import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import {
  buildOrderedGradientPaintCommands,
  GRADIENT_LUT_WIDTH,
  orderedGradientPaintNeedsDirectRendering,
  planOrderedGradientMinify,
  readGradientSceneData,
  type GradientSceneData,
  type OrderedGradientPaintCommand
} from "./orderedGradientPaint";
import { GRADIENT_FILL_WGSL, GRADIENT_STROKE_WGSL } from "./nativeGradientWebGpuShaders";
import {
  isNativeTextHeavyStrokeFreeScene,
  NATIVE_VECTOR_MINIFY_ENABLED,
  shouldUseNativePanCacheForFrame
} from "./nativeRenderPolicy";
import { prepareSearchHighlights, type SearchHighlightSet } from "./searchHighlights";
import type {
  DrawStats,
  SceneStats,
  ViewState,
  ViewStateUpdateOptions
} from "./webGlFloorplanRenderer";
import {
  CORE_WGSL_DISTANCE_TO_LINE_SEGMENT_SOURCE,
  CORE_WGSL_DISTANCE_TO_QUADRATIC_BEZIER_SOURCE,
  CORE_WGSL_STROKE_QUAD_WORLD_POSITION_SOURCE
} from "./coreWgslShaders";
import { buildSpatialGrid, type SpatialGrid } from "./spatialGrid";
import {
  appendTextLodCombinedPayload,
  TEXT_LOD_SOLID_GLYPH_SEGMENT_COUNT,
  type TextLodBuildData
} from "./textGreekLod";
import { createOrthographicLocalToClip } from "./planarProjection";
import {
  getCachedTextLod,
  getOrBuildTextLod,
  TextLodRuntime,
  type TextLodMode,
  type TextLodStats
} from "./textLodCore";
import { buildSingleChannelUint8MipChain } from "./singleChannelMipChain";
import { buildTextRasterAtlas } from "./textRasterAtlas";
import {
  shouldUseVectorStrokeLod,
  takePrebuiltVectorStrokeLodRuntime,
  VectorStrokeLodRuntime,
  type VectorLodMode,
  type VectorStrokeLodStats
} from "./vectorStrokeLodCore";

type FrameListener = (stats: DrawStats) => void;

interface WebGpuRasterLayerResource {
  texture: any;
  uniformBuffer: any;
  bindGroup: any;
  paintOrder: number;
  pageIndex: number;
}

interface WebGpuVectorLodLevelResource {
  textureA: any;
  textureB: any;
  textureC: any;
  textureD: any;
  textureWidth: number;
  textureHeight: number;
  visibleSegmentIdBuffer: any;
  bindGroup: any;
  ownsTextures: boolean;
}

interface TextureDimensions {
  width: number;
  height: number;
}

interface NativeTextUploadArrays {
  textInstanceA: Float32Array;
  textInstanceB: Float32Array;
  textInstanceC: Float32Array;
  textGlyphMetaA: Float32Array;
  textGlyphMetaB: Float32Array;
  textGlyphSegmentsA: Float32Array;
  textGlyphSegmentsB: Float32Array;
}

const INTERACTION_DECAY_MS = 140;
const FULL_VIEW_FALLBACK_THRESHOLD = 0.92;
const PAN_CACHE_MIN_SEGMENTS = 300_000;
const PAN_CACHE_OVERSCAN_FACTOR = 1.8;
const PAN_CACHE_BORDER_PX = 96;
const PAN_CACHE_ZOOM_EPSILON = 1e-5;
const PAN_CACHE_ZOOM_RATIO_MIN = 0.75;
const PAN_CACHE_ZOOM_RATIO_MAX = 1.3333333333;
const VECTOR_MINIFY_SUPERSAMPLE = 2;
const VECTOR_MINIFY_MAX_ZOOM = 2.25;
const CAMERA_DAMPING_POSITION_RATE = 24;
const CAMERA_DAMPING_ZOOM_RATE = 24;
const CAMERA_DAMPING_POSITION_EPSILON = 1e-4;
const CAMERA_DAMPING_ZOOM_EPSILON = 1e-5;
const CAMERA_DAMPING_MAX_DT_MS = 64;
const PAN_INERTIA_MIN_SPEED_WORLD_PER_SEC = 5;
const PAN_MAX_SPEED_WORLD_PER_SEC = 20_000;
const PAN_INERTIA_VELOCITY_STALE_MS = 120;
const CLEAR_COLOR = {
  r: 160 / 255,
  g: 169 / 255,
  b: 175 / 255,
  a: 1
};

const CAMERA_UNIFORM_FLOATS = 16;
const CAMERA_UNIFORM_BUFFER_BYTES = 64;

const BLIT_UNIFORM_FLOATS = 12;
const BLIT_UNIFORM_BUFFER_BYTES = 48;

const VECTOR_COMPOSITE_UNIFORM_FLOATS = 4;
const VECTOR_COMPOSITE_UNIFORM_BUFFER_BYTES = 16;

const RASTER_UNIFORM_FLOATS = 8;
const RASTER_UNIFORM_BUFFER_BYTES = 32;

const WGSL_OUTPUT_COLOR_HELPERS = /* wgsl */ `
fn heprEncodeOutputColor(color : vec4f) -> vec4f {
  // Extracted PDF colors are display/sRGB values and the presentation target is
  // unorm. Preserve those values instead of applying the transfer curve twice.
  return color;
}

fn heprLinearCoverageToOutputAlpha(coverage : f32) -> f32 {
  return clamp(coverage, 0.0, 1.0);
}
`;

const STROKE_SHADER_SOURCE = /* wgsl */ `
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

struct SegmentIdBuffer {
  values : array<u32>,
};

@group(0) @binding(0) var<uniform> uCamera : CameraUniforms;
@group(0) @binding(1) var uSegmentTexA : texture_2d<f32>;
@group(0) @binding(2) var uSegmentTexB : texture_2d<f32>;
@group(0) @binding(3) var uSegmentStyleTex : texture_2d<f32>;
@group(0) @binding(4) var uSegmentBoundsTex : texture_2d<f32>;
@group(0) @binding(5) var<storage, read> uSegmentIds : SegmentIdBuffer;

struct VsOut {
  @builtin(position) position : vec4f,
  @location(0) local : vec2f,
  @location(1) @interpolate(flat) p0 : vec2f,
  @location(2) @interpolate(flat) p1 : vec2f,
  @location(3) @interpolate(flat) p2 : vec2f,
  @location(4) @interpolate(flat) primitiveType : f32,
  @location(5) @interpolate(flat) halfWidth : f32,
  @location(6) @interpolate(flat) aaWorld : f32,
  @location(7) @interpolate(flat) color : vec3f,
  @location(8) @interpolate(flat) alpha : f32,
  @location(9) @interpolate(flat) clipBounds : vec4f,
  @location(10) @interpolate(flat) hasClipBounds : f32,
};

${WGSL_OUTPUT_COLOR_HELPERS}

fn cornerFromVertexIndex(vertexIndex : u32) -> vec2f {
  switch (vertexIndex) {
    case 0u: {
      return vec2f(-1.0, -1.0);
    }
    case 1u: {
      return vec2f(1.0, -1.0);
    }
    case 2u: {
      return vec2f(-1.0, 1.0);
    }
    default: {
      return vec2f(1.0, 1.0);
    }
  }
}

fn coordFromIndex(index : u32, width : u32) -> vec2<i32> {
  return vec2<i32>(i32(index % width), i32(index / width));
}

${CORE_WGSL_DISTANCE_TO_LINE_SEGMENT_SOURCE}
${CORE_WGSL_DISTANCE_TO_QUADRATIC_BEZIER_SOURCE}
${CORE_WGSL_STROKE_QUAD_WORLD_POSITION_SOURCE}
@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32, @builtin(instance_index) instanceIndex : u32) -> VsOut {
  let segmentIndex = uSegmentIds.values[instanceIndex];
  let dims = textureDimensions(uSegmentTexA);
  let coord = coordFromIndex(segmentIndex, dims.x);

  let primitiveA = textureLoad(uSegmentTexA, coord, 0);
  let primitiveB = textureLoad(uSegmentTexB, coord, 0);
  let style = textureLoad(uSegmentStyleTex, coord, 0);
  let primitiveBounds = textureLoad(uSegmentBoundsTex, coord, 0);

  let p0 = primitiveA.xy;
  let p1 = primitiveA.zw;
  let p2 = primitiveB.xy;
  let primitiveType = primitiveB.z;
  let isQuadratic = primitiveType >= 0.5;

  var halfWidth = style.x;
  let color = style.yzw;
  let packedStyle = primitiveB.w;
  let styleFlags = i32(floor(packedStyle / 2.0 + 1e-6));
  let alpha = clamp(packedStyle - f32(styleFlags) * 2.0, 0.0, 1.0);
  let isHairline = (styleFlags & 1) != 0;
  let isRoundCap = (styleFlags & 2) != 0;
  let isClipped = (styleFlags & 4) != 0;

  let geometryLength = select(length(p2 - p0), length(p1 - p0) + length(p2 - p1), isQuadratic);

  var out : VsOut;
  if ((geometryLength < 1e-5 && !isRoundCap) || alpha <= 0.001) {
    out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
    out.local = vec2f(0.0, 0.0);
    out.p0 = vec2f(0.0, 0.0);
    out.p1 = vec2f(0.0, 0.0);
    out.p2 = vec2f(0.0, 0.0);
    out.primitiveType = 0.0;
    out.halfWidth = 0.0;
    out.aaWorld = 1.0;
    out.color = color;
    out.alpha = 0.0;
    out.clipBounds = vec4f(0.0, 0.0, 0.0, 0.0);
    out.hasClipBounds = 0.0;
    return out;
  }

  if (isHairline) {
    halfWidth = max(0.5 / max(uCamera.zoom, 1e-4), 1e-5);
  }

  var aaWorld = max(1.0 / max(uCamera.zoom, 1e-4), 0.0001) * uCamera.strokeAAScreenPx;
  if (isHairline) {
    aaWorld = max(0.35 / max(uCamera.zoom, 1e-4), 5e-5);
  }

  let extent = halfWidth + aaWorld;
  let corner01 = cornerFromVertexIndex(vertexIndex) * 0.5 + 0.5;
  let worldPosition = heprStrokeQuadWorldPosition(corner01, p0, p1, p2, primitiveBounds, extent);

  let screen = (worldPosition - uCamera.cameraCenter) * uCamera.zoom + 0.5 * uCamera.viewport;
  let clip = (screen / (0.5 * uCamera.viewport)) - 1.0;

  out.position = vec4f(clip, 0.0, 1.0);
  out.local = worldPosition;
  out.p0 = p0;
  out.p1 = p1;
  out.p2 = p2;
  out.primitiveType = primitiveType;
  out.halfWidth = halfWidth;
  out.aaWorld = aaWorld;
  out.color = color;
  out.alpha = alpha;
  out.clipBounds = primitiveBounds;
  out.hasClipBounds = select(0.0, 1.0, isClipped);
  return out;
}

@fragment
fn fsMain(inData : VsOut) -> @location(0) vec4f {
  if (inData.alpha <= 0.001) {
    discard;
  }

  if (
    inData.hasClipBounds >= 0.5 &&
    (inData.local.x < inData.clipBounds.x || inData.local.y < inData.clipBounds.y ||
      inData.local.x > inData.clipBounds.z || inData.local.y > inData.clipBounds.w)
  ) {
    discard;
  }

  let useCurve = uCamera.strokeCurveEnabled >= 0.5 && inData.primitiveType >= 0.5;
  let distanceToSegment = select(
    heprDistanceToLineSegment(inData.local, inData.p0, inData.p2),
    heprDistanceToQuadraticBezier(inData.local, inData.p0, inData.p1, inData.p2),
    useCurve
  );

  let coverage = 1.0 - smoothstep(inData.halfWidth - inData.aaWorld, inData.halfWidth + inData.aaWorld, distanceToSegment);
  let alpha = heprLinearCoverageToOutputAlpha(coverage) * inData.alpha;

  if (alpha <= 0.001) {
    discard;
  }

  let color = mix(inData.color, uCamera.vectorOverride.xyz, clamp(uCamera.vectorOverride.w, 0.0, 1.0));
  return heprEncodeOutputColor(vec4f(color, alpha));
}
`;

const FILL_SHADER_SOURCE = /* wgsl */ `
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

@group(0) @binding(0) var<uniform> uCamera : CameraUniforms;
@group(0) @binding(1) var uFillPathMetaTexA : texture_2d<f32>;
@group(0) @binding(2) var uFillPathMetaTexB : texture_2d<f32>;
@group(0) @binding(3) var uFillPathMetaTexC : texture_2d<f32>;
@group(0) @binding(4) var uFillSegmentTexA : texture_2d<f32>;
@group(0) @binding(5) var uFillSegmentTexB : texture_2d<f32>;

struct VsOut {
  @builtin(position) position : vec4f,
  @location(0) local : vec2f,
  @location(1) @interpolate(flat) segmentStart : i32,
  @location(2) @interpolate(flat) segmentCount : i32,
  @location(3) @interpolate(flat) color : vec3f,
  @location(4) @interpolate(flat) alpha : f32,
  @location(5) @interpolate(flat) fillRule : f32,
  @location(6) @interpolate(flat) fillHasCompanionStroke : f32,
};

${WGSL_OUTPUT_COLOR_HELPERS}

const MAX_FILL_PATH_PRIMITIVES : i32 = 2048;
const FILL_PRIMITIVE_QUADRATIC : f32 = 1.0;
const QUAD_WINDING_SUBDIVISIONS : i32 = 6;

fn cornerFromVertexIndex(vertexIndex : u32) -> vec2f {
  switch (vertexIndex) {
    case 0u: {
      return vec2f(-1.0, -1.0);
    }
    case 1u: {
      return vec2f(1.0, -1.0);
    }
    case 2u: {
      return vec2f(-1.0, 1.0);
    }
    default: {
      return vec2f(1.0, 1.0);
    }
  }
}

fn coordFromIndex(index : i32, width : i32) -> vec2<i32> {
  return vec2<i32>(index % width, index / width);
}

fn distanceToLineSegment(p : vec2f, a : vec2f, b : vec2f) -> f32 {
  let ab = b - a;
  let abLenSq = dot(ab, ab);
  if (abLenSq <= 1e-10) {
    return length(p - a);
  }
  let t = clamp(dot(p - a, ab) / abLenSq, 0.0, 1.0);
  return length(p - (a + ab * t));
}

fn distanceToQuadraticBezier(p : vec2f, a : vec2f, b : vec2f, c : vec2f) -> f32 {
  let aa = b - a;
  let bb = a - 2.0 * b + c;
  let cc = aa * 2.0;
  let dd = a - p;

  let bbLenSq = dot(bb, bb);
  if (bbLenSq <= 1e-12) {
    return distanceToLineSegment(p, a, c);
  }

  let inv = 1.0 / bbLenSq;
  let kx = inv * dot(aa, bb);
  let ky = inv * (2.0 * dot(aa, aa) + dot(dd, bb)) / 3.0;
  let kz = inv * dot(dd, aa);

  let pValue = ky - kx * kx;
  let pCube = pValue * pValue * pValue;
  let qValue = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  let hValue = qValue * qValue + 4.0 * pCube;

  var best = 1e20;

  if (hValue >= 0.0) {
    let hSqrt = sqrt(hValue);
    let roots = (vec2f(hSqrt, -hSqrt) - qValue) * 0.5;
    let uv = sign(roots) * pow(abs(roots), vec2f(1.0 / 3.0));
    let t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    let delta = dd + (cc + bb * t) * t;
    best = dot(delta, delta);
  } else {
    let z = sqrt(-pValue);
    let acosArg = clamp(qValue / (2.0 * pValue * z), -1.0, 1.0);
    let angle = acos(acosArg) / 3.0;
    let cosine = cos(angle);
    let sine = sin(angle) * 1.732050808;
    let t = clamp(vec3f(cosine + cosine, -sine - cosine, sine - cosine) * z - kx, vec3f(0.0), vec3f(1.0));

    var delta = dd + (cc + bb * t.x) * t.x;
    best = min(best, dot(delta, delta));
    delta = dd + (cc + bb * t.y) * t.y;
    best = min(best, dot(delta, delta));
    delta = dd + (cc + bb * t.z) * t.z;
    best = min(best, dot(delta, delta));
  }

  return sqrt(max(best, 0.0));
}

fn evaluateQuadratic(a : vec2f, b : vec2f, c : vec2f, t : f32) -> vec2f {
  let oneMinusT = 1.0 - t;
  return oneMinusT * oneMinusT * a + 2.0 * oneMinusT * t * b + t * t * c;
}

fn accumulateLineCrossing(a : vec2f, b : vec2f, p : vec2f, winding : ptr<function, i32>, crossings : ptr<function, i32>) {
  let upward = (a.y <= p.y) && (b.y > p.y);
  let downward = (a.y > p.y) && (b.y <= p.y);
  if (!upward && !downward) {
    return;
  }

  let denom = b.y - a.y;
  if (abs(denom) <= 1e-6) {
    return;
  }

  let xCross = a.x + (p.y - a.y) * (b.x - a.x) / denom;
  if (xCross > p.x) {
    *crossings = *crossings + 1;
    *winding = *winding + select(-1, 1, upward);
  }
}

fn accumulateQuadraticCrossing(a : vec2f, b : vec2f, c : vec2f, p : vec2f, winding : ptr<function, i32>, crossings : ptr<function, i32>) {
  var prev = a;
  for (var i = 1; i <= QUAD_WINDING_SUBDIVISIONS; i = i + 1) {
    let t = f32(i) / f32(QUAD_WINDING_SUBDIVISIONS);
    let next = evaluateQuadratic(a, b, c, t);
    accumulateLineCrossing(prev, next, p, winding, crossings);
    prev = next;
  }
}

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32, @builtin(instance_index) instanceIndex : u32) -> VsOut {
  let metaDims = textureDimensions(uFillPathMetaTexA);
  let pathIndex = i32(instanceIndex);
  let coord = coordFromIndex(pathIndex, i32(metaDims.x));

  let metaA = textureLoad(uFillPathMetaTexA, coord, 0);
  let metaB = textureLoad(uFillPathMetaTexB, coord, 0);
  let metaC = textureLoad(uFillPathMetaTexC, coord, 0);

  let segmentCount = i32(metaA.y + 0.5);
  let alpha = metaC.w;

  var out : VsOut;
  if (segmentCount <= 0 || alpha <= 0.001) {
    out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
    out.local = vec2f(0.0, 0.0);
    out.segmentStart = 0;
    out.segmentCount = 0;
    out.color = vec3f(0.0, 0.0, 0.0);
    out.alpha = 0.0;
    out.fillRule = 0.0;
    out.fillHasCompanionStroke = 0.0;
    return out;
  }

  let minBounds = metaA.zw;
  let maxBounds = metaB.xy;
  let corner01 = cornerFromVertexIndex(vertexIndex) * 0.5 + 0.5;
  let world = mix(minBounds, maxBounds, corner01);

  let screen = (world - uCamera.cameraCenter) * uCamera.zoom + 0.5 * uCamera.viewport;
  let clip = (screen / (0.5 * uCamera.viewport)) - 1.0;

  out.position = vec4f(clip, 0.0, 1.0);
  out.local = world;
  out.segmentStart = i32(metaA.x + 0.5);
  out.segmentCount = segmentCount;
  out.color = vec3f(metaB.z, metaB.w, metaC.z);
  out.alpha = alpha;
  out.fillRule = metaC.x;
  out.fillHasCompanionStroke = metaC.y;
  return out;
}

@fragment
fn fsMain(inData : VsOut) -> @location(0) vec4f {
  let pixelToLocalX = length(vec2f(dpdx(inData.local.x), dpdy(inData.local.x)));
  let pixelToLocalY = length(vec2f(dpdx(inData.local.y), dpdy(inData.local.y)));
  let aaWidth = max(max(pixelToLocalX, pixelToLocalY) * uCamera.fillAAScreenPx, 1e-4);

  if (inData.segmentCount <= 0 || inData.alpha <= 0.001) {
    discard;
  }

  let fillSegDims = textureDimensions(uFillSegmentTexA);

  var minDistance = 1e20;
  var winding = 0;
  var crossings = 0;

  for (var i = 0; i < MAX_FILL_PATH_PRIMITIVES; i = i + 1) {
    if (i >= inData.segmentCount) {
      break;
    }

    let segmentIndex = inData.segmentStart + i;
    let coord = coordFromIndex(segmentIndex, i32(fillSegDims.x));

    let primitiveA = textureLoad(uFillSegmentTexA, coord, 0);
    let primitiveB = textureLoad(uFillSegmentTexB, coord, 0);
    let p0 = primitiveA.xy;
    let p1 = primitiveA.zw;
    let p2 = primitiveB.xy;
    let primitiveType = primitiveB.z;

    if (primitiveType >= FILL_PRIMITIVE_QUADRATIC) {
      minDistance = min(minDistance, distanceToQuadraticBezier(inData.local, p0, p1, p2));
      accumulateQuadraticCrossing(p0, p1, p2, inData.local, &winding, &crossings);
    } else {
      minDistance = min(minDistance, distanceToLineSegment(inData.local, p0, p2));
      accumulateLineCrossing(p0, p2, inData.local, &winding, &crossings);
    }
  }

  let insideNonZero = winding != 0;
  let insideEvenOdd = (crossings & 1) == 1;
  let inside = select(insideNonZero, insideEvenOdd, inData.fillRule >= 0.5);
  let color = mix(inData.color, uCamera.vectorOverride.xyz, clamp(uCamera.vectorOverride.w, 0.0, 1.0));

  if (inData.fillHasCompanionStroke >= 0.5) {
    let alpha = select(0.0, inData.alpha, inside);
    if (alpha <= 0.001) {
      discard;
    }
    return heprEncodeOutputColor(vec4f(color, alpha));
  }

  let signedDistance = select(minDistance, -minDistance, inside);

  let coverage = clamp(0.5 - signedDistance / aaWidth, 0.0, 1.0);
  let alpha = heprLinearCoverageToOutputAlpha(coverage) * inData.alpha;
  if (alpha <= 0.001) {
    discard;
  }

  return heprEncodeOutputColor(vec4f(color, alpha));
}
`;

