import { VECTOR_CLIP_GLSL } from "./vectorClipShaders";

export const RASTER_BATCH_TEXTURES = 8;
export const RASTER_BATCH_INSTANCES = 512;

// Clip roots travel with the image, so different clips do not split a draw.
const INSTANCE_CLIP_GLSL = VECTOR_CLIP_GLSL.replace("uniform float uVectorClipIndex;", "")
  .replace(/uVectorClipIndex/g, "vRasterClip");

export const RASTER_TEXTURE_BATCH_VERTEX_GLSL = `#version 300 es
precision highp float;

layout(location = 0) in vec4 aRasterMatrixABCD;
layout(location = 1) in vec4 aRasterEFOpacityClip;
layout(location = 2) in float aTextureSlot;
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;
out vec2 vUv;
out vec2 vWorld;
flat out float vOpacity;
flat out float vRasterClip;
flat out float vTextureSlot;

void main() {
  vec2 uv = vec2(float(gl_VertexID & 1), float(1 - (gl_VertexID >> 1)));
  vec2 world = vec2(
    aRasterMatrixABCD.x * uv.x + aRasterMatrixABCD.z * uv.y + aRasterEFOpacityClip.x,
    aRasterMatrixABCD.y * uv.x + aRasterMatrixABCD.w * uv.y + aRasterEFOpacityClip.y
  );
  if (uUseLocalToClip >= 0.5) gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    gl_Position = vec4(screen / (0.5 * uViewport) - 1.0, 0.0, 1.0);
  }
  vUv = uv; vWorld = world; vOpacity = aRasterEFOpacityClip.z;
  vRasterClip = aRasterEFOpacityClip.w; vTextureSlot = aTextureSlot;
}
`;

export const RASTER_TEXTURE_BATCH_FRAGMENT_GLSL = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uRasterBatchTex0;
uniform sampler2D uRasterBatchTex1;
uniform sampler2D uRasterBatchTex2;
uniform sampler2D uRasterBatchTex3;
uniform sampler2D uRasterBatchTex4;
uniform sampler2D uRasterBatchTex5;
uniform sampler2D uRasterBatchTex6;
uniform sampler2D uRasterBatchTex7;
uniform float uPdfShapeOnly;
in vec2 vUv;
in vec2 vWorld;
flat in float vOpacity;
flat in float vRasterClip;
flat in float vTextureSlot;
out vec4 outColor;

${INSTANCE_CLIP_GLSL}

void main() {
  float clipAAWidth = max(max(length(vec2(dFdx(vWorld.x), dFdy(vWorld.x))),
    length(vec2(dFdx(vWorld.y), dFdy(vWorld.y)))), 1e-4);
  // Sampler indices must be constant in GLSL ES. Explicit derivatives retain
  // the original hardware mip filtering across nonuniform texture branches.
  vec2 dx = dFdx(vUv), dy = dFdy(vUv);
  vec4 color;
  if (vTextureSlot < 0.5) color = textureGrad(uRasterBatchTex0, vUv, dx, dy);
  else if (vTextureSlot < 1.5) color = textureGrad(uRasterBatchTex1, vUv, dx, dy);
  else if (vTextureSlot < 2.5) color = textureGrad(uRasterBatchTex2, vUv, dx, dy);
  else if (vTextureSlot < 3.5) color = textureGrad(uRasterBatchTex3, vUv, dx, dy);
  else if (vTextureSlot < 4.5) color = textureGrad(uRasterBatchTex4, vUv, dx, dy);
  else if (vTextureSlot < 5.5) color = textureGrad(uRasterBatchTex5, vUv, dx, dy);
  else if (vTextureSlot < 6.5) color = textureGrad(uRasterBatchTex6, vUv, dx, dy);
  else color = textureGrad(uRasterBatchTex7, vUv, dx, dy);
  color *= mix(vOpacity, 1.0, uPdfShapeOnly);
  if (color.a <= 0.001) discard;
  outColor = color * heprVectorClipAA(vWorld, clipAAWidth);
}
`;
