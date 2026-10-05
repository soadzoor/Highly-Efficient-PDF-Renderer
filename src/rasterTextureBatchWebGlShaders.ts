import { VECTOR_CLIP_GLSL } from "./vectorClipShaders";
import { RASTER_CLIP_UV_BOUNDS_GLSL } from "./rasterClipBounds";

// Leave two fragment samplers for geometric clips and a folded soft mask.
export const RASTER_BATCH_TEXTURES = 14;
export const RASTER_BATCH_INSTANCES = 512;
export const RASTER_BATCH_INSTANCE_FLOATS = 16;

// Clip roots travel with the image, so different clips do not split a draw.
const INSTANCE_CLIP_GLSL = VECTOR_CLIP_GLSL.replace("uniform float uVectorClipIndex;", "")
  .replace(/uVectorClipIndex/g, "vRasterClip");

export const RASTER_TEXTURE_BATCH_VERTEX_GLSL = `#version 300 es
precision highp float;

layout(location = 0) in vec4 aRasterMatrixABCD;
layout(location = 1) in vec4 aRasterEFOpacityClip;
layout(location = 2) in vec3 aTextureSlotUvMargin;
layout(location = 3) in vec4 aRasterUvBounds;
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

${RASTER_CLIP_UV_BOUNDS_GLSL}

void main() {
  vec2 uv = vec2(float(gl_VertexID & 1), float(1 - (gl_VertexID >> 1)));
  vOpacity = aRasterEFOpacityClip.z;
  vRasterClip = aRasterEFOpacityClip.w; vTextureSlot = aTextureSlotUvMargin.x;
  if (uUseLocalToClip < 0.5) {
    vec4 bounds = heprRasterClipUvBounds(aRasterUvBounds, aTextureSlotUvMargin.yz,
      max(1.0 / max(uZoom, 1e-6), 1e-4));
    if (bounds.x > bounds.z || bounds.y > bounds.w) {
      vUv = vec2(0.0); vWorld = vec2(0.0);
      gl_Position = vec4(0.0, 0.0, 2.0, 1.0);
      return;
    }
    uv = mix(bounds.xy, bounds.zw, uv);
  }
  vec2 world = vec2(
    aRasterMatrixABCD.x * uv.x + aRasterMatrixABCD.z * uv.y + aRasterEFOpacityClip.x,
    aRasterMatrixABCD.y * uv.x + aRasterMatrixABCD.w * uv.y + aRasterEFOpacityClip.y
  );
  if (uUseLocalToClip >= 0.5) gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    gl_Position = vec4(screen / (0.5 * uViewport) - 1.0, 0.0, 1.0);
  }
  vUv = uv; vWorld = world;
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
uniform sampler2D uRasterBatchTex8;
uniform sampler2D uRasterBatchTex9;
uniform sampler2D uRasterBatchTex10;
uniform sampler2D uRasterBatchTex11;
uniform sampler2D uRasterBatchTex12;
uniform sampler2D uRasterBatchTex13;
uniform float uPdfShapeOnly;
in vec2 vUv;
in vec2 vWorld;
flat in float vOpacity;
flat in float vRasterClip;
flat in float vTextureSlot;
out vec4 outColor;

${INSTANCE_CLIP_GLSL}

// A balanced choice keeps every slot within four comparisons. Explicit
// sampler names and derivatives preserve mip filtering across instances.
vec4 heprRasterBatchSample(float slot, vec2 uv, vec2 dx, vec2 dy) {
  vec4 color = vec4(0.0, 0.0, 0.0, 0.0);
  if (slot < 6.5) {
    if (slot < 2.5) {
      if (slot < 0.5) color = textureGrad(uRasterBatchTex0, uv, dx, dy);
      else if (slot < 1.5) color = textureGrad(uRasterBatchTex1, uv, dx, dy);
      else color = textureGrad(uRasterBatchTex2, uv, dx, dy);
    } else if (slot < 4.5) {
      if (slot < 3.5) color = textureGrad(uRasterBatchTex3, uv, dx, dy);
      else color = textureGrad(uRasterBatchTex4, uv, dx, dy);
    } else {
      if (slot < 5.5) color = textureGrad(uRasterBatchTex5, uv, dx, dy);
      else color = textureGrad(uRasterBatchTex6, uv, dx, dy);
    }
  } else {
    if (slot < 9.5) {
      if (slot < 7.5) color = textureGrad(uRasterBatchTex7, uv, dx, dy);
      else if (slot < 8.5) color = textureGrad(uRasterBatchTex8, uv, dx, dy);
      else color = textureGrad(uRasterBatchTex9, uv, dx, dy);
    } else if (slot < 11.5) {
      if (slot < 10.5) color = textureGrad(uRasterBatchTex10, uv, dx, dy);
      else color = textureGrad(uRasterBatchTex11, uv, dx, dy);
    } else {
      if (slot < 12.5) color = textureGrad(uRasterBatchTex12, uv, dx, dy);
      else color = textureGrad(uRasterBatchTex13, uv, dx, dy);
    }
  }
  return color;
}

void main() {
  float clipAAWidth = max(max(length(vec2(dFdx(vWorld.x), dFdy(vWorld.x))),
    length(vec2(dFdx(vWorld.y), dFdy(vWorld.y)))), 1e-4);
  // Sampler indices must be constant in GLSL ES. Explicit derivatives retain
  // the original hardware mip filtering across nonuniform texture branches.
  vec2 dx = dFdx(vUv), dy = dFdy(vUv);
  vec4 color = heprRasterBatchSample(vTextureSlot, vUv, dx, dy);
  color *= mix(vOpacity, 1.0, uPdfShapeOnly);
  if (color.a <= 0.001) discard;
  outColor = color * heprVectorClipAA(vWorld, clipAAWidth);
}
`;