const TEXT_SHADER_SOURCE = /* wgsl */ `
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

@group(0) @binding(0) var<uniform> uCamera : CameraUniforms;
@group(0) @binding(1) var uTextInstanceTexA : texture_2d<f32>;
@group(0) @binding(2) var uTextInstanceTexB : texture_2d<f32>;
@group(0) @binding(3) var uTextInstanceTexC : texture_2d<f32>;
@group(0) @binding(4) var uTextGlyphMetaTexA : texture_2d<f32>;
@group(0) @binding(5) var uTextGlyphMetaTexB : texture_2d<f32>;
@group(0) @binding(6) var uTextGlyphSegmentTexA : texture_2d<f32>;
@group(0) @binding(7) var uTextGlyphSegmentTexB : texture_2d<f32>;
@group(0) @binding(8) var uTextGlyphRasterMetaTex : texture_2d<f32>;
@group(0) @binding(9) var uTextRasterSampler : sampler;
@group(0) @binding(10) var uTextRasterAtlasTex : texture_2d<f32>;

struct TextInstanceIdBuffer {
  values : array<u32>,
};

@group(0) @binding(11) var<storage, read> uTextInstanceIds : TextInstanceIdBuffer;

struct VsOut {
  @builtin(position) position : vec4f,
  @location(0) local : vec2f,
  @location(1) @interpolate(flat) segmentStart : i32,
  @location(2) @interpolate(flat) segmentCount : i32,
  @location(3) @interpolate(flat) color : vec3f,
  @location(4) @interpolate(flat) colorAlpha : f32,
  @location(5) @interpolate(flat) rasterRect : vec4f,
  @location(6) normCoord : vec2f,
};

${WGSL_OUTPUT_COLOR_HELPERS}

const MAX_GLYPH_PRIMITIVES : i32 = 256;
const TEXT_PRIMITIVE_QUADRATIC : f32 = 1.0;

fn cornerFromVertexIndex(vertexIndex : u32) -> vec2f {
  switch (vertexIndex) {
    case 0u: {
      return vec2f(-1.0, -1.0);
    }
    case 1u: {
      return vec2f(1.0, -1.0);
    }
    case 2u: {
      return vec2f(-1.0, 1.0);
    }
    default: {
      return vec2f(1.0, 1.0);
    }
  }
}

fn coordFromIndex(index : i32, width : i32) -> vec2<i32> {
  return vec2<i32>(index % width, index / width);
}

fn textLineDistanceInfo(p : vec2f, a : vec2f, b : vec2f) -> vec4f {
  let ab = b - a;
  let abLenSq = dot(ab, ab);
  if (abLenSq <= 1e-10) {
    return vec4f(length(p - a), 0.0, 1.0, 0.0);
  }
  let t = clamp(dot(p - a, ab) / abLenSq, 0.0, 1.0);
  let offset = p - (a + ab * t);
  let tangent = ab * inverseSqrt(abLenSq);
  let leftNormal = vec2f(-tangent.y, tangent.x);
  return vec4f(length(offset), t, leftNormal);
}

fn textQuadraticDistanceInfo(p : vec2f, a : vec2f, b : vec2f, c : vec2f) -> vec4f {
  let aa = b - a;
  let bb = a - 2.0 * b + c;
  let cc = aa * 2.0;
  let dd = a - p;

  let bbLenSq = dot(bb, bb);
  if (bbLenSq <= 1e-12) {
    return textLineDistanceInfo(p, a, c);
  }

  let inv = 1.0 / bbLenSq;
  let kx = inv * dot(aa, bb);
  let ky = inv * (2.0 * dot(aa, aa) + dot(dd, bb)) / 3.0;
  let kz = inv * dot(dd, aa);

  let pValue = ky - kx * kx;
  let pCube = pValue * pValue * pValue;
  let qValue = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  let hValue = qValue * qValue + 4.0 * pCube;

  var best = 1e20;
  var closestT = 0.0;

  if (hValue >= 0.0) {
    let hSqrt = sqrt(hValue);
    let roots = (vec2f(hSqrt, -hSqrt) - qValue) * 0.5;
    let uv = sign(roots) * pow(abs(roots), vec2f(1.0 / 3.0));
    closestT = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    let delta = dd + (cc + bb * closestT) * closestT;
    best = dot(delta, delta);
  } else {
    let z = sqrt(-pValue);
    let acosArg = clamp(qValue / (2.0 * pValue * z), -1.0, 1.0);
    let angle = acos(acosArg) / 3.0;
    let cosine = cos(angle);
    let sine = sin(angle) * 1.732050808;
    let t = clamp(vec3f(cosine + cosine, -sine - cosine, sine - cosine) * z - kx, vec3f(0.0), vec3f(1.0));

    var delta = dd + (cc + bb * t.x) * t.x;
    best = dot(delta, delta);
    closestT = t.x;
    delta = dd + (cc + bb * t.y) * t.y;
    var candidate = dot(delta, delta);
    if (candidate < best) {
      best = candidate;
      closestT = t.y;
    }
    delta = dd + (cc + bb * t.z) * t.z;
    candidate = dot(delta, delta);
    if (candidate < best) {
      best = candidate;
      closestT = t.z;
    }
  }

  let closestPoint = evaluateQuadratic(a, b, c, closestT);
  var tangent = 2.0 * ((1.0 - closestT) * (b - a) + closestT * (c - b));
  var tangentLenSq = dot(tangent, tangent);
  if (tangentLenSq <= 1e-12) {
    tangent = c - a;
    tangentLenSq = dot(tangent, tangent);
  }
  var leftNormal = vec2f(1.0, 0.0);
  if (tangentLenSq > 1e-12) {
    leftNormal = vec2f(-tangent.y, tangent.x) * inverseSqrt(tangentLenSq);
  }
  return vec4f(sqrt(max(best, 0.0)), closestT, leftNormal);
}

fn evaluateQuadratic(a : vec2f, b : vec2f, c : vec2f, t : f32) -> vec2f {
  let oneMinusT = 1.0 - t;
  return oneMinusT * oneMinusT * a + 2.0 * oneMinusT * t * b + t * t * c;
}

fn accumulateLineCrossing(a : vec2f, b : vec2f, p : vec2f, winding : ptr<function, i32>) {
  let upward = (a.y <= p.y) && (b.y > p.y);
  let downward = (a.y > p.y) && (b.y <= p.y);
  if (!upward && !downward) {
    return;
  }

  let denom = b.y - a.y;
  if (abs(denom) <= 1e-6) {
    return;
  }

  let xCross = a.x + (p.y - a.y) * (b.x - a.x) / denom;
  if (xCross > p.x) {
    *winding = *winding + select(-1, 1, upward);
  }
}

fn accumulateQuadraticCrossingRoot(
  a : vec2f,
  b : vec2f,
  c : vec2f,
  p : vec2f,
  ay : f32,
  by : f32,
  t : f32,
  winding : ptr<function, i32>
) {
  let rootEps = 1e-5;
  if (t < -rootEps || t >= 1.0 - rootEps) {
    return;
  }

  let tc = clamp(t, 0.0, 1.0);
  let oneMinusT = 1.0 - tc;
  let xCross = oneMinusT * oneMinusT * a.x + 2.0 * oneMinusT * tc * b.x + tc * tc * c.x;
  if (xCross <= p.x) {
    return;
  }

  let dy = by + 2.0 * ay * tc;
  if (abs(dy) <= 1e-6) {
    return;
  }

  *winding = *winding + select(-1, 1, dy > 0.0);
}

fn accumulateQuadraticCrossing(a : vec2f, b : vec2f, c : vec2f, p : vec2f, winding : ptr<function, i32>) {
  let ay = a.y - 2.0 * b.y + c.y;
  let by = 2.0 * (b.y - a.y);
  let cy = a.y - p.y;

  if (abs(ay) <= 1e-8) {
    if (abs(by) <= 1e-8) {
      return;
    }
    let t = -cy / by;
    accumulateQuadraticCrossingRoot(a, b, c, p, ay, by, t, winding);
    return;
  }

  let discriminant = by * by - 4.0 * ay * cy;
  if (discriminant < 0.0) {
    return;
  }

  let sqrtDiscriminant = sqrt(max(discriminant, 0.0));
  let invDen = 0.5 / ay;
  let t0 = (-by - sqrtDiscriminant) * invDen;
  let t1 = (-by + sqrtDiscriminant) * invDen;
  accumulateQuadraticCrossingRoot(a, b, c, p, ay, by, t0, winding);
  if (abs(t1 - t0) > 1e-5) {
    accumulateQuadraticCrossingRoot(a, b, c, p, ay, by, t1, winding);
  }
}

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32, @builtin(instance_index) instanceIndex : u32) -> VsOut {
  let instanceDims = textureDimensions(uTextInstanceTexA);
  let glyphMetaDims = textureDimensions(uTextGlyphMetaTexA);

  // pad0 is an indirection flag for the LOD pipeline. Ordinary scenes retain
  // the original direct instance-index path and do not read the ID buffer.
  var selectedInstanceIndex = instanceIndex;
  if (uCamera.pad0 >= 0.5) {
    selectedInstanceIndex = uTextInstanceIds.values[instanceIndex];
  }
  let instanceIndexI = i32(selectedInstanceIndex);
  let instanceCoord = coordFromIndex(instanceIndexI, i32(instanceDims.x));

  let instanceA = textureLoad(uTextInstanceTexA, instanceCoord, 0);
  let instanceB = textureLoad(uTextInstanceTexB, instanceCoord, 0);
  let instanceC = textureLoad(uTextInstanceTexC, instanceCoord, 0);

  let glyphIndex = i32(instanceB.z + 0.5);
  let glyphCoord = coordFromIndex(glyphIndex, i32(glyphMetaDims.x));
  let glyphMetaA = textureLoad(uTextGlyphMetaTexA, glyphCoord, 0);
  let glyphMetaB = textureLoad(uTextGlyphMetaTexB, glyphCoord, 0);
  let glyphRasterMeta = textureLoad(uTextGlyphRasterMetaTex, glyphCoord, 0);

  let segmentCount = i32(glyphMetaA.y + 0.5);

  var out : VsOut;
  if (segmentCount <= 0) {
    out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
    out.local = vec2f(0.0, 0.0);
    out.segmentStart = 0;
    out.segmentCount = 0;
    out.color = vec3f(0.0, 0.0, 0.0);
    out.colorAlpha = 0.0;
    out.rasterRect = vec4f(0.0, 0.0, 0.0, 0.0);
    out.normCoord = vec2f(0.0, 0.0);
    return out;
  }

  let minBounds = glyphMetaA.zw;
  let maxBounds = glyphMetaB.xy;
  let corner01 = cornerFromVertexIndex(vertexIndex) * 0.5 + 0.5;
  let local = mix(minBounds, maxBounds, corner01);

  let world = vec2f(
    instanceA.x * local.x + instanceA.z * local.y + instanceB.x,
    instanceA.y * local.x + instanceA.w * local.y + instanceB.y
  );

  let screen = (world - uCamera.cameraCenter) * uCamera.zoom + 0.5 * uCamera.viewport;
  let clip = (screen / (0.5 * uCamera.viewport)) - 1.0;

  out.position = vec4f(clip, 0.0, 1.0);
  out.local = local;
  out.segmentStart = i32(glyphMetaA.x + 0.5);
  out.segmentCount = segmentCount;
  out.color = instanceC.xyz;
  out.colorAlpha = instanceC.w;
  out.rasterRect = glyphRasterMeta;
  out.normCoord = clamp((local - minBounds) / max(maxBounds - minBounds, vec2f(1e-6, 1e-6)), vec2f(0.0), vec2f(1.0));
  return out;
}

@fragment
fn fsMain(inData : VsOut) -> @location(0) vec4f {
  let localDx = dpdx(inData.local);
  let localDy = dpdy(inData.local);
  let pixelToLocalX = length(vec2f(localDx.x, localDy.x));
  let pixelToLocalY = length(vec2f(localDx.y, localDy.y));
  // Frobenius is a conservative bound for primitive culling in every normal
  // direction; final coverage below uses the tighter projected-normal width.
  let localPerPixel = length(vec2f(pixelToLocalX, pixelToLocalY));
  let baseAAWidth = max(localPerPixel * uCamera.textAAScreenPx, 1e-4);
  let atlasDims = vec2f(textureDimensions(uTextRasterAtlasTex));
  let nc = vec2f(inData.normCoord.x, 1.0 - inData.normCoord.y) * (inData.rasterRect.zw * atlasDims);
  let dncDx = dpdx(nc);
  let dncDy = dpdy(nc);
  let ncFwidthX = abs(dncDx.x) + abs(dncDy.x);
  let ncFwidthY = abs(dncDx.y) + abs(dncDy.y);

  if (inData.segmentCount <= 0) {
    discard;
  }

  if (
    uCamera.textVectorOnly < 0.5 &&
    inData.rasterRect.z > 0.0 &&
    inData.rasterRect.w > 0.0 &&
    min(ncFwidthX, ncFwidthY) > 2.0
  ) {
    let uvCenter = vec2f(
      inData.rasterRect.x + inData.normCoord.x * inData.rasterRect.z,
      inData.rasterRect.y + (1.0 - inData.normCoord.y) * inData.rasterRect.w
    );
    let texel = 1.0 / max(atlasDims, vec2f(1.0, 1.0));
    let uvMin = inData.rasterRect.xy + texel * 0.5;
    let uvMax = inData.rasterRect.xy + inData.rasterRect.zw - texel * 0.5;
    let tapDx = dncDx * 0.33 * texel;
    let tapDy = dncDy * 0.33 * texel;
    // textureSampleGrad is valid in non-uniform control flow. The gradients
    // were evaluated above the branch for derivative-uniformity and retain the
    // anisotropic footprint. Scaling by exp2(-1.25) preserves the old mip bias.
    let mipBiasedUvDx = dncDx * texel * 0.42044820762685725;
    let mipBiasedUvDy = dncDy * texel * 0.42044820762685725;
    let alphaRaster = (1.0 / 3.0) * textureSampleGrad(
      uTextRasterAtlasTex,
      uTextRasterSampler,
      clamp(uvCenter, uvMin, uvMax),
      mipBiasedUvDx,
      mipBiasedUvDy
    ).r + (1.0 / 6.0) * (
      textureSampleGrad(
        uTextRasterAtlasTex,
        uTextRasterSampler,
        clamp(uvCenter - tapDx - tapDy, uvMin, uvMax),
        mipBiasedUvDx,
        mipBiasedUvDy
      ).r +
      textureSampleGrad(
        uTextRasterAtlasTex,
        uTextRasterSampler,
        clamp(uvCenter - tapDx + tapDy, uvMin, uvMax),
        mipBiasedUvDx,
        mipBiasedUvDy
      ).r +
      textureSampleGrad(
        uTextRasterAtlasTex,
        uTextRasterSampler,
        clamp(uvCenter + tapDx - tapDy, uvMin, uvMax),
        mipBiasedUvDx,
        mipBiasedUvDy
      ).r +
      textureSampleGrad(
        uTextRasterAtlasTex,
        uTextRasterSampler,
        clamp(uvCenter + tapDx + tapDy, uvMin, uvMax),
        mipBiasedUvDx,
        mipBiasedUvDy
      ).r
    );
    let alpha = heprLinearCoverageToOutputAlpha(alphaRaster) * inData.colorAlpha;
    if (alpha <= 0.001) {
      discard;
    }
    let color = mix(inData.color, uCamera.vectorOverride.xyz, clamp(uCamera.vectorOverride.w, 0.0, 1.0));
    return heprEncodeOutputColor(vec4f(color, alpha));
  }

  let glyphSegDims = textureDimensions(uTextGlyphSegmentTexA);

  let coincidentEpsilon = max(baseAAWidth * 1e-4, 1e-7);
  // Outside the antialiasing band the smoothstep below saturates, so the winding
  // number alone decides the pixel and exact distances stop mattering. The small
  // margin keeps coincident-edge grouping from losing a tie candidate.
  let aaCullDistance = baseAAWidth * 1.05 + coincidentEpsilon;
  // A tiny deterministic offset keeps exact-on-edge winding tests stable.
  let queryLocal = inData.local + 0.001 * (localDx + 0.37 * localDy);
  var minDistance = 1e20;
  var nearestT = 0.0;
  var nearestPoint = vec2f(0.0);
  var nearestNormal = vec2f(1.0, 0.0);
  var nearestSideMultiplicity = 0;
  var winding = 0;

  for (var i = 0; i < MAX_GLYPH_PRIMITIVES; i = i + 1) {
    if (i >= inData.segmentCount) {
      break;
    }

    let segmentIndex = inData.segmentStart + i;
    let coord = coordFromIndex(segmentIndex, i32(glyphSegDims.x));

    let primitiveA = textureLoad(uTextGlyphSegmentTexA, coord, 0);
    let primitiveB = textureLoad(uTextGlyphSegmentTexB, coord, 0);
    let p0 = primitiveA.xy;
    let p1 = primitiveA.zw;
    let p2 = primitiveB.xy;
    let primitiveType = primitiveB.z;
    let isQuadratic = uCamera.textCurveEnabled >= 0.5 && primitiveType >= TEXT_PRIMITIVE_QUADRATIC;

    // A quadratic stays inside the hull of its control points, so this box
    // contains the primitive for both curve and line cases.
    var hullMin = min(p0, p2);
    var hullMax = max(p0, p2);
    if (isQuadratic) {
      hullMin = min(hullMin, p1);
      hullMax = max(hullMax, p1);
    }

    // The ray used for the winding test travels along +x, so it can only cross
    // this primitive within the box's y span and to the right of the query point.
    let mayCross = queryLocal.y >= hullMin.y && queryLocal.y <= hullMax.y && hullMax.x > queryLocal.x;

    // Distance to the box lower-bounds the distance to the primitive inside it.
    let boundOffset = max(max(hullMin - queryLocal, queryLocal - hullMax), vec2f(0.0));
    let cullDistance = min(aaCullDistance, minDistance + coincidentEpsilon);
    let mayBeNearest = dot(boundOffset, boundOffset) <= cullDistance * cullDistance;

    if (!mayCross && !mayBeNearest) {
      continue;
    }

    if (mayBeNearest) {
      var distanceInfo : vec4f;
      var closestPoint : vec2f;
      if (isQuadratic) {
        distanceInfo = textQuadraticDistanceInfo(queryLocal, p0, p1, p2);
        closestPoint = evaluateQuadratic(p0, p1, p2, distanceInfo.y);
      } else {
        distanceInfo = textLineDistanceInfo(queryLocal, p0, p2);
        closestPoint = mix(p0, p2, distanceInfo.y);
      }

      let signedOffset = dot(queryLocal - closestPoint, distanceInfo.zw);
      let sideStep = select(-1, 1, signedOffset >= 0.0);
      if (distanceInfo.x + coincidentEpsilon < minDistance) {
        minDistance = distanceInfo.x;
        nearestT = distanceInfo.y;
        nearestPoint = closestPoint;
        nearestNormal = distanceInfo.zw;
        nearestSideMultiplicity = sideStep;
      } else if (abs(distanceInfo.x - minDistance) <= coincidentEpsilon) {
        let normalAlignment = dot(distanceInfo.zw, nearestNormal);
        let bothInterior = distanceInfo.y > 1e-4 && distanceInfo.y < 1.0 - 1e-4 &&
          nearestT > 1e-4 && nearestT < 1.0 - 1e-4;
        let sameEdge = bothInterior && distance(closestPoint, nearestPoint) <= coincidentEpsilon &&
          abs(normalAlignment) >= 0.9999;
        if (sameEdge) {
          nearestSideMultiplicity = nearestSideMultiplicity + sideStep;
          minDistance = min(minDistance, distanceInfo.x);
        } else if (distanceInfo.x < minDistance) {
          minDistance = distanceInfo.x;
          nearestT = distanceInfo.y;
          nearestPoint = closestPoint;
          nearestNormal = distanceInfo.zw;
          nearestSideMultiplicity = sideStep;
        }
      }
    }

    if (mayCross) {
      if (isQuadratic) {
        accumulateQuadraticCrossing(p0, p1, p2, queryLocal, &winding);
      } else {
        accumulateLineCrossing(p0, p2, queryLocal, &winding);
      }
    }
  }

  let inside = winding != 0;
  let acrossWinding = winding - nearestSideMultiplicity;
  let nearestSeparatesFill = inside != (acrossWinding != 0);
  let signedDistance = select(minDistance, -minDistance, inside);
  // Keep the maximum derivative above for conservative primitive culling, but
  // resolve final coverage with the derivative along the nearest edge normal.
  // This prevents tilted glyph edges from acquiring over-wide grey bands.
  let edgeAAWidth = max(
    length(vec2f(dot(localDx, nearestNormal), dot(localDy, nearestNormal))) * uCamera.textAAScreenPx,
    1e-4
  );
  let edgeAlpha = 1.0 - smoothstep(-edgeAAWidth, edgeAAWidth, signedDistance);
  // Nonzero fill stays opaque across overlap-only contour edges. Coincident
  // exterior edges are grouped above and antialiased as one true boundary.
  let alphaBase = select(select(0.0, 1.0, inside), edgeAlpha, nearestSeparatesFill);
  let alpha = heprLinearCoverageToOutputAlpha(alphaBase) * inData.colorAlpha;
  if (alpha <= 0.001) {
    discard;
  }

  let color = mix(inData.color, uCamera.vectorOverride.xyz, clamp(uCamera.vectorOverride.w, 0.0, 1.0));
  return heprEncodeOutputColor(vec4f(color, alpha));
}
`;

const RASTER_SHADER_SOURCE = /* wgsl */ `
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

struct RasterUniforms {
  matrixA : vec4f,
  matrixB : vec4f,
};

@group(0) @binding(0) var<uniform> uCamera : CameraUniforms;
@group(0) @binding(1) var<uniform> uRaster : RasterUniforms;
@group(0) @binding(2) var uRasterSampler : sampler;
@group(0) @binding(3) var uRasterTex : texture_2d<f32>;

struct VsOut {
  @builtin(position) position : vec4f,
  @location(0) uv : vec2f,
};

fn cornerFromVertexIndex(vertexIndex : u32) -> vec2f {
  switch (vertexIndex) {
    case 0u: {
      return vec2f(-1.0, -1.0);
    }
    case 1u: {
      return vec2f(1.0, -1.0);
    }
    case 2u: {
      return vec2f(-1.0, 1.0);
    }
    default: {
      return vec2f(1.0, 1.0);
    }
  }
}

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> VsOut {
  let corner01 = cornerFromVertexIndex(vertexIndex) * 0.5 + 0.5;
  let localTopDown = vec2f(corner01.x, 1.0 - corner01.y);

  let a = uRaster.matrixA.x;
  let b = uRaster.matrixA.y;
  let c = uRaster.matrixA.z;
  let d = uRaster.matrixA.w;
  let e = uRaster.matrixB.x;
  let f = uRaster.matrixB.y;

  let world = vec2f(
    a * localTopDown.x + c * localTopDown.y + e,
    b * localTopDown.x + d * localTopDown.y + f
  );

  let screen = (world - uCamera.cameraCenter) * uCamera.zoom + 0.5 * uCamera.viewport;
  let clip = (screen / (0.5 * uCamera.viewport)) - 1.0;

  var out : VsOut;
  out.position = vec4f(clip, 0.0, 1.0);
  out.uv = localTopDown;
  return out;
}

@fragment
fn fsMain(inData : VsOut) -> @location(0) vec4f {
  let color = textureSample(uRasterTex, uRasterSampler, inData.uv);
  if (color.a <= 0.001) {
    discard;
  }
  return color;
}
`;

const HIGHLIGHT_SHADER_SOURCE = /* wgsl */ `
struct HighlightCamera {
  viewport : vec2f,
  cameraCenter : vec2f,
  zoom : f32,
  pad0 : f32,
  pad1 : f32,
  pad2 : f32,
};

struct HighlightStyle {
  fillColor : vec4f,
  borderColor : vec4f,
  borderPx : f32,
  minSizePx : f32,
  pad0 : f32,
  pad1 : f32,
};

@group(0) @binding(0) var<uniform> uCamera : HighlightCamera;
@group(0) @binding(1) var<uniform> uStyle : HighlightStyle;
@group(0) @binding(2) var<storage, read> uRects : array<vec4f>;

struct VsOut {
  @builtin(position) position : vec4f,
  @location(0) localPx : vec2f,
  @location(1) halfSizePx : vec2f,
};

fn cornerFromVertexIndex(vertexIndex : u32) -> vec2f {
  switch (vertexIndex) {
    case 0u: {
      return vec2f(-1.0, -1.0);
    }
    case 1u: {
      return vec2f(1.0, -1.0);
    }
    case 2u: {
      return vec2f(-1.0, 1.0);
    }
    default: {
      return vec2f(1.0, 1.0);
    }
  }
}

@vertex
fn vsMain(
  @builtin(vertex_index) vertexIndex : u32,
  @builtin(instance_index) instanceIndex : u32
) -> VsOut {
  let rect = uRects[instanceIndex];
  let corner = cornerFromVertexIndex(vertexIndex);
  let center = (rect.xy + rect.zw) * 0.5;
  let halfSize = (rect.zw - rect.xy) * 0.5;
  let halfSizePx = max(halfSize * uCamera.zoom, vec2f(0.5 * uStyle.minSizePx));
  let expandedHalfPx = halfSizePx + vec2f(uStyle.borderPx);
  let world = center + corner * (expandedHalfPx / uCamera.zoom);
  let screen = (world - uCamera.cameraCenter) * uCamera.zoom + 0.5 * uCamera.viewport;
  let clip = (screen / (0.5 * uCamera.viewport)) - 1.0;

  var out : VsOut;
  out.position = vec4f(clip, 0.0, 1.0);
  out.localPx = corner * expandedHalfPx;
  out.halfSizePx = halfSizePx;
  return out;
}

@fragment
fn fsMain(inData : VsOut) -> @location(0) vec4f {
  let distanceToEdgePx = inData.halfSizePx - abs(inData.localPx);
  let insideRect = all(distanceToEdgePx >= vec2f(0.0));
  return select(uStyle.borderColor, uStyle.fillColor, insideRect);
}
`;

