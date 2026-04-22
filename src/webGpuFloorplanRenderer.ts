import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import type { DrawStats, SceneStats, ViewState } from "./webGlFloorplanRenderer";
import { buildSpatialGrid, type SpatialGrid } from "./spatialGrid";
import { buildTextRasterAtlas } from "./textRasterAtlas";

type FrameListener = (stats: DrawStats) => void;

interface WebGpuRasterLayerResource {
  texture: any;
  uniformBuffer: any;
  bindGroup: any;
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

fn coordFromIndex(index : u32, width : u32) -> vec2<i32> {
  return vec2<i32>(i32(index % width), i32(index / width));
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
  let worldMin = primitiveBounds.xy - vec2f(extent, extent);
  let worldMax = primitiveBounds.zw + vec2f(extent, extent);

  let corner01 = cornerFromVertexIndex(vertexIndex) * 0.5 + 0.5;
  let worldPosition = mix(worldMin, worldMax, corner01);
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
  return out;
}

@fragment
fn fsMain(inData : VsOut) -> @location(0) vec4f {
  if (inData.alpha <= 0.001) {
    discard;
  }

  let useCurve = uCamera.strokeCurveEnabled >= 0.5 && inData.primitiveType >= 0.5;
  let distanceToSegment = select(
    distanceToLineSegment(inData.local, inData.p0, inData.p2),
    distanceToQuadraticBezier(inData.local, inData.p0, inData.p1, inData.p2),
    useCurve
  );

  let coverage = 1.0 - smoothstep(inData.halfWidth - inData.aaWorld, inData.halfWidth + inData.aaWorld, distanceToSegment);
  let alpha = coverage * inData.alpha;

  if (alpha <= 0.001) {
    discard;
  }

  let color = mix(inData.color, uCamera.vectorOverride.xyz, clamp(uCamera.vectorOverride.w, 0.0, 1.0));
  return vec4f(color, alpha);
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
    return vec4f(color, alpha);
  }

  let signedDistance = select(minDistance, -minDistance, inside);

  let alpha = clamp(0.5 - signedDistance / aaWidth, 0.0, 1.0) * inData.alpha;
  if (alpha <= 0.001) {
    discard;
  }

  return vec4f(color, alpha);
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

const MAX_GLYPH_PRIMITIVES : i32 = 256;
const TEXT_PRIMITIVE_QUADRATIC : f32 = 1.0;
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

