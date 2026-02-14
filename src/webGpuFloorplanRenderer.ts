import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import type { DrawStats, SceneStats, ViewState } from "./gpuFloorplanRenderer";
import { buildSpatialGrid, type SpatialGrid } from "./spatialGrid";

type FrameListener = (stats: DrawStats) => void;

const INTERACTION_DECAY_MS = 140;
const FULL_VIEW_FALLBACK_THRESHOLD = 0.92;
const PAN_CACHE_MIN_SEGMENTS = 300_000;
const PAN_CACHE_OVERSCAN_FACTOR = 1.8;
const PAN_CACHE_BORDER_PX = 96;
const PAN_CACHE_ZOOM_EPSILON = 1e-5;

const CAMERA_UNIFORM_FLOATS = 12;
const CAMERA_UNIFORM_BUFFER_BYTES = 64;

const BLIT_UNIFORM_FLOATS = 8;
const BLIT_UNIFORM_BUFFER_BYTES = 48;

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
  pad0 : f32,
  pad1 : f32,
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
  let styleFlags = select(0.0, 1.0, packedStyle >= 2.0);
  let alpha = clamp(packedStyle - styleFlags * 2.0, 0.0, 1.0);
  let isHairline = styleFlags >= 0.5;

  let geometryLength = select(length(p2 - p0), length(p1 - p0) + length(p2 - p1), isQuadratic);

  var out : VsOut;
  if (geometryLength < 1e-5 || alpha <= 0.001) {
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

  return vec4f(inData.color, alpha);
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
  pad0 : f32,
  pad1 : f32,
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

  if (inData.fillHasCompanionStroke >= 0.5) {
    let alpha = select(0.0, inData.alpha, inside);
    if (alpha <= 0.001) {
      discard;
    }
    return vec4f(inData.color, alpha);
  }

  let signedDistance = select(minDistance, -minDistance, inside);

  let alpha = clamp(0.5 - signedDistance / aaWidth, 0.0, 1.0) * inData.alpha;
  if (alpha <= 0.001) {
    discard;
  }

  return vec4f(inData.color, alpha);
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
  pad0 : f32,
  pad1 : f32,
};

@group(0) @binding(0) var<uniform> uCamera : CameraUniforms;
@group(0) @binding(1) var uTextInstanceTexA : texture_2d<f32>;
@group(0) @binding(2) var uTextInstanceTexB : texture_2d<f32>;
@group(0) @binding(3) var uTextInstanceTexC : texture_2d<f32>;
@group(0) @binding(4) var uTextGlyphMetaTexA : texture_2d<f32>;
@group(0) @binding(5) var uTextGlyphMetaTexB : texture_2d<f32>;
@group(0) @binding(6) var uTextGlyphSegmentTexA : texture_2d<f32>;
@group(0) @binding(7) var uTextGlyphSegmentTexB : texture_2d<f32>;