const HIGHLIGHT_CAMERA_BUFFER_BYTES = 32;
const HIGHLIGHT_STYLE_BUFFER_BYTES = 48;
/** Browser-find style: semi-transparent fill with a solid outline ring. */
const HIGHLIGHT_STYLES: ReadonlyArray<{ fillColor: readonly number[]; borderColor: readonly number[]; borderPx: number }> = [
  { fillColor: [1, 0.921, 0.231, 0.35], borderColor: [0.792, 0.541, 0.016, 1], borderPx: 1 },
  { fillColor: [1, 0.596, 0, 0.45], borderColor: [0.918, 0.345, 0.047, 1], borderPx: 2 },
  // Text-selection style: browser-selection blue, same fill+ring treatment.
  { fillColor: [0.259, 0.522, 0.957, 0.35], borderColor: [0.106, 0.365, 0.788, 1], borderPx: 1 }
];
const HIGHLIGHT_MIN_SIZE_PX = 2;

const BLIT_SHADER_SOURCE = /* wgsl */ `
struct BlitUniforms {
  viewportPx : vec2f,
  cacheSizePx : vec2f,
  offsetPx : vec2f,
  sampleScale : f32,
  pad : vec3f,
};

@group(0) @binding(0) var uCacheSampler : sampler;
@group(0) @binding(1) var uCacheTex : texture_2d<f32>;
@group(0) @binding(2) var<uniform> uBlit : BlitUniforms;

struct VsOut {
  @builtin(position) position : vec4f,
};

fn cornerFromVertexIndex(vertexIndex : u32) -> vec2f {
  switch (vertexIndex) {
    case 0u: {
      return vec2f(-1.0, -1.0);
    }
    case 1u: {
      return vec2f(1.0, -1.0);
    }
    case 2u: {
      return vec2f(-1.0, 1.0);
    }
    default: {
      return vec2f(1.0, 1.0);
    }
  }
}

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> VsOut {
  var out : VsOut;
  out.position = vec4f(cornerFromVertexIndex(vertexIndex), 0.0, 1.0);
  return out;
}

@fragment
fn fsMain(@builtin(position) fragPos : vec4f) -> @location(0) vec4f {
  let scale = max(uBlit.sampleScale, 1e-6);
  let centered = fragPos.xy - 0.5 * uBlit.viewportPx;
  let offsetPx = vec2f(uBlit.offsetPx.x, -uBlit.offsetPx.y);
  let samplePx = centered * scale + 0.5 * uBlit.cacheSizePx + offsetPx;
  let uv = samplePx / uBlit.cacheSizePx;

  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    return vec4f(0.627451, 0.662745, 0.686275, 1.0);
  }

  return textureSampleLevel(uCacheTex, uCacheSampler, uv, 0.0);
}
`;

const VECTOR_COMPOSITE_SHADER_SOURCE = /* wgsl */ `
struct VectorCompositeUniforms {
  viewportPx : vec2f,
  pad : vec2f,
};

@group(0) @binding(0) var uVectorSampler : sampler;
@group(0) @binding(1) var uVectorTex : texture_2d<f32>;
@group(0) @binding(2) var<uniform> uComposite : VectorCompositeUniforms;

struct VsOut {
  @builtin(position) position : vec4f,
};

fn cornerFromVertexIndex(vertexIndex : u32) -> vec2f {
  switch (vertexIndex) {
    case 0u: {
      return vec2f(-1.0, -1.0);
    }
    case 1u: {
      return vec2f(1.0, -1.0);
    }
    case 2u: {
      return vec2f(-1.0, 1.0);
    }
    default: {
      return vec2f(1.0, 1.0);
    }
  }
}

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> VsOut {
  var out : VsOut;
  out.position = vec4f(cornerFromVertexIndex(vertexIndex), 0.0, 1.0);
  return out;
}

@fragment
fn fsMain(@builtin(position) fragPos : vec4f) -> @location(0) vec4f {
  let viewport = max(uComposite.viewportPx, vec2f(1.0, 1.0));
  let uv = fragPos.xy / viewport;
  return textureSampleLevel(uVectorTex, uVectorSampler, clamp(uv, vec2f(0.0), vec2f(1.0)), 0.0);
}
`;

export class WebGpuFloorplanRenderer {
  private readonly canvas: HTMLCanvasElement;

  private readonly gpuDevice: any;

  private readonly gpuContext: any;

  private readonly presentationFormat: string;

  private readonly strokePipeline: any;

  private readonly fillPipeline: any;

  private readonly gradientFillPipeline: any;

  private readonly gradientStrokePipeline: any;

  private readonly textPipeline: any;

  private readonly rasterPipeline: any;

  private readonly blitPipeline: any;

  private readonly vectorCompositePipeline: any;

  private readonly highlightPipeline: any;

  private readonly cameraUniformBuffer: any;

  private readonly highlightCameraBuffer: any;

  private readonly highlightStyleBuffers: any[];

  private readonly highlightBindGroupLayout: any;

  private highlightOthersRectsBuffer: any = null;

  private highlightOthersCapacityBytes = 0;

  private highlightCurrentRectBuffer: any = null;

  private highlightCurrentCapacityBytes = 0;

  private highlightSelectionRectsBuffer: any = null;

  private highlightSelectionCapacityBytes = 0;

  private highlightOthersBindGroups: any[] = [];

  private highlightCurrentBindGroups: any[] = [];

  private highlightSelectionBindGroups: any[] = [];

  private highlightOthersCount = 0;

  private highlightCurrentCount = 0;

  private highlightSelectionCount = 0;

  private readonly blitUniformBuffer: any;

  private readonly vectorCompositeUniformBuffer: any;

  private readonly panCacheSampler: any;

  private readonly rasterLayerSampler: any;

  private readonly textRasterSampler: any;

  private readonly gradientSampler: any;

  private readonly vectorCompositeSampler: any;

  private readonly strokeBindGroupLayout: any;

  private readonly fillBindGroupLayout: any;

  private readonly gradientFillBindGroupLayout: any;

  private readonly gradientStrokeBindGroupLayout: any;

  private readonly textBindGroupLayout: any;

  private readonly rasterBindGroupLayout: any;

  private readonly blitBindGroupLayout: any;

  private readonly vectorCompositeBindGroupLayout: any;

  private strokeBindGroupAll: any = null;

  private strokeBindGroupVisible: any = null;

  private fillBindGroup: any = null;

  private gradientFillBindGroup: any = null;

  private gradientStrokeBindGroup: any = null;

  private textBindGroup: any = null;

  private blitBindGroup: any = null;

  private vectorCompositeBindGroup: any = null;
  private vectorLodLevelResources: WebGpuVectorLodLevelResource[] = [];

  private segmentTextureA: any = null;

  private segmentTextureB: any = null;

  private segmentTextureC: any = null;

  private segmentTextureD: any = null;

  private fillPathMetaTextureA: any = null;

  private fillPathMetaTextureB: any = null;

  private fillPathMetaTextureC: any = null;

  private fillSegmentTextureA: any = null;

  private fillSegmentTextureB: any = null;

  private textInstanceTextureA: any = null;

  private textInstanceTextureB: any = null;

  private textInstanceTextureC: any = null;
  private rasterLayerResources: WebGpuRasterLayerResource[] = [];
  private rasterTextureResidency = true;
  private pageBackgroundResources: WebGpuRasterLayerResource[] = [];

  private textGlyphMetaTextureA: any = null;

  private textGlyphMetaTextureB: any = null;

  private textGlyphRasterMetaTexture: any = null;

  private textGlyphSegmentTextureA: any = null;

  private textGlyphSegmentTextureB: any = null;

  private textRasterAtlasTexture: any = null;
  private pageBackgroundTexture: any = null;

  private gradientMetaTextures: any[] = [];

  private gradientLutTexture: any = null;

  private gradientFillTextures: any[] = [];

  private gradientStrokeTextures: any[] = [];

  private gradientData: GradientSceneData | null = null;

  private orderedGradientPaintCommands: OrderedGradientPaintCommand[] = [];

  private gradientPaintRequiresDirectRendering = false;

  private segmentIdBufferAll: any = null;

  private segmentIdBufferVisible: any = null;

  /** Source-ordered exact/coarse IDs, bound only through the LOD shader path. */
  private textInstanceIdBuffer: any = null;

  private panCacheTexture: any = null;

  private panCacheWidth = 0;

  private panCacheHeight = 0;

  private panCacheValid = false;

  private panCacheCenterX = 0;

  private panCacheCenterY = 0;

  private panCacheZoom = 1;

  private panCacheRenderedSegments = 0;

  private panCacheUsedCulling = false;

  private vectorMinifyTexture: any = null;

  private vectorMinifyWidth = 0;

  private vectorMinifyHeight = 0;

  private scene: VectorScene | null = null;

  private sceneStats: SceneStats | null = null;

  private grid: SpatialGrid | null = null;
  private vectorLodMode: VectorLodMode = "auto";
  private vectorLodRuntime: VectorStrokeLodRuntime | null = null;
  private vectorLodStats: VectorStrokeLodStats | null = null;

  private frameListener: FrameListener | null = null;
  private interactionViewportProvider: (() => DOMRect | DOMRectReadOnly | null) | null = null;
  private presentedCameraCenterX = 0;
  private presentedCameraCenterY = 0;
  private presentedZoom = 1;
  private presentedFrameSerial = 0;

  private rafHandle = 0;
  private externalFrameDriver = false;
  private isDisposed = false;
  private externalFramePending = false;

  private cameraCenterX = 0;

  private cameraCenterY = 0;

  private zoom = 1;

  private targetCameraCenterX = 0;

  private targetCameraCenterY = 0;

  private targetZoom = 1;

  private lastCameraAnimationTimeMs = 0;

  private hasZoomAnchor = false;

  private zoomAnchorClientX = 0;

  private zoomAnchorClientY = 0;

  private zoomAnchorWorldX = 0;

  private zoomAnchorWorldY = 0;

  private panVelocityWorldX = 0;

  private panVelocityWorldY = 0;

  private lastPanVelocityUpdateTimeMs = 0;

  private lastPanFrameCameraX = 0;

  private lastPanFrameCameraY = 0;

  private lastPanFrameTimeMs = 0;

  private minZoom = 0.01;

  private maxZoom = 8_192;

  private strokeCurveEnabled = true;

  private rasterRenderingEnabled = true;

  private fillRenderingEnabled = true;

  private strokeRenderingEnabled = true;

  private textRenderingEnabled = true;

  private textVectorOnly = false;

  private pageBackgroundColor: [number, number, number, number] = [1, 1, 1, 1];

  private vectorOverrideColor: [number, number, number] = [0, 0, 0];

  private vectorOverrideOpacity = 0;

  private isPanInteracting = false;

  // Keep first loaded frame complete; enable culling once user actually pans/zooms.
  private hasCameraInteractionSinceSceneLoad = false;

  private lastInteractionTime = Number.NEGATIVE_INFINITY;

  private needsVisibleSetUpdate = false;

  private segmentCount = 0;

  private fillPathCount = 0;

  private textInstanceCount = 0;

  private textLodMode: TextLodMode = "auto";

  private textLodRuntime: TextLodRuntime | null = null;

  private textLodGpuActive = false;

  private selectedTextInstanceCount = 0;

  private useTextInstanceIndirection = false;

  private visibleSegmentCount = 0;

  private usingAllSegments = true;

  private segmentTextureWidth = 1;

  private segmentTextureHeight = 1;

  private fillPathMetaTextureWidth = 1;

  private fillPathMetaTextureHeight = 1;

  private fillSegmentTextureWidth = 1;

  private fillSegmentTextureHeight = 1;

  private textInstanceTextureWidth = 1;

  private textInstanceTextureHeight = 1;

  private textGlyphMetaTextureWidth = 1;

  private textGlyphMetaTextureHeight = 1;

  private textGlyphSegmentTextureWidth = 1;

  private textGlyphSegmentTextureHeight = 1;

  private allSegmentIds = new Uint32Array(0);

  private visibleSegmentIds = new Uint32Array(0);

  private segmentMarks = new Uint32Array(0);

  private segmentMinX = new Float32Array(0);

  private segmentMinY = new Float32Array(0);

  private segmentMaxX = new Float32Array(0);

  private segmentMaxY = new Float32Array(0);

  private markToken = 1;

