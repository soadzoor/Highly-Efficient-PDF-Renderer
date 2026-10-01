import { VECTOR_CLIP_AA_WGSL } from "./vectorClipShaders";
import { RASTER_STRIP_LEVEL_WGSL, RASTER_STRIP_SAMPLE_WGSL } from "./rasterStripWebGpuSampling";

/** Independent one-row image mip chains share an atlas without cross-image filtering. */
export const RASTER_STRIP_WGSL = /* wgsl */ `
struct CameraUniforms {
  viewport : vec2f,
  cameraCenter : vec2f,
  zoom : f32,
  strokeAAScreenPx : f32,
  strokeCurveEnabled : f32,
  textAAScreenPx : f32,
  textCurveEnabled : f32,
  fillAAScreenPx : f32,
  textVectorOnly : f32,
  pad0 : f32,
  vectorOverride : vec4f,
};

struct RasterStripInstance {
  matrixA : vec4f,
  matrixB : vec4f,
};

@group(0) @binding(0) var<uniform> uCamera : CameraUniforms;
@group(0) @binding(1) var<storage, read> uInstances : array<RasterStripInstance>;
@group(0) @binding(2) var uRasterSampler : sampler;
@group(0) @binding(3) var uRasterTex : texture_2d<f32>;
@group(1) @binding(0) var uVectorClipTex : texture_2d<f32>;
@group(1) @binding(1) var<uniform> uVectorClip : vec4f;
${VECTOR_CLIP_AA_WGSL}

struct VsOut {
  @builtin(position) position : vec4f,
  @location(0) uv : vec2f,
  @location(1) world : vec2f,
  @location(2) @interpolate(flat) row : u32,
  @location(3) @interpolate(flat) width : f32,
  @location(4) @interpolate(flat) opacity : f32,
};

@vertex
fn vsMain(
  @builtin(vertex_index) vertexIndex : u32,
  @builtin(instance_index) instanceIndex : u32
) -> VsOut {
  let uv = vec2f(f32(vertexIndex & 1u), 1.0 - f32(vertexIndex >> 1u));
  let instance = uInstances[instanceIndex];
  let world = vec2f(
    instance.matrixA.x * uv.x + instance.matrixA.z * uv.y + instance.matrixB.x,
    instance.matrixA.y * uv.x + instance.matrixA.w * uv.y + instance.matrixB.y
  );
  let screen = (world - uCamera.cameraCenter) * uCamera.zoom + 0.5 * uCamera.viewport;
  var out : VsOut;
  out.position = vec4f(screen / (0.5 * uCamera.viewport) - 1.0, 0.0, 1.0);
  out.uv = uv;
  out.world = world;
  out.row = instanceIndex;
  out.width = instance.matrixB.z;
  out.opacity = instance.matrixB.w;
  return out;
}

${RASTER_STRIP_LEVEL_WGSL}
${RASTER_STRIP_SAMPLE_WGSL}

@fragment
fn fsMain(inData : VsOut) -> @location(0) vec4f {
  // An antialiased clip edge, measured before any discard; color is premultiplied.
  let clipAAWidth = max(max(length(vec2f(dpdx(inData.world.x), dpdy(inData.world.x))),
    length(vec2f(dpdx(inData.world.y), dpdy(inData.world.y)))), 1e-4);
  let color = heprRasterStripSample(
    uRasterTex, uRasterSampler, inData.uv, inData.row, u32(inData.width)
  ) * inData.opacity;
  if (color.a <= 0.001) { discard; }
  return color * heprVectorClipAA(inData.world, uVectorClip.x, uVectorClipTex, clipAAWidth);
}
`;