struct VsOut {
  @builtin(position) position : vec4f,
  @location(0) local : vec2f,
  @location(1) @interpolate(flat) segmentStart : i32,
  @location(2) @interpolate(flat) segmentCount : i32,
  @location(3) @interpolate(flat) color : vec3f,
  @location(4) @interpolate(flat) colorAlpha : f32,
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

fn accumulateQuadraticCrossing(a : vec2f, b : vec2f, c : vec2f, p : vec2f, winding : ptr<function, i32>) {
  var prev = a;
  for (var i = 1; i <= QUAD_WINDING_SUBDIVISIONS; i = i + 1) {
    let t = f32(i) / f32(QUAD_WINDING_SUBDIVISIONS);
    let next = evaluateQuadratic(a, b, c, t);
    accumulateLineCrossing(prev, next, p, winding);
    prev = next;
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

  let segmentCount = i32(glyphMetaA.y + 0.5);

  var out : VsOut;
  if (segmentCount <= 0) {
    out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
    out.local = vec2f(0.0, 0.0);
    out.segmentStart = 0;
    out.segmentCount = 0;
    out.color = vec3f(0.0, 0.0, 0.0);
    out.colorAlpha = 0.0;
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
  return out;
}

@fragment
fn fsMain(inData : VsOut) -> @location(0) vec4f {
  let pixelToLocalX = length(vec2f(dpdx(inData.local.x), dpdy(inData.local.x)));
  let pixelToLocalY = length(vec2f(dpdx(inData.local.y), dpdy(inData.local.y)));
  let aaWidth = max(max(pixelToLocalX, pixelToLocalY) * uCamera.textAAScreenPx, 1e-4);

  if (inData.segmentCount <= 0) {
    discard;
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

  let alpha = clamp(0.5 - signedDistance / aaWidth, 0.0, 1.0) * inData.colorAlpha;
  if (alpha <= 0.001) {
    discard;
  }

  return vec4f(inData.color, alpha);
}
`;

const BLIT_SHADER_SOURCE = /* wgsl */ `
struct BlitUniforms {
  viewportPx : vec2f,
  cacheSizePx : vec2f,
  offsetPx : vec2f,
  pad : vec2f,
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
  let base = 0.5 * (uBlit.cacheSizePx - uBlit.viewportPx);
  let samplePx = fragPos.xy + base + uBlit.offsetPx;
  let uv = samplePx / uBlit.cacheSizePx;

  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    return vec4f(1.0, 1.0, 1.0, 1.0);
  }

  return textureSampleLevel(uCacheTex, uCacheSampler, uv, 0.0);
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

  private readonly blitPipeline: any;

  private readonly cameraUniformBuffer: any;

  private readonly blitUniformBuffer: any;

  private readonly panCacheSampler: any;

  private readonly strokeBindGroupLayout: any;

  private readonly fillBindGroupLayout: any;

  private readonly textBindGroupLayout: any;

  private readonly blitBindGroupLayout: any;

  private strokeBindGroupAll: any = null;

  private strokeBindGroupVisible: any = null;

  private fillBindGroup: any = null;

  private textBindGroup: any = null;

  private blitBindGroup: any = null;

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

  private textGlyphMetaTextureA: any = null;

  private textGlyphMetaTextureB: any = null;

  private textGlyphSegmentTextureA: any = null;

  private textGlyphSegmentTextureB: any = null;

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

  private scene: VectorScene | null = null;

  private sceneStats: SceneStats | null = null;

  private grid: SpatialGrid | null = null;

  private frameListener: FrameListener | null = null;

  private rafHandle = 0;

  private cameraCenterX = 0;

  private cameraCenterY = 0;

  private zoom = 1;

  private minZoom = 0.01;

  private maxZoom = 8_192;

  private strokeCurveEnabled = true;

  private panOptimizationEnabled = true;

  private isPanInteracting = false;

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
        }
      ]
    });

    this.blitBindGroupLayout = this.gpuDevice.createBindGroupLayout({
      entries: [
        {
          binding: 0,
          visibility: gpuShaderStage.FRAGMENT,
          sampler: { type: "non-filtering" }
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

    const strokePipelineLayout = this.gpuDevice.createPipelineLayout({
      bindGroupLayouts: [this.strokeBindGroupLayout]
    });
    const fillPipelineLayout = this.gpuDevice.createPipelineLayout({
      bindGroupLayouts: [this.fillBindGroupLayout]
    });
    const textPipelineLayout = this.gpuDevice.createPipelineLayout({
      bindGroupLayouts: [this.textBindGroupLayout]
    });
    const blitPipelineLayout = this.gpuDevice.createPipelineLayout({
      bindGroupLayouts: [this.blitBindGroupLayout]
    });

    this.strokePipeline = this.createPipeline(STROKE_SHADER_SOURCE, "vsMain", "fsMain", strokePipelineLayout);
    this.fillPipeline = this.createPipeline(FILL_SHADER_SOURCE, "vsMain", "fsMain", fillPipelineLayout);
    this.textPipeline = this.createPipeline(TEXT_SHADER_SOURCE, "vsMain", "fsMain", textPipelineLayout);
    this.blitPipeline = this.createPipeline(BLIT_SHADER_SOURCE, "vsMain", "fsMain", blitPipelineLayout);

    this.panCacheSampler = this.gpuDevice.createSampler({
      magFilter: "nearest",
      minFilter: "nearest",
      mipmapFilter: "nearest",
      addressModeU: "clamp-to-edge",
      addressModeV: "clamp-to-edge"
    });

    this.ensureSegmentIdBuffers(1);
  }

  static async create(canvas: HTMLCanvasElement): Promise<WebGpuFloorplanRenderer> {
    const nav = navigator as Navigator & {
      gpu?: {
        requestAdapter: () => Promise<any>;
        getPreferredCanvasFormat?: () => string;
      };
    };

    if (!nav.gpu) {
      throw new Error("WebGPU is not available in this browser.");
    }

    const adapter = await nav.gpu.requestAdapter();
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

  beginPanInteraction(): void {
    this.isPanInteracting = true;
    this.markInteraction();
  }

  endPanInteraction(): void {
    this.isPanInteracting = false;
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

  setViewState(viewState: ViewState): void {
    const nextCenterX = Number(viewState.cameraCenterX);
    const nextCenterY = Number(viewState.cameraCenterY);
    const nextZoom = Number(viewState.zoom);
    if (!Number.isFinite(nextCenterX) || !Number.isFinite(nextCenterY) || !Number.isFinite(nextZoom)) {
      return;
    }

    this.cameraCenterX = nextCenterX;
    this.cameraCenterY = nextCenterY;
    this.zoom = clamp(nextZoom, this.minZoom, this.maxZoom);
    this.isPanInteracting = false;
    this.panCacheValid = false;
    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  fitToBounds(bounds: Bounds, paddingPixels = 64): void {
    const width = Math.max(bounds.maxX - bounds.minX, 1e-4);
    const height = Math.max(bounds.maxY - bounds.minY, 1e-4);

    const viewWidth = Math.max(1, this.canvas.width - paddingPixels * 2);
    const viewHeight = Math.max(1, this.canvas.height - paddingPixels * 2);

    this.zoom = Math.min(viewWidth / width, viewHeight / height);
    this.zoom = clamp(this.zoom, this.minZoom, this.maxZoom);

    this.cameraCenterX = (bounds.minX + bounds.maxX) * 0.5;
    this.cameraCenterY = (bounds.minY + bounds.maxY) * 0.5;
    this.isPanInteracting = false;

    this.panCacheValid = false;
    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  panByPixels(deltaX: number, deltaY: number): void {
    if (!Number.isFinite(deltaX) || !Number.isFinite(deltaY)) {
      return;
    }

    this.markInteraction();
    this.cameraCenterX -= deltaX / this.zoom;
    this.cameraCenterY += deltaY / this.zoom;

    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  zoomAtClientPoint(clientX: number, clientY: number, zoomFactor: number): void {
    const clampedFactor = clamp(zoomFactor, 0.1, 10);
    this.isPanInteracting = false;
    this.markInteraction();
    const before = this.clientToWorld(clientX, clientY);

    const nextZoom = clamp(this.zoom * clampedFactor, this.minZoom, this.maxZoom);
    this.zoom = nextZoom;

    const after = this.clientToWorld(clientX, clientY);

    this.cameraCenterX += before.x - after.x;
    this.cameraCenterY += before.y - after.y;

    this.panCacheValid = false;
    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  dispose(): void {
    if (this.rafHandle !== 0) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }

    this.frameListener = null;
    this.destroyPanCacheResources();
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
  }

  private configureContext(): void {
    this.gpuContext.configure({
      device: this.gpuDevice,
      format: this.presentationFormat,
      alphaMode: "opaque"
    });
  }

  private createPipeline(shaderSource: string, vertexEntry: string, fragmentEntry: string, layout: any): any {
    const shaderModule = this.gpuDevice.createShaderModule({ code: shaderSource });
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
                srcFactor: "src-alpha",
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
    if (this.rafHandle !== 0) {
      return;
    }

    this.rafHandle = requestAnimationFrame(() => {
      this.rafHandle = 0;
      this.render();
    });
  }

  private render(): void {
    if (!this.scene || (this.segmentCount === 0 && this.fillPathCount === 0 && this.textInstanceCount === 0)) {
      this.clearToScreen();
      this.frameListener?.({
        renderedSegments: 0,
        totalSegments: 0,
        usedCulling: false,
        zoom: this.zoom
      });
      return;
    }

    if (this.shouldUsePanCache()) {
      this.renderWithPanCache();
      return;
    }

    this.renderDirectToScreen();
  }

  private shouldUsePanCache(): boolean {
    return this.panOptimizationEnabled && this.isPanInteracting && this.segmentCount >= PAN_CACHE_MIN_SEGMENTS;
  }

  private renderDirectToScreen(): void {
    if (this.needsVisibleSetUpdate) {
      this.updateVisibleSet(this.cameraCenterX, this.cameraCenterY, this.canvas.width, this.canvas.height);
      this.needsVisibleSetUpdate = false;
    }

    const view = this.gpuContext.getCurrentTexture().createView();
    const encoder = this.gpuDevice.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: 1, g: 1, b: 1, a: 1 },
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

  private renderWithPanCache(): void {
    if (!this.ensurePanCacheResources()) {
      this.renderDirectToScreen();
      return;
    }

    let offsetPxX = (this.cameraCenterX - this.panCacheCenterX) * this.zoom;
    let offsetPxY = (this.cameraCenterY - this.panCacheCenterY) * this.zoom;

    const maxOffsetX = Math.max(0, (this.panCacheWidth - this.canvas.width) * 0.5 - 2);
    const maxOffsetY = Math.max(0, (this.panCacheHeight - this.canvas.height) * 0.5 - 2);

    const zoomChanged = Math.abs(this.panCacheZoom - this.zoom) > PAN_CACHE_ZOOM_EPSILON;
    const cacheOutOfCoverage = Math.abs(offsetPxX) > maxOffsetX || Math.abs(offsetPxY) > maxOffsetY;
    const needsCacheRefresh = !this.panCacheValid || zoomChanged || cacheOutOfCoverage;

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
            clearValue: { r: 1, g: 1, b: 1, a: 1 },
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

      offsetPxX = 0;
      offsetPxY = 0;
    }

    this.blitPanCache(offsetPxX, offsetPxY);

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

    if (this.fillPathCount > 0 && this.fillBindGroup) {
      pass.setPipeline(this.fillPipeline);
      pass.setBindGroup(0, this.fillBindGroup);
      pass.draw(4, this.fillPathCount, 0, 0);
    }

    let strokeInstanceCount = this.usingAllSegments ? this.segmentCount : this.visibleSegmentCount;
    if (strokeInstanceCount > 0) {
      const strokeBindGroup = this.usingAllSegments ? this.strokeBindGroupAll : this.strokeBindGroupVisible;
      if (strokeBindGroup) {
        pass.setPipeline(this.strokePipeline);
        pass.setBindGroup(0, strokeBindGroup);
        pass.draw(4, strokeInstanceCount, 0, 0);
      }
    }

    if (this.textInstanceCount > 0 && this.textBindGroup) {
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
    cameraCenterY: number
  ): void {
    const data = new Float32Array(CAMERA_UNIFORM_FLOATS);
    data[0] = viewportWidth;
    data[1] = viewportHeight;
    data[2] = cameraCenterX;
    data[3] = cameraCenterY;
    data[4] = this.zoom;
    data[5] = 1.0;
    data[6] = this.strokeCurveEnabled ? 1 : 0;
    data[7] = 1.25;
    data[8] = this.strokeCurveEnabled ? 1 : 0;
    data[9] = 1.0;
    data[10] = 0;
    data[11] = 0;

    assertUniformBufferSizeMatches(data, CAMERA_UNIFORM_BUFFER_BYTES, "camera");
    this.gpuDevice.queue.writeBuffer(this.cameraUniformBuffer, 0, data);
  }

  private updateBlitUniforms(offsetPxX: number, offsetPxY: number): void {
    const data = new Float32Array(BLIT_UNIFORM_FLOATS);
    data[0] = this.canvas.width;
    data[1] = this.canvas.height;
    data[2] = this.panCacheWidth;
    data[3] = this.panCacheHeight;
    data[4] = offsetPxX;
    data[5] = offsetPxY;
    data[6] = 0;
    data[7] = 0;

    assertUniformBufferSizeMatches(data, BLIT_UNIFORM_BUFFER_BYTES, "blit");
    this.gpuDevice.queue.writeBuffer(this.blitUniformBuffer, 0, data);
  }

  private blitPanCache(offsetPxX: number, offsetPxY: number): void {
    if (!this.panCacheTexture || !this.blitBindGroup) {
      this.renderDirectToScreen();
      return;
    }

    this.updateBlitUniforms(offsetPxX, offsetPxY);

    const view = this.gpuContext.getCurrentTexture().createView();
    const encoder = this.gpuDevice.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: 1, g: 1, b: 1, a: 1 },
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

  private updateVisibleSet(
    viewCenterX: number = this.cameraCenterX,
    viewCenterY: number = this.cameraCenterY,
    viewportWidthPx: number = this.canvas.width,
    viewportHeightPx: number = this.canvas.height
  ): void {
    if (!this.scene || !this.grid) {
      this.visibleSegmentCount = 0;
      this.usingAllSegments = true;
      return;
    }

    const grid = this.grid;

    const halfViewWidth = viewportWidthPx / (2 * this.zoom);
    const halfViewHeight = viewportHeightPx / (2 * this.zoom);

    const margin = Math.max(16 / this.zoom, this.scene.maxHalfWidth * 2);

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

  private clearToScreen(): void {
    const view = this.gpuContext.getCurrentTexture().createView();
    const encoder = this.gpuDevice.createCommandEncoder();
    const pass = encoder.beginRenderPass({
      colorAttachments: [
        {
          view,
          clearValue: { r: 1, g: 1, b: 1, a: 1 },
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
      this.textGlyphSegmentTextureA,
      this.textGlyphSegmentTextureB
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
    this.textGlyphSegmentTextureA = null;
    this.textGlyphSegmentTextureB = null;
  }

  private clientToWorld(clientX: number, clientY: number): { x: number; y: number } {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    const pixelX = (clientX - rect.left) * dpr;
    const pixelY = (rect.bottom - clientY) * dpr;

    return {
      x: (pixelX - this.canvas.width * 0.5) / this.zoom + this.cameraCenterX,
      y: (pixelY - this.canvas.height * 0.5) / this.zoom + this.cameraCenterY
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