  private constructor(canvas: HTMLCanvasElement, device: any, context: any, presentationFormat: string) {
    this.canvas = canvas;
    this.gpuDevice = device;
    this.gpuContext = context;
    this.presentationFormat = presentationFormat;

    this.configureContext();

    const gpuBufferUsage = (globalThis as any).GPUBufferUsage;
    const gpuShaderStage = (globalThis as any).GPUShaderStage;
    this.cameraUniformBuffer = this.gpuDevice.createBuffer({
      size: CAMERA_UNIFORM_BUFFER_BYTES,
      usage: gpuBufferUsage.UNIFORM | gpuBufferUsage.COPY_DST
    });

    this.blitUniformBuffer = this.gpuDevice.createBuffer({
      size: BLIT_UNIFORM_BUFFER_BYTES,
      usage: gpuBufferUsage.UNIFORM | gpuBufferUsage.COPY_DST
    });

    this.vectorCompositeUniformBuffer = this.gpuDevice.createBuffer({
      size: VECTOR_COMPOSITE_UNIFORM_BUFFER_BYTES,
      usage: gpuBufferUsage.UNIFORM | gpuBufferUsage.COPY_DST
    });

    this.highlightCameraBuffer = this.gpuDevice.createBuffer({
      size: HIGHLIGHT_CAMERA_BUFFER_BYTES,
      usage: gpuBufferUsage.UNIFORM | gpuBufferUsage.COPY_DST
    });
    this.highlightStyleBuffers = HIGHLIGHT_STYLES.map((style) => {
      const buffer = this.gpuDevice.createBuffer({
        size: HIGHLIGHT_STYLE_BUFFER_BYTES,
        usage: gpuBufferUsage.UNIFORM | gpuBufferUsage.COPY_DST
      });
      const data = new Float32Array(12);
      data[0] = style.fillColor[0];
      data[1] = style.fillColor[1];
      data[2] = style.fillColor[2];
      data[3] = style.fillColor[3];
      data[4] = style.borderColor[0];
      data[5] = style.borderColor[1];
      data[6] = style.borderColor[2];
      data[7] = style.borderColor[3];
      data[8] = style.borderPx;
      data[9] = HIGHLIGHT_MIN_SIZE_PX;
      this.gpuDevice.queue.writeBuffer(buffer, 0, data);
      return buffer;
    });

    this.strokeBindGroupLayout = this.gpuDevice.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: gpuShaderStage.VERTEX | gpuShaderStage.FRAGMENT,
          buffer: { type: "uniform", minBindingSize: CAMERA_UNIFORM_BUFFER_BYTES }
        },
        {
          binding: 1,
          visibility: gpuShaderStage.VERTEX,
          texture: { sampleType: "unfilterable-float" }
        },
        {
          binding: 2,
          visibility: gpuShaderStage.VERTEX,
          texture: { sampleType: "unfilterable-float" }
        },
        {
          binding: 3,
          visibility: gpuShaderStage.VERTEX,
          texture: { sampleType: "unfilterable-float" }
        },
        {
          binding: 4,
          visibility: gpuShaderStage.VERTEX,
          texture: { sampleType: "unfilterable-float" }
        },
        {
          binding: 5,
          visibility: gpuShaderStage.VERTEX,
          buffer: { type: "read-only-storage" }
        }
      ]
    });

    this.fillBindGroupLayout = this.gpuDevice.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: gpuShaderStage.VERTEX | gpuShaderStage.FRAGMENT,
          buffer: { type: "uniform", minBindingSize: CAMERA_UNIFORM_BUFFER_BYTES }
        },
        {
          binding: 1,
          visibility: gpuShaderStage.VERTEX,
          texture: { sampleType: "unfilterable-float" }
        },
        {
          binding: 2,
          visibility: gpuShaderStage.VERTEX,
          texture: { sampleType: "unfilterable-float" }
        },
        {
          binding: 3,
          visibility: gpuShaderStage.VERTEX,
          texture: { sampleType: "unfilterable-float" }
        },
        {
          binding: 4,
          visibility: gpuShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float" }
        },
        {
          binding: 5,
          visibility: gpuShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float" }
        }
      ]
    });

    this.gradientFillBindGroupLayout = this.gpuDevice.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: gpuShaderStage.VERTEX | gpuShaderStage.FRAGMENT,
          buffer: { type: "uniform", minBindingSize: CAMERA_UNIFORM_BUFFER_BYTES }
        },
        ...[1, 2, 3, 4].map((binding) => ({
          binding,
          visibility: gpuShaderStage.VERTEX,
          texture: { sampleType: "unfilterable-float" }
        })),
        ...[5, 6, 7, 8, 9, 10, 11].map((binding) => ({
          binding,
          visibility: gpuShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float" }
        })),
        {
          binding: 12,
          visibility: gpuShaderStage.FRAGMENT,
          sampler: { type: "filtering" }
        },
        {
          binding: 13,
          visibility: gpuShaderStage.FRAGMENT,
          texture: { sampleType: "float" }
        }
      ]
    });

    this.gradientStrokeBindGroupLayout = this.gpuDevice.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: gpuShaderStage.VERTEX | gpuShaderStage.FRAGMENT,
          buffer: { type: "uniform", minBindingSize: CAMERA_UNIFORM_BUFFER_BYTES }
        },
        ...[1, 2, 3, 4, 5].map((binding) => ({
          binding,
          visibility: gpuShaderStage.VERTEX,
          texture: { sampleType: "unfilterable-float" }
        })),
        ...[6, 7, 8, 9, 10].map((binding) => ({
          binding,
          visibility: gpuShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float" }
        })),
        {
          binding: 11,
          visibility: gpuShaderStage.FRAGMENT,
          sampler: { type: "filtering" }
        },
        {
          binding: 12,
          visibility: gpuShaderStage.FRAGMENT,
          texture: { sampleType: "float" }
        }
      ]
    });

    this.textBindGroupLayout = this.gpuDevice.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: gpuShaderStage.VERTEX | gpuShaderStage.FRAGMENT,
          buffer: { type: "uniform", minBindingSize: CAMERA_UNIFORM_BUFFER_BYTES }
        },
        {
          binding: 1,
          visibility: gpuShaderStage.VERTEX,
          texture: { sampleType: "unfilterable-float" }
        },
        {
          binding: 2,
          visibility: gpuShaderStage.VERTEX,
          texture: { sampleType: "unfilterable-float" }
        },
        {
          binding: 3,
          visibility: gpuShaderStage.VERTEX,
          texture: { sampleType: "unfilterable-float" }
        },
        {
          binding: 4,
          visibility: gpuShaderStage.VERTEX,
          texture: { sampleType: "unfilterable-float" }
        },
        {
          binding: 5,
          visibility: gpuShaderStage.VERTEX,
          texture: { sampleType: "unfilterable-float" }
        },
        {
          binding: 6,
          visibility: gpuShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float" }
        },
        {
          binding: 7,
          visibility: gpuShaderStage.FRAGMENT,
          texture: { sampleType: "unfilterable-float" }
        },
        {
          binding: 8,
          visibility: gpuShaderStage.VERTEX,
          texture: { sampleType: "unfilterable-float" }
        },
        {
          binding: 9,
          visibility: gpuShaderStage.FRAGMENT,
          sampler: { type: "filtering" }
        },
        {
          binding: 10,
          visibility: gpuShaderStage.FRAGMENT,
          texture: { sampleType: "float" }
        },
        {
          binding: 11,
          visibility: gpuShaderStage.VERTEX,
          buffer: { type: "read-only-storage" }
        }
      ]
    });

    this.rasterBindGroupLayout = this.gpuDevice.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: gpuShaderStage.VERTEX,
          buffer: { type: "uniform", minBindingSize: CAMERA_UNIFORM_BUFFER_BYTES }
        },
        {
          binding: 1,
          visibility: gpuShaderStage.VERTEX,
          buffer: { type: "uniform", minBindingSize: RASTER_UNIFORM_BUFFER_BYTES }
        },
        {
          binding: 2,
          visibility: gpuShaderStage.FRAGMENT,
          sampler: { type: "filtering" }
        },
        {
          binding: 3,
          visibility: gpuShaderStage.FRAGMENT,
          texture: { sampleType: "float" }
        }
      ]
    });

    this.blitBindGroupLayout = this.gpuDevice.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: gpuShaderStage.FRAGMENT,
          sampler: { type: "filtering" }
        },
        {
          binding: 1,
          visibility: gpuShaderStage.FRAGMENT,
          texture: { sampleType: "float" }
        },
        {
          binding: 2,
          visibility: gpuShaderStage.FRAGMENT,
          buffer: { type: "uniform", minBindingSize: BLIT_UNIFORM_BUFFER_BYTES }
        }
      ]
    });

    this.vectorCompositeBindGroupLayout = this.gpuDevice.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: gpuShaderStage.FRAGMENT,
          sampler: { type: "filtering" }
        },
        {
          binding: 1,
          visibility: gpuShaderStage.FRAGMENT,
          texture: { sampleType: "float" }
        },
        {
          binding: 2,
          visibility: gpuShaderStage.FRAGMENT,
          buffer: { type: "uniform", minBindingSize: VECTOR_COMPOSITE_UNIFORM_BUFFER_BYTES }
        }
      ]
    });

    this.highlightBindGroupLayout = this.gpuDevice.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: gpuShaderStage.VERTEX,
          buffer: { type: "uniform", minBindingSize: HIGHLIGHT_CAMERA_BUFFER_BYTES }
        },
        {
          binding: 1,
          visibility: gpuShaderStage.VERTEX | gpuShaderStage.FRAGMENT,
          buffer: { type: "uniform", minBindingSize: HIGHLIGHT_STYLE_BUFFER_BYTES }
        },
        {
          binding: 2,
          visibility: gpuShaderStage.VERTEX,
          buffer: { type: "read-only-storage" }
        }
      ]
    });

    const strokePipelineLayout = this.gpuDevice.createPipelineLayout({
      bindGroupLayouts: [this.strokeBindGroupLayout]
    });
    const fillPipelineLayout = this.gpuDevice.createPipelineLayout({
      bindGroupLayouts: [this.fillBindGroupLayout]
    });
    const gradientFillPipelineLayout = this.gpuDevice.createPipelineLayout({
      bindGroupLayouts: [this.gradientFillBindGroupLayout]
    });
    const gradientStrokePipelineLayout = this.gpuDevice.createPipelineLayout({
      bindGroupLayouts: [this.gradientStrokeBindGroupLayout]
    });
    const textPipelineLayout = this.gpuDevice.createPipelineLayout({
      bindGroupLayouts: [this.textBindGroupLayout]
    });
    const rasterPipelineLayout = this.gpuDevice.createPipelineLayout({
      bindGroupLayouts: [this.rasterBindGroupLayout]
    });
    const blitPipelineLayout = this.gpuDevice.createPipelineLayout({
      bindGroupLayouts: [this.blitBindGroupLayout]
    });
    const vectorCompositePipelineLayout = this.gpuDevice.createPipelineLayout({
      bindGroupLayouts: [this.vectorCompositeBindGroupLayout]
    });

    const highlightPipelineLayout = this.gpuDevice.createPipelineLayout({
      bindGroupLayouts: [this.highlightBindGroupLayout]
    });

    this.strokePipeline = this.createPipeline(STROKE_SHADER_SOURCE, "vsMain", "fsMain", strokePipelineLayout);
    this.highlightPipeline = this.createPipeline(HIGHLIGHT_SHADER_SOURCE, "vsMain", "fsMain", highlightPipelineLayout);
    this.fillPipeline = this.createPipeline(FILL_SHADER_SOURCE, "vsMain", "fsMain", fillPipelineLayout);
    this.gradientFillPipeline = this.createPipeline(GRADIENT_FILL_WGSL, "vsMain", "fsMain", gradientFillPipelineLayout);
    this.gradientStrokePipeline = this.createPipeline(GRADIENT_STROKE_WGSL, "vsMain", "fsMain", gradientStrokePipelineLayout);
    this.textPipeline = this.createPipeline(TEXT_SHADER_SOURCE, "vsMain", "fsMain", textPipelineLayout);
    this.rasterPipeline = this.createPipeline(RASTER_SHADER_SOURCE, "vsMain", "fsMain", rasterPipelineLayout, true);
    this.blitPipeline = this.createPipeline(BLIT_SHADER_SOURCE, "vsMain", "fsMain", blitPipelineLayout);
    this.vectorCompositePipeline = this.createPipeline(
      VECTOR_COMPOSITE_SHADER_SOURCE,
      "vsMain",
      "fsMain",
      vectorCompositePipelineLayout,
      true
    );

    this.panCacheSampler = this.gpuDevice.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge"
    });

    this.rasterLayerSampler = this.gpuDevice.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge"
    });

    // WebGPU guarantees sampler anisotropy values through 16. Keep the glyph
    // atlas sharp when a PDF plane is viewed at a steep angle without changing
    // the sampling policy of ordinary raster-image layers.
    this.textRasterSampler = this.gpuDevice.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "linear",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge",
      maxAnisotropy: 16
    });

    this.gradientSampler = this.gpuDevice.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge"
    });

    this.vectorCompositeSampler = this.gpuDevice.createSampler({
      magFilter: "linear",
      minFilter: "linear",
      mipmapFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge"
    });

    this.pageBackgroundTexture = this.createRgba8Texture(1, 1, new Uint8Array([255, 255, 255, 255]));

    this.ensureSegmentIdBuffers(1);
  }

  static async create(canvas: HTMLCanvasElement): Promise<WebGpuFloorplanRenderer> {
    const nav = navigator as Navigator & {
      gpu?: {
        requestAdapter: (options?: { powerPreference?: "low-power" | "high-performance" }) => Promise<any>;
        getPreferredCanvasFormat?: () => string;
      };
    };

    if (!nav.gpu) {
      throw new Error("WebGPU is not available in this browser.");
    }

    const adapter = await nav.gpu.requestAdapter({ powerPreference: "high-performance" })
      ?? await nav.gpu.requestAdapter();
    if (!adapter) {
      throw new Error("Failed to acquire a WebGPU adapter.");
    }

    const device = await adapter.requestDevice();
    let context: any = null;
    try {
      if (typeof device.addEventListener === "function") {
        device.addEventListener("uncapturederror", (event: any) => {
          const message = event?.error?.message || event?.error || event;
          console.warn("[WebGPU uncaptured error]", message);
        });
      }
      context = canvas.getContext("webgpu");
      if (!context) {
        throw new Error("Failed to acquire a WebGPU canvas context.");
      }

      const presentationFormat = nav.gpu.getPreferredCanvasFormat?.() ?? "bgra8unorm";
      return new WebGpuFloorplanRenderer(canvas, device, context, presentationFormat);
    } catch (error) {
      try {
        releaseOwnedWebGpuDevice(device, context);
      } catch {
        // Preserve the original initialization error.
      }
      throw error;
    }
  }

  setFrameListener(listener: FrameListener | null): void {
    this.frameListener = listener;
  }

  setExternalFrameDriver(enabled: boolean): void {
    const nextEnabled = Boolean(enabled);
    if (this.externalFrameDriver === nextEnabled) {
      return;
    }

    this.externalFrameDriver = nextEnabled;
    if (this.externalFrameDriver) {
      this.externalFramePending = true;
      if (this.rafHandle !== 0) {
        cancelAnimationFrame(this.rafHandle);
        this.rafHandle = 0;
      }
      return;
    }

    if (this.externalFramePending) {
      this.externalFramePending = false;
      this.requestFrame();
    }
  }

  renderExternalFrame(timestamp: number = performance.now()): void {
    if (this.externalFrameDriver && !this.externalFramePending) {
      return;
    }
    this.externalFramePending = false;
    this.render(timestamp);
  }

  setVectorLodMode(mode: VectorLodMode): void {
    const nextMode = normalizeVectorLodMode(mode);
    if (this.vectorLodMode === nextMode) {
      return;
    }

    this.vectorLodMode = nextMode;
    if (this.scene) {
      const vectorLodActive = this.rebuildVectorLod(this.scene);
      this.grid = !vectorLodActive && this.segmentCount > 0 ? buildSpatialGrid(this.scene) : null;
    }

    this.panCacheValid = false;
    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  getVectorStrokeLodStats(): VectorStrokeLodStats | null {
    return this.vectorLodStats
      ? {
        ...this.vectorLodStats,
        activeLevels: this.vectorLodStats.activeLevels.map((level) => ({ ...level }))
      }
      : null;
  }

  setTextLodMode(mode: TextLodMode): void {
    const nextMode: TextLodMode = mode === "off" ? "off" : "auto";
    if (this.textLodMode === nextMode) {
      return;
    }
    this.textLodMode = nextMode;
    if (nextMode === "auto" && this.scene && !this.textLodGpuActive) {
      this.setScene(this.scene);
      return;
    }
    this.textLodRuntime?.setMode(nextMode);
    this.selectedTextInstanceCount = 0;
    this.useTextInstanceIndirection = false;
    this.destroyPanCacheResources();
    this.destroyVectorMinifyResources();
    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  getTextLodStats(): TextLodStats | null {
    return this.textLodRuntime?.getStats() ?? null;
  }

  setStrokeCurveEnabled(enabled: boolean): void {
    const nextEnabled = Boolean(enabled);
    if (this.strokeCurveEnabled === nextEnabled) {
      return;
    }

    this.strokeCurveEnabled = nextEnabled;
    this.requestFrame();
  }

  setRasterRenderingEnabled(enabled: boolean): void {
    const nextEnabled = Boolean(enabled);
    if (this.rasterRenderingEnabled === nextEnabled) {
      return;
    }

    this.rasterRenderingEnabled = nextEnabled;
    this.panCacheValid = false;
    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  setRasterTextureResidency(resident: boolean): void {
    const nextResident = Boolean(resident);
    if (this.rasterTextureResidency === nextResident || this.isDisposed) {
      return;
    }

    this.rasterTextureResidency = nextResident;
    if (nextResident) {
      if (this.scene) {
        try {
          this.configureRasterLayers(this.scene);
        } catch (error) {
          this.rasterTextureResidency = false;
          this.destroyRasterLayerResources();
          throw error;
        }
      }
    } else {
      this.destroyRasterLayerResources();
    }
    this.panCacheValid = false;
    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  setFillRenderingEnabled(enabled: boolean): void {
    const nextEnabled = Boolean(enabled);
    if (this.fillRenderingEnabled === nextEnabled) {
      return;
    }

    this.fillRenderingEnabled = nextEnabled;
    this.panCacheValid = false;
    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  setStrokeRenderingEnabled(enabled: boolean): void {
    const nextEnabled = Boolean(enabled);
    if (this.strokeRenderingEnabled === nextEnabled) {
      return;
    }

    this.strokeRenderingEnabled = nextEnabled;
    this.panCacheValid = false;
    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  setTextRenderingEnabled(enabled: boolean): void {
    const nextEnabled = Boolean(enabled);
    if (this.textRenderingEnabled === nextEnabled) {
      return;
    }

    this.textRenderingEnabled = nextEnabled;
    this.panCacheValid = false;
    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  setTextVectorOnly(enabled: boolean): void {
    const nextEnabled = Boolean(enabled);
    if (this.textVectorOnly === nextEnabled) {
      return;
    }

    this.textVectorOnly = nextEnabled;
    this.panCacheValid = false;
    if (this.textVectorOnly) {
      this.destroyVectorMinifyResources();
    }
    this.requestFrame();
  }

  setPageBackgroundColor(red: number, green: number, blue: number, alpha: number): void {
    const nextRed = clamp(red, 0, 1);
    const nextGreen = clamp(green, 0, 1);
    const nextBlue = clamp(blue, 0, 1);
    const nextAlpha = clamp(alpha, 0, 1);

    const prev = this.pageBackgroundColor;
    if (
      Math.abs(prev[0] - nextRed) <= 1e-6 &&
      Math.abs(prev[1] - nextGreen) <= 1e-6 &&
      Math.abs(prev[2] - nextBlue) <= 1e-6 &&
      Math.abs(prev[3] - nextAlpha) <= 1e-6
    ) {
      return;
    }

    this.pageBackgroundColor = [nextRed, nextGreen, nextBlue, nextAlpha];
    this.uploadPageBackgroundTexture();
    this.panCacheValid = false;
    this.requestFrame();
  }

  setVectorColorOverride(red: number, green: number, blue: number, opacity: number): void {
    const nextRed = clamp(red, 0, 1);
    const nextGreen = clamp(green, 0, 1);
    const nextBlue = clamp(blue, 0, 1);
    const nextOpacity = clamp(opacity, 0, 1);

    const prevColor = this.vectorOverrideColor;
    if (
      Math.abs(prevColor[0] - nextRed) <= 1e-6 &&
      Math.abs(prevColor[1] - nextGreen) <= 1e-6 &&
      Math.abs(prevColor[2] - nextBlue) <= 1e-6 &&
      Math.abs(this.vectorOverrideOpacity - nextOpacity) <= 1e-6
    ) {
      return;
    }

    this.vectorOverrideColor = [nextRed, nextGreen, nextBlue];
    this.vectorOverrideOpacity = nextOpacity;
    this.panCacheValid = false;
    this.requestFrame();
  }

  setInteractionViewportProvider(
    provider: (() => DOMRect | DOMRectReadOnly | null) | null
  ): void {
    this.interactionViewportProvider = provider;
  }

  beginPanInteraction(): void {
    this.hasCameraInteractionSinceSceneLoad = true;
    this.syncCameraTargetsToCurrent();
    this.panVelocityWorldX = 0;
    this.panVelocityWorldY = 0;
    this.lastPanVelocityUpdateTimeMs = 0;
    this.lastPanFrameCameraX = this.cameraCenterX;
    this.lastPanFrameCameraY = this.cameraCenterY;
    this.lastPanFrameTimeMs = 0;
    this.isPanInteracting = true;
    this.markInteraction();
  }

  endPanInteraction(): void {
    this.isPanInteracting = false;
    const now = performance.now();
    const velocityIsFresh =
      this.lastPanVelocityUpdateTimeMs > 0 &&
      now - this.lastPanVelocityUpdateTimeMs <= PAN_INERTIA_VELOCITY_STALE_MS;
    const speed = velocityIsFresh ? Math.hypot(this.panVelocityWorldX, this.panVelocityWorldY) : 0;
    if (Number.isFinite(speed) && speed >= PAN_INERTIA_MIN_SPEED_WORLD_PER_SEC) {
      this.targetCameraCenterX = this.cameraCenterX + this.panVelocityWorldX / CAMERA_DAMPING_POSITION_RATE;
      this.targetCameraCenterY = this.cameraCenterY + this.panVelocityWorldY / CAMERA_DAMPING_POSITION_RATE;
      this.lastCameraAnimationTimeMs = 0;
    } else {
      this.targetCameraCenterX = this.cameraCenterX;
      this.targetCameraCenterY = this.cameraCenterY;
    }
    this.panVelocityWorldX = 0;
    this.panVelocityWorldY = 0;
    this.lastPanVelocityUpdateTimeMs = 0;
    this.lastPanFrameTimeMs = 0;
    this.markInteraction();
    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  resize(): void {
    const devicePixelRatio = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.floor(this.canvas.clientWidth * devicePixelRatio));
    const nextHeight = Math.max(1, Math.floor(this.canvas.clientHeight * devicePixelRatio));

    if (this.canvas.width === nextWidth && this.canvas.height === nextHeight) {
      return;
    }

    this.canvas.width = nextWidth;
    this.canvas.height = nextHeight;
    this.configureContext();

    this.destroyPanCacheResources();
    this.destroyVectorMinifyResources();
    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  setScene(scene: VectorScene): SceneStats {
    if (this.isDisposed) {
      throw new Error("Cannot upload a scene after the WebGPU renderer has been disposed.");
    }
    this.scene = scene;
    this.segmentCount = scene.segmentCount;
    this.fillPathCount = scene.fillPathCount;
    this.textInstanceCount = scene.textInstanceCount;
    this.textLodRuntime?.dispose();
    this.textLodRuntime = null;
    this.textLodGpuActive = false;
    this.selectedTextInstanceCount = 0;
    this.useTextInstanceIndirection = false;
    this.buildSegmentBounds(scene);

    this.isPanInteracting = false;
    this.panCacheValid = false;
    this.destroyVectorMinifyResources();
    this.destroyVectorLodResources();
    this.grid = null;

    const maxTextureSize = this.maxTextureSize();

    const textLodBuildResult = this.textLodMode === "auto"
      ? getOrBuildTextLod(scene)
      : getCachedTextLod(scene);
    this.textLodRuntime = textLodBuildResult
      ? new TextLodRuntime(textLodBuildResult, this.textLodMode)
      : null;
    let textLodUploadData: TextLodBuildData | null = null;
    if (this.textLodMode === "auto" && textLodBuildResult?.data) {
      const data = textLodBuildResult.data;
      const fitsGpuResources =
        canFitTextureItems(data.combinedInstanceCount, maxTextureSize) &&
        canFitTextureItems(scene.textGlyphCount + 1, maxTextureSize) &&
        canFitTextureItems(
          scene.textGlyphSegmentCount + TEXT_LOD_SOLID_GLYPH_SEGMENT_COUNT,
          maxTextureSize
        ) &&
        this.canFitTextLodStorageBuffer(scene.textInstanceCount);
      if (fitsGpuResources) {
        textLodUploadData = data;
        this.textLodGpuActive = true;
      } else {
        this.textLodRuntime?.setResourceFallback("resource-capacity");
      }
    }

    const segmentDims = chooseTextureDimensions(scene.segmentCount, maxTextureSize);
    const fillPathDims = chooseTextureDimensions(scene.fillPathCount, maxTextureSize);
    const fillSegmentDims = chooseTextureDimensions(scene.fillSegmentCount, maxTextureSize);
    let textInstanceDims = chooseTextureDimensions(
      textLodUploadData?.combinedInstanceCount ?? scene.textInstanceCount,
      maxTextureSize
    );
    let textGlyphDims = chooseTextureDimensions(scene.textGlyphCount + (textLodUploadData ? 1 : 0), maxTextureSize);
    let textSegmentDims = chooseTextureDimensions(
      scene.textGlyphSegmentCount + (textLodUploadData ? TEXT_LOD_SOLID_GLYPH_SEGMENT_COUNT : 0),
      maxTextureSize
    );

    this.destroyDataResources();
    let textCpuPayload: NativeTextUploadArrays;
    try {
      textCpuPayload = prepareNativeTextUploadArrays(
        scene,
        textLodUploadData,
        textInstanceDims,
        textGlyphDims,
        textSegmentDims
      );
    } catch (error) {
      if (!textLodUploadData) {
        throw error;
      }
      this.textLodRuntime?.setResourceFallback("resource-capacity");
      this.textLodGpuActive = false;
      textLodUploadData = null;
      textInstanceDims = chooseTextureDimensions(scene.textInstanceCount, maxTextureSize);
      textGlyphDims = chooseTextureDimensions(scene.textGlyphCount, maxTextureSize);
      textSegmentDims = chooseTextureDimensions(scene.textGlyphSegmentCount, maxTextureSize);
      textCpuPayload = prepareNativeTextUploadArrays(
        scene,
        null,
        textInstanceDims,
        textGlyphDims,
        textSegmentDims
      );
    }

    this.segmentTextureWidth = segmentDims.width;
    this.segmentTextureHeight = segmentDims.height;
    this.fillPathMetaTextureWidth = fillPathDims.width;
    this.fillPathMetaTextureHeight = fillPathDims.height;
    this.fillSegmentTextureWidth = fillSegmentDims.width;
    this.fillSegmentTextureHeight = fillSegmentDims.height;
    this.textInstanceTextureWidth = textInstanceDims.width;
    this.textInstanceTextureHeight = textInstanceDims.height;
    this.textGlyphMetaTextureWidth = textGlyphDims.width;
    this.textGlyphMetaTextureHeight = textGlyphDims.height;
    this.textGlyphSegmentTextureWidth = textSegmentDims.width;
    this.textGlyphSegmentTextureHeight = textSegmentDims.height;

    this.segmentTextureA = this.createFloatTexture(this.segmentTextureWidth, this.segmentTextureHeight, scene.endpoints);
    this.segmentTextureB = this.createFloatTexture(this.segmentTextureWidth, this.segmentTextureHeight, scene.primitiveMeta);
    this.segmentTextureC = this.createFloatTexture(this.segmentTextureWidth, this.segmentTextureHeight, scene.styles);
    this.segmentTextureD = this.createFloatTexture(this.segmentTextureWidth, this.segmentTextureHeight, scene.primitiveBounds);

    this.fillPathMetaTextureA = this.createFloatTexture(this.fillPathMetaTextureWidth, this.fillPathMetaTextureHeight, scene.fillPathMetaA);
    this.fillPathMetaTextureB = this.createFloatTexture(this.fillPathMetaTextureWidth, this.fillPathMetaTextureHeight, scene.fillPathMetaB);
    this.fillPathMetaTextureC = this.createFloatTexture(this.fillPathMetaTextureWidth, this.fillPathMetaTextureHeight, scene.fillPathMetaC);
    this.fillSegmentTextureA = this.createFloatTexture(this.fillSegmentTextureWidth, this.fillSegmentTextureHeight, scene.fillSegmentsA);
    this.fillSegmentTextureB = this.createFloatTexture(this.fillSegmentTextureWidth, this.fillSegmentTextureHeight, scene.fillSegmentsB);

    const textInstanceTexels = this.textInstanceTextureWidth * this.textInstanceTextureHeight;
    this.textInstanceTextureA = this.createFloatTexture(
      this.textInstanceTextureWidth,
      this.textInstanceTextureHeight,
      textCpuPayload.textInstanceA
    );
    this.textInstanceTextureB = this.createFloatTexture(
      this.textInstanceTextureWidth,
      this.textInstanceTextureHeight,
      textCpuPayload.textInstanceB
    );
    this.textInstanceTextureC = this.createRgba8DataTexture(
      this.textInstanceTextureWidth,
      this.textInstanceTextureHeight,
      packNormalizedUint8TextureData(textCpuPayload.textInstanceC, textInstanceTexels)
    );
    this.textGlyphMetaTextureA = this.createFloatTexture(
      this.textGlyphMetaTextureWidth,
      this.textGlyphMetaTextureHeight,
      textCpuPayload.textGlyphMetaA
    );
    this.textGlyphMetaTextureB = this.createFloatTexture(
      this.textGlyphMetaTextureWidth,
      this.textGlyphMetaTextureHeight,
      textCpuPayload.textGlyphMetaB
    );
    this.textGlyphSegmentTextureA = this.createFloatTexture(
      this.textGlyphSegmentTextureWidth,
      this.textGlyphSegmentTextureHeight,
      textCpuPayload.textGlyphSegmentsA
    );
    this.textGlyphSegmentTextureB = this.createFloatTexture(
      this.textGlyphSegmentTextureWidth,
      this.textGlyphSegmentTextureHeight,
      textCpuPayload.textGlyphSegmentsB
    );
    const glyphRasterMetaData = new Float32Array(this.textGlyphMetaTextureWidth * this.textGlyphMetaTextureHeight * 4);
    const textRasterAtlas = buildTextRasterAtlas(scene, maxTextureSize);
    if (textRasterAtlas) {
      glyphRasterMetaData.set(textRasterAtlas.glyphUvRects);
    }
    this.textGlyphRasterMetaTexture = this.createFloatTexture(
      this.textGlyphMetaTextureWidth,
      this.textGlyphMetaTextureHeight,
      glyphRasterMetaData
    );
    this.textRasterAtlasTexture = textRasterAtlas
      ? this.createR8Texture(textRasterAtlas.width, textRasterAtlas.height, textRasterAtlas.alpha)
      : this.createR8Texture(1, 1, new Uint8Array([0]));

    this.configurePageBackgroundResources(scene);
    this.destroyRasterLayerResources();
    if (this.rasterTextureResidency) {
      this.configureRasterLayers(scene);
    }
    this.configureGradientPaint(scene, maxTextureSize);

    this.allSegmentIds = new Uint32Array(this.segmentCount);
    for (let i = 0; i < this.segmentCount; i += 1) {
      this.allSegmentIds[i] = i;
    }

    this.ensureSegmentIdBuffers(Math.max(1, this.segmentCount));
    if (this.segmentCount > 0) {
      this.gpuDevice.queue.writeBuffer(this.segmentIdBufferAll, 0, this.allSegmentIds);
      this.gpuDevice.queue.writeBuffer(this.segmentIdBufferVisible, 0, this.allSegmentIds);
    }
    this.ensureTextInstanceIdBuffer(this.textLodGpuActive ? this.textInstanceCount : 1);

    this.fillBindGroup = this.gpuDevice.createBindGroup({
      layout: this.fillPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: this.cameraUniformBuffer, size: CAMERA_UNIFORM_BUFFER_BYTES }
        },
        {
          binding: 1,
          resource: this.fillPathMetaTextureA.createView()
        },
        {
          binding: 2,
          resource: this.fillPathMetaTextureB.createView()
        },
        {
          binding: 3,
          resource: this.fillPathMetaTextureC.createView()
        },
        {
          binding: 4,
          resource: this.fillSegmentTextureA.createView()
        },
        {
          binding: 5,
          resource: this.fillSegmentTextureB.createView()
        }
      ]
    });

    this.textBindGroup = this.gpuDevice.createBindGroup({
      layout: this.textPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: this.cameraUniformBuffer, size: CAMERA_UNIFORM_BUFFER_BYTES }
        },
        {
          binding: 1,
          resource: this.textInstanceTextureA.createView()
        },
        {
          binding: 2,
          resource: this.textInstanceTextureB.createView()
        },
        {
          binding: 3,
          resource: this.textInstanceTextureC.createView()
        },
        {
          binding: 4,
          resource: this.textGlyphMetaTextureA.createView()
        },
        {
          binding: 5,
          resource: this.textGlyphMetaTextureB.createView()
        },
        {
          binding: 6,
          resource: this.textGlyphSegmentTextureA.createView()
        },
        {
          binding: 7,
          resource: this.textGlyphSegmentTextureB.createView()
        },
        {
          binding: 8,
          resource: this.textGlyphRasterMetaTexture.createView()
        },
        {
          binding: 9,
          resource: this.textRasterSampler
        },
        {
          binding: 10,
          resource: this.textRasterAtlasTexture.createView()
        },
        {
          binding: 11,
          resource: { buffer: this.textInstanceIdBuffer }
        }
      ]
    });

    this.strokeBindGroupAll = this.gpuDevice.createBindGroup({
      layout: this.strokePipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: this.cameraUniformBuffer, size: CAMERA_UNIFORM_BUFFER_BYTES }
        },
        {
          binding: 1,
          resource: this.segmentTextureA.createView()
        },
        {
          binding: 2,
          resource: this.segmentTextureB.createView()
        },
        {
          binding: 3,
          resource: this.segmentTextureC.createView()
        },
        {
          binding: 4,
          resource: this.segmentTextureD.createView()
        },
        {
          binding: 5,
          resource: { buffer: this.segmentIdBufferAll }
        }
      ]
    });

    this.strokeBindGroupVisible = this.gpuDevice.createBindGroup({
      layout: this.strokePipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: this.cameraUniformBuffer, size: CAMERA_UNIFORM_BUFFER_BYTES }
        },
        {
          binding: 1,
          resource: this.segmentTextureA.createView()
        },
        {
          binding: 2,
          resource: this.segmentTextureB.createView()
        },
        {
          binding: 3,
          resource: this.segmentTextureC.createView()
        },
        {
          binding: 4,
          resource: this.segmentTextureD.createView()
        },
        {
          binding: 5,
          resource: { buffer: this.segmentIdBufferVisible }
        }
      ]
    });

    if (this.visibleSegmentIds.length < this.segmentCount) {
      this.visibleSegmentIds = new Uint32Array(this.segmentCount);
    }

    if (this.segmentMarks.length < this.segmentCount) {
      this.segmentMarks = new Uint32Array(this.segmentCount);
      this.markToken = 1;
    }

    this.visibleSegmentCount = this.segmentCount;
    this.usingAllSegments = true;

    const vectorLodActive = this.rebuildVectorLod(scene);
    this.grid = !vectorLodActive && this.segmentCount > 0 ? buildSpatialGrid(scene) : null;

    this.sceneStats = {
      gridWidth: this.grid?.gridWidth ?? 0,
      gridHeight: this.grid?.gridHeight ?? 0,
      gridIndexCount: this.grid?.indices.length ?? 0,
      maxCellPopulation: this.grid?.maxCellPopulation ?? 0,
      fillPathTextureWidth: this.fillPathMetaTextureWidth,
      fillPathTextureHeight: this.fillPathMetaTextureHeight,
      fillSegmentTextureWidth: this.fillSegmentTextureWidth,
      fillSegmentTextureHeight: this.fillSegmentTextureHeight,
      textureWidth: this.segmentTextureWidth,
      textureHeight: this.segmentTextureHeight,
      maxTextureSize,
      textInstanceTextureWidth: this.textInstanceTextureWidth,
      textInstanceTextureHeight: this.textInstanceTextureHeight,
      textGlyphTextureWidth: this.textGlyphMetaTextureWidth,
      textGlyphTextureHeight: this.textGlyphMetaTextureHeight,
      textSegmentTextureWidth: this.textGlyphSegmentTextureWidth,
      textSegmentTextureHeight: this.textGlyphSegmentTextureHeight
    };

    this.minZoom = 0.01;
    this.maxZoom = 8_192;
    this.hasCameraInteractionSinceSceneLoad = false;
    this.syncCameraTargetsToCurrent();
    this.needsVisibleSetUpdate = true;
    this.requestFrame();

    return this.sceneStats;
  }

  getSceneStats(): SceneStats | null {
    return this.sceneStats;
  }

  getViewState(): ViewState {
    return {
      cameraCenterX: this.cameraCenterX,
      cameraCenterY: this.cameraCenterY,
      zoom: this.zoom
    };
  }

  getPresentedViewState(): ViewState {
    return {
      cameraCenterX: this.presentedCameraCenterX,
      cameraCenterY: this.presentedCameraCenterY,
      zoom: this.presentedZoom
    };
  }

  getPresentedFrameSerial(): number {
    return this.presentedFrameSerial;
  }

  setViewState(viewState: ViewState, options: ViewStateUpdateOptions = {}): void {
    const nextCenterX = Number(viewState.cameraCenterX);
    const nextCenterY = Number(viewState.cameraCenterY);
    const nextZoom = Number(viewState.zoom);
    if (!Number.isFinite(nextCenterX) || !Number.isFinite(nextCenterY) || !Number.isFinite(nextZoom)) {
      return;
    }

    this.cameraCenterX = nextCenterX;
    this.cameraCenterY = nextCenterY;
    const resolvedZoom = clamp(nextZoom, this.minZoom, this.maxZoom);
    this.zoom = resolvedZoom;
    this.targetCameraCenterX = nextCenterX;
    this.targetCameraCenterY = nextCenterY;
    this.targetZoom = resolvedZoom;
    this.lastCameraAnimationTimeMs = 0;
    this.hasZoomAnchor = false;
    this.isPanInteracting = false;
    this.panCacheValid = false;
    this.presentedCameraCenterX = this.cameraCenterX;
    this.presentedCameraCenterY = this.cameraCenterY;
    this.presentedZoom = this.zoom;
    this.needsVisibleSetUpdate = true;
    if (options.scheduleFrame !== false) {
      this.requestFrame();
    }
  }

  setSearchHighlights(highlights: SearchHighlightSet | null): void {
    const prepared = prepareSearchHighlights(highlights);
    if (!prepared) {
      if (this.highlightOthersCount !== 0 || this.highlightCurrentCount !== 0) {
        this.highlightOthersCount = 0;
        this.highlightCurrentCount = 0;
        this.requestFrame();
      }
      return;
    }

    const otherRects =
      prepared.otherCount > 0 ? prepared.otherRects : new Float32Array(4);

    const gpuBufferUsage = (globalThis as any).GPUBufferUsage;
    let bindGroupsInvalid = false;
    if (!this.highlightOthersRectsBuffer || this.highlightOthersCapacityBytes < otherRects.byteLength) {
      this.highlightOthersRectsBuffer?.destroy();
      this.highlightOthersCapacityBytes = Math.max(otherRects.byteLength, 16 * 64);
      this.highlightOthersRectsBuffer = this.gpuDevice.createBuffer({
        size: this.highlightOthersCapacityBytes,
        usage: gpuBufferUsage.STORAGE | gpuBufferUsage.COPY_DST
      });
      bindGroupsInvalid = true;
    }
    const currentByteLength = Math.max(16, prepared.currentRects.byteLength);
    if (!this.highlightCurrentRectBuffer || this.highlightCurrentCapacityBytes < currentByteLength) {
      this.highlightCurrentRectBuffer?.destroy();
      this.highlightCurrentCapacityBytes = Math.max(currentByteLength, 16 * 64);
      this.highlightCurrentRectBuffer = this.gpuDevice.createBuffer({
        size: this.highlightCurrentCapacityBytes,
        usage: gpuBufferUsage.STORAGE | gpuBufferUsage.COPY_DST
      });
      bindGroupsInvalid = true;
    }
    this.gpuDevice.queue.writeBuffer(this.highlightOthersRectsBuffer, 0, otherRects);
    if (prepared.currentCount > 0) {
      this.gpuDevice.queue.writeBuffer(this.highlightCurrentRectBuffer, 0, prepared.currentRects);
    }

    if (bindGroupsInvalid || this.highlightOthersBindGroups.length === 0) {
      this.rebuildHighlightBindGroups();
    }

    this.highlightOthersCount = prepared.otherCount;
    this.highlightCurrentCount = prepared.currentCount;
    this.requestFrame();
  }

  private rebuildHighlightBindGroups(): void {
    const makeBindGroup = (styleIndex: number, rectsBuffer: any): any =>
      this.gpuDevice.createBindGroup({
        layout: this.highlightBindGroupLayout,
        entries: [
          { binding: 0, resource: { buffer: this.highlightCameraBuffer } },
          { binding: 1, resource: { buffer: this.highlightStyleBuffers[styleIndex] } },
          { binding: 2, resource: { buffer: rectsBuffer } }
        ]
      });

    this.highlightOthersBindGroups = this.highlightOthersRectsBuffer ? [makeBindGroup(0, this.highlightOthersRectsBuffer)] : [];
    this.highlightCurrentBindGroups = this.highlightCurrentRectBuffer ? [makeBindGroup(1, this.highlightCurrentRectBuffer)] : [];
    this.highlightSelectionBindGroups = this.highlightSelectionRectsBuffer
      ? [makeBindGroup(2, this.highlightSelectionRectsBuffer)]
      : [];
  }

  setTextSelectionHighlights(rects: Float32Array | null): void {
    const count = rects ? Math.floor(rects.length / 4) : 0;
    if (!rects || count === 0) {
      if (this.highlightSelectionCount !== 0) {
        this.highlightSelectionCount = 0;
        this.requestFrame();
      }
      return;
    }

    const data = rects.length === count * 4 ? rects : rects.subarray(0, count * 4);
    const gpuBufferUsage = (globalThis as any).GPUBufferUsage;
    let bindGroupsInvalid = false;
    if (!this.highlightSelectionRectsBuffer || this.highlightSelectionCapacityBytes < data.byteLength) {
      this.highlightSelectionRectsBuffer?.destroy();
      this.highlightSelectionCapacityBytes = Math.max(data.byteLength, 16 * 64);
      this.highlightSelectionRectsBuffer = this.gpuDevice.createBuffer({
        size: this.highlightSelectionCapacityBytes,
        usage: gpuBufferUsage.STORAGE | gpuBufferUsage.COPY_DST
      });
      bindGroupsInvalid = true;
    }
    this.gpuDevice.queue.writeBuffer(this.highlightSelectionRectsBuffer, 0, data);

    if (bindGroupsInvalid || this.highlightSelectionBindGroups.length === 0) {
      this.rebuildHighlightBindGroups();
    }

    this.highlightSelectionCount = count;
    this.requestFrame();
  }

  /**
   * Draws search highlights into the presented pass with the live camera so
   * they can never lag the scene (the dedicated camera buffer is refreshed
   * even on pan-cache blit frames).
   */
  private drawHighlightsIntoPass(
    pass: any,
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoomValue: number
  ): void {
    if (this.highlightOthersCount === 0 && this.highlightCurrentCount === 0 && this.highlightSelectionCount === 0) {
      return;
    }

    const camera = new Float32Array(8);
    camera[0] = viewportWidth;
    camera[1] = viewportHeight;
    camera[2] = cameraCenterX;
    camera[3] = cameraCenterY;
    camera[4] = zoomValue;
    this.gpuDevice.queue.writeBuffer(this.highlightCameraBuffer, 0, camera);

    pass.setPipeline(this.highlightPipeline);
    // Selection first so the search current-match ring stays visible on top.
    if (this.highlightSelectionCount > 0 && this.highlightSelectionBindGroups.length === 1) {
      pass.setBindGroup(0, this.highlightSelectionBindGroups[0]);
      pass.draw(4, this.highlightSelectionCount, 0, 0);
    }
    if (this.highlightOthersCount > 0 && this.highlightOthersBindGroups.length === 1) {
      pass.setBindGroup(0, this.highlightOthersBindGroups[0]);
      pass.draw(4, this.highlightOthersCount, 0, 0);
    }
    if (this.highlightCurrentCount > 0 && this.highlightCurrentBindGroups.length === 1) {
      pass.setBindGroup(0, this.highlightCurrentBindGroups[0]);
      pass.draw(4, this.highlightCurrentCount, 0, 0);
    }
  }

  fitToBounds(bounds: Bounds, paddingPixels = 64): void {
    const width = Math.max(bounds.maxX - bounds.minX, 1e-4);
    const height = Math.max(bounds.maxY - bounds.minY, 1e-4);

    const viewWidth = Math.max(1, this.canvas.width - paddingPixels * 2);
    const viewHeight = Math.max(1, this.canvas.height - paddingPixels * 2);

    const fitZoom = Math.min(viewWidth / width, viewHeight / height);
    const nextZoom = clamp(fitZoom, 1e-8, this.maxZoom);
    this.minZoom = Math.min(this.minZoom, nextZoom);
    const nextCenterX = (bounds.minX + bounds.maxX) * 0.5;
    const nextCenterY = (bounds.minY + bounds.maxY) * 0.5;
    this.zoom = nextZoom;
    this.cameraCenterX = nextCenterX;
    this.cameraCenterY = nextCenterY;
    this.targetZoom = nextZoom;
    this.targetCameraCenterX = nextCenterX;
    this.targetCameraCenterY = nextCenterY;
    this.lastCameraAnimationTimeMs = 0;
    this.hasZoomAnchor = false;
    this.isPanInteracting = false;

    this.panCacheValid = false;
    this.presentedCameraCenterX = this.cameraCenterX;
    this.presentedCameraCenterY = this.cameraCenterY;
    this.presentedZoom = this.zoom;
    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  panByPixels(deltaX: number, deltaY: number): void {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      return;
    }

    this.hasCameraInteractionSinceSceneLoad = true;
    this.markInteraction();
    this.hasZoomAnchor = false;
    const pixelScale = this.resolveClientToPixelScale();
    const worldDeltaX = -(deltaX * pixelScale.x) / this.zoom;
    const worldDeltaY = (deltaY * pixelScale.y) / this.zoom;

    // While dragging, camera should follow pointer immediately.
    this.cameraCenterX += worldDeltaX;
    this.cameraCenterY += worldDeltaY;
    this.targetCameraCenterX = this.cameraCenterX;
    this.targetCameraCenterY = this.cameraCenterY;

    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  zoomAtClientPoint(clientX: number, clientY: number, zoomFactor: number): void {
    const clampedFactor = clamp(zoomFactor, 0.1, 10);
    this.hasCameraInteractionSinceSceneLoad = true;
    this.markInteraction();
    const anchorWorld = this.clientToWorld(clientX, clientY);
    const nextZoom = clamp(this.targetZoom * clampedFactor, this.minZoom, this.maxZoom);
    const zoomTargetChanged = nextZoom !== this.targetZoom;
    this.hasZoomAnchor = true;
    this.zoomAnchorClientX = clientX;
    this.zoomAnchorClientY = clientY;
    this.zoomAnchorWorldX = anchorWorld.x;
    this.zoomAnchorWorldY = anchorWorld.y;
    this.targetZoom = nextZoom;
    const targetCenter = this.computeCameraCenterForAnchor(
      this.zoomAnchorClientX,
      this.zoomAnchorClientY,
      this.zoomAnchorWorldX,
      this.zoomAnchorWorldY,
      nextZoom
    );
    this.targetCameraCenterX = targetCenter.x;
    this.targetCameraCenterY = targetCenter.y;
    if (zoomTargetChanged) {
      // A later pan must not revive pixels rendered with an old hysteretic LOD
      // selection merely because the zoom eventually returns to this scale.
      this.panCacheValid = false;
    }

    this.needsVisibleSetUpdate = true;
    this.panVelocityWorldX = 0;
    this.panVelocityWorldY = 0;
    this.lastPanVelocityUpdateTimeMs = 0;
    this.lastPanFrameTimeMs = 0;
    this.requestFrame();
  }

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;
    if (this.rafHandle !== 0) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }

    this.frameListener = null;
    this.destroyPanCacheResources();
    this.destroyVectorMinifyResources();
    this.destroyDataResources();
    this.rasterLayerResources = [];
    this.scene = null;
    this.grid = null;
    this.sceneStats = null;

    if (this.segmentIdBufferAll) {
      this.segmentIdBufferAll.destroy();
      this.segmentIdBufferAll = null;
    }
    if (this.segmentIdBufferVisible) {
      this.segmentIdBufferVisible.destroy();
      this.segmentIdBufferVisible = null;
    }
    if (this.textInstanceIdBuffer) {
      this.textInstanceIdBuffer.destroy();
      this.textInstanceIdBuffer = null;
    }

    this.textLodRuntime?.dispose();
    this.textLodRuntime = null;
    this.textLodGpuActive = false;
    this.selectedTextInstanceCount = 0;
    this.useTextInstanceIndirection = false;

    if (this.cameraUniformBuffer) {
      this.cameraUniformBuffer.destroy();
    }
    if (this.highlightCameraBuffer) {
      this.highlightCameraBuffer.destroy();
    }
    for (const buffer of this.highlightStyleBuffers) {
      buffer.destroy();
    }
    if (this.highlightOthersRectsBuffer) {
      this.highlightOthersRectsBuffer.destroy();
      this.highlightOthersRectsBuffer = null;
    }
    if (this.highlightCurrentRectBuffer) {
      this.highlightCurrentRectBuffer.destroy();
      this.highlightCurrentRectBuffer = null;
      this.highlightCurrentCapacityBytes = 0;
    }
    if (this.highlightSelectionRectsBuffer) {
      this.highlightSelectionRectsBuffer.destroy();
      this.highlightSelectionRectsBuffer = null;
    }
    if (this.blitUniformBuffer) {
      this.blitUniformBuffer.destroy();
    }
    if (this.vectorCompositeUniformBuffer) {
      this.vectorCompositeUniformBuffer.destroy();
    }
    if (this.pageBackgroundTexture) {
      this.pageBackgroundTexture.destroy();
      this.pageBackgroundTexture = null;
    }
    releaseOwnedWebGpuDevice(this.gpuDevice, this.gpuContext);
  }

  private configureContext(): void {
    this.gpuContext.configure({
      device: this.gpuDevice,
      format: this.presentationFormat,
      alphaMode: "opaque"
    });
  }

  private createPipeline(
    shaderSource: string,
    vertexEntry: string,
    fragmentEntry: string,
    layout: any,
    premultipliedColor = false
  ): any {
    const shaderModule = this.gpuDevice.createShaderModule({ code: shaderSource });
    const colorSrcFactor = premultipliedColor ? "one" : "src-alpha";
    return this.gpuDevice.createRenderPipeline({
      layout,
      vertex: {
        module: shaderModule,
        entryPoint: vertexEntry
      },
      fragment: {
        module: shaderModule,
        entryPoint: fragmentEntry,
        targets: [
          {
            format: this.presentationFormat,
            blend: {
              color: {
                srcFactor: colorSrcFactor,
                dstFactor: "one-minus-src-alpha",
                operation: "add"
              },
              alpha: {
                srcFactor: "one",
                dstFactor: "one-minus-src-alpha",
                operation: "add"
              }
            }
          }
        ]
      },
      primitive: {
        topology: "triangle-strip"
      }
    });
  }

  private maxTextureSize(): number {
    const maxTextureSize = Number(this.gpuDevice?.limits?.maxTextureDimension2D);
    if (Number.isFinite(maxTextureSize) && maxTextureSize >= 1) {
      return Math.floor(maxTextureSize);
    }
    return 8192;
  }

  private ensureSegmentIdBuffers(segmentCapacity: number): void {
    const nextBytes = Math.max(1, segmentCapacity) * 4;

    if (this.segmentIdBufferAll) {
      this.segmentIdBufferAll.destroy();
      this.segmentIdBufferAll = null;
    }

    if (this.segmentIdBufferVisible) {
      this.segmentIdBufferVisible.destroy();
      this.segmentIdBufferVisible = null;
    }

    this.segmentIdBufferAll = this.createSegmentIdStorageBuffer(nextBytes);
    this.segmentIdBufferVisible = this.createSegmentIdStorageBuffer(nextBytes);
  }

  private canFitTextLodStorageBuffer(instanceCapacity: number): boolean {
    const requiredBytes = Math.max(1, instanceCapacity) * 4;
    const storageLimit = Number(this.gpuDevice?.limits?.maxStorageBufferBindingSize);
    const bufferLimit = Number(this.gpuDevice?.limits?.maxBufferSize);
    return (!Number.isFinite(storageLimit) || requiredBytes <= storageLimit) &&
      (!Number.isFinite(bufferLimit) || requiredBytes <= bufferLimit);
  }

  private ensureTextInstanceIdBuffer(instanceCapacity: number): void {
    this.textInstanceIdBuffer?.destroy();
    this.textInstanceIdBuffer = this.createSegmentIdStorageBuffer(Math.max(1, instanceCapacity), false);
  }

  private createSegmentIdStorageBuffer(byteSizeOrCapacity: number, sizeIsBytes = true): any {
    const gpuBufferUsage = (globalThis as any).GPUBufferUsage;
    const size = sizeIsBytes ? byteSizeOrCapacity : Math.max(1, byteSizeOrCapacity) * 4;
    return this.gpuDevice.createBuffer({
      size: Math.max(4, size),
      usage: gpuBufferUsage.STORAGE | gpuBufferUsage.COPY_DST
    });
  }

  private requestFrame(): void {
    if (this.externalFrameDriver) {
      this.externalFramePending = true;
      return;
    }

    if (this.rafHandle !== 0) {
      return;
    }

    this.rafHandle = requestAnimationFrame((timestamp) => {
      this.rafHandle = 0;
      this.render(timestamp);
    });
  }

  private render(timestamp: number = performance.now()): void {
    const isCameraAnimating = this.updateCameraWithDamping(timestamp);
    this.updatePanReleaseVelocitySample(timestamp);
    if (
      !this.scene ||
      (this.segmentCount === 0 &&
        this.fillPathCount === 0 &&
        this.textInstanceCount === 0 &&
        (this.gradientData?.gradientFillPathCount ?? 0) === 0 &&
        (this.gradientData?.gradientStrokeRunCount ?? 0) === 0 &&
        this.rasterLayerResources.length === 0 &&
        this.pageBackgroundResources.length === 0)
    ) {
      this.clearToScreen();
      this.capturePresentedFrameState();
      this.frameListener?.({
        renderedSegments: 0,
        totalSegments: 0,
        usedCulling: false,
        zoom: this.zoom
      });
      if (isCameraAnimating) {
        this.requestFrame();
      }
      return;
    }

    if (!this.hasNativeRenderingEnabled()) {
      this.capturePresentedFrameState();
      this.frameListener?.({
        renderedSegments: 0,
        totalSegments: this.segmentCount,
        usedCulling: false,
        zoom: this.zoom
      });
      if (isCameraAnimating) {
        this.requestFrame();
      }
      return;
    }

    if (this.shouldUsePanCache(isCameraAnimating)) {
      this.renderWithPanCache();
    } else {
      this.renderDirectToScreen();
    }
    this.capturePresentedFrameState();

    if (isCameraAnimating) {
      this.requestFrame();
    }
  }

  private hasNativeRenderingEnabled(): boolean {
    return (
      this.rasterRenderingEnabled ||
      this.fillRenderingEnabled ||
      this.strokeRenderingEnabled ||
      this.textRenderingEnabled
    );
  }

  private capturePresentedFrameState(): void {
    this.presentedCameraCenterX = this.cameraCenterX;
    this.presentedCameraCenterY = this.cameraCenterY;
    this.presentedZoom = this.zoom;
    this.presentedFrameSerial += 1;
  }

  private isTextHeavyStrokeFreeScene(): boolean {
    return isNativeTextHeavyStrokeFreeScene(this.textInstanceCount, this.segmentCount);
  }

  private shouldUsePanCache(isCameraAnimating: boolean): boolean {
    const sceneEligible =
      this.segmentCount >= PAN_CACHE_MIN_SEGMENTS || this.isTextHeavyStrokeFreeScene();
    const vectorLodActive = this.vectorLodRuntime !== null;
    const zoomAnimating =
      Math.abs(this.targetZoom - this.zoom) > CAMERA_DAMPING_ZOOM_EPSILON;
    return shouldUseNativePanCacheForFrame(
      sceneEligible,
      vectorLodActive,
      this.isPanInteracting,
      isCameraAnimating,
      zoomAnimating
    );
  }

  private renderDirectToScreen(): void {
    let useVectorMinify = this.shouldUseVectorMinifyPath() && this.ensureVectorMinifyResources();
    // Keep still/moving appearance consistent on large pan-optimized scenes.
    // Pan-cache path renders vectors directly; matching that avoids thickness shifts while camera moves.
    if (this.segmentCount >= PAN_CACHE_MIN_SEGMENTS) {
      useVectorMinify = false;
    }
    if (this.vectorLodRuntime) {
      useVectorMinify = false;
    }

    if (this.needsVisibleSetUpdate) {
      if (useVectorMinify) {
        const effectiveZoom = this.computeVectorMinifyZoom(this.vectorMinifyWidth, this.vectorMinifyHeight);
        this.updateStrokeVisibleSet(
          this.cameraCenterX,
          this.cameraCenterY,
          this.vectorMinifyWidth,
          this.vectorMinifyHeight,
          effectiveZoom
        );
      } else {
        this.updateStrokeVisibleSet(this.cameraCenterX, this.cameraCenterY, this.canvas.width, this.canvas.height, this.zoom);
      }
      this.needsVisibleSetUpdate = false;
    }

    if (useVectorMinify) {
      const minifyPlan = this.getOrderedGradientMinifyPlan();
      const renderedSegments = this.renderVectorLayerIntoMinifyTarget(
        this.vectorMinifyWidth,
        this.vectorMinifyHeight,
        this.cameraCenterX,
        this.cameraCenterY,
        minifyPlan.includeGradientPaint
      );

      const view = this.gpuContext.getCurrentTexture().createView();
      const encoder = this.gpuDevice.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view,
            clearValue: CLEAR_COLOR,
            loadOp: "clear",
            storeOp: "store"
          }
        ]
      });

      this.updateCameraUniforms(this.canvas.width, this.canvas.height, this.cameraCenterX, this.cameraCenterY, this.zoom, false);
      if (minifyPlan.splitOrderedGradientPrefix) {
        // Keep the raster/native-gradient prefix in exact PDF order and only
        // supersample the ordinary vector suffix. Extraction guarantees
        // accepted native gradient paints precede ordinary vector content.
        this.drawOrderedGradientPaintIntoPass(pass);
      } else {
        this.drawRasterContentIntoPass(pass);
      }
      this.drawVectorMinifyCompositeIntoPass(pass, this.canvas.width, this.canvas.height);
      this.drawHighlightsIntoPass(pass, this.canvas.width, this.canvas.height, this.cameraCenterX, this.cameraCenterY, this.zoom);

      pass.end();
      this.gpuDevice.queue.submit([encoder.finish()]);

      this.frameListener?.({
        renderedSegments,
        totalSegments: this.segmentCount,
        usedCulling: !this.usingAllSegments,
        zoom: this.zoom
      });
      return;
    }

    const view = this.gpuContext.getCurrentTexture().createView();
    const encoder = this.gpuDevice.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: CLEAR_COLOR,
          loadOp: "clear",
          storeOp: "store"
        }
      ]
    });

    const renderedSegments = this.drawSceneIntoPass(pass, this.canvas.width, this.canvas.height, this.cameraCenterX, this.cameraCenterY);
    this.drawHighlightsIntoPass(pass, this.canvas.width, this.canvas.height, this.cameraCenterX, this.cameraCenterY, this.zoom);

    pass.end();
    this.gpuDevice.queue.submit([encoder.finish()]);

    this.frameListener?.({
      renderedSegments,
      totalSegments: this.segmentCount,
      usedCulling: !this.usingAllSegments,
      zoom: this.zoom
    });
  }

  private hasOrdinaryVectorContent(): boolean {
    return (
      (this.fillRenderingEnabled && this.fillPathCount > 0) ||
      (this.strokeRenderingEnabled && this.segmentCount > 0) ||
      (this.textRenderingEnabled && this.textInstanceCount > 0)
    );
  }

  private hasVectorContent(): boolean {
    return (
      this.hasOrdinaryVectorContent() ||
      (this.fillRenderingEnabled && (this.gradientData?.gradientFillPathCount ?? 0) > 0) ||
      (this.strokeRenderingEnabled && (this.gradientData?.gradientStrokeRunCount ?? 0) > 0)
    );
  }

  private shouldUseVectorMinifyPath(): boolean {
    if (!NATIVE_VECTOR_MINIFY_ENABLED) {
      return false;
    }
    const minifyPlan = this.getOrderedGradientMinifyPlan();
    if (
      this.vectorLodRuntime ||
      this.textVectorOnly ||
      !minifyPlan.hasMinifiableContent
    ) {
      return false;
    }
    if (this.isTextHeavyStrokeFreeScene()) {
      return false;
    }
    return this.zoom <= VECTOR_MINIFY_MAX_ZOOM;
  }

  private getOrderedGradientMinifyPlan() {
    return planOrderedGradientMinify(
      this.rasterRenderingEnabled,
      this.gradientPaintRequiresDirectRendering,
      this.hasOrdinaryVectorContent(),
      this.hasVectorContent()
    );
  }

  private computeVectorMinifyZoom(viewportWidth: number, viewportHeight: number): number {
    const zoomScale = Math.min(
      viewportWidth / Math.max(1, this.canvas.width),
      viewportHeight / Math.max(1, this.canvas.height)
    );
    return this.zoom * Math.max(1, zoomScale);
  }

  private renderVectorLayerIntoMinifyTarget(
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    includeGradientPaint: boolean
  ): number {
    if (!this.vectorMinifyTexture) {
      return 0;
    }

    const effectiveZoom = this.computeVectorMinifyZoom(viewportWidth, viewportHeight);
    const encoder = this.gpuDevice.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view: this.vectorMinifyTexture.createView(),
          clearValue: { r: 0, g: 0, b: 0, a: 0 },
          loadOp: "clear",
          storeOp: "store"
        }
      ]
    });

    this.updateCameraUniforms(
      viewportWidth,
      viewportHeight,
      cameraCenterX,
      cameraCenterY,
      effectiveZoom,
      true,
      {
        viewportWidth: this.canvas.width,
        viewportHeight: this.canvas.height,
        cameraCenterX,
        cameraCenterY,
        zoom: this.zoom
      }
    );
    if (includeGradientPaint) {
      this.drawOrderedGradientVectorsIntoPass(pass);
    }
    const renderedSegments = this.drawVectorContentIntoPass(pass);
    pass.end();
    this.gpuDevice.queue.submit([encoder.finish()]);
    return renderedSegments;
  }

  private drawVectorMinifyCompositeIntoPass(pass: any, viewportWidth: number, viewportHeight: number): void {
    if (!this.vectorCompositeBindGroup || !this.vectorMinifyTexture) {
      return;
    }

    this.updateVectorCompositeUniforms(viewportWidth, viewportHeight);
    pass.setPipeline(this.vectorCompositePipeline);
    pass.setBindGroup(0, this.vectorCompositeBindGroup);
    pass.draw(4, 1, 0, 0);
  }

  private renderWithPanCache(): void {
    if (!this.ensurePanCacheResources()) {
      this.renderDirectToScreen();
      return;
    }

    let sampleScale = this.panCacheZoom / Math.max(this.zoom, 1e-6);
    let offsetPxX = (this.cameraCenterX - this.panCacheCenterX) * this.panCacheZoom;
    let offsetPxY = (this.cameraCenterY - this.panCacheCenterY) * this.panCacheZoom;

    const halfCacheX = this.panCacheWidth * 0.5 - 2;
    const halfCacheY = this.panCacheHeight * 0.5 - 2;
    const halfScaledViewX = this.canvas.width * 0.5 * Math.abs(sampleScale);
    const halfScaledViewY = this.canvas.height * 0.5 * Math.abs(sampleScale);
    const coverageX = halfCacheX - halfScaledViewX;
    const coverageY = halfCacheY - halfScaledViewY;

    const zoomRatio = this.zoom / Math.max(this.panCacheZoom, 1e-6);
    const zoomOutOfRange = zoomRatio < PAN_CACHE_ZOOM_RATIO_MIN || zoomRatio > PAN_CACHE_ZOOM_RATIO_MAX;
    const zoomSettled = Math.abs(this.targetZoom - this.zoom) <= CAMERA_DAMPING_ZOOM_EPSILON;
    const needsSharpRefresh = zoomSettled && Math.abs(this.panCacheZoom - this.zoom) > PAN_CACHE_ZOOM_EPSILON;
    const cacheOutOfCoverage =
      coverageX < 0 ||
      coverageY < 0 ||
      Math.abs(offsetPxX) > coverageX ||
      Math.abs(offsetPxY) > coverageY;
    const needsCacheRefresh = !this.panCacheValid || zoomOutOfRange || cacheOutOfCoverage || needsSharpRefresh;

    if (needsCacheRefresh) {
      this.panCacheCenterX = this.cameraCenterX;
      this.panCacheCenterY = this.cameraCenterY;
      this.panCacheZoom = this.zoom;

      this.updateStrokeVisibleSet(this.panCacheCenterX, this.panCacheCenterY, this.panCacheWidth, this.panCacheHeight);
      this.needsVisibleSetUpdate = false;

      const encoder = this.gpuDevice.createCommandEncoder();
      const pass = encoder.beginRenderPass({
        colorAttachments: [
          {
            view: this.panCacheTexture.createView(),
            clearValue: CLEAR_COLOR,
            loadOp: "clear",
            storeOp: "store"
          }
        ]
      });

      this.panCacheRenderedSegments = this.drawSceneIntoPass(
        pass,
        this.panCacheWidth,
        this.panCacheHeight,
        this.panCacheCenterX,
        this.panCacheCenterY
      );

      pass.end();
      this.gpuDevice.queue.submit([encoder.finish()]);

      this.panCacheUsedCulling = !this.usingAllSegments;
      this.panCacheValid = true;

      sampleScale = 1;
      offsetPxX = 0;
      offsetPxY = 0;
    }

    this.blitPanCache(offsetPxX, offsetPxY, sampleScale);

    this.frameListener?.({
      renderedSegments: this.panCacheRenderedSegments,
      totalSegments: this.segmentCount,
      usedCulling: this.panCacheUsedCulling,
      zoom: this.zoom
    });
  }

  private drawSceneIntoPass(
    pass: any,
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number
  ): number {
    this.updateCameraUniforms(viewportWidth, viewportHeight, cameraCenterX, cameraCenterY);
    this.drawOrderedGradientPaintIntoPass(pass);
    return this.drawVectorContentIntoPass(pass);
  }

  private drawPageBackgroundContentIntoPass(pass: any): void {
    if (!this.rasterRenderingEnabled || this.pageBackgroundResources.length === 0) {
      return;
    }
    pass.setPipeline(this.rasterPipeline);
    for (const layer of this.pageBackgroundResources) {
      pass.setBindGroup(0, layer.bindGroup);
      pass.draw(4, 1, 0, 0);
    }
  }

  private drawOrderedGradientPaintIntoPass(pass: any): void {
    this.drawPageBackgroundContentIntoPass(pass);
    for (const command of this.orderedGradientPaintCommands) {
      if (command.kind === "raster") {
        if (!this.rasterRenderingEnabled) {
          continue;
        }
        const resource = this.rasterLayerResources[command.index];
        if (resource) {
          pass.setPipeline(this.rasterPipeline);
          pass.setBindGroup(0, resource.bindGroup);
          pass.draw(4, 1, 0, 0);
        }
      } else if (command.kind === "gradient-fill") {
        if (this.fillRenderingEnabled) {
          this.drawGradientFillIntoPass(pass, command.index);
        }
      } else if (this.strokeRenderingEnabled) {
        this.drawGradientStrokeIntoPass(pass, command.index);
      }
    }
  }

  private drawOrderedGradientVectorsIntoPass(pass: any): void {
    for (const command of this.orderedGradientPaintCommands) {
      if (command.kind === "gradient-fill" && this.fillRenderingEnabled) {
        this.drawGradientFillIntoPass(pass, command.index);
      } else if (command.kind === "gradient-stroke" && this.strokeRenderingEnabled) {
        this.drawGradientStrokeIntoPass(pass, command.index);
      }
    }
  }

  private drawGradientFillIntoPass(pass: any, pathIndex: number): void {
    const data = this.gradientData;
    if (!data || !this.gradientFillBindGroup || pathIndex < 0 || pathIndex >= data.gradientFillPathCount) {
      return;
    }
    pass.setPipeline(this.gradientFillPipeline);
    pass.setBindGroup(0, this.gradientFillBindGroup);
    pass.draw(4, 1, pathIndex * 4, 0);
  }

  private drawGradientStrokeIntoPass(pass: any, runIndex: number): void {
    const data = this.gradientData;
    if (!data || !this.gradientStrokeBindGroup || runIndex < 0 || runIndex >= data.gradientStrokeRunCount) {
      return;
    }
    const segmentCount = Math.max(0, Math.trunc(data.gradientStrokeRunMetaA[runIndex * 4 + 1] ?? 0));
    if (segmentCount === 0) {
      return;
    }
    pass.setPipeline(this.gradientStrokePipeline);
    pass.setBindGroup(0, this.gradientStrokeBindGroup);
    pass.draw(4, segmentCount, runIndex * 4, 0);
  }

  private drawRasterContentIntoPass(pass: any): void {
    if (!this.rasterRenderingEnabled) {
      return;
    }

    this.drawPageBackgroundContentIntoPass(pass);

    if (this.rasterLayerResources.length > 0) {
      pass.setPipeline(this.rasterPipeline);
      for (const command of this.orderedGradientPaintCommands) {
        if (command.kind !== "raster") {
          continue;
        }
        const layer = this.rasterLayerResources[command.index];
        if (layer) {
          pass.setBindGroup(0, layer.bindGroup);
          pass.draw(4, 1, 0, 0);
        }
      }
    }
  }

  private drawVectorContentIntoPass(pass: any): number {
    if (this.fillRenderingEnabled && this.fillPathCount > 0 && this.fillBindGroup) {
      pass.setPipeline(this.fillPipeline);
      pass.setBindGroup(0, this.fillBindGroup);
      pass.draw(4, this.fillPathCount, 0, 0);
    }

    let strokeInstanceCount = 0;
    if (this.strokeRenderingEnabled && this.vectorLodRuntime && this.vectorLodLevelResources.length > 0) {
      for (let levelIndex = 0; levelIndex < this.vectorLodRuntime.levels.length; levelIndex += 1) {
        const runtimeLevel = this.vectorLodRuntime.levels[levelIndex];
        const resource = this.vectorLodLevelResources[levelIndex];
        const instanceCount = Math.max(0, runtimeLevel.visibleSegmentCount | 0);
        if (!resource || instanceCount <= 0 || !resource.bindGroup) {
          continue;
        }
        pass.setPipeline(this.strokePipeline);
        pass.setBindGroup(0, resource.bindGroup);
        pass.draw(4, instanceCount, 0, 0);
        strokeInstanceCount += instanceCount;
      }
    } else {
      strokeInstanceCount = this.strokeRenderingEnabled
        ? (this.usingAllSegments ? this.segmentCount : this.visibleSegmentCount)
        : 0;
      if (strokeInstanceCount > 0) {
        const strokeBindGroup = this.usingAllSegments ? this.strokeBindGroupAll : this.strokeBindGroupVisible;
        if (strokeBindGroup) {
          pass.setPipeline(this.strokePipeline);
          pass.setBindGroup(0, strokeBindGroup);
          pass.draw(4, strokeInstanceCount, 0, 0);
        }
      }
    }

    if (this.textRenderingEnabled && this.textInstanceCount > 0 && this.textBindGroup) {
      const textDrawCount = this.useTextInstanceIndirection
        ? this.selectedTextInstanceCount
        : this.textInstanceCount;
      if (textDrawCount <= 0) {
        return strokeInstanceCount;
      }
      pass.setPipeline(this.textPipeline);
      pass.setBindGroup(0, this.textBindGroup);
      pass.draw(4, textDrawCount, 0, 0);
    }

    return strokeInstanceCount;
  }

  private updateCameraUniforms(
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoomValue = this.zoom,
    prepareTextLodSelection = true,
    textLodProjection?: {
      viewportWidth: number;
      viewportHeight: number;
      cameraCenterX: number;
      cameraCenterY: number;
      zoom: number;
    }
  ): void {
    if (prepareTextLodSelection) {
      this.useTextInstanceIndirection = this.updateTextLodSelection(
        textLodProjection?.viewportWidth ?? viewportWidth,
        textLodProjection?.viewportHeight ?? viewportHeight,
        textLodProjection?.cameraCenterX ?? cameraCenterX,
        textLodProjection?.cameraCenterY ?? cameraCenterY,
        textLodProjection?.zoom ?? zoomValue
      );
    }
    const data = new Float32Array(CAMERA_UNIFORM_FLOATS);
    data[0] = viewportWidth;
    data[1] = viewportHeight;
    data[2] = cameraCenterX;
    data[3] = cameraCenterY;
    data[4] = zoomValue;
    data[5] = 1.0;
    data[6] = this.strokeCurveEnabled ? 1 : 0;
    data[7] = 1.25;
    data[8] = this.strokeCurveEnabled ? 1 : 0;
    data[9] = 1.0;
    data[10] = this.textVectorOnly ? 1 : 0;
    data[11] = prepareTextLodSelection && this.useTextInstanceIndirection ? 1 : 0;
    data[12] = this.vectorOverrideColor[0];
    data[13] = this.vectorOverrideColor[1];
    data[14] = this.vectorOverrideColor[2];
    data[15] = this.vectorOverrideOpacity;

    assertUniformBufferSizeMatches(data, CAMERA_UNIFORM_BUFFER_BYTES, "camera");
    this.gpuDevice.queue.writeBuffer(this.cameraUniformBuffer, 0, data);
  }

  private updateTextLodSelection(
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoomValue: number
  ): boolean {
    const runtime = this.textLodRuntime;
    if (!runtime || !this.textLodGpuActive || this.textLodMode === "off" || !this.textInstanceIdBuffer) {
      this.selectedTextInstanceCount = 0;
      return false;
    }

    const selection = runtime.update({
      localToClip: createOrthographicLocalToClip(
        cameraCenterX,
        cameraCenterY,
        zoomValue,
        viewportWidth,
        viewportHeight
      ),
      viewportWidth,
      viewportHeight
    });
    this.selectedTextInstanceCount = selection.instanceIds.length;
    if (selection.changed && selection.instanceIds.length > 0) {
      this.gpuDevice.queue.writeBuffer(this.textInstanceIdBuffer, 0, selection.instanceIds);
    }
    return true;
  }

  private updateVectorCompositeUniforms(viewportWidth: number, viewportHeight: number): void {
    const data = new Float32Array(VECTOR_COMPOSITE_UNIFORM_FLOATS);
    data[0] = viewportWidth;
    data[1] = viewportHeight;
    data[2] = 0;
    data[3] = 0;
    assertUniformBufferSizeMatches(data, VECTOR_COMPOSITE_UNIFORM_BUFFER_BYTES, "vector composite");
    this.gpuDevice.queue.writeBuffer(this.vectorCompositeUniformBuffer, 0, data);
  }

  private updateBlitUniforms(offsetPxX: number, offsetPxY: number, sampleScale: number): void {
    const data = new Float32Array(BLIT_UNIFORM_FLOATS);
    data[0] = this.canvas.width;
    data[1] = this.canvas.height;
    data[2] = this.panCacheWidth;
    data[3] = this.panCacheHeight;
    data[4] = offsetPxX;
    data[5] = offsetPxY;
    data[6] = sampleScale;
    data[7] = 0;
    data[8] = 0;
    data[9] = 0;
    data[10] = 0;
    data[11] = 0;

    assertUniformBufferSizeMatches(data, BLIT_UNIFORM_BUFFER_BYTES, "blit");
    this.gpuDevice.queue.writeBuffer(this.blitUniformBuffer, 0, data);
  }

  private blitPanCache(offsetPxX: number, offsetPxY: number, sampleScale: number): void {
    if (!this.panCacheTexture || !this.blitBindGroup) {
      this.renderDirectToScreen();
      return;
    }

    this.updateBlitUniforms(offsetPxX, offsetPxY, sampleScale);

    const view = this.gpuContext.getCurrentTexture().createView();
    const encoder = this.gpuDevice.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: CLEAR_COLOR,
          loadOp: "clear",
          storeOp: "store"
        }
      ]
    });

    pass.setPipeline(this.blitPipeline);
    pass.setBindGroup(0, this.blitBindGroup);
    pass.draw(4, 1, 0, 0);

    // Live camera on top of the (possibly slightly stale) blitted cache.
    this.drawHighlightsIntoPass(pass, this.canvas.width, this.canvas.height, this.cameraCenterX, this.cameraCenterY, this.zoom);

    pass.end();
    this.gpuDevice.queue.submit([encoder.finish()]);
  }

  private ensureVectorMinifyResources(): boolean {
    const maxTextureSize = this.maxTextureSize();
    const maxScaleX = maxTextureSize / Math.max(1, this.canvas.width);
    const maxScaleY = maxTextureSize / Math.max(1, this.canvas.height);
    const scale = Math.max(1, Math.min(VECTOR_MINIFY_SUPERSAMPLE, maxScaleX, maxScaleY));
    const desiredWidth = Math.max(this.canvas.width, Math.floor(this.canvas.width * scale));
    const desiredHeight = Math.max(this.canvas.height, Math.floor(this.canvas.height * scale));

    if (desiredWidth < this.canvas.width || desiredHeight < this.canvas.height) {
      return false;
    }

    if (
      this.vectorMinifyTexture &&
      this.vectorMinifyWidth === desiredWidth &&
      this.vectorMinifyHeight === desiredHeight &&
      this.vectorCompositeBindGroup
    ) {
      return true;
    }

    this.destroyVectorMinifyResources();

    const gpuTextureUsage = (globalThis as any).GPUTextureUsage;
    this.vectorMinifyTexture = this.gpuDevice.createTexture({
      size: {
        width: desiredWidth,
        height: desiredHeight,
        depthOrArrayLayers: 1
      },
      format: this.presentationFormat,
      usage: gpuTextureUsage.RENDER_ATTACHMENT | gpuTextureUsage.TEXTURE_BINDING
    });

    this.vectorMinifyWidth = desiredWidth;
    this.vectorMinifyHeight = desiredHeight;

    this.vectorCompositeBindGroup = this.gpuDevice.createBindGroup({
      layout: this.vectorCompositePipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: this.vectorCompositeSampler
        },
        {
          binding: 1,
          resource: this.vectorMinifyTexture.createView()
        },
        {
          binding: 2,
          resource: { buffer: this.vectorCompositeUniformBuffer, size: VECTOR_COMPOSITE_UNIFORM_BUFFER_BYTES }
        }
      ]
    });

    return true;
  }

  private ensurePanCacheResources(): boolean {
    const maxTextureSize = this.maxTextureSize();

    const desiredWidth = Math.min(
      maxTextureSize,
      Math.max(this.canvas.width + PAN_CACHE_BORDER_PX * 2, Math.ceil(this.canvas.width * PAN_CACHE_OVERSCAN_FACTOR))
    );
    const desiredHeight = Math.min(
      maxTextureSize,
      Math.max(this.canvas.height + PAN_CACHE_BORDER_PX * 2, Math.ceil(this.canvas.height * PAN_CACHE_OVERSCAN_FACTOR))
    );

    if (desiredWidth < this.canvas.width || desiredHeight < this.canvas.height) {
      return false;
    }

    if (
      this.panCacheTexture &&
      this.panCacheWidth === desiredWidth &&
      this.panCacheHeight === desiredHeight &&
      this.blitBindGroup
    ) {
      return true;
    }

    this.destroyPanCacheResources();

    const gpuTextureUsage = (globalThis as any).GPUTextureUsage;
    this.panCacheTexture = this.gpuDevice.createTexture({
      size: {
        width: desiredWidth,
        height: desiredHeight,
        depthOrArrayLayers: 1
      },
      format: this.presentationFormat,
      usage: gpuTextureUsage.RENDER_ATTACHMENT | gpuTextureUsage.TEXTURE_BINDING
    });

    this.panCacheWidth = desiredWidth;
    this.panCacheHeight = desiredHeight;
    this.panCacheValid = false;

    this.blitBindGroup = this.gpuDevice.createBindGroup({
      layout: this.blitPipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: this.panCacheSampler
        },
        {
          binding: 1,
          resource: this.panCacheTexture.createView()
        },
        {
          binding: 2,
          resource: { buffer: this.blitUniformBuffer, size: BLIT_UNIFORM_BUFFER_BYTES }
        }
      ]
    });

    return true;
  }

  private destroyPanCacheResources(): void {
    if (this.panCacheTexture) {
      this.panCacheTexture.destroy();
      this.panCacheTexture = null;
    }

    this.panCacheWidth = 0;
    this.panCacheHeight = 0;
    this.panCacheValid = false;
    this.panCacheRenderedSegments = 0;
    this.panCacheUsedCulling = false;
    this.blitBindGroup = null;
  }

  private destroyVectorMinifyResources(): void {
    if (this.vectorMinifyTexture) {
      this.vectorMinifyTexture.destroy();
      this.vectorMinifyTexture = null;
    }

    this.vectorMinifyWidth = 0;
    this.vectorMinifyHeight = 0;
    this.vectorCompositeBindGroup = null;
  }

  private updateVisibleSet(
    viewCenterX: number = this.cameraCenterX,
    viewCenterY: number = this.cameraCenterY,
    viewportWidthPx: number = this.canvas.width,
    viewportHeightPx: number = this.canvas.height,
    zoomValue: number = this.zoom
  ): void {
    if (!this.scene || !this.grid) {
      this.visibleSegmentCount = 0;
      this.usingAllSegments = true;
      return;
    }

    if (!this.hasCameraInteractionSinceSceneLoad) {
      this.usingAllSegments = true;
      this.visibleSegmentCount = this.segmentCount;
      return;
    }

    const grid = this.grid;

    const safeZoom = Math.max(zoomValue, 1e-6);
    const halfViewWidth = viewportWidthPx / (2 * safeZoom);
    const halfViewHeight = viewportHeightPx / (2 * safeZoom);

    const margin = Math.max(16 / safeZoom, this.scene.maxHalfWidth * 2);

    const viewMinX = viewCenterX - halfViewWidth - margin;
    const viewMaxX = viewCenterX + halfViewWidth + margin;
    const viewMinY = viewCenterY - halfViewHeight - margin;
    const viewMaxY = viewCenterY + halfViewHeight + margin;

    const c0 = clampToGrid(Math.floor((viewMinX - grid.minX) / grid.cellWidth), grid.gridWidth);
    const c1 = clampToGrid(Math.floor((viewMaxX - grid.minX) / grid.cellWidth), grid.gridWidth);
    const r0 = clampToGrid(Math.floor((viewMinY - grid.minY) / grid.cellHeight), grid.gridHeight);
    const r1 = clampToGrid(Math.floor((viewMaxY - grid.minY) / grid.cellHeight), grid.gridHeight);

    const visibleCellCount = (c1 - c0 + 1) * (r1 - r0 + 1);
    const totalCellCount = grid.gridWidth * grid.gridHeight;

    if (!this.isInteractionActive() && visibleCellCount >= totalCellCount * FULL_VIEW_FALLBACK_THRESHOLD) {
      this.usingAllSegments = true;
      this.visibleSegmentCount = this.segmentCount;
      return;
    }

    this.usingAllSegments = false;

    this.markToken += 1;
    if (this.markToken === 0xffffffff) {
      this.segmentMarks.fill(0);
      this.markToken = 1;
    }

    let outCount = 0;

    for (let row = r0; row <= r1; row += 1) {
      let cellIndex = row * grid.gridWidth + c0;
      for (let col = c0; col <= c1; col += 1) {
        const offset = grid.offsets[cellIndex];
        const count = grid.counts[cellIndex];
        for (let i = 0; i < count; i += 1) {
          const segmentIndex = grid.indices[offset + i];
          if (this.segmentMarks[segmentIndex] === this.markToken) {
            continue;
          }
          this.segmentMarks[segmentIndex] = this.markToken;

          if (
            this.segmentMaxX[segmentIndex] < viewMinX ||
            this.segmentMinX[segmentIndex] > viewMaxX ||
            this.segmentMaxY[segmentIndex] < viewMinY ||
            this.segmentMinY[segmentIndex] > viewMaxY
          ) {
            continue;
          }

          this.visibleSegmentIds[outCount] = segmentIndex;
          outCount += 1;
        }
        cellIndex += 1;
      }
    }

    this.visibleSegmentCount = outCount;

    if (this.segmentIdBufferVisible && outCount > 0) {
      const slice = this.visibleSegmentIds.subarray(0, outCount);
      this.gpuDevice.queue.writeBuffer(this.segmentIdBufferVisible, 0, slice);
    }
  }

  private updateStrokeVisibleSet(
    viewCenterX: number = this.cameraCenterX,
    viewCenterY: number = this.cameraCenterY,
    viewportWidthPx: number = this.canvas.width,
    viewportHeightPx: number = this.canvas.height,
    zoomValue: number = this.zoom
  ): void {
    if (this.vectorLodRuntime) {
      this.updateVectorLodVisibleSet(viewCenterX, viewCenterY, viewportWidthPx, viewportHeightPx, zoomValue);
      return;
    }

    this.updateVisibleSet(viewCenterX, viewCenterY, viewportWidthPx, viewportHeightPx, zoomValue);
  }

  private updateVectorLodVisibleSet(
    viewCenterX: number = this.cameraCenterX,
    viewCenterY: number = this.cameraCenterY,
    viewportWidthPx: number = this.canvas.width,
    viewportHeightPx: number = this.canvas.height,
    zoomValue: number = this.zoom
  ): void {
    if (!this.scene || !this.vectorLodRuntime) {
      this.vectorLodStats = null;
      this.visibleSegmentCount = 0;
      this.usingAllSegments = true;
      return;
    }

    const safeZoom = Math.max(zoomValue, 1e-6);
    this.vectorLodRuntime.setScreenSpaceTransform();
    this.vectorLodRuntime.updateForLocalUnitsPerPixel(1 / safeZoom);
    this.vectorLodRuntime.update(
      { cameraCenterX: viewCenterX, cameraCenterY: viewCenterY, zoom: safeZoom },
      { width: Math.max(1, viewportWidthPx), height: Math.max(1, viewportHeightPx) },
      null
    );
    this.vectorLodStats = this.vectorLodRuntime.getStats();
    this.visibleSegmentCount = this.vectorLodStats.renderedSegments;
    this.usingAllSegments = false;

    for (let levelIndex = 0; levelIndex < this.vectorLodRuntime.levels.length; levelIndex += 1) {
      const runtimeLevel = this.vectorLodRuntime.levels[levelIndex];
      const resource = this.vectorLodLevelResources[levelIndex];
      if (!resource) {
        continue;
      }
      const drawCount = Math.max(0, runtimeLevel.visibleSegmentCount | 0);
      if (drawCount > 0) {
        this.gpuDevice.queue.writeBuffer(
          resource.visibleSegmentIdBuffer,
          0,
          runtimeLevel.visibleSegmentIds.subarray(0, drawCount)
        );
      }
    }
  }

  private rebuildVectorLod(scene: VectorScene): boolean {
    if (shouldUseVectorStrokeLod(this.vectorLodMode, "webgpu", scene.segmentCount)) {
      this.vectorLodRuntime = takePrebuiltVectorStrokeLodRuntime(scene) ?? new VectorStrokeLodRuntime(scene);
    } else {
      this.vectorLodRuntime = null;
    }
    this.vectorLodStats = null;

    if (!this.vectorLodRuntime || this.vectorLodRuntime.levels.length <= 1) {
      this.destroyVectorLodResources();
      this.vectorLodRuntime = null;
      return false;
    }

    this.uploadVectorLodLevels();
    return this.vectorLodLevelResources.length > 1;
  }

  private uploadVectorLodLevels(): void {
    this.destroyVectorLodResources();
    if (!this.vectorLodRuntime) {
      return;
    }

    const maxTextureSize = this.maxTextureSize();
    for (let levelIndex = 0; levelIndex < this.vectorLodRuntime.levels.length; levelIndex += 1) {
      const level = this.vectorLodRuntime.levels[levelIndex];
      const visibleSegmentIdBuffer = this.createSegmentIdStorageBuffer(Math.max(1, level.segmentCount), false);
      if (levelIndex === 0) {
        this.vectorLodLevelResources.push({
          textureA: this.segmentTextureA,
          textureB: this.segmentTextureB,
          textureC: this.segmentTextureC,
          textureD: this.segmentTextureD,
          textureWidth: this.segmentTextureWidth,
          textureHeight: this.segmentTextureHeight,
          visibleSegmentIdBuffer,
          bindGroup: this.createStrokeBindGroup(
            this.segmentTextureA,
            this.segmentTextureB,
            this.segmentTextureC,
            this.segmentTextureD,
            visibleSegmentIdBuffer
          ),
          ownsTextures: false
        });
        continue;
      }

      const dims = chooseTextureDimensions(level.scene.segmentCount, maxTextureSize);
      const textureA = this.createFloatTexture(dims.width, dims.height, level.scene.endpoints);
      const textureB = this.createFloatTexture(dims.width, dims.height, level.scene.primitiveMeta);
      const textureC = this.createFloatTexture(dims.width, dims.height, level.scene.styles);
      const textureD = this.createFloatTexture(dims.width, dims.height, level.scene.primitiveBounds);
      this.vectorLodLevelResources.push({
        textureA,
        textureB,
        textureC,
        textureD,
        textureWidth: dims.width,
        textureHeight: dims.height,
        visibleSegmentIdBuffer,
        bindGroup: this.createStrokeBindGroup(textureA, textureB, textureC, textureD, visibleSegmentIdBuffer),
        ownsTextures: true
      });
    }
  }

  private createStrokeBindGroup(textureA: any, textureB: any, textureC: any, textureD: any, segmentIdBuffer: any): any {
    return this.gpuDevice.createBindGroup({
      layout: this.strokePipeline.getBindGroupLayout(0),
      entries: [
        {
          binding: 0,
          resource: { buffer: this.cameraUniformBuffer, size: CAMERA_UNIFORM_BUFFER_BYTES }
        },
        {
          binding: 1,
          resource: textureA.createView()
        },
        {
          binding: 2,
          resource: textureB.createView()
        },
        {
          binding: 3,
          resource: textureC.createView()
        },
        {
          binding: 4,
          resource: textureD.createView()
        },
        {
          binding: 5,
          resource: { buffer: segmentIdBuffer }
        }
      ]
    });
  }

  private destroyVectorLodResources(): void {
    for (const level of this.vectorLodLevelResources) {
      if (level.ownsTextures) {
        level.textureA?.destroy();
        level.textureB?.destroy();
        level.textureC?.destroy();
        level.textureD?.destroy();
      }
      level.visibleSegmentIdBuffer?.destroy();
    }
    this.vectorLodLevelResources = [];
    this.vectorLodStats = null;
  }

  private buildSegmentBounds(scene: VectorScene): void {
    if (this.segmentMinX.length < this.segmentCount) {
      this.segmentMinX = new Float32Array(this.segmentCount);
      this.segmentMinY = new Float32Array(this.segmentCount);
      this.segmentMaxX = new Float32Array(this.segmentCount);
      this.segmentMaxY = new Float32Array(this.segmentCount);
    }

    for (let i = 0; i < this.segmentCount; i += 1) {
      const primitiveBoundsOffset = i * 4;
      const styleOffset = i * 4;
      const margin = scene.styles[styleOffset] + 0.35;

      this.segmentMinX[i] = scene.primitiveBounds[primitiveBoundsOffset] - margin;
      this.segmentMinY[i] = scene.primitiveBounds[primitiveBoundsOffset + 1] - margin;
      this.segmentMaxX[i] = scene.primitiveBounds[primitiveBoundsOffset + 2] + margin;
      this.segmentMaxY[i] = scene.primitiveBounds[primitiveBoundsOffset + 3] + margin;
    }
  }

  private markInteraction(): void {
    this.lastInteractionTime = performance.now();
  }

  private isInteractionActive(): boolean {
    return performance.now() - this.lastInteractionTime <= INTERACTION_DECAY_MS;
  }

  private configureRasterLayers(scene: VectorScene): void {
    const rasterSources = this.getSceneRasterLayers(scene);
    const maxRasterTextureSize = this.maxTextureSize();
    for (const [index, source] of rasterSources.entries()) {
      if (source.width > maxRasterTextureSize || source.height > maxRasterTextureSize) {
        throw new Error(
          `Raster layer ${index} requires a ${source.width}x${source.height} texture, ` +
          `but this WebGPU device supports at most ${maxRasterTextureSize}x${maxRasterTextureSize}.`
        );
      }
    }

    this.destroyRasterLayerResources();

    try {
      for (const source of rasterSources) {
        const matrix = new Float32Array(6);
        if (source.matrix.length >= 6) {
          matrix.set(source.matrix.subarray(0, 6));
        } else {
          matrix[0] = 1;
          matrix[3] = 1;
        }

        const rgba = source.data.subarray(0, source.width * source.height * 4);
        const premultiplied = premultiplyRgba(rgba);
        const texture = this.createRgba8Texture(source.width, source.height, premultiplied);
        try {
          this.rasterLayerResources.push(
            this.createRasterLayerResource(matrix, texture, source.paintOrder, source.pageIndex)
          );
        } catch (error) {
          texture.destroy();
          throw error;
        }
      }
    } catch (error) {
      this.destroyRasterLayerResources();
      throw error;
    }
  }

  private configureGradientPaint(scene: VectorScene, maxTextureSize: number): void {
    const data = readGradientSceneData(scene);
    this.gradientData = data;
    const gradientDims = chooseTextureDimensions(data.gradientCount, maxTextureSize);
    const fillPathDims = chooseTextureDimensions(data.gradientFillPathCount, maxTextureSize);
    const fillSegmentDims = chooseTextureDimensions(data.gradientFillSegmentCount, maxTextureSize);
    const strokeRunDims = chooseTextureDimensions(data.gradientStrokeRunCount, maxTextureSize);
    const strokeSegmentDims = chooseTextureDimensions(data.gradientStrokeSegmentCount, maxTextureSize);

    this.gradientMetaTextures = [
      data.gradientMetaA,
      data.gradientMetaB,
      data.gradientMetaC,
      data.gradientMetaD,
      data.gradientMetaE
    ].map((source) => this.createFloatTexture(gradientDims.width, gradientDims.height, source));

    if (data.gradientCount > 0) {
      const byteLength = GRADIENT_LUT_WIDTH * data.gradientCount * 4;
      const lut = new Uint8Array(byteLength);
      lut.set(data.gradientLut.subarray(0, byteLength));
      this.gradientLutTexture = this.createRgba8DataTexture(GRADIENT_LUT_WIDTH, data.gradientCount, lut);
    } else {
      this.gradientLutTexture = this.createRgba8DataTexture(1, 1, new Uint8Array(4));
    }

    this.gradientFillTextures = [
      this.createFloatTexture(fillPathDims.width, fillPathDims.height, data.gradientFillPathMetaA),
      this.createFloatTexture(fillPathDims.width, fillPathDims.height, data.gradientFillPathMetaB),
      this.createFloatTexture(fillPathDims.width, fillPathDims.height, data.gradientFillPathMetaC),
      this.createFloatTexture(fillPathDims.width, fillPathDims.height, data.gradientFillPaintMeta),
      this.createFloatTexture(fillSegmentDims.width, fillSegmentDims.height, data.gradientFillSegmentsA),
      this.createFloatTexture(fillSegmentDims.width, fillSegmentDims.height, data.gradientFillSegmentsB)
    ];
    this.gradientStrokeTextures = [
      this.createFloatTexture(strokeRunDims.width, strokeRunDims.height, data.gradientStrokeRunMetaA),
      this.createFloatTexture(strokeSegmentDims.width, strokeSegmentDims.height, data.gradientStrokeEndpoints),
      this.createFloatTexture(strokeSegmentDims.width, strokeSegmentDims.height, data.gradientStrokePrimitiveMeta),
      this.createFloatTexture(strokeSegmentDims.width, strokeSegmentDims.height, data.gradientStrokePrimitiveBounds),
      this.createFloatTexture(strokeSegmentDims.width, strokeSegmentDims.height, data.gradientStrokeStyles)
    ];

    this.gradientFillBindGroup = this.gpuDevice.createBindGroup({
      layout: this.gradientFillBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraUniformBuffer, size: CAMERA_UNIFORM_BUFFER_BYTES } },
        ...this.gradientFillTextures.map((texture, index) => ({
          binding: index + 1,
          resource: texture.createView()
        })),
        ...this.gradientMetaTextures.map((texture, index) => ({
          binding: index + 7,
          resource: texture.createView()
        })),
        { binding: 12, resource: this.gradientSampler },
        { binding: 13, resource: this.gradientLutTexture.createView() }
      ]
    });
    this.gradientStrokeBindGroup = this.gpuDevice.createBindGroup({
      layout: this.gradientStrokeBindGroupLayout,
      entries: [
        { binding: 0, resource: { buffer: this.cameraUniformBuffer, size: CAMERA_UNIFORM_BUFFER_BYTES } },
        ...this.gradientStrokeTextures.map((texture, index) => ({
          binding: index + 1,
          resource: texture.createView()
        })),
        ...this.gradientMetaTextures.map((texture, index) => ({
          binding: index + 6,
          resource: texture.createView()
        })),
        { binding: 11, resource: this.gradientSampler },
        { binding: 12, resource: this.gradientLutTexture.createView() }
      ]
    });

    this.orderedGradientPaintCommands = buildOrderedGradientPaintCommands(
      this.getSceneRasterLayers(scene),
      data
    );
    this.gradientPaintRequiresDirectRendering = orderedGradientPaintNeedsDirectRendering(
      this.orderedGradientPaintCommands
    );
  }

  private configurePageBackgroundResources(scene: VectorScene): void {
    this.destroyPageBackgroundResources();
    if (!this.pageBackgroundTexture) {
      this.uploadPageBackgroundTexture();
    }
    if (!this.pageBackgroundTexture) {
      return;
    }

    const rects = normalizePageRects(scene);
    for (let i = 0; i + 3 < rects.length; i += 4) {
      const minX = rects[i];
      const minY = rects[i + 1];
      const maxX = rects[i + 2];
      const maxY = rects[i + 3];
      if (![minX, minY, maxX, maxY].every(Number.isFinite)) {
        continue;
      }

      const width = Math.max(maxX - minX, 1e-6);
      const height = Math.max(maxY - minY, 1e-6);
      const matrix = new Float32Array([width, 0, 0, height, minX, minY]);
      this.pageBackgroundResources.push(this.createRasterLayerResource(matrix, this.pageBackgroundTexture));
    }
  }

  private getSceneRasterLayers(
    scene: VectorScene
  ): Array<{
    width: number;
    height: number;
    data: Uint8Array<ArrayBufferLike>;
    matrix: Float32Array;
    paintOrder: number;
    pageIndex: number;
  }> {
    const out: Array<{
      width: number;
      height: number;
      data: Uint8Array<ArrayBufferLike>;
      matrix: Float32Array;
      paintOrder: number;
      pageIndex: number;
    }> = [];
    if (Array.isArray(scene.rasterLayers)) {
      for (const layer of scene.rasterLayers) {
        const width = Math.max(0, Math.trunc(layer?.width ?? 0));
        const height = Math.max(0, Math.trunc(layer?.height ?? 0));
        if (width <= 0 || height <= 0 || !(layer.data instanceof Uint8Array) || layer.data.length < width * height * 4) {
          continue;
        }
        out.push({
          width,
          height,
          data: layer.data,
          matrix: layer.matrix instanceof Float32Array ? layer.matrix : new Float32Array(layer.matrix),
          paintOrder: Number.isFinite(layer.paintOrder) ? layer.paintOrder : 0,
          pageIndex: Number.isFinite(layer.pageIndex) ? Math.max(0, Math.trunc(layer.pageIndex)) : 0
        });
      }
    }

    if (out.length > 0) {
      return out;
    }

    const legacyWidth = Math.max(0, Math.trunc(scene.rasterLayerWidth));
    const legacyHeight = Math.max(0, Math.trunc(scene.rasterLayerHeight));
    if (legacyWidth <= 0 || legacyHeight <= 0 || scene.rasterLayerData.length < legacyWidth * legacyHeight * 4) {
      return out;
    }

    out.push({
      width: legacyWidth,
      height: legacyHeight,
      data: scene.rasterLayerData,
      matrix: scene.rasterLayerMatrix,
      paintOrder: 0,
      pageIndex: 0
    });
    return out;
  }

  private destroyRasterLayerResources(): void {
    for (const layer of this.rasterLayerResources) {
      if (layer.texture) {
        layer.texture.destroy();
      }
      if (layer.uniformBuffer) {
        layer.uniformBuffer.destroy();
      }
    }
    this.rasterLayerResources = [];
  }

  private destroyPageBackgroundResources(): void {
    for (const layer of this.pageBackgroundResources) {
      if (layer.uniformBuffer) {
        layer.uniformBuffer.destroy();
      }
    }
    this.pageBackgroundResources = [];
  }

  private uploadPageBackgroundTexture(): void {
    const alphaByte = Math.round(this.pageBackgroundColor[3] * 255);
    const alphaScale = alphaByte / 255;
    const rgba = new Uint8Array([
      Math.round(this.pageBackgroundColor[0] * alphaScale * 255),
      Math.round(this.pageBackgroundColor[1] * alphaScale * 255),
      Math.round(this.pageBackgroundColor[2] * alphaScale * 255),
      alphaByte
    ]);

    if (!this.pageBackgroundTexture) {
      this.pageBackgroundTexture = this.createRgba8Texture(1, 1, rgba);
      return;
    }

    this.writeRgba8Texture(this.pageBackgroundTexture, 1, 1, rgba, 0);
  }

  private createRasterLayerResource(
    matrix: Float32Array,
    texture: any,
    paintOrder = 0,
    pageIndex = 0
  ): WebGpuRasterLayerResource {
    const gpuBufferUsage = (globalThis as any).GPUBufferUsage;
    const rasterUniforms = new Float32Array(RASTER_UNIFORM_FLOATS);
    rasterUniforms[0] = matrix[0];
    rasterUniforms[1] = matrix[1];
    rasterUniforms[2] = matrix[2];
    rasterUniforms[3] = matrix[3];
    rasterUniforms[4] = matrix[4];
    rasterUniforms[5] = matrix[5];
    rasterUniforms[6] = 0;
    rasterUniforms[7] = 0;
    assertUniformBufferSizeMatches(rasterUniforms, RASTER_UNIFORM_BUFFER_BYTES, "raster");

    const uniformBuffer = this.gpuDevice.createBuffer({
      size: RASTER_UNIFORM_BUFFER_BYTES,
      usage: gpuBufferUsage.UNIFORM | gpuBufferUsage.COPY_DST
    });
    try {
      this.gpuDevice.queue.writeBuffer(uniformBuffer, 0, rasterUniforms);

      const bindGroup = this.gpuDevice.createBindGroup({
        layout: this.rasterPipeline.getBindGroupLayout(0),
        entries: [
          {
            binding: 0,
            resource: { buffer: this.cameraUniformBuffer, size: CAMERA_UNIFORM_BUFFER_BYTES }
          },
          {
            binding: 1,
            resource: { buffer: uniformBuffer, size: RASTER_UNIFORM_BUFFER_BYTES }
          },
          {
            binding: 2,
            resource: this.rasterLayerSampler
          },
          {
            binding: 3,
            resource: texture.createView()
          }
        ]
      });

      return {
        texture,
        uniformBuffer,
        bindGroup,
        paintOrder: Number.isFinite(paintOrder) ? paintOrder : 0,
        pageIndex: Number.isFinite(pageIndex) ? Math.max(0, Math.trunc(pageIndex)) : 0
      };
    } catch (error) {
      try {
        uniformBuffer.destroy();
      } catch {
        // Preserve the resource-creation error.
      }
      throw error;
    }
  }

  private createFloatTexture(width: number, height: number, source: Float32Array): any {
    const gpuTextureUsage = (globalThis as any).GPUTextureUsage;

    const texture = this.gpuDevice.createTexture({
      size: {
        width,
        height,
        depthOrArrayLayers: 1
      },
      format: "rgba32float",
      usage: gpuTextureUsage.TEXTURE_BINDING | gpuTextureUsage.COPY_DST
    });

    const padded = createPaddedFloatTextureData(source, width, height);
    this.writeFloatTexture(texture, width, height, padded);

    return texture;
  }

  private createRgba8Texture(width: number, height: number, source: Uint8Array): any {
    const gpuTextureUsage = (globalThis as any).GPUTextureUsage;
    const mipChain = buildRgbaMipChain(source, width, height);

    const texture = this.gpuDevice.createTexture({
      size: {
        width,
        height,
        depthOrArrayLayers: 1
      },
      format: "rgba8unorm",
      mipLevelCount: mipChain.length,
      usage: gpuTextureUsage.TEXTURE_BINDING | gpuTextureUsage.COPY_DST
    });

    for (let mipLevel = 0; mipLevel < mipChain.length; mipLevel += 1) {
      const level = mipChain[mipLevel];
      const padded = createPaddedByteTextureData(level.data, level.width, level.height);
      this.writeRgba8Texture(texture, level.width, level.height, padded, mipLevel);
    }
    return texture;
  }

  private createR8Texture(width: number, height: number, source: Uint8Array): any {
    const gpuTextureUsage = (globalThis as any).GPUTextureUsage;
    const mipChain = buildSingleChannelUint8MipChain(source, width, height);

    const texture = this.gpuDevice.createTexture({
      size: {
        width,
        height,
        depthOrArrayLayers: 1
      },
      format: "r8unorm",
      mipLevelCount: mipChain.length,
      usage: gpuTextureUsage.TEXTURE_BINDING | gpuTextureUsage.COPY_DST
    });

    for (let mipLevel = 0; mipLevel < mipChain.length; mipLevel += 1) {
      const level = mipChain[mipLevel];
      const padded = createPaddedByteTextureData(level.data, level.width, level.height, 1);
      this.writeR8Texture(texture, level.width, level.height, padded, mipLevel);
    }
    return texture;
  }

  private createRgba8DataTexture(width: number, height: number, source: Uint8Array): any {
    const gpuTextureUsage = (globalThis as any).GPUTextureUsage;

    const texture = this.gpuDevice.createTexture({
      size: {
        width,
        height,
        depthOrArrayLayers: 1
      },
      format: "rgba8unorm",
      usage: gpuTextureUsage.TEXTURE_BINDING | gpuTextureUsage.COPY_DST
    });

    const padded = createPaddedByteTextureData(source, width, height, 4);
    this.writeRgba8Texture(texture, width, height, padded);
    return texture;
  }

  private writeFloatTexture(texture: any, width: number, height: number, data: Float32Array): void {
    const bytesPerRowUnpadded = width * 16;
    const bytesPerRowAligned = alignTo(bytesPerRowUnpadded, 256);

    if (height <= 1 && bytesPerRowUnpadded === bytesPerRowAligned) {
      this.gpuDevice.queue.writeTexture(
        { texture },
        data,
        { offset: 0 },
        { width, height, depthOrArrayLayers: 1 }
      );
      return;
    }

    if (bytesPerRowUnpadded === bytesPerRowAligned) {
      this.gpuDevice.queue.writeTexture(
        { texture },
        data,
        { offset: 0, bytesPerRow: bytesPerRowUnpadded, rowsPerImage: height },
        { width, height, depthOrArrayLayers: 1 }
      );
      return;
    }

    const srcBytes = new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
    const paddedBytes = new Uint8Array(bytesPerRowAligned * height);

    for (let row = 0; row < height; row += 1) {
      const srcOffset = row * bytesPerRowUnpadded;
      const dstOffset = row * bytesPerRowAligned;
      paddedBytes.set(srcBytes.subarray(srcOffset, srcOffset + bytesPerRowUnpadded), dstOffset);
    }

    this.gpuDevice.queue.writeTexture(
      { texture },
      paddedBytes,
      { offset: 0, bytesPerRow: bytesPerRowAligned, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 }
    );
  }

  private writeRgba8Texture(texture: any, width: number, height: number, data: Uint8Array, mipLevel = 0): void {
    const bytesPerRowUnpadded = width * 4;
    const bytesPerRowAligned = alignTo(bytesPerRowUnpadded, 256);

    if (height <= 1 && bytesPerRowUnpadded === bytesPerRowAligned) {
      this.gpuDevice.queue.writeTexture(
        { texture, mipLevel },
        data,
        { offset: 0 },
        { width, height, depthOrArrayLayers: 1 }
      );
      return;
    }

    if (bytesPerRowUnpadded === bytesPerRowAligned) {
      this.gpuDevice.queue.writeTexture(
        { texture, mipLevel },
        data,
        { offset: 0, bytesPerRow: bytesPerRowUnpadded, rowsPerImage: height },
        { width, height, depthOrArrayLayers: 1 }
      );
      return;
    }

    const paddedBytes = new Uint8Array(bytesPerRowAligned * height);
    for (let row = 0; row < height; row += 1) {
      const srcOffset = row * bytesPerRowUnpadded;
      const dstOffset = row * bytesPerRowAligned;
      paddedBytes.set(data.subarray(srcOffset, srcOffset + bytesPerRowUnpadded), dstOffset);
    }

    this.gpuDevice.queue.writeTexture(
      { texture, mipLevel },
      paddedBytes,
      { offset: 0, bytesPerRow: bytesPerRowAligned, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 }
    );
  }

  private writeR8Texture(texture: any, width: number, height: number, data: Uint8Array, mipLevel = 0): void {
    const bytesPerRowUnpadded = width;
    const bytesPerRowAligned = alignTo(bytesPerRowUnpadded, 256);

    if (height <= 1 && bytesPerRowUnpadded === bytesPerRowAligned) {
      this.gpuDevice.queue.writeTexture(
        { texture, mipLevel },
        data,
        { offset: 0 },
        { width, height, depthOrArrayLayers: 1 }
      );
      return;
    }

    if (bytesPerRowUnpadded === bytesPerRowAligned) {
      this.gpuDevice.queue.writeTexture(
        { texture, mipLevel },
        data,
        { offset: 0, bytesPerRow: bytesPerRowUnpadded, rowsPerImage: height },
        { width, height, depthOrArrayLayers: 1 }
      );
      return;
    }

    const paddedBytes = new Uint8Array(bytesPerRowAligned * height);
    for (let row = 0; row < height; row += 1) {
      const srcOffset = row * bytesPerRowUnpadded;
      const dstOffset = row * bytesPerRowAligned;
      paddedBytes.set(data.subarray(srcOffset, srcOffset + bytesPerRowUnpadded), dstOffset);
    }

    this.gpuDevice.queue.writeTexture(
      { texture, mipLevel },
      paddedBytes,
      { offset: 0, bytesPerRow: bytesPerRowAligned, rowsPerImage: height },
      { width, height, depthOrArrayLayers: 1 }
    );
  }

  private clearToScreen(): void {
    const view = this.gpuContext.getCurrentTexture().createView();
    const encoder = this.gpuDevice.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: CLEAR_COLOR,
          loadOp: "clear",
          storeOp: "store"
        }
      ]
    });

    pass.end();
    this.gpuDevice.queue.submit([encoder.finish()]);
  }

  private destroyDataResources(): void {
    this.destroyVectorLodResources();
    this.vectorLodRuntime = null;
    this.strokeBindGroupAll = null;
    this.strokeBindGroupVisible = null;
    this.fillBindGroup = null;
    this.gradientFillBindGroup = null;
    this.gradientStrokeBindGroup = null;
    this.textBindGroup = null;
    if (this.textInstanceIdBuffer) {
      this.textInstanceIdBuffer.destroy();
      this.textInstanceIdBuffer = null;
    }
    this.destroyPageBackgroundResources();
    this.destroyRasterLayerResources();

    const textures = [
      this.segmentTextureA,
      this.segmentTextureB,
      this.segmentTextureC,
      this.segmentTextureD,
      this.fillPathMetaTextureA,
      this.fillPathMetaTextureB,
      this.fillPathMetaTextureC,
      this.fillSegmentTextureA,
      this.fillSegmentTextureB,
      this.textInstanceTextureA,
      this.textInstanceTextureB,
      this.textInstanceTextureC,
      this.textGlyphMetaTextureA,
      this.textGlyphMetaTextureB,
      this.textGlyphRasterMetaTexture,
      this.textGlyphSegmentTextureA,
      this.textGlyphSegmentTextureB,
      this.textRasterAtlasTexture,
      ...this.gradientMetaTextures,
      this.gradientLutTexture,
      ...this.gradientFillTextures,
      ...this.gradientStrokeTextures
    ];

    for (const texture of textures) {
      if (texture) {
        texture.destroy();
      }
    }

    this.segmentTextureA = null;
    this.segmentTextureB = null;
    this.segmentTextureC = null;
    this.segmentTextureD = null;
    this.fillPathMetaTextureA = null;
    this.fillPathMetaTextureB = null;
    this.fillPathMetaTextureC = null;
    this.fillSegmentTextureA = null;
    this.fillSegmentTextureB = null;
    this.textInstanceTextureA = null;
    this.textInstanceTextureB = null;
    this.textInstanceTextureC = null;
    this.textGlyphMetaTextureA = null;
    this.textGlyphMetaTextureB = null;
    this.textGlyphRasterMetaTexture = null;
    this.textGlyphSegmentTextureA = null;
    this.textGlyphSegmentTextureB = null;
    this.textRasterAtlasTexture = null;
    this.gradientMetaTextures = [];
    this.gradientLutTexture = null;
    this.gradientFillTextures = [];
    this.gradientStrokeTextures = [];
    this.gradientData = null;
    this.orderedGradientPaintCommands = [];
    this.gradientPaintRequiresDirectRendering = false;
  }

  clientToScenePoint(clientX: number, clientY: number): { x: number; y: number } | null {
    return this.clientToWorld(clientX, clientY);
  }

  sceneToClientPoint(sceneX: number, sceneY: number): { x: number; y: number } | null {
    const rect = this.resolveInteractionViewportRect();
    const pixelScale = this.resolveClientToPixelScale(rect);
    if (pixelScale.x === 0 || pixelScale.y === 0) {
      return null;
    }

    const pixelX = (sceneX - this.cameraCenterX) * this.zoom + this.canvas.width * 0.5;
    const pixelY = (sceneY - this.cameraCenterY) * this.zoom + this.canvas.height * 0.5;

    return {
      x: rect.left + pixelX / pixelScale.x,
      y: rect.bottom - pixelY / pixelScale.y
    };
  }

  private clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
    return this.clientToWorldAt(clientX, clientY, this.cameraCenterX, this.cameraCenterY, this.zoom);
  }

  private clientToWorldAt(
    clientX: number,
    clientY: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoom: number
  ): { x: number; y: number } {
    const rect = this.resolveInteractionViewportRect();
    const pixelScale = this.resolveClientToPixelScale(rect);

    const pixelX = (clientX - rect.left) * pixelScale.x;
    const pixelY = (rect.bottom - clientY) * pixelScale.y;

    return {
      x: (pixelX - this.canvas.width * 0.5) / zoom + cameraCenterX,
      y: (pixelY - this.canvas.height * 0.5) / zoom + cameraCenterY
    };
  }

  private syncCameraTargetsToCurrent(): void {
    this.targetCameraCenterX = this.cameraCenterX;
    this.targetCameraCenterY = this.cameraCenterY;
    this.targetZoom = this.zoom;
    this.lastCameraAnimationTimeMs = 0;
    this.hasZoomAnchor = false;
  }

  private updatePanReleaseVelocitySample(timestamp: number): void {
    if (!this.isPanInteracting) {
      this.lastPanFrameTimeMs = 0;
      return;
    }

    if (this.lastPanFrameTimeMs > 0) {
      const deltaMs = timestamp - this.lastPanFrameTimeMs;
      if (deltaMs > 0.1) {
        const deltaX = this.cameraCenterX - this.lastPanFrameCameraX;
        const deltaY = this.cameraCenterY - this.lastPanFrameCameraY;
        let velocityX = (deltaX * 1000) / deltaMs;
        let velocityY = (deltaY * 1000) / deltaMs;
        const speed = Math.hypot(velocityX, velocityY);
        if (Number.isFinite(speed) && speed >= PAN_INERTIA_MIN_SPEED_WORLD_PER_SEC) {
          if (speed > PAN_MAX_SPEED_WORLD_PER_SEC) {
            const scale = PAN_MAX_SPEED_WORLD_PER_SEC / speed;
            velocityX *= scale;
            velocityY *= scale;
          }
          this.panVelocityWorldX = velocityX;
          this.panVelocityWorldY = velocityY;
          this.lastPanVelocityUpdateTimeMs = timestamp;
        }
      }
    }

    this.lastPanFrameCameraX = this.cameraCenterX;
    this.lastPanFrameCameraY = this.cameraCenterY;
    this.lastPanFrameTimeMs = timestamp;
  }

  private updateCameraWithDamping(timestamp: number): boolean {
    let needsPosition =
      Math.abs(this.targetCameraCenterX - this.cameraCenterX) > CAMERA_DAMPING_POSITION_EPSILON ||
      Math.abs(this.targetCameraCenterY - this.cameraCenterY) > CAMERA_DAMPING_POSITION_EPSILON;
    let needsZoom = Math.abs(this.targetZoom - this.zoom) > CAMERA_DAMPING_ZOOM_EPSILON;
    if (!needsPosition && !needsZoom) {
      this.hasZoomAnchor = false;
      this.lastCameraAnimationTimeMs = timestamp;
      return false;
    }

    if (this.lastCameraAnimationTimeMs <= 0) {
      this.lastCameraAnimationTimeMs = timestamp - 16;
    }

    const dtMs = clamp(timestamp - this.lastCameraAnimationTimeMs, 0, CAMERA_DAMPING_MAX_DT_MS);
    this.lastCameraAnimationTimeMs = timestamp;
    const dtSeconds = dtMs / 1000;
    const positionLerp = 1 - Math.exp(-CAMERA_DAMPING_POSITION_RATE * dtSeconds);
    const zoomLerp = 1 - Math.exp(-CAMERA_DAMPING_ZOOM_RATE * dtSeconds);

    if (needsZoom) {
      this.zoom += (this.targetZoom - this.zoom) * zoomLerp;
      if (Math.abs(this.targetZoom - this.zoom) <= CAMERA_DAMPING_ZOOM_EPSILON) {
        this.zoom = this.targetZoom;
      }
    }

    if (this.hasZoomAnchor) {
      // Compute center from the post-zoom value so the world point under cursor stays fixed every frame.
      const anchoredCurrent = this.computeCameraCenterForAnchor(
        this.zoomAnchorClientX,
        this.zoomAnchorClientY,
        this.zoomAnchorWorldX,
        this.zoomAnchorWorldY,
        this.zoom
      );
      const anchoredTarget = this.computeCameraCenterForAnchor(
        this.zoomAnchorClientX,
        this.zoomAnchorClientY,
        this.zoomAnchorWorldX,
        this.zoomAnchorWorldY,
        this.targetZoom
      );
      this.cameraCenterX = anchoredCurrent.x;
      this.cameraCenterY = anchoredCurrent.y;
      this.targetCameraCenterX = anchoredTarget.x;
      this.targetCameraCenterY = anchoredTarget.y;
      if (!needsZoom) {
        this.hasZoomAnchor = false;
      }
      needsPosition = false;
    } else if (needsPosition) {
      this.cameraCenterX += (this.targetCameraCenterX - this.cameraCenterX) * positionLerp;
      this.cameraCenterY += (this.targetCameraCenterY - this.cameraCenterY) * positionLerp;
      if (Math.abs(this.targetCameraCenterX - this.cameraCenterX) <= CAMERA_DAMPING_POSITION_EPSILON) {
        this.cameraCenterX = this.targetCameraCenterX;
      }
      if (Math.abs(this.targetCameraCenterY - this.cameraCenterY) <= CAMERA_DAMPING_POSITION_EPSILON) {
        this.cameraCenterY = this.targetCameraCenterY;
      }
    }

    this.markInteraction();
    this.needsVisibleSetUpdate = true;

    needsPosition =
      Math.abs(this.targetCameraCenterX - this.cameraCenterX) > CAMERA_DAMPING_POSITION_EPSILON ||
      Math.abs(this.targetCameraCenterY - this.cameraCenterY) > CAMERA_DAMPING_POSITION_EPSILON;
    needsZoom = Math.abs(this.targetZoom - this.zoom) > CAMERA_DAMPING_ZOOM_EPSILON;

    return (
      needsPosition ||
      needsZoom
    );
  }

  private computeCameraCenterForAnchor(
    clientX: number,
    clientY: number,
    worldX: number,
    worldY: number,
    zoom: number
  ): { x: number; y: number } {
    const rect = this.resolveInteractionViewportRect();
    const pixelScale = this.resolveClientToPixelScale(rect);
    const pixelX = (clientX - rect.left) * pixelScale.x;
    const pixelY = (rect.bottom - clientY) * pixelScale.y;
    return {
      x: worldX - (pixelX - this.canvas.width * 0.5) / zoom,
      y: worldY - (pixelY - this.canvas.height * 0.5) / zoom
    };
  }

  private resolveInteractionViewportRect(): DOMRect | DOMRectReadOnly {
    const providerRect = this.interactionViewportProvider?.();
    if (providerRect) {
      return providerRect;
    }
    return this.canvas.getBoundingClientRect();
  }

  private resolveClientToPixelScale(rectInput?: DOMRect | DOMRectReadOnly): { x: number; y: number } {
    const rect = rectInput ?? this.resolveInteractionViewportRect();
    const defaultScale = Math.max(window.devicePixelRatio || 1, 1e-6);
    const scaleX = rect.width > 1e-6 ? this.canvas.width / rect.width : defaultScale;
    const scaleY = rect.height > 1e-6 ? this.canvas.height / rect.height : defaultScale;
    return {
      x: Math.max(1e-6, scaleX),
      y: Math.max(1e-6, scaleY)
    };
  }
}