  let instanceIndexI = i32(instanceIndex);
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
  let pixelToLocalX = length(vec2f(dpdx(inData.local.x), dpdy(inData.local.x)));
  let pixelToLocalY = length(vec2f(dpdx(inData.local.y), dpdy(inData.local.y)));
  let localPerPixel = max(pixelToLocalX, pixelToLocalY);
  let baseAAWidth = max(localPerPixel * uCamera.textAAScreenPx, 1e-4);
  let atlasDims = vec2f(textureDimensions(uTextRasterAtlasTex));
  let nc = vec2f(inData.normCoord.x, 1.0 - inData.normCoord.y) * (inData.rasterRect.zw * atlasDims);
  let ncFwidthX = fwidth(nc.x);
  let ncFwidthY = fwidth(nc.y);
  let dncDx = dpdx(nc);
  let dncDy = dpdy(nc);

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
    let dx = dncDx * 0.33 * texel;
    let dy = dncDy * 0.33 * texel;
    let mipBias = -1.25;
    let lod = max(log2(max(max(ncFwidthX, ncFwidthY), 1e-6)) + mipBias, 0.0);
    let alphaRaster = (1.0 / 3.0) * textureSampleLevel(uTextRasterAtlasTex, uTextRasterSampler, clamp(uvCenter, uvMin, uvMax), lod).r +
      (1.0 / 6.0) * (
        textureSampleLevel(uTextRasterAtlasTex, uTextRasterSampler, clamp(uvCenter - dx - dy, uvMin, uvMax), lod).r +
        textureSampleLevel(uTextRasterAtlasTex, uTextRasterSampler, clamp(uvCenter - dx + dy, uvMin, uvMax), lod).r +
        textureSampleLevel(uTextRasterAtlasTex, uTextRasterSampler, clamp(uvCenter + dx - dy, uvMin, uvMax), lod).r +
        textureSampleLevel(uTextRasterAtlasTex, uTextRasterSampler, clamp(uvCenter + dx + dy, uvMin, uvMax), lod).r
      );
    let alpha = alphaRaster * inData.colorAlpha;
    if (alpha <= 0.001) {
      discard;
    }
    let color = mix(inData.color, uCamera.vectorOverride.xyz, clamp(uCamera.vectorOverride.w, 0.0, 1.0));
    return vec4f(color, alpha);
  }

  let glyphSegDims = textureDimensions(uTextGlyphSegmentTexA);

  var minDistance = 1e20;
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

    if (uCamera.textCurveEnabled >= 0.5 && primitiveType >= TEXT_PRIMITIVE_QUADRATIC) {
      minDistance = min(minDistance, distanceToQuadraticBezier(inData.local, p0, p1, p2));
      accumulateQuadraticCrossing(p0, p1, p2, inData.local, &winding);
    } else {
      minDistance = min(minDistance, distanceToLineSegment(inData.local, p0, p2));
      accumulateLineCrossing(p0, p2, inData.local, &winding);
    }
  }

  let inside = winding != 0;
  let signedDistance = select(minDistance, -minDistance, inside);
  let alphaBase = 1.0 - smoothstep(-baseAAWidth, baseAAWidth, signedDistance);
  let alpha = alphaBase * inData.colorAlpha;
  if (alpha <= 0.001) {
    discard;
  }

  let color = mix(inData.color, uCamera.vectorOverride.xyz, clamp(uCamera.vectorOverride.w, 0.0, 1.0));
  return vec4f(color, alpha);
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

  private readonly textPipeline: any;

  private readonly rasterPipeline: any;

  private readonly blitPipeline: any;

  private readonly vectorCompositePipeline: any;

  private readonly cameraUniformBuffer: any;

  private readonly blitUniformBuffer: any;

  private readonly vectorCompositeUniformBuffer: any;

  private readonly panCacheSampler: any;

  private readonly rasterLayerSampler: any;

  private readonly vectorCompositeSampler: any;

  private readonly strokeBindGroupLayout: any;

  private readonly fillBindGroupLayout: any;

  private readonly textBindGroupLayout: any;

  private readonly rasterBindGroupLayout: any;

  private readonly blitBindGroupLayout: any;

  private readonly vectorCompositeBindGroupLayout: any;

  private strokeBindGroupAll: any = null;

  private strokeBindGroupVisible: any = null;

  private fillBindGroup: any = null;

  private textBindGroup: any = null;

  private blitBindGroup: any = null;

  private vectorCompositeBindGroup: any = null;

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
  private pageBackgroundResources: WebGpuRasterLayerResource[] = [];

  private textGlyphMetaTextureA: any = null;

  private textGlyphMetaTextureB: any = null;

  private textGlyphRasterMetaTexture: any = null;

  private textGlyphSegmentTextureA: any = null;

  private textGlyphSegmentTextureB: any = null;

  private textRasterAtlasTexture: any = null;
  private pageBackgroundTexture: any = null;

  private segmentIdBufferAll: any = null;

  private segmentIdBufferVisible: any = null;

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

  private frameListener: FrameListener | null = null;
  private interactionViewportProvider: (() => DOMRect | DOMRectReadOnly | null) | null = null;
  private presentedCameraCenterX = 0;
  private presentedCameraCenterY = 0;
  private presentedZoom = 1;
  private presentedFrameSerial = 0;

  private rafHandle = 0;
  private externalFrameDriver = false;
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

  private panOptimizationEnabled = true;

  private isPanInteracting = false;

  // Keep first loaded frame complete; enable culling once user actually pans/zooms.
  private hasCameraInteractionSinceSceneLoad = false;

  private lastInteractionTime = Number.NEGATIVE_INFINITY;

  private needsVisibleSetUpdate = false;

  private segmentCount = 0;

  private fillPathCount = 0;

  private textInstanceCount = 0;

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

    const strokePipelineLayout = this.gpuDevice.createPipelineLayout({
      bindGroupLayouts: [this.strokeBindGroupLayout]
    });
    const fillPipelineLayout = this.gpuDevice.createPipelineLayout({
      bindGroupLayouts: [this.fillBindGroupLayout]
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

    this.strokePipeline = this.createPipeline(STROKE_SHADER_SOURCE, "vsMain", "fsMain", strokePipelineLayout);
    this.fillPipeline = this.createPipeline(FILL_SHADER_SOURCE, "vsMain", "fsMain", fillPipelineLayout);
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
    if (typeof device.addEventListener === "function") {
      device.addEventListener("uncapturederror", (event: any) => {
        const message = event?.error?.message || event?.error || event;
        console.warn("[WebGPU uncaptured error]", message);
      });
    }
    const context = canvas.getContext("webgpu");
    if (!context) {
      throw new Error("Failed to acquire a WebGPU canvas context.");
    }

    const presentationFormat = nav.gpu.getPreferredCanvasFormat?.() ?? "bgra8unorm";
    return new WebGpuFloorplanRenderer(canvas, device, context, presentationFormat);
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

  setPanOptimizationEnabled(enabled: boolean): void {
    const nextEnabled = Boolean(enabled);
    if (this.panOptimizationEnabled === nextEnabled) {
      return;
    }

    this.panOptimizationEnabled = nextEnabled;
    this.isPanInteracting = false;
    this.panCacheValid = false;

    if (!this.panOptimizationEnabled) {
      this.destroyPanCacheResources();
    }

    this.needsVisibleSetUpdate = true;
    this.requestFrame();
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
    const nextWidth = Math.max(1, Math.round(this.canvas.clientWidth * devicePixelRatio));
    const nextHeight = Math.max(1, Math.round(this.canvas.clientHeight * devicePixelRatio));

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
    this.scene = scene;
    this.segmentCount = scene.segmentCount;
    this.fillPathCount = scene.fillPathCount;
    this.textInstanceCount = scene.textInstanceCount;
    this.buildSegmentBounds(scene);

    this.isPanInteracting = false;
    this.panCacheValid = false;
    this.destroyVectorMinifyResources();

    this.grid = this.segmentCount > 0 ? buildSpatialGrid(scene) : null;

    const maxTextureSize = this.maxTextureSize();

    const segmentDims = chooseTextureDimensions(scene.segmentCount, maxTextureSize);
    const fillPathDims = chooseTextureDimensions(scene.fillPathCount, maxTextureSize);
    const fillSegmentDims = chooseTextureDimensions(scene.fillSegmentCount, maxTextureSize);
    const textInstanceDims = chooseTextureDimensions(scene.textInstanceCount, maxTextureSize);
    const textGlyphDims = chooseTextureDimensions(scene.textGlyphCount, maxTextureSize);
    const textSegmentDims = chooseTextureDimensions(scene.textGlyphSegmentCount, maxTextureSize);

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

    this.destroyDataResources();

    this.segmentTextureA = this.createFloatTexture(this.segmentTextureWidth, this.segmentTextureHeight, scene.endpoints);
    this.segmentTextureB = this.createFloatTexture(this.segmentTextureWidth, this.segmentTextureHeight, scene.primitiveMeta);
    this.segmentTextureC = this.createFloatTexture(this.segmentTextureWidth, this.segmentTextureHeight, scene.styles);
    this.segmentTextureD = this.createFloatTexture(this.segmentTextureWidth, this.segmentTextureHeight, scene.primitiveBounds);

    this.fillPathMetaTextureA = this.createFloatTexture(this.fillPathMetaTextureWidth, this.fillPathMetaTextureHeight, scene.fillPathMetaA);
    this.fillPathMetaTextureB = this.createFloatTexture(this.fillPathMetaTextureWidth, this.fillPathMetaTextureHeight, scene.fillPathMetaB);
    this.fillPathMetaTextureC = this.createFloatTexture(this.fillPathMetaTextureWidth, this.fillPathMetaTextureHeight, scene.fillPathMetaC);
    this.fillSegmentTextureA = this.createFloatTexture(this.fillSegmentTextureWidth, this.fillSegmentTextureHeight, scene.fillSegmentsA);
    this.fillSegmentTextureB = this.createFloatTexture(this.fillSegmentTextureWidth, this.fillSegmentTextureHeight, scene.fillSegmentsB);

    this.textInstanceTextureA = this.createFloatTexture(this.textInstanceTextureWidth, this.textInstanceTextureHeight, scene.textInstanceA);
    this.textInstanceTextureB = this.createFloatTexture(this.textInstanceTextureWidth, this.textInstanceTextureHeight, scene.textInstanceB);
    this.textInstanceTextureC = this.createFloatTexture(this.textInstanceTextureWidth, this.textInstanceTextureHeight, scene.textInstanceC);
    this.textGlyphMetaTextureA = this.createFloatTexture(this.textGlyphMetaTextureWidth, this.textGlyphMetaTextureHeight, scene.textGlyphMetaA);
    this.textGlyphMetaTextureB = this.createFloatTexture(this.textGlyphMetaTextureWidth, this.textGlyphMetaTextureHeight, scene.textGlyphMetaB);
    this.textGlyphSegmentTextureA = this.createFloatTexture(this.textGlyphSegmentTextureWidth, this.textGlyphSegmentTextureHeight, scene.textGlyphSegmentsA);
    this.textGlyphSegmentTextureB = this.createFloatTexture(this.textGlyphSegmentTextureWidth, this.textGlyphSegmentTextureHeight, scene.textGlyphSegmentsB);
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
      ? this.createRgba8Texture(textRasterAtlas.width, textRasterAtlas.height, textRasterAtlas.rgba)
      : this.createRgba8Texture(1, 1, new Uint8Array([0, 0, 0, 0]));

    this.configurePageBackgroundResources(scene);
    this.configureRasterLayers(scene);

    this.allSegmentIds = new Uint32Array(this.segmentCount);
    for (let i = 0; i < this.segmentCount; i += 1) {
      this.allSegmentIds[i] = i;
    }

    this.ensureSegmentIdBuffers(Math.max(1, this.segmentCount));
    if (this.segmentCount > 0) {
      this.gpuDevice.queue.writeBuffer(this.segmentIdBufferAll, 0, this.allSegmentIds);
      this.gpuDevice.queue.writeBuffer(this.segmentIdBufferVisible, 0, this.allSegmentIds);
    }

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
          resource: this.rasterLayerSampler
        },
        {
          binding: 10,
          resource: this.textRasterAtlasTexture.createView()
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

  setViewState(viewState: ViewState): void {
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
    this.requestFrame();
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

    this.needsVisibleSetUpdate = true;
    this.panVelocityWorldX = 0;
    this.panVelocityWorldY = 0;
    this.lastPanVelocityUpdateTimeMs = 0;
    this.lastPanFrameTimeMs = 0;
    this.requestFrame();
  }

  dispose(): void {
    if (this.rafHandle !== 0) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }

    this.frameListener = null;
    this.destroyPanCacheResources();
    this.destroyVectorMinifyResources();
    this.destroyDataResources();

    if (this.segmentIdBufferAll) {
      this.segmentIdBufferAll.destroy();
      this.segmentIdBufferAll = null;
    }
    if (this.segmentIdBufferVisible) {
      this.segmentIdBufferVisible.destroy();
      this.segmentIdBufferVisible = null;
    }

    if (this.cameraUniformBuffer) {
      this.cameraUniformBuffer.destroy();
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
    const gpuBufferUsage = (globalThis as any).GPUBufferUsage;
    const nextBytes = Math.max(1, segmentCapacity) * 4;

    if (this.segmentIdBufferAll) {
      this.segmentIdBufferAll.destroy();
      this.segmentIdBufferAll = null;
    }

    if (this.segmentIdBufferVisible) {
      this.segmentIdBufferVisible.destroy();
      this.segmentIdBufferVisible = null;
    }

    this.segmentIdBufferAll = this.gpuDevice.createBuffer({
      size: nextBytes,
      usage: gpuBufferUsage.STORAGE | gpuBufferUsage.COPY_DST
    });

    this.segmentIdBufferVisible = this.gpuDevice.createBuffer({
      size: nextBytes,
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

  private shouldUsePanCache(isCameraAnimating: boolean): boolean {
    if (!this.panOptimizationEnabled || this.segmentCount < PAN_CACHE_MIN_SEGMENTS) {
      return false;
    }
    if (this.isPanInteracting) {
      return true;
    }
    return isCameraAnimating;
  }

  private renderDirectToScreen(): void {
    let useVectorMinify = this.shouldUseVectorMinifyPath() && this.ensureVectorMinifyResources();
    // Keep still/moving appearance consistent on large pan-optimized scenes.
    // Pan-cache path renders vectors directly; matching that avoids thickness shifts while camera moves.
    if (this.panOptimizationEnabled && this.segmentCount >= PAN_CACHE_MIN_SEGMENTS) {
      useVectorMinify = false;
    }

    if (this.needsVisibleSetUpdate) {
      if (useVectorMinify) {
        const effectiveZoom = this.computeVectorMinifyZoom(this.vectorMinifyWidth, this.vectorMinifyHeight);
        this.updateVisibleSet(
          this.cameraCenterX,
          this.cameraCenterY,
          this.vectorMinifyWidth,
          this.vectorMinifyHeight,
          effectiveZoom
        );
      } else {
        this.updateVisibleSet(this.cameraCenterX, this.cameraCenterY, this.canvas.width, this.canvas.height, this.zoom);
      }
      this.needsVisibleSetUpdate = false;
    }

    if (useVectorMinify) {
      const renderedSegments = this.renderVectorLayerIntoMinifyTarget(
        this.vectorMinifyWidth,
        this.vectorMinifyHeight,
        this.cameraCenterX,
        this.cameraCenterY
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

      this.updateCameraUniforms(this.canvas.width, this.canvas.height, this.cameraCenterX, this.cameraCenterY);
      this.drawRasterContentIntoPass(pass);
      this.drawVectorMinifyCompositeIntoPass(pass, this.canvas.width, this.canvas.height);

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

    pass.end();
    this.gpuDevice.queue.submit([encoder.finish()]);

    this.frameListener?.({
      renderedSegments,
      totalSegments: this.segmentCount,
      usedCulling: !this.usingAllSegments,
      zoom: this.zoom
    });
  }

  private hasVectorContent(): boolean {
    return (
      (this.fillRenderingEnabled && this.fillPathCount > 0) ||
      (this.strokeRenderingEnabled && this.segmentCount > 0) ||
      (this.textRenderingEnabled && this.textInstanceCount > 0)
    );
  }

  private shouldUseVectorMinifyPath(): boolean {
    if (this.textVectorOnly || !this.hasVectorContent()) {
      return false;
    }
    return this.zoom <= VECTOR_MINIFY_MAX_ZOOM;
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
    cameraCenterY: number
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

    this.updateCameraUniforms(viewportWidth, viewportHeight, cameraCenterX, cameraCenterY, effectiveZoom);
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

      this.updateVisibleSet(this.panCacheCenterX, this.panCacheCenterY, this.panCacheWidth, this.panCacheHeight);
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
    this.drawRasterContentIntoPass(pass);
    return this.drawVectorContentIntoPass(pass);
  }

  private drawRasterContentIntoPass(pass: any): void {
    if (!this.rasterRenderingEnabled) {
      return;
    }

    if (this.pageBackgroundResources.length > 0) {
      pass.setPipeline(this.rasterPipeline);
      for (const layer of this.pageBackgroundResources) {
        pass.setBindGroup(0, layer.bindGroup);
        pass.draw(4, 1, 0, 0);
      }
    }

    if (this.rasterLayerResources.length > 0) {
      pass.setPipeline(this.rasterPipeline);
      for (const layer of this.rasterLayerResources) {
        pass.setBindGroup(0, layer.bindGroup);
        pass.draw(4, 1, 0, 0);
      }
    }
  }

  private drawVectorContentIntoPass(pass: any): number {
    if (this.fillRenderingEnabled && this.fillPathCount > 0 && this.fillBindGroup) {
      pass.setPipeline(this.fillPipeline);
      pass.setBindGroup(0, this.fillBindGroup);
      pass.draw(4, this.fillPathCount, 0, 0);
    }

    let strokeInstanceCount = this.strokeRenderingEnabled
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

    if (this.textRenderingEnabled && this.textInstanceCount > 0 && this.textBindGroup) {
      pass.setPipeline(this.textPipeline);
      pass.setBindGroup(0, this.textBindGroup);
      pass.draw(4, this.textInstanceCount, 0, 0);
    }

    return strokeInstanceCount;
  }

  private updateCameraUniforms(
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoomValue = this.zoom
  ): void {
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
    data[11] = 0;
    data[12] = this.vectorOverrideColor[0];
    data[13] = this.vectorOverrideColor[1];
    data[14] = this.vectorOverrideColor[2];
    data[15] = this.vectorOverrideOpacity;

    assertUniformBufferSizeMatches(data, CAMERA_UNIFORM_BUFFER_BYTES, "camera");
    this.gpuDevice.queue.writeBuffer(this.cameraUniformBuffer, 0, data);
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
    this.destroyRasterLayerResources();

    for (const source of this.getSceneRasterLayers(scene)) {
      const matrix = new Float32Array(6);
      if (source.matrix.length >= 6) {
        matrix[0] = source.matrix[0];
        matrix[1] = source.matrix[1];
        matrix[2] = source.matrix[2];
        matrix[3] = source.matrix[3];
        matrix[4] = source.matrix[4];
        matrix[5] = source.matrix[5];
      } else {
        matrix[0] = 1;
        matrix[3] = 1;
      }

      const rgba = source.data.subarray(0, source.width * source.height * 4);
      const premultiplied = premultiplyRgba(rgba);
      const texture = this.createRgba8Texture(source.width, source.height, premultiplied);
      this.rasterLayerResources.push(this.createRasterLayerResource(matrix, texture));
    }
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
  ): Array<{ width: number; height: number; data: Uint8Array<ArrayBufferLike>; matrix: Float32Array }> {
    const out: Array<{ width: number; height: number; data: Uint8Array<ArrayBufferLike>; matrix: Float32Array }> = [];
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
          matrix: layer.matrix instanceof Float32Array ? layer.matrix : new Float32Array(layer.matrix)
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
      matrix: scene.rasterLayerMatrix
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

  private createRasterLayerResource(matrix: Float32Array, texture: any): WebGpuRasterLayerResource {
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

    return { texture, uniformBuffer, bindGroup };
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
    this.strokeBindGroupAll = null;
    this.strokeBindGroupVisible = null;
    this.fillBindGroup = null;
    this.textBindGroup = null;
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
      this.textRasterAtlasTexture
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

function createPaddedByteTextureData(source: Uint8Array, width: number, height: number): Uint8Array {
  const expectedLength = width * height * 4;
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

function clampToGrid(value: number, gridSize: number): number {
  if (value < 0) {
    return 0;
  }
  if (value >= gridSize) {
    return gridSize - 1;
  }
  return value;
}