function createPaddedFloatTextureData(source: Float32Array, width: number, height: number): Float32Array {
  const expectedLength = width * height * 4;
  if (source.length > expectedLength) {
    throw new Error(`Texture source data exceeds texture size (${source.length} > ${expectedLength}).`);
  }

  const padded = new Float32Array(expectedLength);
  padded.set(source);
  return padded;
}

function createPaddedByteTextureData(source: Uint8Array, width: number, height: number, bytesPerPixel = 4): Uint8Array {
  const expectedLength = width * height * bytesPerPixel;
  if (source.length > expectedLength) {
    throw new Error(`Texture source data exceeds texture size (${source.length} > ${expectedLength}).`);
  }

  const padded = new Uint8Array(expectedLength);
  padded.set(source);
  return padded;
}

function premultiplyRgba(source: Uint8Array): Uint8Array {
  const out = new Uint8Array(source.length);
  for (let i = 0; i + 3 < source.length; i += 4) {
    const alpha = source[i + 3];
    if (alpha <= 0) {
      out[i] = 0;
      out[i + 1] = 0;
      out[i + 2] = 0;
      out[i + 3] = 0;
      continue;
    }

    if (alpha >= 255) {
      out[i] = source[i];
      out[i + 1] = source[i + 1];
      out[i + 2] = source[i + 2];
      out[i + 3] = 255;
      continue;
    }

    const scale = alpha / 255;
    out[i] = Math.round(source[i] * scale);
    out[i + 1] = Math.round(source[i + 1] * scale);
    out[i + 2] = Math.round(source[i + 2] * scale);
    out[i + 3] = alpha;
  }
  return out;
}

function packNormalizedUint8TextureData(source: Float32Array, texelCount: number): Uint8Array {
  const out = new Uint8Array(texelCount * 4);
  const sourceLength = Math.min(source.length, out.length);
  for (let i = 0; i < sourceLength; i += 1) {
    out[i] = Math.round(clamp(source[i], 0, 1) * 255);
  }
  return out;
}

function buildRgbaMipChain(source: Uint8Array, width: number, height: number): Array<{ width: number; height: number; data: Uint8Array }> {
  const chain: Array<{ width: number; height: number; data: Uint8Array }> = [];
  let levelWidth = Math.max(1, Math.trunc(width));
  let levelHeight = Math.max(1, Math.trunc(height));
  let levelData = source;

  chain.push({ width: levelWidth, height: levelHeight, data: levelData });

  while (levelWidth > 1 || levelHeight > 1) {
    const nextWidth = Math.max(1, levelWidth >> 1);
    const nextHeight = Math.max(1, levelHeight >> 1);
    const nextData = new Uint8Array(nextWidth * nextHeight * 4);

    for (let y = 0; y < nextHeight; y += 1) {
      const srcY0 = Math.min(levelHeight - 1, y * 2);
      const srcY1 = Math.min(levelHeight - 1, srcY0 + 1);

      for (let x = 0; x < nextWidth; x += 1) {
        const srcX0 = Math.min(levelWidth - 1, x * 2);
        const srcX1 = Math.min(levelWidth - 1, srcX0 + 1);

        const i00 = (srcY0 * levelWidth + srcX0) * 4;
        const i01 = (srcY0 * levelWidth + srcX1) * 4;
        const i10 = (srcY1 * levelWidth + srcX0) * 4;
        const i11 = (srcY1 * levelWidth + srcX1) * 4;

        const outIndex = (y * nextWidth + x) * 4;
        nextData[outIndex] = ((levelData[i00] + levelData[i01] + levelData[i10] + levelData[i11]) + 2) >> 2;
        nextData[outIndex + 1] = ((levelData[i00 + 1] + levelData[i01 + 1] + levelData[i10 + 1] + levelData[i11 + 1]) + 2) >> 2;
        nextData[outIndex + 2] = ((levelData[i00 + 2] + levelData[i01 + 2] + levelData[i10 + 2] + levelData[i11 + 2]) + 2) >> 2;
        nextData[outIndex + 3] = ((levelData[i00 + 3] + levelData[i01 + 3] + levelData[i10 + 3] + levelData[i11 + 3]) + 2) >> 2;
      }
    }

    chain.push({ width: nextWidth, height: nextHeight, data: nextData });
    levelWidth = nextWidth;
    levelHeight = nextHeight;
    levelData = nextData;
  }

  return chain;
}

function assertUniformBufferSizeMatches(data: Float32Array, requiredBytes: number, label: string): void {
  const byteLength = data.byteLength;
  if (byteLength > requiredBytes) {
    throw new Error(`${label} uniform data (${byteLength} bytes) exceeds buffer size ${requiredBytes} bytes.`);
  }
}

function prepareNativeTextUploadArrays(
  scene: VectorScene,
  textLodData: TextLodBuildData | null,
  instanceDims: TextureDimensions,
  glyphDims: TextureDimensions,
  segmentDims: TextureDimensions
): NativeTextUploadArrays {
  const arrays: NativeTextUploadArrays = {
    textInstanceA: new Float32Array(instanceDims.width * instanceDims.height * 4),
    textInstanceB: new Float32Array(instanceDims.width * instanceDims.height * 4),
    textInstanceC: new Float32Array(instanceDims.width * instanceDims.height * 4),
    textGlyphMetaA: new Float32Array(glyphDims.width * glyphDims.height * 4),
    textGlyphMetaB: new Float32Array(glyphDims.width * glyphDims.height * 4),
    textGlyphSegmentsA: new Float32Array(segmentDims.width * segmentDims.height * 4),
    textGlyphSegmentsB: new Float32Array(segmentDims.width * segmentDims.height * 4)
  };
  if (textLodData) {
    appendTextLodCombinedPayload(scene, textLodData, arrays);
  } else {
    arrays.textInstanceA.set(scene.textInstanceA);
    arrays.textInstanceB.set(scene.textInstanceB);
    arrays.textInstanceC.set(scene.textInstanceC);
    arrays.textGlyphMetaA.set(scene.textGlyphMetaA);
    arrays.textGlyphMetaB.set(scene.textGlyphMetaB);
    arrays.textGlyphSegmentsA.set(scene.textGlyphSegmentsA);
    arrays.textGlyphSegmentsB.set(scene.textGlyphSegmentsB);
  }
  return arrays;
}

function chooseTextureDimensions(itemCount: number, maxTextureSize: number): { width: number; height: number } {
  const safeCount = Math.max(1, itemCount);
  const preferredWidth = Math.ceil(Math.sqrt(safeCount));
  const width = clamp(preferredWidth, 1, maxTextureSize);
  const height = Math.max(1, Math.ceil(safeCount / width));

  if (height > maxTextureSize) {
    throw new Error("Data texture exceeds GPU limits for this browser/GPU.");
  }

  return { width, height };
}

function canFitTextureItems(itemCount: number, maxTextureSize: number): boolean {
  return maxTextureSize >= 1 && Math.max(1, itemCount) / maxTextureSize <= maxTextureSize;
}

function normalizePageRects(scene: VectorScene): Float32Array {
  if (scene.pageRects instanceof Float32Array && scene.pageRects.length >= 4) {
    return new Float32Array(scene.pageRects);
  }

  return new Float32Array([
    scene.pageBounds.minX,
    scene.pageBounds.minY,
    scene.pageBounds.maxX,
    scene.pageBounds.maxY
  ]);
}

function releaseOwnedWebGpuDevice(device: any, context: any): void {
  let firstError: unknown = null;
  try {
    if (typeof context?.unconfigure === "function") {
      context.unconfigure();
    }
  } catch (error) {
    firstError = error;
  }

  try {
    if (typeof device?.destroy === "function") {
      device.destroy();
    }
  } catch (error) {
    firstError ??= error;
  }

  if (firstError !== null) {
    throw firstError;
  }
}

function alignTo(value: number, alignment: number): number {
  if (alignment <= 1) {
    return value;
  }
  return Math.ceil(value / alignment) * alignment;
}

function clamp(value: number, min: number, max: number): number {
  if (value < min) {
    return min;
  }
  if (value > max) {
    return max;
  }
  return value;
}

function normalizeVectorLodMode(value: VectorLodMode | undefined): VectorLodMode {
  if (value === "off" || value === "force") {
    return value;
  }
  return "auto";
}

function clampToGrid(value: number, gridSize: number): number {
  if (value < 0) {
    return 0;
  }
  if (value >= gridSize) {
    return gridSize - 1;
  }
  return value;
}
