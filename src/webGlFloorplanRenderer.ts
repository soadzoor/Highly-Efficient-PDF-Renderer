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
import {
  GRADIENT_FILL_FRAGMENT_SHADER_SOURCE,
  GRADIENT_FILL_VERTEX_SHADER_SOURCE,
  GRADIENT_STROKE_FRAGMENT_SHADER_SOURCE,
  GRADIENT_STROKE_VERTEX_SHADER_SOURCE
} from "./nativeGradientWebGlShaders";
import {
  isNativeTextHeavyStrokeFreeScene,
  NATIVE_VECTOR_MINIFY_ENABLED
} from "./nativeRenderPolicy";
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

const GLSL_OUTPUT_COLOR_HELPERS = `
vec4 heprThreeEncodeOutputColor(vec4 color) {
  // PDF.js supplies display/sRGB components already. The canvas framebuffer is
  // unorm, so encoding them again would wash dark colors toward gray.
  return color;
}

float heprThreeLinearCoverageToOutputAlpha(float coverage) {
  return clamp(coverage, 0.0, 1.0);
}
`;

const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp sampler2D;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in float aSegmentIndex;

uniform sampler2D uSegmentTexA;
uniform sampler2D uSegmentTexB;
uniform sampler2D uSegmentStyleTex;
uniform sampler2D uSegmentBoundsTex;
uniform ivec2 uSegmentTexSize;
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uAAScreenPx;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;
uniform float uLocalUnitsPerPixel;

out vec2 vLocal;
flat out vec2 vP0;
flat out vec2 vP1;
flat out vec2 vP2;
flat out float vPrimitiveType;
flat out float vIsHairline;
flat out float vHalfWidth;
flat out float vAAWorld;
flat out vec3 vColor;
flat out float vAlpha;
flat out vec4 vClipBounds;
flat out float vHasClipBounds;

ivec2 segmentCoord(int index) {
  int x = index % uSegmentTexSize.x;
  int y = index / uSegmentTexSize.x;
  return ivec2(x, y);
}

void main() {
  int index = int(aSegmentIndex + 0.5);
  vec4 primitiveA = texelFetch(uSegmentTexA, segmentCoord(index), 0);
  vec4 primitiveB = texelFetch(uSegmentTexB, segmentCoord(index), 0);
  vec4 style = texelFetch(uSegmentStyleTex, segmentCoord(index), 0);
  vec4 primitiveBounds = texelFetch(uSegmentBoundsTex, segmentCoord(index), 0);

  vec2 p0 = primitiveA.xy;
  vec2 p1 = primitiveA.zw;
  vec2 p2 = primitiveB.xy;
  float primitiveType = primitiveB.z;
  bool isQuadratic = primitiveType >= 0.5;
  float halfWidth = style.x;
  vec3 color = style.yzw;
  float packedStyle = primitiveB.w;
  float styleFlags = floor(packedStyle / 2.0 + 1e-6);
  float alpha = packedStyle - styleFlags * 2.0;
  bool isHairline = mod(styleFlags, 2.0) >= 0.5;
  bool isRoundCap = mod(floor(styleFlags * 0.5), 2.0) >= 0.5;
  bool hasClipBounds = mod(floor(styleFlags * 0.25), 2.0) >= 0.5;

  float geometryLength = isQuadratic
    ? length(p1 - p0) + length(p2 - p1)
    : length(p2 - p0);

  if ((geometryLength < 1e-5 && !isRoundCap) || alpha <= 0.001) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    vLocal = vec2(0.0);
    vP0 = vec2(0.0);
    vP1 = vec2(0.0);
    vP2 = vec2(0.0);
    vPrimitiveType = 0.0;
    vIsHairline = 0.0;
    vHalfWidth = 0.0;
    vAAWorld = 1.0;
    vColor = color;
    vAlpha = 0.0;
    vClipBounds = vec4(0.0);
    vHasClipBounds = 0.0;
    return;
  }

  float localUnitsPerPixel = uUseLocalToClip >= 0.5
    ? max(uLocalUnitsPerPixel, 1e-6)
    : (1.0 / max(uZoom, 1e-4));
  if (isHairline) {
    halfWidth = max(0.5 * localUnitsPerPixel, 1e-5);
  }

  float aaWorld = max(localUnitsPerPixel, 0.0001) * uAAScreenPx;
  if (isHairline) {
    aaWorld = max(0.35 * localUnitsPerPixel, 5e-5);
  }

  float extent = halfWidth + aaWorld;
  vec2 corner01 = aCorner * 0.5 + 0.5;

  // Candidate A: axis-aligned quad over the (possibly clip-intersected) primitive bounds.
  vec2 worldMin = primitiveBounds.xy - vec2(extent);
  vec2 worldMax = primitiveBounds.zw + vec2(extent);

  // Candidate B: oriented quad along the primitive direction. Diagonal segments
  // (e.g. hatching) rasterize orders of magnitude fewer wasted fragments this way,
  // because their axis-aligned bounds cover far more area than the stroke itself.
  vec2 axisDelta = p2 - p0;
  float axisLength = length(axisDelta);
  vec2 axisU = axisLength > 1e-6 ? axisDelta / axisLength : vec2(1.0, 0.0);
  vec2 axisV = vec2(-axisU.y, axisU.x);
  vec2 controlOffset = p1 - p0;
  float controlU = dot(controlOffset, axisU);
  float controlV = dot(controlOffset, axisV);
  float orientedMinU = min(min(0.0, controlU), axisLength) - extent;
  float orientedMaxU = max(max(0.0, controlU), axisLength) + extent;
  float orientedMinV = min(0.0, controlV) - extent;
  float orientedMaxV = max(0.0, controlV) + extent;

  float axisAlignedArea = (worldMax.x - worldMin.x) * (worldMax.y - worldMin.y);
  float orientedArea = (orientedMaxU - orientedMinU) * (orientedMaxV - orientedMinV);

  vec2 worldPosition;
  if (orientedArea < axisAlignedArea) {
    worldPosition = p0
      + axisU * mix(orientedMinU, orientedMaxU, corner01.x)
      + axisV * mix(orientedMinV, orientedMaxV, corner01.y);
  } else {
    worldPosition = mix(worldMin, worldMax, corner01);
  }

  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(worldPosition, 0.0, 1.0);
  } else {
    vec2 screen = (worldPosition - uCameraCenter) * uZoom + 0.5 * uViewport;
    vec2 clip = (screen / (0.5 * uViewport)) - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
  }

  vLocal = worldPosition;
  vP0 = p0;
  vP1 = p1;
  vP2 = p2;
  vPrimitiveType = primitiveType;
  vIsHairline = isHairline ? 1.0 : 0.0;
  vHalfWidth = halfWidth;
  vAAWorld = aaWorld;
  vColor = color;
  vAlpha = alpha;
  vClipBounds = primitiveBounds;
  vHasClipBounds = hasClipBounds ? 1.0 : 0.0;
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
uniform float uStrokeCurveEnabled;
uniform float uAAScreenPx;
uniform vec4 uVectorOverride;
in vec2 vLocal;
flat in vec2 vP0;
flat in vec2 vP1;
flat in vec2 vP2;
flat in float vPrimitiveType;
flat in float vIsHairline;
flat in float vHalfWidth;
flat in vec3 vColor;
flat in float vAlpha;
flat in vec4 vClipBounds;
flat in float vHasClipBounds;

out vec4 outColor;

${GLSL_OUTPUT_COLOR_HELPERS}

float distanceToLineSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float abLenSq = dot(ab, ab);
  if (abLenSq <= 1e-10) {
    return length(p - a);
  }
  float t = clamp(dot(p - a, ab) / abLenSq, 0.0, 1.0);
  return length(p - (a + ab * t));
}

float distanceToQuadraticBezier(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 aa = b - a;
  vec2 bb = a - 2.0 * b + c;
  vec2 cc = aa * 2.0;
  vec2 dd = a - p;

  float bbLenSq = dot(bb, bb);
  if (bbLenSq <= 1e-12) {
    return distanceToLineSegment(p, a, c);
  }

  float inv = 1.0 / bbLenSq;
  float kx = inv * dot(aa, bb);
  float ky = inv * (2.0 * dot(aa, aa) + dot(dd, bb)) / 3.0;
  float kz = inv * dot(dd, aa);

  float pValue = ky - kx * kx;
  float pCube = pValue * pValue * pValue;
  float qValue = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  float hValue = qValue * qValue + 4.0 * pCube;

  float best = 1e20;

  if (hValue >= 0.0) {
    float hSqrt = sqrt(hValue);
    vec2 roots = (vec2(hSqrt, -hSqrt) - qValue) * 0.5;
    vec2 uv = sign(roots) * pow(abs(roots), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    vec2 delta = dd + (cc + bb * t) * t;
    best = dot(delta, delta);
  } else {
    float z = sqrt(-pValue);
    float acosArg = clamp(qValue / (2.0 * pValue * z), -1.0, 1.0);
    float angle = acos(acosArg) / 3.0;
    float cosine = cos(angle);
    float sine = sin(angle) * 1.732050808;
    vec3 t = clamp(vec3(cosine + cosine, -sine - cosine, sine - cosine) * z - kx, 0.0, 1.0);

    vec2 delta = dd + (cc + bb * t.x) * t.x;
    best = min(best, dot(delta, delta));
    delta = dd + (cc + bb * t.y) * t.y;
    best = min(best, dot(delta, delta));
    delta = dd + (cc + bb * t.z) * t.z;
    best = min(best, dot(delta, delta));
  }

  return sqrt(max(best, 0.0));
}

void main() {
  if (vAlpha <= 0.001) {
    discard;
  }

  if (
    vHasClipBounds >= 0.5 &&
    (vLocal.x < vClipBounds.x || vLocal.y < vClipBounds.y || vLocal.x > vClipBounds.z || vLocal.y > vClipBounds.w)
  ) {
    discard;
  }

  float distanceToSegment = (uStrokeCurveEnabled >= 0.5 && vPrimitiveType >= 0.5)
    ? distanceToQuadraticBezier(vLocal, vP0, vP1, vP2)
    : distanceToLineSegment(vLocal, vP0, vP2);

  float pixelToLocalX = length(vec2(dFdx(vLocal.x), dFdy(vLocal.x)));
  float pixelToLocalY = length(vec2(dFdx(vLocal.y), dFdy(vLocal.y)));
  float localPerPixel = max(max(pixelToLocalX, pixelToLocalY), 1e-6);
  float aaWorld = max(localPerPixel * uAAScreenPx, 5e-5);
  float halfWidth = vIsHairline >= 0.5 ? max(0.5 * localPerPixel, 1e-5) : vHalfWidth;

  float coverage = 1.0 - smoothstep(halfWidth - aaWorld, halfWidth + aaWorld, distanceToSegment);
  float alpha = heprThreeLinearCoverageToOutputAlpha(coverage) * vAlpha;

  if (alpha <= 0.001) {
    discard;
  }

  vec3 color = mix(vColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
  outColor = heprThreeEncodeOutputColor(vec4(color, alpha));
}
`;

const FILL_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp sampler2D;

layout(location = 0) in vec2 aCorner;
layout(location = 3) in float aFillPathIndex;

uniform sampler2D uFillPathMetaTexA;
uniform sampler2D uFillPathMetaTexB;
uniform sampler2D uFillPathMetaTexC;
uniform ivec2 uFillPathMetaTexSize;
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;

flat out int vSegmentStart;
flat out int vSegmentCount;
flat out vec3 vColor;
flat out float vAlpha;
flat out float vFillRule;
flat out float vFillHasCompanionStroke;
out vec2 vLocal;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  int x = index % sizeValue.x;
  int y = index / sizeValue.x;
  return ivec2(x, y);
}

void main() {
  int pathIndex = int(aFillPathIndex + 0.5);
  vec4 metaA = texelFetch(uFillPathMetaTexA, coordFromIndex(pathIndex, uFillPathMetaTexSize), 0);
  vec4 metaB = texelFetch(uFillPathMetaTexB, coordFromIndex(pathIndex, uFillPathMetaTexSize), 0);
  vec4 metaC = texelFetch(uFillPathMetaTexC, coordFromIndex(pathIndex, uFillPathMetaTexSize), 0);

  int segmentCount = int(metaA.y + 0.5);
  float alpha = metaC.w;
  if (segmentCount <= 0 || alpha <= 0.001) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    vSegmentStart = 0;
    vSegmentCount = 0;
    vColor = vec3(0.0);
    vAlpha = 0.0;
    vFillRule = 0.0;
    vFillHasCompanionStroke = 0.0;
    vLocal = vec2(0.0);
    return;
  }

  vec2 minBounds = metaA.zw;
  vec2 maxBounds = metaB.xy;
  vec2 corner01 = aCorner * 0.5 + 0.5;
  vec2 world = mix(minBounds, maxBounds, corner01);

  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  } else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    vec2 clip = (screen / (0.5 * uViewport)) - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
  }

  vSegmentStart = int(metaA.x + 0.5);
  vSegmentCount = segmentCount;
  vColor = vec3(metaB.z, metaB.w, metaC.z);
  vAlpha = alpha;
  vFillRule = metaC.x;
  vFillHasCompanionStroke = metaC.y;
  vLocal = world;
}
`;

const FILL_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uFillSegmentTexA;
uniform sampler2D uFillSegmentTexB;
uniform ivec2 uFillSegmentTexSize;
uniform float uFillAAScreenPx;
uniform vec4 uVectorOverride;

flat in int vSegmentStart;
flat in int vSegmentCount;
flat in vec3 vColor;
flat in float vAlpha;
flat in float vFillRule;
flat in float vFillHasCompanionStroke;
in vec2 vLocal;

out vec4 outColor;

${GLSL_OUTPUT_COLOR_HELPERS}

const int MAX_FILL_PATH_PRIMITIVES = 2048;
const float FILL_PRIMITIVE_QUADRATIC = 1.0;
const int QUAD_WINDING_SUBDIVISIONS = 6;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  int x = index % sizeValue.x;
  int y = index / sizeValue.x;
  return ivec2(x, y);
}

float distanceToLineSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float abLenSq = dot(ab, ab);
  if (abLenSq <= 1e-10) {
    return length(p - a);
  }
  float t = clamp(dot(p - a, ab) / abLenSq, 0.0, 1.0);
  return length(p - (a + ab * t));
}

float distanceToQuadraticBezier(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 aa = b - a;
  vec2 bb = a - 2.0 * b + c;
  vec2 cc = aa * 2.0;
  vec2 dd = a - p;

  float bbLenSq = dot(bb, bb);
  if (bbLenSq <= 1e-12) {
    return distanceToLineSegment(p, a, c);
  }

  float inv = 1.0 / bbLenSq;
  float kx = inv * dot(aa, bb);
  float ky = inv * (2.0 * dot(aa, aa) + dot(dd, bb)) / 3.0;
  float kz = inv * dot(dd, aa);

  float pValue = ky - kx * kx;
  float pCube = pValue * pValue * pValue;
  float qValue = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  float hValue = qValue * qValue + 4.0 * pCube;

  float best = 1e20;

  if (hValue >= 0.0) {
    float hSqrt = sqrt(hValue);
    vec2 roots = (vec2(hSqrt, -hSqrt) - qValue) * 0.5;
    vec2 uv = sign(roots) * pow(abs(roots), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    vec2 delta = dd + (cc + bb * t) * t;
    best = dot(delta, delta);
  } else {
    float z = sqrt(-pValue);
    float acosArg = clamp(qValue / (2.0 * pValue * z), -1.0, 1.0);
    float angle = acos(acosArg) / 3.0;
    float cosine = cos(angle);
    float sine = sin(angle) * 1.732050808;
    vec3 t = clamp(vec3(cosine + cosine, -sine - cosine, sine - cosine) * z - kx, 0.0, 1.0);

    vec2 delta = dd + (cc + bb * t.x) * t.x;
    best = min(best, dot(delta, delta));
    delta = dd + (cc + bb * t.y) * t.y;
    best = min(best, dot(delta, delta));
    delta = dd + (cc + bb * t.z) * t.z;
    best = min(best, dot(delta, delta));
  }

  return sqrt(max(best, 0.0));
}

vec2 evaluateQuadratic(vec2 a, vec2 b, vec2 c, float t) {
  float oneMinusT = 1.0 - t;
  return oneMinusT * oneMinusT * a + 2.0 * oneMinusT * t * b + t * t * c;
}

void accumulateLineCrossing(vec2 a, vec2 b, vec2 p, inout int winding, inout int crossings) {
  bool upward = (a.y <= p.y) && (b.y > p.y);
  bool downward = (a.y > p.y) && (b.y <= p.y);
  if (!upward && !downward) {
    return;
  }

  float denom = b.y - a.y;
  if (abs(denom) <= 1e-6) {
    return;
  }

  float xCross = a.x + (p.y - a.y) * (b.x - a.x) / denom;
  if (xCross > p.x) {
    crossings += 1;
    winding += upward ? 1 : -1;
  }
}

void accumulateQuadraticCrossing(vec2 a, vec2 b, vec2 c, vec2 p, inout int winding, inout int crossings) {
  vec2 prev = a;
  for (int i = 1; i <= QUAD_WINDING_SUBDIVISIONS; i += 1) {
    float t = float(i) / float(QUAD_WINDING_SUBDIVISIONS);
    vec2 next = evaluateQuadratic(a, b, c, t);
    accumulateLineCrossing(prev, next, p, winding, crossings);
    prev = next;
  }
}

void main() {
  if (vSegmentCount <= 0 || vAlpha <= 0.001) {
    discard;
  }

  float minDistance = 1e20;
  int winding = 0;
  int crossings = 0;

  for (int i = 0; i < MAX_FILL_PATH_PRIMITIVES; i += 1) {
    if (i >= vSegmentCount) {
      break;
    }

    vec4 primitiveA = texelFetch(uFillSegmentTexA, coordFromIndex(vSegmentStart + i, uFillSegmentTexSize), 0);
    vec4 primitiveB = texelFetch(uFillSegmentTexB, coordFromIndex(vSegmentStart + i, uFillSegmentTexSize), 0);
    vec2 p0 = primitiveA.xy;
    vec2 p1 = primitiveA.zw;
    vec2 p2 = primitiveB.xy;
    float primitiveType = primitiveB.z;

    if (primitiveType >= FILL_PRIMITIVE_QUADRATIC) {
      minDistance = min(minDistance, distanceToQuadraticBezier(vLocal, p0, p1, p2));
      accumulateQuadraticCrossing(p0, p1, p2, vLocal, winding, crossings);
    } else {
      minDistance = min(minDistance, distanceToLineSegment(vLocal, p0, p2));
      accumulateLineCrossing(p0, p2, vLocal, winding, crossings);
    }
  }

  bool insideNonZero = winding != 0;
  bool insideEvenOdd = (crossings & 1) == 1;
  bool inside = vFillRule >= 0.5 ? insideEvenOdd : insideNonZero;
  vec3 color = mix(vColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
  if (vFillHasCompanionStroke >= 0.5) {
    float alpha = inside ? vAlpha : 0.0;
    if (alpha <= 0.001) {
      discard;
    }
    outColor = heprThreeEncodeOutputColor(vec4(color, alpha));
    return;
  }

  float signedDistance = inside ? -minDistance : minDistance;

  float pixelToLocalX = length(vec2(dFdx(vLocal.x), dFdy(vLocal.x)));
  float pixelToLocalY = length(vec2(dFdx(vLocal.y), dFdy(vLocal.y)));
  float aaWidth = max(max(pixelToLocalX, pixelToLocalY) * uFillAAScreenPx, 1e-4);

  float coverage = clamp(0.5 - signedDistance / aaWidth, 0.0, 1.0);
  float alpha = heprThreeLinearCoverageToOutputAlpha(coverage) * vAlpha;
  if (alpha <= 0.001) {
    discard;
  }

  outColor = heprThreeEncodeOutputColor(vec4(color, alpha));
}
`;

const TEXT_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp sampler2D;

layout(location = 0) in vec2 aCorner;
layout(location = 2) in float aTextInstanceIndex;

uniform sampler2D uTextInstanceTexA;
uniform sampler2D uTextInstanceTexB;
uniform sampler2D uTextInstanceTexC;
uniform sampler2D uTextGlyphMetaTexA;
uniform sampler2D uTextGlyphMetaTexB;
uniform sampler2D uTextGlyphRasterMetaTex;
uniform ivec2 uTextInstanceTexSize;
uniform ivec2 uTextGlyphMetaTexSize;
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;
uniform float uTextVectorOnly;

flat out int vSegmentStart;
flat out int vSegmentCount;
flat out vec3 vColor;
flat out float vColorAlpha;
flat out vec4 vRasterRect;
out vec2 vNormCoord;
out vec2 vLocal;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  int x = index % sizeValue.x;
  int y = index / sizeValue.x;
  return ivec2(x, y);
}

void main() {
  int instanceIndex = int(aTextInstanceIndex + 0.5);
  vec4 instanceA = texelFetch(uTextInstanceTexA, coordFromIndex(instanceIndex, uTextInstanceTexSize), 0);
  vec4 instanceB = texelFetch(uTextInstanceTexB, coordFromIndex(instanceIndex, uTextInstanceTexSize), 0);
  vec4 instanceC = texelFetch(uTextInstanceTexC, coordFromIndex(instanceIndex, uTextInstanceTexSize), 0);

  int glyphIndex = int(instanceB.z + 0.5);
  vec4 glyphMetaA = texelFetch(uTextGlyphMetaTexA, coordFromIndex(glyphIndex, uTextGlyphMetaTexSize), 0);
  vec4 glyphMetaB = texelFetch(uTextGlyphMetaTexB, coordFromIndex(glyphIndex, uTextGlyphMetaTexSize), 0);

  int segmentCount = int(glyphMetaA.y + 0.5);
  if (segmentCount <= 0) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    vSegmentStart = 0;
    vSegmentCount = 0;
    vColor = vec3(0.0);
    vColorAlpha = 0.0;
    vRasterRect = vec4(0.0);
    vNormCoord = vec2(0.0);
    vLocal = vec2(0.0);
    return;
  }

  // The raster atlas rect is only read by the minified branch of the fragment
  // shader, so vector-only rendering skips one of six fetches per vertex.
  vec4 glyphRasterMeta = vec4(0.0);
  if (uTextVectorOnly < 0.5) {
    glyphRasterMeta = texelFetch(uTextGlyphRasterMetaTex, coordFromIndex(glyphIndex, uTextGlyphMetaTexSize), 0);
  }

  vec2 minBounds = glyphMetaA.zw;
  vec2 maxBounds = glyphMetaB.xy;
  vec2 corner01 = aCorner * 0.5 + 0.5;
  vec2 local = mix(minBounds, maxBounds, corner01);

  vec2 world = vec2(
    instanceA.x * local.x + instanceA.z * local.y + instanceB.x,
    instanceA.y * local.x + instanceA.w * local.y + instanceB.y
  );

  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  } else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    vec2 clip = (screen / (0.5 * uViewport)) - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
  }
  vSegmentStart = int(glyphMetaA.x + 0.5);
  vSegmentCount = segmentCount;
  vColor = instanceC.rgb;
  vColorAlpha = instanceC.a;
  vRasterRect = glyphRasterMeta;
  vNormCoord = clamp((local - minBounds) / max(maxBounds - minBounds, vec2(1e-6)), 0.0, 1.0);
  vLocal = local;
}
`;

const TEXT_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uTextGlyphSegmentTexA;
uniform sampler2D uTextGlyphSegmentTexB;
uniform sampler2D uTextRasterAtlasTex;
uniform ivec2 uTextGlyphSegmentTexSize;
uniform vec2 uTextRasterAtlasSize;
uniform float uTextAAScreenPx;
uniform float uTextCurveEnabled;
uniform float uTextVectorOnly;
uniform vec4 uVectorOverride;

flat in int vSegmentStart;
flat in int vSegmentCount;
flat in vec3 vColor;
flat in float vColorAlpha;
flat in vec4 vRasterRect;
in vec2 vNormCoord;
in vec2 vLocal;

out vec4 outColor;

${GLSL_OUTPUT_COLOR_HELPERS}

const int MAX_GLYPH_PRIMITIVES = 256;
const float TEXT_PRIMITIVE_QUADRATIC = 1.0;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  int x = index % sizeValue.x;
  int y = index / sizeValue.x;
  return ivec2(x, y);
}

vec2 evaluateQuadratic(vec2 a, vec2 b, vec2 c, float t) {
  float oneMinusT = 1.0 - t;
  return oneMinusT * oneMinusT * a + 2.0 * oneMinusT * t * b + t * t * c;
}

vec4 textLineDistanceInfo(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float abLenSq = dot(ab, ab);
  if (abLenSq <= 1e-10) {
    return vec4(length(p - a), 0.0, 1.0, 0.0);
  }
  float t = clamp(dot(p - a, ab) / abLenSq, 0.0, 1.0);
  vec2 offset = p - (a + ab * t);
  vec2 tangent = ab * inversesqrt(abLenSq);
  vec2 leftNormal = vec2(-tangent.y, tangent.x);
  return vec4(length(offset), t, leftNormal);
}

vec4 textQuadraticDistanceInfo(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 aa = b - a;
  vec2 bb = a - 2.0 * b + c;
  vec2 cc = aa * 2.0;
  vec2 dd = a - p;

  float bbLenSq = dot(bb, bb);
  if (bbLenSq <= 1e-12) {
    return textLineDistanceInfo(p, a, c);
  }

  float inv = 1.0 / bbLenSq;
  float kx = inv * dot(aa, bb);
  float ky = inv * (2.0 * dot(aa, aa) + dot(dd, bb)) / 3.0;
  float kz = inv * dot(dd, aa);
  float pValue = ky - kx * kx;
  float pCube = pValue * pValue * pValue;
  float qValue = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  float hValue = qValue * qValue + 4.0 * pCube;
  float best = 1e20;
  float closestT = 0.0;

  if (hValue >= 0.0) {
    float hSqrt = sqrt(hValue);
    vec2 roots = (vec2(hSqrt, -hSqrt) - qValue) * 0.5;
    vec2 uv = sign(roots) * pow(abs(roots), vec2(1.0 / 3.0));
    closestT = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    vec2 delta = dd + (cc + bb * closestT) * closestT;
    best = dot(delta, delta);
  } else {
    float z = sqrt(-pValue);
    float acosArg = clamp(qValue / (2.0 * pValue * z), -1.0, 1.0);
    float angle = acos(acosArg) / 3.0;
    float cosine = cos(angle);
    float sine = sin(angle) * 1.732050808;
    vec3 t = clamp(vec3(cosine + cosine, -sine - cosine, sine - cosine) * z - kx, 0.0, 1.0);

    vec2 delta = dd + (cc + bb * t.x) * t.x;
    best = dot(delta, delta);
    closestT = t.x;
    delta = dd + (cc + bb * t.y) * t.y;
    float candidate = dot(delta, delta);
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

  vec2 closestPoint = evaluateQuadratic(a, b, c, closestT);
  vec2 tangent = 2.0 * ((1.0 - closestT) * (b - a) + closestT * (c - b));
  float tangentLenSq = dot(tangent, tangent);
  if (tangentLenSq <= 1e-12) {
    tangent = c - a;
    tangentLenSq = dot(tangent, tangent);
  }
  vec2 leftNormal = tangentLenSq > 1e-12
    ? vec2(-tangent.y, tangent.x) * inversesqrt(tangentLenSq)
    : vec2(1.0, 0.0);
  return vec4(sqrt(max(best, 0.0)), closestT, leftNormal);
}

void accumulateLineCrossing(vec2 a, vec2 b, vec2 p, inout int winding) {
  bool upward = (a.y <= p.y) && (b.y > p.y);
  bool downward = (a.y > p.y) && (b.y <= p.y);
  if (!upward && !downward) {
    return;
  }

  float denom = b.y - a.y;
  if (abs(denom) <= 1e-6) {
    return;
  }

  float xCross = a.x + (p.y - a.y) * (b.x - a.x) / denom;
  if (xCross > p.x) {
    winding += upward ? 1 : -1;
  }
}

void accumulateQuadraticCrossingRoot(
  vec2 a,
  vec2 b,
  vec2 c,
  vec2 p,
  float ay,
  float by,
  float t,
  inout int winding
) {
  const float ROOT_EPS = 1e-5;
  if (t < -ROOT_EPS || t >= 1.0 - ROOT_EPS) {
    return;
  }

  float tc = clamp(t, 0.0, 1.0);
  float oneMinusT = 1.0 - tc;
  float xCross = oneMinusT * oneMinusT * a.x + 2.0 * oneMinusT * tc * b.x + tc * tc * c.x;
  if (xCross <= p.x) {
    return;
  }

  float dy = by + 2.0 * ay * tc;
  if (abs(dy) <= 1e-6) {
    return;
  }

  winding += dy > 0.0 ? 1 : -1;
}

void accumulateQuadraticCrossing(vec2 a, vec2 b, vec2 c, vec2 p, inout int winding) {
  float ay = a.y - 2.0 * b.y + c.y;
  float by = 2.0 * (b.y - a.y);
  float cy = a.y - p.y;

  if (abs(ay) <= 1e-8) {
    if (abs(by) <= 1e-8) {
      return;
    }
    float t = -cy / by;
    accumulateQuadraticCrossingRoot(a, b, c, p, ay, by, t, winding);
    return;
  }

  float discriminant = by * by - 4.0 * ay * cy;
  if (discriminant < 0.0) {
    return;
  }

  float sqrtDiscriminant = sqrt(max(discriminant, 0.0));
  float invDen = 0.5 / ay;
  float t0 = (-by - sqrtDiscriminant) * invDen;
  float t1 = (-by + sqrtDiscriminant) * invDen;
  accumulateQuadraticCrossingRoot(a, b, c, p, ay, by, t0, winding);
  if (abs(t1 - t0) > 1e-5) {
    accumulateQuadraticCrossingRoot(a, b, c, p, ay, by, t1, winding);
  }
}

void main() {
  vec2 localDx = dFdx(vLocal);
  vec2 localDy = dFdy(vLocal);
  float pixelToLocalX = length(vec2(localDx.x, localDy.x));
  float pixelToLocalY = length(vec2(localDx.y, localDy.y));
  // The Frobenius norm conservatively bounds stretch along every possible
  // edge normal. Final coverage below uses the tighter directional width.
  float localPerPixel = length(vec2(pixelToLocalX, pixelToLocalY));
  float baseAAWidth = max(localPerPixel * uTextAAScreenPx, 1e-4);
  vec2 atlasPxSize = max(uTextRasterAtlasSize, vec2(1.0));
  vec2 nc = vec2(vNormCoord.x, 1.0 - vNormCoord.y) * (vRasterRect.zw * atlasPxSize);
  vec2 dncDx = dFdx(nc);
  vec2 dncDy = dFdy(nc);
  float ncFwidthX = abs(dncDx.x) + abs(dncDy.x);
  float ncFwidthY = abs(dncDx.y) + abs(dncDy.y);

  if (vSegmentCount <= 0) {
    discard;
  }

  if (
    uTextVectorOnly < 0.5 &&
    vRasterRect.z > 0.0 &&
    vRasterRect.w > 0.0 &&
    min(ncFwidthX, ncFwidthY) > 2.0
  ) {
    vec2 uvCenter = vec2(
      vRasterRect.x + vNormCoord.x * vRasterRect.z,
      vRasterRect.y + (1.0 - vNormCoord.y) * vRasterRect.w
    );
    vec2 texel = 1.0 / atlasPxSize;
    vec2 uvMin = vRasterRect.xy + texel * 0.5;
    vec2 uvMax = vRasterRect.xy + vRasterRect.zw - texel * 0.5;
    vec2 tapDx = dncDx * 0.33 * texel;
    vec2 tapDy = dncDy * 0.33 * texel;
    // Scale explicit gradients by exp2(-1.25) to preserve the previous mip
    // bias while matching the WGSL anisotropic footprint exactly.
    vec2 mipBiasedUvDx = dncDx * texel * 0.42044820762685725;
    vec2 mipBiasedUvDy = dncDy * texel * 0.42044820762685725;
    float alpha = (1.0 / 3.0) * textureGrad(
      uTextRasterAtlasTex,
      clamp(uvCenter, uvMin, uvMax),
      mipBiasedUvDx,
      mipBiasedUvDy
    ).r +
      (1.0 / 6.0) * (
        textureGrad(uTextRasterAtlasTex, clamp(uvCenter - tapDx - tapDy, uvMin, uvMax), mipBiasedUvDx, mipBiasedUvDy).r +
        textureGrad(uTextRasterAtlasTex, clamp(uvCenter - tapDx + tapDy, uvMin, uvMax), mipBiasedUvDx, mipBiasedUvDy).r +
        textureGrad(uTextRasterAtlasTex, clamp(uvCenter + tapDx - tapDy, uvMin, uvMax), mipBiasedUvDx, mipBiasedUvDy).r +
        textureGrad(uTextRasterAtlasTex, clamp(uvCenter + tapDx + tapDy, uvMin, uvMax), mipBiasedUvDx, mipBiasedUvDy).r
      );
    alpha = heprThreeLinearCoverageToOutputAlpha(alpha) * vColorAlpha;
    if (alpha <= 0.001) {
      discard;
    }
    vec3 color = mix(vColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
    outColor = heprThreeEncodeOutputColor(vec4(color, alpha));
    return;
  }

  float coincidentEpsilon = max(baseAAWidth * 1e-4, 1e-7);
  // Outside the antialiasing band the smoothstep below saturates, so the winding
  // number alone decides the pixel and exact distances stop mattering. The small
  // margin keeps coincident-edge grouping from losing a tie candidate.
  float aaCullDistance = baseAAWidth * 1.05 + coincidentEpsilon;

  // A tiny deterministic offset keeps exact-on-edge winding tests stable.
  vec2 queryLocal = vLocal + 0.001 * (localDx + 0.37 * localDy);
  float minDistance = 1e20;
  float nearestT = 0.0;
  vec2 nearestPoint = vec2(0.0);
  vec2 nearestNormal = vec2(1.0, 0.0);
  int nearestSideMultiplicity = 0;
  int winding = 0;

  for (int i = 0; i < MAX_GLYPH_PRIMITIVES; i += 1) {
    if (i >= vSegmentCount) {
      break;
    }

    vec4 primitiveA = texelFetch(uTextGlyphSegmentTexA, coordFromIndex(vSegmentStart + i, uTextGlyphSegmentTexSize), 0);
    vec4 primitiveB = texelFetch(uTextGlyphSegmentTexB, coordFromIndex(vSegmentStart + i, uTextGlyphSegmentTexSize), 0);
    vec2 p0 = primitiveA.xy;
    vec2 p1 = primitiveA.zw;
    vec2 p2 = primitiveB.xy;
    float primitiveType = primitiveB.z;
    bool isQuadratic = uTextCurveEnabled >= 0.5 && primitiveType >= TEXT_PRIMITIVE_QUADRATIC;

    // A quadratic stays inside the hull of its control points, so this box
    // contains the primitive for both curve and line cases.
    vec2 hullMin = min(p0, p2);
    vec2 hullMax = max(p0, p2);
    if (isQuadratic) {
      hullMin = min(hullMin, p1);
      hullMax = max(hullMax, p1);
    }

    // The ray used for the winding test travels along +x, so it can only cross
    // this primitive within the box's y span and to the right of the query point.
    bool mayCross = queryLocal.y >= hullMin.y && queryLocal.y <= hullMax.y && hullMax.x > queryLocal.x;

    // Distance to the box lower-bounds the distance to the primitive inside it.
    vec2 boundOffset = max(max(hullMin - queryLocal, queryLocal - hullMax), vec2(0.0));
    float cullDistance = min(aaCullDistance, minDistance + coincidentEpsilon);
    bool mayBeNearest = dot(boundOffset, boundOffset) <= cullDistance * cullDistance;

    if (!mayCross && !mayBeNearest) {
      continue;
    }

    if (mayBeNearest) {
      vec4 distanceInfo;
      vec2 closestPoint;
      if (isQuadratic) {
        distanceInfo = textQuadraticDistanceInfo(queryLocal, p0, p1, p2);
        closestPoint = evaluateQuadratic(p0, p1, p2, distanceInfo.y);
      } else {
        distanceInfo = textLineDistanceInfo(queryLocal, p0, p2);
        closestPoint = mix(p0, p2, distanceInfo.y);
      }

      float signedOffset = dot(queryLocal - closestPoint, distanceInfo.zw);
      int sideStep = signedOffset >= 0.0 ? 1 : -1;
      if (distanceInfo.x + coincidentEpsilon < minDistance) {
        minDistance = distanceInfo.x;
        nearestT = distanceInfo.y;
        nearestPoint = closestPoint;
        nearestNormal = distanceInfo.zw;
        nearestSideMultiplicity = sideStep;
      } else if (abs(distanceInfo.x - minDistance) <= coincidentEpsilon) {
        float normalAlignment = dot(distanceInfo.zw, nearestNormal);
        bool bothInterior = distanceInfo.y > 1e-4 && distanceInfo.y < 1.0 - 1e-4 &&
          nearestT > 1e-4 && nearestT < 1.0 - 1e-4;
        bool sameEdge = bothInterior && distance(closestPoint, nearestPoint) <= coincidentEpsilon &&
          abs(normalAlignment) >= 0.9999;
        if (sameEdge) {
          nearestSideMultiplicity += sideStep;
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
        accumulateQuadraticCrossing(p0, p1, p2, queryLocal, winding);
      } else {
        accumulateLineCrossing(p0, p2, queryLocal, winding);
      }
    }
  }

  bool inside = winding != 0;
  int acrossWinding = winding - nearestSideMultiplicity;
  bool nearestSeparatesFill = inside != (acrossWinding != 0);
  float signedDistance = inside ? -minDistance : minDistance;
  // Use the screen-space derivative along the nearest edge normal for final
  // coverage. baseAAWidth intentionally remains conservative above for
  // primitive culling, while this directional width avoids widening tilted
  // glyph edges into dark/grey bands.
  float edgeAAWidth = max(
    length(vec2(dot(localDx, nearestNormal), dot(localDy, nearestNormal))) * uTextAAScreenPx,
    1e-4
  );
  float edgeAlpha = 1.0 - smoothstep(-edgeAAWidth, edgeAAWidth, signedDistance);
  // Nonzero fill stays opaque across overlap-only contour edges. Coincident
  // exterior edges are grouped above and antialiased as one true boundary.
  float alphaBase = nearestSeparatesFill ? edgeAlpha : (inside ? 1.0 : 0.0);
  float alpha = heprThreeLinearCoverageToOutputAlpha(alphaBase) * vColorAlpha;
  if (alpha <= 0.001) {
    discard;
  }

  vec3 color = mix(vColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
  outColor = heprThreeEncodeOutputColor(vec4(color, alpha));
}
`;

const BLIT_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;

void main() {
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`;

const BLIT_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D uCacheTex;
uniform vec2 uViewportPx;
uniform vec2 uCacheSizePx;
uniform vec2 uOffsetPx;
uniform float uSampleScale;

out vec4 outColor;

void main() {
  float sampleScale = max(uSampleScale, 1e-6);
  vec2 centered = gl_FragCoord.xy - 0.5 * uViewportPx;
  vec2 samplePx = centered * sampleScale + 0.5 * uCacheSizePx + uOffsetPx;
  vec2 uv = samplePx / uCacheSizePx;

  if (uv.x < 0.0 || uv.y < 0.0 || uv.x > 1.0 || uv.y > 1.0) {
    outColor = vec4(0.627451, 0.662745, 0.686275, 1.0);
    return;
  }

  outColor = texture(uCacheTex, uv);
}
`;

const VECTOR_COMPOSITE_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D uVectorLayerTex;
uniform vec2 uViewportPx;

out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / max(uViewportPx, vec2(1.0));
  outColor = texture(uVectorLayerTex, clamp(uv, vec2(0.0), vec2(1.0)));
}
`;

const RASTER_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;

uniform vec4 uRasterMatrixABCD;
uniform vec2 uRasterMatrixEF;
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;

out vec2 vUv;

void main() {
  vec2 corner01 = aCorner * 0.5 + 0.5;
  vec2 localTopDown = vec2(corner01.x, 1.0 - corner01.y);

  float a = uRasterMatrixABCD.x;
  float b = uRasterMatrixABCD.y;
  float c = uRasterMatrixABCD.z;
  float d = uRasterMatrixABCD.w;
  float e = uRasterMatrixEF.x;
  float f = uRasterMatrixEF.y;

  vec2 world = vec2(
    a * localTopDown.x + c * localTopDown.y + e,
    b * localTopDown.x + d * localTopDown.y + f
  );

  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  } else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    vec2 clip = (screen / (0.5 * uViewport)) - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
  }
  vUv = localTopDown;
}
`;

const RASTER_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uRasterTex;
in vec2 vUv;
out vec4 outColor;

void main() {
  vec4 color = texture(uRasterTex, vUv);
  if (color.a <= 0.001) {
    discard;
  }
  outColor = color;
}
`;

const HIGHLIGHT_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;
layout(location = 1) in vec4 aRectBounds;

uniform vec2 uViewport;
uniform vec2 uCameraCenter;
// Pixels per scene unit; also supplied on the projected path so pixel-space
// border/min-size math works in both branches.
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;
uniform float uBorderPx;
uniform float uMinSizePx;

out vec2 vLocalPx;
out vec2 vHalfSizePx;

void main() {
  vec2 center = (aRectBounds.xy + aRectBounds.zw) * 0.5;
  vec2 halfSize = (aRectBounds.zw - aRectBounds.xy) * 0.5;
  vec2 halfSizePx = max(halfSize * uZoom, vec2(0.5 * uMinSizePx));
  vec2 expandedHalfPx = halfSizePx + vec2(uBorderPx);
  vec2 world = center + aCorner * (expandedHalfPx / uZoom);

  vLocalPx = aCorner * expandedHalfPx;
  vHalfSizePx = halfSizePx;

  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  } else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    vec2 clip = (screen / (0.5 * uViewport)) - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
  }
}
`;

const HIGHLIGHT_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec2 vLocalPx;
in vec2 vHalfSizePx;

uniform vec4 uFillColor;
uniform vec4 uBorderColor;

out vec4 outColor;

void main() {
  vec2 distanceToEdgePx = vHalfSizePx - abs(vLocalPx);
  bool insideRect = distanceToEdgePx.x >= 0.0 && distanceToEdgePx.y >= 0.0;
  outColor = insideRect ? uFillColor : uBorderColor;
}
`;

/** Browser-find style: semi-transparent fill with a solid outline ring. */
const HIGHLIGHT_OTHER_FILL: readonly number[] = [1, 0.921, 0.231, 0.35];
const HIGHLIGHT_OTHER_BORDER: readonly number[] = [0.792, 0.541, 0.016, 1];
const HIGHLIGHT_OTHER_BORDER_PX = 1;
const HIGHLIGHT_CURRENT_FILL: readonly number[] = [1, 0.596, 0, 0.45];
const HIGHLIGHT_CURRENT_BORDER: readonly number[] = [0.918, 0.345, 0.047, 1];
const HIGHLIGHT_CURRENT_BORDER_PX = 2;
/** Text-selection style: browser-selection blue, same fill+ring treatment. */
const HIGHLIGHT_SELECTION_FILL: readonly number[] = [0.259, 0.522, 0.957, 0.35];
const HIGHLIGHT_SELECTION_BORDER: readonly number[] = [0.106, 0.365, 0.788, 1];
const HIGHLIGHT_SELECTION_BORDER_PX = 1;
const HIGHLIGHT_MIN_SIZE_PX = 2;

const INTERACTION_DECAY_MS = 140;
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
const CLEAR_COLOR_R = 160 / 255;
const CLEAR_COLOR_G = 169 / 255;
const CLEAR_COLOR_B = 175 / 255;

// Shared shader sources exposed for adapter integrations (Three/Babylon/native wrappers).
export const CORE_STROKE_VERTEX_SHADER_SOURCE = VERTEX_SHADER_SOURCE;
export const CORE_STROKE_FRAGMENT_SHADER_SOURCE = FRAGMENT_SHADER_SOURCE;
export const CORE_FILL_VERTEX_SHADER_SOURCE = FILL_VERTEX_SHADER_SOURCE;
export const CORE_FILL_FRAGMENT_SHADER_SOURCE = FILL_FRAGMENT_SHADER_SOURCE;
export const CORE_TEXT_VERTEX_SHADER_SOURCE = TEXT_VERTEX_SHADER_SOURCE;
export const CORE_TEXT_FRAGMENT_SHADER_SOURCE = TEXT_FRAGMENT_SHADER_SOURCE;
export const CORE_BLIT_VERTEX_SHADER_SOURCE = BLIT_VERTEX_SHADER_SOURCE;
export const CORE_BLIT_FRAGMENT_SHADER_SOURCE = BLIT_FRAGMENT_SHADER_SOURCE;
export const CORE_VECTOR_COMPOSITE_FRAGMENT_SHADER_SOURCE = VECTOR_COMPOSITE_FRAGMENT_SHADER_SOURCE;
export const CORE_RASTER_VERTEX_SHADER_SOURCE = RASTER_VERTEX_SHADER_SOURCE;
export const CORE_RASTER_FRAGMENT_SHADER_SOURCE = RASTER_FRAGMENT_SHADER_SOURCE;

/** Per-frame draw diagnostics from HEPR's native renderer. */
export interface DrawStats {
  /** Number of vector stroke segments rendered in the frame. */
  renderedSegments: number;

  /** Total stroke segment count in the loaded scene. */
  totalSegments: number;

  /** Whether renderer-side culling reduced the frame workload. */
  usedCulling: boolean;

  /** HEPR view zoom in screen pixels per PDF scene unit. */
  zoom: number;
}

/** GPU resource and spatial-index diagnostics for the loaded scene. */
export interface SceneStats {
  /** Spatial grid column count. */
  gridWidth: number;

  /** Spatial grid row count. */
  gridHeight: number;

  /** Number of segment index entries stored in the spatial grid. */
  gridIndexCount: number;

  /** Largest number of segments assigned to one spatial grid cell. */
  maxCellPopulation: number;

  /** Fill path metadata texture width. */
  fillPathTextureWidth: number;

  /** Fill path metadata texture height. */
  fillPathTextureHeight: number;

  /** Fill segment texture width. */
  fillSegmentTextureWidth: number;

  /** Fill segment texture height. */
  fillSegmentTextureHeight: number;

  /** Stroke segment texture width. */
  textureWidth: number;

  /** Stroke segment texture height. */
  textureHeight: number;

  /** Maximum texture size reported by the active renderer. */
  maxTextureSize: number;

  /** Text instance texture width. */
  textInstanceTextureWidth: number;

  /** Text instance texture height. */
  textInstanceTextureHeight: number;

  /** Text glyph metadata texture width. */
  textGlyphTextureWidth: number;

  /** Text glyph metadata texture height. */
  textGlyphTextureHeight: number;

  /** Text glyph segment texture width. */
  textSegmentTextureWidth: number;

  /** Text glyph segment texture height. */
  textSegmentTextureHeight: number;
}

/** HEPR's native 2D view state in PDF scene coordinates. */
export interface ViewState {
  /** X coordinate at the center of the HEPR view. */
  cameraCenterX: number;

  /** Y coordinate at the center of the HEPR view. */
  cameraCenterY: number;

  /** Screen pixels per PDF scene unit. */
  zoom: number;
}

/**
 * Search-highlight rectangles drawn natively by the renderer, in the same
 * frame and with the same camera transform as the scene (no overlay lag).
 */
export interface SearchHighlightSet {
  /** 4 floats per rectangle: minX, minY, maxX, maxY in scene space. */
  rects: Float32Array;
  count: number;
  /** Rectangle drawn with the emphasized "current match" style, or -1. */
  currentIndex: number;
}

/** Parameters for rendering a native frame through an external projection. */
export interface ProjectedFrameOptions {
  /** Render viewport width in device pixels. */
  viewportWidth: number;

  /** Render viewport height in device pixels. */
  viewportHeight: number;

  /** Column-major local-to-clip transform matrix. */
  localToClip: ArrayLike<number>;

  /** Approximate PDF local units per screen pixel. */
  localUnitsPerPixel: number;

  /** Optional PDF-scene culling bounds for the projected frame. */
  cullingBounds?: Bounds | null;
}

/** Options for native view-state updates. */
export interface ViewStateUpdateOptions {
  /** Preserve cached pan content where possible. */
  preservePanCache?: boolean;

  /** Whether the update occurs during an active interaction. */
  interacting?: boolean;

  /**
   * Whether the renderer should schedule a frame of its own. Hosts that drive
   * the camera but present through their own pipeline set this to false: the
   * view state still has to stay current for hit testing and pipeline switches,
   * but rendering it would draw a second copy of the document nobody sees.
   */
  scheduleFrame?: boolean;
}

/** WebGL native renderer construction options. */
export interface WebGlFloorplanRendererOptions {
  /** Preserve the WebGL drawing buffer after presentation. */
  preserveDrawingBuffer?: boolean;
}

type FrameListener = (stats: DrawStats) => void;

interface RasterLayerGpu {
  texture: WebGLTexture;
  matrix: Float32Array;
  paintOrder: number;
  pageIndex: number;
}

interface StrokeTextureSet {
  textureA: WebGLTexture;
  textureB: WebGLTexture;
  textureC: WebGLTexture;
  textureD: WebGLTexture;
  textureWidth: number;
  textureHeight: number;
  ownsTextures: boolean;
}

interface VectorLodGpuLevel extends StrokeTextureSet {
  visibleSegmentIdBuffer: WebGLBuffer;
  visibleSegmentIdsFloat: Float32Array;
}

interface InstanceRange {
  start: number;
  count: number;
}

export class WebGlFloorplanRenderer {
  private readonly canvas: HTMLCanvasElement;

  private readonly gl: WebGL2RenderingContext;

  private readonly segmentProgram: WebGLProgram;

  private readonly fillProgram: WebGLProgram;

  private readonly gradientFillProgram: WebGLProgram;

  private readonly gradientStrokeProgram: WebGLProgram;

  private readonly textProgram: WebGLProgram;

  private readonly blitProgram: WebGLProgram;

  private readonly vectorCompositeProgram: WebGLProgram;

  private readonly rasterProgram: WebGLProgram;

  private readonly highlightProgram: WebGLProgram;

  private readonly segmentVao: WebGLVertexArrayObject;

  private readonly fillVao: WebGLVertexArrayObject;

  private readonly gradientPaintVao: WebGLVertexArrayObject;

  private readonly textVao: WebGLVertexArrayObject;

  private readonly blitVao: WebGLVertexArrayObject;

  private readonly highlightOthersVao: WebGLVertexArrayObject;

  private readonly highlightCurrentVao: WebGLVertexArrayObject;

  private readonly highlightSelectionVao: WebGLVertexArrayObject;

  private readonly cornerBuffer: WebGLBuffer;

  private readonly allSegmentIdBuffer: WebGLBuffer;

  private readonly visibleSegmentIdBuffer: WebGLBuffer;

  private readonly allFillPathIdBuffer: WebGLBuffer;

  private readonly allTextInstanceIdBuffer: WebGLBuffer;

  /** Source-ordered exact/coarse selection used only while text LOD is active. */
  private readonly selectedTextInstanceIdBuffer: WebGLBuffer;

  private readonly highlightOthersBuffer: WebGLBuffer;

  private readonly highlightCurrentBuffer: WebGLBuffer;

  private readonly highlightSelectionBuffer: WebGLBuffer;

  private highlightOthersCount = 0;

  private highlightHasCurrent = false;

  private highlightSelectionCount = 0;

  private readonly segmentTextureA: WebGLTexture;

  private readonly segmentTextureB: WebGLTexture;

  private readonly segmentTextureC: WebGLTexture;

  private readonly segmentTextureD: WebGLTexture;

  private readonly fillPathMetaTextureA: WebGLTexture;

  private readonly fillPathMetaTextureB: WebGLTexture;

  private readonly fillPathMetaTextureC: WebGLTexture;

  private readonly fillSegmentTextureA: WebGLTexture;

  private readonly fillSegmentTextureB: WebGLTexture;

  private readonly textInstanceTextureA: WebGLTexture;

  private readonly textInstanceTextureB: WebGLTexture;

  private readonly textInstanceTextureC: WebGLTexture;

  private readonly textGlyphMetaTextureA: WebGLTexture;

  private readonly textGlyphMetaTextureB: WebGLTexture;

  private readonly textGlyphRasterMetaTexture: WebGLTexture;

  private readonly textGlyphSegmentTextureA: WebGLTexture;

  private readonly textGlyphSegmentTextureB: WebGLTexture;

  private readonly textRasterAtlasTexture: WebGLTexture;

  private readonly pageBackgroundTexture: WebGLTexture;

  private readonly gradientMetaTextures: readonly WebGLTexture[];

  private readonly gradientLutTexture: WebGLTexture;

  private readonly gradientFillTextures: readonly WebGLTexture[];

  private readonly gradientStrokeTextures: readonly WebGLTexture[];

  private readonly gradientFillUniforms: Readonly<Record<string, WebGLUniformLocation>>;

  private readonly gradientStrokeUniforms: Readonly<Record<string, WebGLUniformLocation>>;

  private readonly uSegmentTexA: WebGLUniformLocation;

  private readonly uSegmentTexB: WebGLUniformLocation;

  private readonly uSegmentStyleTex: WebGLUniformLocation;

  private readonly uSegmentBoundsTex: WebGLUniformLocation;

  private readonly uSegmentTexSize: WebGLUniformLocation;

  private readonly uViewport: WebGLUniformLocation;

  private readonly uCameraCenter: WebGLUniformLocation;

  private readonly uZoom: WebGLUniformLocation;

  private readonly uAAScreenPx: WebGLUniformLocation;

  private readonly uUseLocalToClip: WebGLUniformLocation;

  private readonly uLocalToClip: WebGLUniformLocation;

  private readonly uLocalUnitsPerPixel: WebGLUniformLocation;

  private readonly uStrokeCurveEnabled: WebGLUniformLocation;

  private readonly uStrokeVectorOverride: WebGLUniformLocation;

  private readonly uFillPathMetaTexA: WebGLUniformLocation;

  private readonly uFillPathMetaTexB: WebGLUniformLocation;

  private readonly uFillPathMetaTexC: WebGLUniformLocation;

  private readonly uFillSegmentTexA: WebGLUniformLocation;

  private readonly uFillSegmentTexB: WebGLUniformLocation;

  private readonly uFillPathMetaTexSize: WebGLUniformLocation;

  private readonly uFillSegmentTexSize: WebGLUniformLocation;

  private readonly uFillViewport: WebGLUniformLocation;

  private readonly uFillCameraCenter: WebGLUniformLocation;

  private readonly uFillZoom: WebGLUniformLocation;

  private readonly uFillAAScreenPx: WebGLUniformLocation;

  private readonly uFillUseLocalToClip: WebGLUniformLocation;

  private readonly uFillLocalToClip: WebGLUniformLocation;

  private readonly uFillVectorOverride: WebGLUniformLocation;

  private readonly uTextInstanceTexA: WebGLUniformLocation;

  private readonly uTextInstanceTexB: WebGLUniformLocation;

  private readonly uTextInstanceTexC: WebGLUniformLocation;

  private readonly uTextGlyphMetaTexA: WebGLUniformLocation;

  private readonly uTextGlyphMetaTexB: WebGLUniformLocation;

  private readonly uTextGlyphRasterMetaTex: WebGLUniformLocation;

  private readonly uTextGlyphSegmentTexA: WebGLUniformLocation;

  private readonly uTextGlyphSegmentTexB: WebGLUniformLocation;

  private readonly uTextInstanceTexSize: WebGLUniformLocation;

  private readonly uTextGlyphMetaTexSize: WebGLUniformLocation;

  private readonly uTextGlyphSegmentTexSize: WebGLUniformLocation;

  private readonly uTextViewport: WebGLUniformLocation;

  private readonly uTextCameraCenter: WebGLUniformLocation;

  private readonly uTextZoom: WebGLUniformLocation;

  private readonly uTextAAScreenPx: WebGLUniformLocation;

  private readonly uTextUseLocalToClip: WebGLUniformLocation;

  private readonly uTextLocalToClip: WebGLUniformLocation;

  private readonly uTextCurveEnabled: WebGLUniformLocation;

  private readonly uTextRasterAtlasTex: WebGLUniformLocation;

  private readonly uTextRasterAtlasSize: WebGLUniformLocation;

  private readonly uTextVectorOnly: WebGLUniformLocation;

  private readonly uTextVectorOverride: WebGLUniformLocation;

  private readonly uCacheTex: WebGLUniformLocation;

  private readonly uViewportPx: WebGLUniformLocation;

  private readonly uCacheSizePx: WebGLUniformLocation;

  private readonly uOffsetPx: WebGLUniformLocation;

  private readonly uSampleScale: WebGLUniformLocation;

  private readonly uVectorLayerTex: WebGLUniformLocation;

  private readonly uVectorLayerViewportPx: WebGLUniformLocation;

  private readonly uRasterTex: WebGLUniformLocation;

  private readonly uRasterMatrixABCD: WebGLUniformLocation;

  private readonly uRasterMatrixEF: WebGLUniformLocation;

  private readonly uRasterViewport: WebGLUniformLocation;

  private readonly uRasterCameraCenter: WebGLUniformLocation;

  private readonly uRasterZoom: WebGLUniformLocation;

  private readonly uRasterUseLocalToClip: WebGLUniformLocation;

  private readonly uRasterLocalToClip: WebGLUniformLocation;

  private readonly uHighlightViewport: WebGLUniformLocation;

  private readonly uHighlightCameraCenter: WebGLUniformLocation;

  private readonly uHighlightZoom: WebGLUniformLocation;

  private readonly uHighlightUseLocalToClip: WebGLUniformLocation;

  private readonly uHighlightLocalToClip: WebGLUniformLocation;

  private readonly uHighlightBorderPx: WebGLUniformLocation;

  private readonly uHighlightMinSizePx: WebGLUniformLocation;

  private readonly uHighlightFillColor: WebGLUniformLocation;

  private readonly uHighlightBorderColor: WebGLUniformLocation;

  private scene: VectorScene | null = null;

  private grid: SpatialGrid | null = null;

  private sceneStats: SceneStats | null = null;

  private vectorLodMode: VectorLodMode = "auto";

  private vectorLodRuntime: VectorStrokeLodRuntime | null = null;

  private vectorLodLevels: VectorLodGpuLevel[] = [];

  private vectorLodStats: VectorStrokeLodStats | null = null;

  private allSegmentIds = new Float32Array(0);

  private visibleSegmentIds = new Float32Array(0);

  private allFillPathIds = new Float32Array(0);

  private allTextInstanceIds = new Float32Array(0);

  private textLodMode: TextLodMode = "auto";

  private textLodRuntime: TextLodRuntime | null = null;

  private textLodGpuActive = false;

  private selectedTextInstanceIds = new Float32Array(0);

  private selectedTextInstanceCount = 0;

  private segmentMarks = new Uint32Array(0);

  private segmentMinX = new Float32Array(0);

  private segmentMinY = new Float32Array(0);

  private segmentMaxX = new Float32Array(0);

  private segmentMaxY = new Float32Array(0);

  private markToken = 1;

  private segmentCount = 0;

  private fillPathCount = 0;

  private textInstanceCount = 0;

  private rasterLayers: RasterLayerGpu[] = [];

  private rasterTextureResidencyEnabled = true;

  private gradientData: GradientSceneData | null = null;

  private orderedGradientPaintCommands: OrderedGradientPaintCommand[] = [];

  private gradientPaintRequiresDirectRendering = false;

  private gradientTextureWidth = 1;

  private gradientTextureHeight = 1;

  private gradientFillPathTextureWidth = 1;

  private gradientFillPathTextureHeight = 1;

  private gradientFillSegmentTextureWidth = 1;

  private gradientFillSegmentTextureHeight = 1;

  private gradientStrokeRunTextureWidth = 1;

  private gradientStrokeRunTextureHeight = 1;

  private gradientStrokeSegmentTextureWidth = 1;

  private gradientStrokeSegmentTextureHeight = 1;

  private pageRects: Float32Array<ArrayBufferLike> = new Float32Array(0);

  private pageTextRanges: Uint32Array<ArrayBufferLike> = new Uint32Array(0);

  private visiblePageRectIndices: Uint32Array<ArrayBufferLike> = new Uint32Array(0);

  private visiblePageRectCount = 0;

  private visibleTextRanges: InstanceRange[] = [];

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

  private textRasterAtlasWidth = 1;

  private textRasterAtlasHeight = 1;

  private textGlyphSegmentTextureWidth = 1;

  private textGlyphSegmentTextureHeight = 1;

  private needsVisibleSetUpdate = false;

  private rafHandle = 0;

  private frameListener: FrameListener | null = null;
  private interactionViewportProvider: (() => DOMRect | DOMRectReadOnly | null) | null = null;
  private externalFrameDriver = false;
  private presentedCameraCenterX = 0;
  private presentedCameraCenterY = 0;
  private presentedZoom = 1;
  private presentedFrameSerial = 0;

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

  private maxZoom = 4_096;

  private lastInteractionTime = Number.NEGATIVE_INFINITY;

  private isPanInteracting = false;

  private panCacheTexture: WebGLTexture | null = null;

  private panCacheFramebuffer: WebGLFramebuffer | null = null;

  private panCacheWidth = 0;

  private panCacheHeight = 0;

  private panCacheValid = false;

  private panCacheCenterX = 0;

  private panCacheCenterY = 0;

  private panCacheZoom = 1;

  private panCacheRenderedSegments = 0;

  private panCacheUsedCulling = false;

  private vectorMinifyTexture: WebGLTexture | null = null;

  private vectorMinifyFramebuffer: WebGLFramebuffer | null = null;

  private vectorMinifyWidth = 0;

  private vectorMinifyHeight = 0;

  private vectorMinifyWarmupPending = false;

  private rasterRenderingEnabled = true;

  private fillRenderingEnabled = true;

  private strokeRenderingEnabled = true;

  private textRenderingEnabled = true;

  private strokeCurveEnabled = true;

  private textVectorOnly = false;

  // Keep first loaded frame complete; enable culling once user actually pans/zooms.
  private hasCameraInteractionSinceSceneLoad = false;

  private pageBackgroundColor: [number, number, number, number] = [1, 1, 1, 1];

  private vectorOverrideColor: [number, number, number] = [0, 0, 0];

  private vectorOverrideOpacity = 0;
  private localToClipRenderingEnabled = false;
  private readonly localToClipMatrix = new Float32Array(16);
  private localUnitsPerPixel = 1;
  private isDisposed = false;

  constructor(canvas: HTMLCanvasElement, options: WebGlFloorplanRendererOptions = {}) {
    this.canvas = canvas;

    const context = canvas.getContext("webgl2", {
      antialias: false,
      depth: false,
      stencil: false,
      alpha: false,
      premultipliedAlpha: false,
      powerPreference: "high-performance",
      preserveDrawingBuffer: options.preserveDrawingBuffer === true
    });

    if (!context) {
      throw new Error("WebGL2 is required for this proof-of-concept renderer.");
    }

    this.gl = context;

    this.segmentProgram = this.createProgram(VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
    this.fillProgram = this.createProgram(FILL_VERTEX_SHADER_SOURCE, FILL_FRAGMENT_SHADER_SOURCE);
    this.gradientFillProgram = this.createProgram(
      GRADIENT_FILL_VERTEX_SHADER_SOURCE,
      GRADIENT_FILL_FRAGMENT_SHADER_SOURCE
    );
    this.gradientStrokeProgram = this.createProgram(
      GRADIENT_STROKE_VERTEX_SHADER_SOURCE,
      GRADIENT_STROKE_FRAGMENT_SHADER_SOURCE
    );
    this.textProgram = this.createProgram(TEXT_VERTEX_SHADER_SOURCE, TEXT_FRAGMENT_SHADER_SOURCE);
    this.blitProgram = this.createProgram(BLIT_VERTEX_SHADER_SOURCE, BLIT_FRAGMENT_SHADER_SOURCE);
    this.vectorCompositeProgram = this.createProgram(BLIT_VERTEX_SHADER_SOURCE, VECTOR_COMPOSITE_FRAGMENT_SHADER_SOURCE);
    this.rasterProgram = this.createProgram(RASTER_VERTEX_SHADER_SOURCE, RASTER_FRAGMENT_SHADER_SOURCE);
    this.highlightProgram = this.createProgram(HIGHLIGHT_VERTEX_SHADER_SOURCE, HIGHLIGHT_FRAGMENT_SHADER_SOURCE);

    this.segmentVao = this.createVertexArray();
    this.fillVao = this.createVertexArray();
    this.gradientPaintVao = this.createVertexArray();
    this.textVao = this.createVertexArray();
    this.blitVao = this.createVertexArray();
    this.highlightOthersVao = this.createVertexArray();
    this.highlightCurrentVao = this.createVertexArray();
    this.highlightSelectionVao = this.createVertexArray();

    this.cornerBuffer = this.mustCreateBuffer();
    this.allSegmentIdBuffer = this.mustCreateBuffer();
    this.visibleSegmentIdBuffer = this.mustCreateBuffer();
    this.allFillPathIdBuffer = this.mustCreateBuffer();
    this.allTextInstanceIdBuffer = this.mustCreateBuffer();
    this.selectedTextInstanceIdBuffer = this.mustCreateBuffer();
    this.highlightOthersBuffer = this.mustCreateBuffer();
    this.highlightCurrentBuffer = this.mustCreateBuffer();
    this.highlightSelectionBuffer = this.mustCreateBuffer();

    this.segmentTextureA = this.mustCreateTexture();
    this.segmentTextureB = this.mustCreateTexture();
    this.segmentTextureC = this.mustCreateTexture();
    this.segmentTextureD = this.mustCreateTexture();
    this.fillPathMetaTextureA = this.mustCreateTexture();
    this.fillPathMetaTextureB = this.mustCreateTexture();
    this.fillPathMetaTextureC = this.mustCreateTexture();
    this.fillSegmentTextureA = this.mustCreateTexture();
    this.fillSegmentTextureB = this.mustCreateTexture();
    this.textInstanceTextureA = this.mustCreateTexture();
    this.textInstanceTextureB = this.mustCreateTexture();
    this.textInstanceTextureC = this.mustCreateTexture();
    this.textGlyphMetaTextureA = this.mustCreateTexture();
    this.textGlyphMetaTextureB = this.mustCreateTexture();
    this.textGlyphRasterMetaTexture = this.mustCreateTexture();
    this.textGlyphSegmentTextureA = this.mustCreateTexture();
    this.textGlyphSegmentTextureB = this.mustCreateTexture();
    this.textRasterAtlasTexture = this.mustCreateTexture();
    this.pageBackgroundTexture = this.mustCreateTexture();
    this.gradientMetaTextures = Array.from({ length: 5 }, () => this.mustCreateTexture());
    this.gradientLutTexture = this.mustCreateTexture();
    this.gradientFillTextures = Array.from({ length: 6 }, () => this.mustCreateTexture());
    this.gradientStrokeTextures = Array.from({ length: 5 }, () => this.mustCreateTexture());

    this.gradientFillUniforms = this.mustGetUniformMap(this.gradientFillProgram, [
      "uPathMetaTexA",
      "uPathMetaTexB",
      "uPathMetaTexC",
      "uPaintMetaTex",
      "uPathMetaTexSize",
      "uSegmentTexA",
      "uSegmentTexB",
      "uSegmentTexSize",
      "uGradientMetaTexA",
      "uGradientMetaTexB",
      "uGradientMetaTexC",
      "uGradientMetaTexD",
      "uGradientMetaTexE",
      "uGradientLutTex",
      "uGradientMetaTexSize",
      "uGradientCount",
      "uViewport",
      "uCameraCenter",
      "uZoom",
      "uAAScreenPx",
      "uUseLocalToClip",
      "uLocalToClip",
      "uVectorOverride"
    ]);
    this.gradientStrokeUniforms = this.mustGetUniformMap(this.gradientStrokeProgram, [
      "uRunMetaTexA",
      "uEndpointsTex",
      "uPrimitiveMetaTex",
      "uPrimitiveBoundsTex",
      "uStylesTex",
      "uRunMetaTexSize",
      "uSegmentTexSize",
      "uGradientMetaTexA",
      "uGradientMetaTexB",
      "uGradientMetaTexC",
      "uGradientMetaTexD",
      "uGradientMetaTexE",
      "uGradientLutTex",
      "uGradientMetaTexSize",
      "uGradientCount",
      "uViewport",
      "uCameraCenter",
      "uZoom",
      "uAAScreenPx",
      "uUseLocalToClip",
      "uLocalToClip",
      "uLocalUnitsPerPixel",
      "uStrokeCurveEnabled",
      "uVectorOverride"
    ]);

    this.uSegmentTexA = this.mustGetUniformLocation(this.segmentProgram, "uSegmentTexA");
    this.uSegmentTexB = this.mustGetUniformLocation(this.segmentProgram, "uSegmentTexB");
    this.uSegmentStyleTex = this.mustGetUniformLocation(this.segmentProgram, "uSegmentStyleTex");
    this.uSegmentBoundsTex = this.mustGetUniformLocation(this.segmentProgram, "uSegmentBoundsTex");
    this.uSegmentTexSize = this.mustGetUniformLocation(this.segmentProgram, "uSegmentTexSize");
    this.uViewport = this.mustGetUniformLocation(this.segmentProgram, "uViewport");
    this.uCameraCenter = this.mustGetUniformLocation(this.segmentProgram, "uCameraCenter");
    this.uZoom = this.mustGetUniformLocation(this.segmentProgram, "uZoom");
    this.uAAScreenPx = this.mustGetUniformLocation(this.segmentProgram, "uAAScreenPx");
    this.uUseLocalToClip = this.mustGetUniformLocation(this.segmentProgram, "uUseLocalToClip");
    this.uLocalToClip = this.mustGetUniformLocation(this.segmentProgram, "uLocalToClip");
    this.uLocalUnitsPerPixel = this.mustGetUniformLocation(this.segmentProgram, "uLocalUnitsPerPixel");
    this.uStrokeCurveEnabled = this.mustGetUniformLocation(this.segmentProgram, "uStrokeCurveEnabled");
    this.uStrokeVectorOverride = this.mustGetUniformLocation(this.segmentProgram, "uVectorOverride");

    this.uFillPathMetaTexA = this.mustGetUniformLocation(this.fillProgram, "uFillPathMetaTexA");
    this.uFillPathMetaTexB = this.mustGetUniformLocation(this.fillProgram, "uFillPathMetaTexB");
    this.uFillPathMetaTexC = this.mustGetUniformLocation(this.fillProgram, "uFillPathMetaTexC");
    this.uFillSegmentTexA = this.mustGetUniformLocation(this.fillProgram, "uFillSegmentTexA");
    this.uFillSegmentTexB = this.mustGetUniformLocation(this.fillProgram, "uFillSegmentTexB");
    this.uFillPathMetaTexSize = this.mustGetUniformLocation(this.fillProgram, "uFillPathMetaTexSize");
    this.uFillSegmentTexSize = this.mustGetUniformLocation(this.fillProgram, "uFillSegmentTexSize");
    this.uFillViewport = this.mustGetUniformLocation(this.fillProgram, "uViewport");
    this.uFillCameraCenter = this.mustGetUniformLocation(this.fillProgram, "uCameraCenter");
    this.uFillZoom = this.mustGetUniformLocation(this.fillProgram, "uZoom");
    this.uFillAAScreenPx = this.mustGetUniformLocation(this.fillProgram, "uFillAAScreenPx");
    this.uFillUseLocalToClip = this.mustGetUniformLocation(this.fillProgram, "uUseLocalToClip");
    this.uFillLocalToClip = this.mustGetUniformLocation(this.fillProgram, "uLocalToClip");
    this.uFillVectorOverride = this.mustGetUniformLocation(this.fillProgram, "uVectorOverride");

    this.uTextInstanceTexA = this.mustGetUniformLocation(this.textProgram, "uTextInstanceTexA");
    this.uTextInstanceTexB = this.mustGetUniformLocation(this.textProgram, "uTextInstanceTexB");
    this.uTextInstanceTexC = this.mustGetUniformLocation(this.textProgram, "uTextInstanceTexC");
    this.uTextGlyphMetaTexA = this.mustGetUniformLocation(this.textProgram, "uTextGlyphMetaTexA");
    this.uTextGlyphMetaTexB = this.mustGetUniformLocation(this.textProgram, "uTextGlyphMetaTexB");
    this.uTextGlyphRasterMetaTex = this.mustGetUniformLocation(this.textProgram, "uTextGlyphRasterMetaTex");
    this.uTextGlyphSegmentTexA = this.mustGetUniformLocation(this.textProgram, "uTextGlyphSegmentTexA");
    this.uTextGlyphSegmentTexB = this.mustGetUniformLocation(this.textProgram, "uTextGlyphSegmentTexB");
    this.uTextInstanceTexSize = this.mustGetUniformLocation(this.textProgram, "uTextInstanceTexSize");
    this.uTextGlyphMetaTexSize = this.mustGetUniformLocation(this.textProgram, "uTextGlyphMetaTexSize");
    this.uTextGlyphSegmentTexSize = this.mustGetUniformLocation(this.textProgram, "uTextGlyphSegmentTexSize");
    this.uTextViewport = this.mustGetUniformLocation(this.textProgram, "uViewport");
    this.uTextCameraCenter = this.mustGetUniformLocation(this.textProgram, "uCameraCenter");
    this.uTextZoom = this.mustGetUniformLocation(this.textProgram, "uZoom");
    this.uTextAAScreenPx = this.mustGetUniformLocation(this.textProgram, "uTextAAScreenPx");
    this.uTextUseLocalToClip = this.mustGetUniformLocation(this.textProgram, "uUseLocalToClip");
    this.uTextLocalToClip = this.mustGetUniformLocation(this.textProgram, "uLocalToClip");
    this.uTextCurveEnabled = this.mustGetUniformLocation(this.textProgram, "uTextCurveEnabled");
    this.uTextRasterAtlasTex = this.mustGetUniformLocation(this.textProgram, "uTextRasterAtlasTex");
    this.uTextRasterAtlasSize = this.mustGetUniformLocation(this.textProgram, "uTextRasterAtlasSize");
    this.uTextVectorOnly = this.mustGetUniformLocation(this.textProgram, "uTextVectorOnly");
    this.uTextVectorOverride = this.mustGetUniformLocation(this.textProgram, "uVectorOverride");

    this.uCacheTex = this.mustGetUniformLocation(this.blitProgram, "uCacheTex");
    this.uViewportPx = this.mustGetUniformLocation(this.blitProgram, "uViewportPx");
    this.uCacheSizePx = this.mustGetUniformLocation(this.blitProgram, "uCacheSizePx");
    this.uOffsetPx = this.mustGetUniformLocation(this.blitProgram, "uOffsetPx");
    this.uSampleScale = this.mustGetUniformLocation(this.blitProgram, "uSampleScale");

    this.uVectorLayerTex = this.mustGetUniformLocation(this.vectorCompositeProgram, "uVectorLayerTex");
    this.uVectorLayerViewportPx = this.mustGetUniformLocation(this.vectorCompositeProgram, "uViewportPx");

    this.uRasterTex = this.mustGetUniformLocation(this.rasterProgram, "uRasterTex");
    this.uRasterMatrixABCD = this.mustGetUniformLocation(this.rasterProgram, "uRasterMatrixABCD");
    this.uRasterMatrixEF = this.mustGetUniformLocation(this.rasterProgram, "uRasterMatrixEF");
    this.uRasterViewport = this.mustGetUniformLocation(this.rasterProgram, "uViewport");
    this.uRasterCameraCenter = this.mustGetUniformLocation(this.rasterProgram, "uCameraCenter");
    this.uRasterZoom = this.mustGetUniformLocation(this.rasterProgram, "uZoom");
    this.uRasterUseLocalToClip = this.mustGetUniformLocation(this.rasterProgram, "uUseLocalToClip");
    this.uRasterLocalToClip = this.mustGetUniformLocation(this.rasterProgram, "uLocalToClip");

    this.uHighlightViewport = this.mustGetUniformLocation(this.highlightProgram, "uViewport");
    this.uHighlightCameraCenter = this.mustGetUniformLocation(this.highlightProgram, "uCameraCenter");
    this.uHighlightZoom = this.mustGetUniformLocation(this.highlightProgram, "uZoom");
    this.uHighlightUseLocalToClip = this.mustGetUniformLocation(this.highlightProgram, "uUseLocalToClip");
    this.uHighlightLocalToClip = this.mustGetUniformLocation(this.highlightProgram, "uLocalToClip");
    this.uHighlightBorderPx = this.mustGetUniformLocation(this.highlightProgram, "uBorderPx");
    this.uHighlightMinSizePx = this.mustGetUniformLocation(this.highlightProgram, "uMinSizePx");
    this.uHighlightFillColor = this.mustGetUniformLocation(this.highlightProgram, "uFillColor");
    this.uHighlightBorderColor = this.mustGetUniformLocation(this.highlightProgram, "uBorderColor");

    this.initializeGeometry();
    this.initializeState();
    this.uploadPageBackgroundTexture();
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
    if (this.externalFrameDriver && this.rafHandle !== 0) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }
  }

  renderExternalFrame(timestamp: number = performance.now()): void {
    this.render(timestamp);
  }

  renderProjectedFrame(options: ProjectedFrameOptions): DrawStats {
    const viewportWidth = Math.max(1, Math.round(options.viewportWidth));
    const viewportHeight = Math.max(1, Math.round(options.viewportHeight));
    const localUnitsPerPixel = Math.max(1e-9, Number(options.localUnitsPerPixel));
    if (options.localToClip.length < 16) {
      return {
        renderedSegments: 0,
        totalSegments: this.segmentCount,
        usedCulling: false,
        zoom: 1 / localUnitsPerPixel
      };
    }

    for (let i = 0; i < 16; i += 1) {
      const value = Number(options.localToClip[i]);
      if (!Number.isFinite(value)) {
        return {
          renderedSegments: 0,
          totalSegments: this.segmentCount,
          usedCulling: false,
          zoom: 1 / localUnitsPerPixel
        };
      }
      this.localToClipMatrix[i] = value;
    }
    this.localUnitsPerPixel = localUnitsPerPixel;
    this.localToClipRenderingEnabled = true;

    const gl = this.gl;
    this.ensureRenderState();
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, viewportWidth, viewportHeight);
    gl.clearColor(CLEAR_COLOR_R, CLEAR_COLOR_G, CLEAR_COLOR_B, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    if (options.cullingBounds) {
      this.updateVisibleSetForBounds(options.cullingBounds, localUnitsPerPixel, viewportWidth, viewportHeight);
    } else {
      this.setAllPagesAndTextVisible();
      if (this.vectorLodRuntime) {
        this.updateVectorLodVisibleSet(
          { cameraCenterX: this.cameraCenterX, cameraCenterY: this.cameraCenterY, zoom: 1 / localUnitsPerPixel },
          { width: viewportWidth, height: viewportHeight },
          null,
          localUnitsPerPixel
        );
      } else {
        this.usingAllSegments = true;
        this.visibleSegmentCount = this.segmentCount;
      }
    }

    this.drawOrderedGradientPaint(
      viewportWidth,
      viewportHeight,
      this.cameraCenterX,
      this.cameraCenterY,
      1 / localUnitsPerPixel
    );
    if (this.fillRenderingEnabled) {
      this.drawFilledPaths(viewportWidth, viewportHeight, this.cameraCenterX, this.cameraCenterY, 1 / localUnitsPerPixel);
    }
    const renderedSegments = this.strokeRenderingEnabled
      ? this.drawVisibleSegments(viewportWidth, viewportHeight, this.cameraCenterX, this.cameraCenterY, 1 / localUnitsPerPixel)
      : 0;
    if (this.textRenderingEnabled) {
      this.drawTextInstances(viewportWidth, viewportHeight, this.cameraCenterX, this.cameraCenterY, 1 / localUnitsPerPixel);
    }
    this.drawSearchHighlights(viewportWidth, viewportHeight, this.cameraCenterX, this.cameraCenterY, 1 / localUnitsPerPixel);

    this.localToClipRenderingEnabled = false;
    gl.bindVertexArray(null);
    this.presentedFrameSerial += 1;

    const stats = {
      renderedSegments,
      totalSegments: this.segmentCount,
      usedCulling: !this.usingAllSegments,
      zoom: 1 / localUnitsPerPixel
    };
    this.frameListener?.(stats);
    return stats;
  }

  setVectorLodMode(mode: VectorLodMode): void {
    const nextMode: VectorLodMode = mode === "off" || mode === "force" ? mode : "auto";
    if (this.vectorLodMode === nextMode) {
      return;
    }
    this.vectorLodMode = nextMode;
    if (this.scene) {
      this.destroyVectorLodResources();
      const vectorLodActive = this.rebuildVectorLod(this.scene);
      this.grid = !vectorLodActive && this.segmentCount > 0 ? buildSpatialGrid(this.scene) : null;
      this.destroyPanCacheResources();
      this.destroyVectorMinifyResources();
      this.needsVisibleSetUpdate = true;
      this.requestFrame();
    }
  }

  getVectorStrokeLodStats(): VectorStrokeLodStats | null {
    return this.vectorLodStats ? { ...this.vectorLodStats, activeLevels: this.vectorLodStats.activeLevels.map((level) => ({ ...level })) } : null;
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

  /**
   * Controls whether native raster textures occupy GPU memory independently
   * from whether raster paint is visible in native frames.
   */
  setRasterTextureResidency(enabled: boolean): void {
    const nextEnabled = Boolean(enabled);
    if (this.rasterTextureResidencyEnabled === nextEnabled || this.isDisposed) {
      return;
    }
    this.rasterTextureResidencyEnabled = nextEnabled;
    if (nextEnabled) {
      if (this.scene) {
        try {
          this.uploadRasterLayers(this.scene);
        } catch (error) {
          this.rasterTextureResidencyEnabled = false;
          this.destroyRasterLayerTextures();
          throw error;
        }
      }
    } else {
      this.destroyRasterLayerTextures();
    }
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

    this.destroyPanCacheResources();
    this.destroyVectorMinifyResources();
    this.needsVisibleSetUpdate = true;
    this.requestFrame();
  }

  setScene(scene: VectorScene): SceneStats {
    if (this.isDisposed) {
      throw new Error("Cannot upload a scene after the WebGL renderer has been disposed.");
    }
    this.scene = scene;
    this.segmentCount = scene.segmentCount;
    this.fillPathCount = scene.fillPathCount;
    this.textInstanceCount = scene.textInstanceCount;
    this.pageRects = normalizePageRects(scene);
    this.pageTextRanges = normalizePageTextRanges(scene, this.pageRects, this.textInstanceCount);
    this.textLodRuntime?.dispose();
    const textLodBuildResult = this.textLodMode === "auto"
      ? getOrBuildTextLod(scene)
      : getCachedTextLod(scene);
    this.textLodRuntime = textLodBuildResult
      ? new TextLodRuntime(textLodBuildResult, this.textLodMode)
      : null;
    this.textLodGpuActive = false;
    this.selectedTextInstanceCount = 0;
    if (this.visiblePageRectIndices.length < Math.floor(this.pageRects.length / 4)) {
      this.visiblePageRectIndices = new Uint32Array(Math.floor(this.pageRects.length / 4));
    }
    this.visiblePageRectCount = 0;
    this.visibleTextRanges = [];
    this.buildSegmentBounds(scene);
    this.isPanInteracting = false;
    this.panCacheValid = false;
    this.destroyVectorMinifyResources();
    this.destroyVectorLodResources();
    this.destroyRasterLayerTextures();
    if (this.rasterTextureResidencyEnabled) {
      this.uploadRasterLayers(scene);
    }
    this.uploadGradientPaintData(scene);
    const fillTextureStats = this.uploadFillPaths(scene);
    const textureStats = this.uploadSegments(scene);
    const vectorLodActive = this.rebuildVectorLod(scene);
    this.grid = !vectorLodActive && this.segmentCount > 0 ? buildSpatialGrid(scene) : null;
    let textLodUploadData: TextLodBuildData | null = null;
    if (this.textLodMode === "auto" && textLodBuildResult?.data) {
      const data = textLodBuildResult.data;
      const maxTextTextureSize = this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE) as number;
      const fitsGpuTextures =
        canFitTextureItems(data.combinedInstanceCount, maxTextTextureSize) &&
        canFitTextureItems(scene.textGlyphCount + 1, maxTextTextureSize) &&
        canFitTextureItems(
          scene.textGlyphSegmentCount + TEXT_LOD_SOLID_GLYPH_SEGMENT_COUNT,
          maxTextTextureSize
        );
      if (fitsGpuTextures && data.combinedInstanceCount <= 16_777_216) {
        textLodUploadData = data;
        this.textLodGpuActive = true;
      } else {
        this.textLodRuntime?.setResourceFallback("resource-capacity");
      }
    }
    let textTextureStats;
    try {
      textTextureStats = this.uploadTextData(scene, textLodUploadData);
    } catch (error) {
      if (!textLodUploadData) {
        throw error;
      }
      this.textLodRuntime?.setResourceFallback("resource-capacity");
      this.textLodGpuActive = false;
      textLodUploadData = null;
      textTextureStats = this.uploadTextData(scene, null);
    }
    this.sceneStats = {
      gridWidth: this.grid?.gridWidth ?? 0,
      gridHeight: this.grid?.gridHeight ?? 0,
      gridIndexCount: this.grid?.indices.length ?? 0,
      maxCellPopulation: this.grid?.maxCellPopulation ?? 0,
      fillPathTextureWidth: fillTextureStats.pathMetaTextureWidth,
      fillPathTextureHeight: fillTextureStats.pathMetaTextureHeight,
      fillSegmentTextureWidth: fillTextureStats.segmentTextureWidth,
      fillSegmentTextureHeight: fillTextureStats.segmentTextureHeight,
      textureWidth: textureStats.textureWidth,
      textureHeight: textureStats.textureHeight,
      maxTextureSize: textureStats.maxTextureSize,
      textInstanceTextureWidth: textTextureStats.instanceTextureWidth,
      textInstanceTextureHeight: textTextureStats.instanceTextureHeight,
      textGlyphTextureWidth: textTextureStats.glyphMetaTextureWidth,
      textGlyphTextureHeight: textTextureStats.glyphMetaTextureHeight,
      textSegmentTextureWidth: textTextureStats.glyphSegmentTextureWidth,
      textSegmentTextureHeight: textTextureStats.glyphSegmentTextureHeight
    };

    this.allSegmentIds = new Float32Array(this.segmentCount);
    for (let i = 0; i < this.segmentCount; i += 1) {
      this.allSegmentIds[i] = i;
    }

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.allSegmentIdBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.allSegmentIds, this.gl.STATIC_DRAW);

    this.allFillPathIds = new Float32Array(this.fillPathCount);
    for (let i = 0; i < this.fillPathCount; i += 1) {
      this.allFillPathIds[i] = i;
    }

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.allFillPathIdBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.allFillPathIds, this.gl.STATIC_DRAW);

    // Ordinary exact-range draws never address the coarse suffix. Clustered
    // LOD uses selectedTextInstanceIdBuffer instead, so keeping this identity
    // buffer exact-sized avoids an optional LOD allocation defeating the
    // exact-resource fallback above.
    this.allTextInstanceIds = new Float32Array(this.textInstanceCount);
    for (let i = 0; i < this.textInstanceCount; i += 1) {
      this.allTextInstanceIds[i] = i;
    }

    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.allTextInstanceIdBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, this.allTextInstanceIds, this.gl.STATIC_DRAW);

    if (this.visibleSegmentIds.length < this.segmentCount) {
      this.visibleSegmentIds = new Float32Array(this.segmentCount);
    }

    if (this.segmentMarks.length < this.segmentCount) {
      this.segmentMarks = new Uint32Array(this.segmentCount);
      this.markToken = 1;
    }

    this.visibleSegmentCount = this.segmentCount;
    this.usingAllSegments = true;
    this.setAllPagesAndTextVisible();

    this.minZoom = 0.01;
    this.maxZoom = 8_192;
    // WebGL can underperform when forcing a full-scene uncull on first frame; start with normal culling.
    this.hasCameraInteractionSinceSceneLoad = true;
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

    const resolvedZoom = clamp(nextZoom, this.minZoom, this.maxZoom);
    const stateChanged =
      Math.abs(this.cameraCenterX - nextCenterX) > 1e-6 ||
      Math.abs(this.cameraCenterY - nextCenterY) > 1e-6 ||
      Math.abs(this.zoom - resolvedZoom) > 1e-6;
    if (!stateChanged && options.preservePanCache === true) {
      const nextInteracting = options.interacting === true;
      if (this.isPanInteracting !== nextInteracting) {
        this.isPanInteracting = nextInteracting;
        if (!nextInteracting) {
          this.needsVisibleSetUpdate = true;
        }
      }
      return;
    }

    this.cameraCenterX = nextCenterX;
    this.cameraCenterY = nextCenterY;
    this.zoom = resolvedZoom;
    this.targetCameraCenterX = nextCenterX;
    this.targetCameraCenterY = nextCenterY;
    this.targetZoom = resolvedZoom;
    this.lastCameraAnimationTimeMs = 0;
    this.hasZoomAnchor = false;
    if (options.preservePanCache === true) {
      this.isPanInteracting = options.interacting === true;
    } else {
      this.isPanInteracting = false;
      this.panCacheValid = false;
    }
    this.presentedCameraCenterX = this.cameraCenterX;
    this.presentedCameraCenterY = this.cameraCenterY;
    this.presentedZoom = this.zoom;
    this.needsVisibleSetUpdate = true;
    if (options.scheduleFrame !== false) {
      this.requestFrame();
    }
  }

  setSearchHighlights(highlights: SearchHighlightSet | null): void {
    if (this.isDisposed) {
      return;
    }
    const gl = this.gl;
    const count = highlights ? Math.min(Math.max(0, highlights.count), Math.floor(highlights.rects.length / 4)) : 0;
    if (!highlights || count === 0) {
      if (this.highlightOthersCount !== 0 || this.highlightHasCurrent) {
        this.highlightOthersCount = 0;
        this.highlightHasCurrent = false;
        this.requestFrame();
      }
      return;
    }

    const rects = highlights.rects;
    const currentIndex = highlights.currentIndex >= 0 && highlights.currentIndex < count ? highlights.currentIndex : -1;
    const othersCount = currentIndex >= 0 ? count - 1 : count;

    const others = new Float32Array(othersCount * 4);
    let cursor = 0;
    for (let i = 0; i < count; i += 1) {
      if (i === currentIndex) {
        continue;
      }
      others.set(rects.subarray(i * 4, i * 4 + 4), cursor * 4);
      cursor += 1;
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, this.highlightOthersBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, others, gl.DYNAMIC_DRAW);
    if (currentIndex >= 0) {
      gl.bindBuffer(gl.ARRAY_BUFFER, this.highlightCurrentBuffer);
      gl.bufferData(gl.ARRAY_BUFFER, rects.subarray(currentIndex * 4, currentIndex * 4 + 4), gl.DYNAMIC_DRAW);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.highlightOthersCount = othersCount;
    this.highlightHasCurrent = currentIndex >= 0;
    this.requestFrame();
  }

  setTextSelectionHighlights(rects: Float32Array | null): void {
    if (this.isDisposed) {
      return;
    }
    const count = rects ? Math.floor(rects.length / 4) : 0;
    if (!rects || count === 0) {
      if (this.highlightSelectionCount !== 0) {
        this.highlightSelectionCount = 0;
        this.requestFrame();
      }
      return;
    }

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.highlightSelectionBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, rects.subarray(0, count * 4), gl.DYNAMIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);

    this.highlightSelectionCount = count;
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

  dispose(): void {
    if (this.isDisposed) {
      return;
    }
    this.isDisposed = true;

    if (this.rafHandle !== 0) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }
    this.externalFrameDriver = true;
    this.frameListener = null;
    this.interactionViewportProvider = null;
    this.destroyPanCacheResources();
    this.destroyVectorMinifyResources();
    this.destroyVectorLodResources();
    const gl = this.gl;
    this.destroyRasterLayerTextures();
    this.rasterLayers = [];

    const textures: WebGLTexture[] = [
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
      this.pageBackgroundTexture,
      ...this.gradientMetaTextures,
      this.gradientLutTexture,
      ...this.gradientFillTextures,
      ...this.gradientStrokeTextures
    ];
    for (const texture of textures) {
      gl.deleteTexture(texture);
    }

    const buffers: WebGLBuffer[] = [
      this.cornerBuffer,
      this.allSegmentIdBuffer,
      this.visibleSegmentIdBuffer,
      this.allFillPathIdBuffer,
      this.allTextInstanceIdBuffer,
      this.selectedTextInstanceIdBuffer,
      this.highlightOthersBuffer,
      this.highlightCurrentBuffer,
      this.highlightSelectionBuffer
    ];
    for (const buffer of buffers) {
      gl.deleteBuffer(buffer);
    }

    const vaos: WebGLVertexArrayObject[] = [
      this.segmentVao,
      this.fillVao,
      this.gradientPaintVao,
      this.textVao,
      this.blitVao,
      this.highlightOthersVao,
      this.highlightCurrentVao,
      this.highlightSelectionVao
    ];
    for (const vao of vaos) {
      gl.deleteVertexArray(vao);
    }

    const programs: WebGLProgram[] = [
      this.segmentProgram,
      this.fillProgram,
      this.gradientFillProgram,
      this.gradientStrokeProgram,
      this.textProgram,
      this.blitProgram,
      this.vectorCompositeProgram,
      this.rasterProgram,
      this.highlightProgram
    ];
    for (const program of programs) {
      gl.deleteProgram(program);
    }

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
    gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.useProgram(null);
    for (let unit = 0; unit <= 13; unit += 1) {
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, null);
    }
    gl.activeTexture(gl.TEXTURE0);

    this.scene = null;
    this.grid = null;
    this.sceneStats = null;
    this.pageRects = new Float32Array(0);
    this.pageTextRanges = new Uint32Array(0);
    this.visiblePageRectIndices = new Uint32Array(0);
    this.visibleTextRanges = [];
    this.textLodRuntime?.dispose();
    this.textLodRuntime = null;
    this.textLodGpuActive = false;
    this.selectedTextInstanceIds = new Float32Array(0);
    this.selectedTextInstanceCount = 0;
    this.gradientData = null;
    this.orderedGradientPaintCommands = [];
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

  requestFrame(): void {
    if (this.externalFrameDriver) {
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
    const gl = this.gl;
    this.ensureRenderState();

    if (
      !this.scene ||
      (this.fillPathCount === 0 &&
        this.segmentCount === 0 &&
        this.textInstanceCount === 0 &&
        (this.gradientData?.gradientFillPathCount ?? 0) === 0 &&
        (this.gradientData?.gradientStrokeRunCount ?? 0) === 0 &&
        this.rasterLayers.length === 0 &&
        this.pageRects.length === 0)
    ) {
      gl.bindFramebuffer(gl.FRAMEBUFFER, null);
      gl.viewport(0, 0, this.canvas.width, this.canvas.height);
      gl.clearColor(CLEAR_COLOR_R, CLEAR_COLOR_G, CLEAR_COLOR_B, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);
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

    if (this.shouldUsePanCache(isCameraAnimating)) {
      this.renderWithPanCache();
    } else {
      this.renderDirectToScreen();
    }
    // Drawn last with the live camera so highlights can never lag the scene,
    // and never bake into the pan cache.
    this.drawSearchHighlights(this.canvas.width, this.canvas.height, this.cameraCenterX, this.cameraCenterY);
    this.capturePresentedFrameState();

    if (isCameraAnimating) {
      this.requestFrame();
    }
  }

  private capturePresentedFrameState(): void {
    this.presentedCameraCenterX = this.cameraCenterX;
    this.presentedCameraCenterY = this.cameraCenterY;
    this.presentedZoom = this.zoom;
    this.presentedFrameSerial += 1;
  }

  /**
   * A book-like scene: enough glyphs to benefit from cached panning even though
   * it does not meet the ordinary stroke-count threshold. The shared direct
   * rendering policy keeps its cached and settled coverage scale consistent.
   */
  private isTextHeavyStrokeFreeScene(): boolean {
    return isNativeTextHeavyStrokeFreeScene(this.textInstanceCount, this.segmentCount);
  }

  private shouldUsePanCache(isCameraAnimating: boolean): boolean {
    if (this.vectorLodRuntime) {
      return false;
    }
    if (this.segmentCount < PAN_CACHE_MIN_SEGMENTS && !this.isTextHeavyStrokeFreeScene()) {
      return false;
    }
    if (this.isPanInteracting) {
      return true;
    }
    return isCameraAnimating;
  }

  private renderDirectToScreen(): void {
    const gl = this.gl;
    let useVectorMinify = this.shouldUseVectorMinifyPath() && this.ensureVectorMinifyResources();
    // Keep still/moving appearance consistent on large pan-optimized scenes.
    // Pan-cache path renders vectors directly; matching that avoids thickness shifts while camera moves.
    if (this.segmentCount >= PAN_CACHE_MIN_SEGMENTS) {
      useVectorMinify = false;
    }

    // WebGL drivers can produce a transient thin/missing first composite frame
    // right after creating the minify target. Warm up with one direct frame.
    if (useVectorMinify && this.vectorMinifyWarmupPending) {
      useVectorMinify = false;
      this.vectorMinifyWarmupPending = false;
      this.needsVisibleSetUpdate = true;
      this.requestFrame();
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(CLEAR_COLOR_R, CLEAR_COLOR_G, CLEAR_COLOR_B, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

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

    let instanceCount = 0;
    if (useVectorMinify) {
      const minifyPlan = this.getOrderedGradientMinifyPlan();
      if (minifyPlan.splitOrderedGradientPrefix) {
        // Sparse native gradients participate in PDF paint order with raster
        // layers, while ordinary fills/strokes/text are guaranteed to follow
        // them by extraction. Draw the interleaved prefix directly, then
        // composite only the supersampled ordinary-vector layer.
        this.drawOrderedGradientPaint(
          this.canvas.width,
          this.canvas.height,
          this.cameraCenterX,
          this.cameraCenterY
        );
      } else if (this.rasterRenderingEnabled) {
        // When no raster follows a gradient, keep native gradients in the
        // supersampled vector layer so thin gradient strokes retain their AA.
        this.drawRasterLayer(this.canvas.width, this.canvas.height, this.cameraCenterX, this.cameraCenterY);
      }
      instanceCount = this.renderVectorLayerIntoMinifyTarget(
        this.vectorMinifyWidth,
        this.vectorMinifyHeight,
        this.cameraCenterX,
        this.cameraCenterY,
        minifyPlan.includeGradientPaint
      );
      this.compositeVectorMinifyLayer();
    } else {
      this.drawOrderedGradientPaint(this.canvas.width, this.canvas.height, this.cameraCenterX, this.cameraCenterY);
      if (this.fillRenderingEnabled) {
        this.drawFilledPaths(this.canvas.width, this.canvas.height, this.cameraCenterX, this.cameraCenterY);
      }
      if (this.strokeRenderingEnabled) {
        instanceCount = this.drawVisibleSegments(this.canvas.width, this.canvas.height, this.cameraCenterX, this.cameraCenterY);
      }
      if (this.textRenderingEnabled) {
        this.drawTextInstances(this.canvas.width, this.canvas.height, this.cameraCenterX, this.cameraCenterY);
      }
    }

    this.frameListener?.({
      renderedSegments: instanceCount,
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

  private ensureVectorMinifyResources(): boolean {
    const gl = this.gl;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
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
      this.vectorMinifyFramebuffer &&
      this.vectorMinifyWidth === desiredWidth &&
      this.vectorMinifyHeight === desiredHeight
    ) {
      return true;
    }

    this.destroyVectorMinifyResources();

    const texture = gl.createTexture();
    if (!texture) {
      return false;
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    configureVectorMinifyTexture(gl);
    gl.texStorage2D(gl.TEXTURE_2D, 1, gl.RGBA8, desiredWidth, desiredHeight);

    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) {
      gl.deleteTexture(texture);
      return false;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      return false;
    }

    this.vectorMinifyTexture = texture;
    this.vectorMinifyFramebuffer = framebuffer;
    this.vectorMinifyWidth = desiredWidth;
    this.vectorMinifyHeight = desiredHeight;
    this.vectorMinifyWarmupPending = true;
    return true;
  }

  private renderVectorLayerIntoMinifyTarget(
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    includeGradientPaint: boolean
  ): number {
    if (!this.vectorMinifyFramebuffer || !this.vectorMinifyTexture) {
      return 0;
    }

    const gl = this.gl;
    const effectiveZoom = this.computeVectorMinifyZoom(viewportWidth, viewportHeight);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.vectorMinifyFramebuffer);
    gl.viewport(0, 0, viewportWidth, viewportHeight);
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    // Offscreen vector layer needs straight-alpha color blending with correct alpha accumulation.
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    if (includeGradientPaint) {
      this.drawOrderedGradientVectors(viewportWidth, viewportHeight, cameraCenterX, cameraCenterY, effectiveZoom);
    }

    if (this.fillRenderingEnabled) {
      this.drawFilledPaths(viewportWidth, viewportHeight, cameraCenterX, cameraCenterY, effectiveZoom);
    }
    const instanceCount = this.strokeRenderingEnabled
      ? this.drawVisibleSegments(viewportWidth, viewportHeight, cameraCenterX, cameraCenterY, effectiveZoom)
      : 0;
    if (this.textRenderingEnabled) {
      this.drawTextInstances(
        viewportWidth,
        viewportHeight,
        cameraCenterX,
        cameraCenterY,
        effectiveZoom,
        {
          viewportWidth: this.canvas.width,
          viewportHeight: this.canvas.height,
          cameraCenterX,
          cameraCenterY,
          zoom: this.zoom
        }
      );
    }

    gl.bindTexture(gl.TEXTURE_2D, this.vectorMinifyTexture);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    return instanceCount;
  }

  private compositeVectorMinifyLayer(): void {
    if (!this.vectorMinifyTexture) {
      return;
    }

    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.useProgram(this.vectorCompositeProgram);
    gl.bindVertexArray(this.blitVao);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.vectorMinifyTexture);
    gl.uniform1i(this.uVectorLayerTex, 0);
    gl.uniform2f(this.uVectorLayerViewportPx, this.canvas.width, this.canvas.height);

    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
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

      const gl = this.gl;
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.panCacheFramebuffer);
      gl.viewport(0, 0, this.panCacheWidth, this.panCacheHeight);
      gl.clearColor(CLEAR_COLOR_R, CLEAR_COLOR_G, CLEAR_COLOR_B, 1);
      gl.clear(gl.COLOR_BUFFER_BIT);

      this.drawOrderedGradientPaint(
        this.panCacheWidth,
        this.panCacheHeight,
        this.panCacheCenterX,
        this.panCacheCenterY
      );
      if (this.fillRenderingEnabled) {
        this.drawFilledPaths(
          this.panCacheWidth,
          this.panCacheHeight,
          this.panCacheCenterX,
          this.panCacheCenterY
        );
      }
      this.panCacheRenderedSegments = this.strokeRenderingEnabled
        ? this.drawVisibleSegments(
          this.panCacheWidth,
          this.panCacheHeight,
          this.panCacheCenterX,
          this.panCacheCenterY
        )
        : 0;
      if (this.textRenderingEnabled) {
        this.drawTextInstances(
          this.panCacheWidth,
          this.panCacheHeight,
          this.panCacheCenterX,
          this.panCacheCenterY
        );
      }
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

  private drawOrderedGradientPaint(
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoomValue = this.zoom
  ): void {
    if (this.rasterRenderingEnabled) {
      this.drawPageBackgrounds(viewportWidth, viewportHeight, cameraCenterX, cameraCenterY, zoomValue);
    }
    let rasterStatePrepared = false;
    for (const command of this.orderedGradientPaintCommands) {
      if (command.kind === "raster") {
        if (this.rasterRenderingEnabled) {
          if (!rasterStatePrepared) {
            this.prepareRasterProgram(viewportWidth, viewportHeight, cameraCenterX, cameraCenterY, zoomValue);
            this.gl.blendFuncSeparate(
              this.gl.ONE,
              this.gl.ONE_MINUS_SRC_ALPHA,
              this.gl.ONE,
              this.gl.ONE_MINUS_SRC_ALPHA
            );
            rasterStatePrepared = true;
          }
          this.drawRasterLayerAtIndex(
            command.index,
            viewportWidth,
            viewportHeight,
            cameraCenterX,
            cameraCenterY,
            zoomValue,
            true
          );
        }
      } else if (command.kind === "gradient-fill") {
        if (rasterStatePrepared) {
          this.gl.blendFuncSeparate(
            this.gl.SRC_ALPHA,
            this.gl.ONE_MINUS_SRC_ALPHA,
            this.gl.ONE,
            this.gl.ONE_MINUS_SRC_ALPHA
          );
          rasterStatePrepared = false;
        }
        if (this.fillRenderingEnabled) {
          this.drawGradientFillPath(command.index, viewportWidth, viewportHeight, cameraCenterX, cameraCenterY, zoomValue);
        }
      } else if (this.strokeRenderingEnabled) {
        if (rasterStatePrepared) {
          this.gl.blendFuncSeparate(
            this.gl.SRC_ALPHA,
            this.gl.ONE_MINUS_SRC_ALPHA,
            this.gl.ONE,
            this.gl.ONE_MINUS_SRC_ALPHA
          );
          rasterStatePrepared = false;
        }
        this.drawGradientStrokeRun(command.index, viewportWidth, viewportHeight, cameraCenterX, cameraCenterY, zoomValue);
      } else {
        if (rasterStatePrepared) {
          this.gl.blendFuncSeparate(
            this.gl.SRC_ALPHA,
            this.gl.ONE_MINUS_SRC_ALPHA,
            this.gl.ONE,
            this.gl.ONE_MINUS_SRC_ALPHA
          );
          rasterStatePrepared = false;
        }
      }
    }
    if (rasterStatePrepared) {
      this.gl.blendFuncSeparate(
        this.gl.SRC_ALPHA,
        this.gl.ONE_MINUS_SRC_ALPHA,
        this.gl.ONE,
        this.gl.ONE_MINUS_SRC_ALPHA
      );
    }
  }

  private drawOrderedGradientVectors(
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoomValue: number
  ): void {
    for (const command of this.orderedGradientPaintCommands) {
      if (command.kind === "gradient-fill" && this.fillRenderingEnabled) {
        this.drawGradientFillPath(command.index, viewportWidth, viewportHeight, cameraCenterX, cameraCenterY, zoomValue);
      } else if (command.kind === "gradient-stroke" && this.strokeRenderingEnabled) {
        this.drawGradientStrokeRun(command.index, viewportWidth, viewportHeight, cameraCenterX, cameraCenterY, zoomValue);
      }
    }
  }

  private drawGradientFillPath(
    pathIndex: number,
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoomValue: number
  ): void {
    const data = this.gradientData;
    if (!data || pathIndex < 0 || pathIndex >= data.gradientFillPathCount) {
      return;
    }
    const gl = this.gl;
    const uniforms = this.gradientFillUniforms;
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.gradientFillProgram);
    gl.bindVertexArray(this.gradientPaintVao);

    for (let index = 0; index < this.gradientFillTextures.length; index += 1) {
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, this.gradientFillTextures[index]);
    }
    for (let index = 0; index < this.gradientMetaTextures.length; index += 1) {
      gl.activeTexture(gl.TEXTURE6 + index);
      gl.bindTexture(gl.TEXTURE_2D, this.gradientMetaTextures[index]);
    }
    gl.activeTexture(gl.TEXTURE11);
    gl.bindTexture(gl.TEXTURE_2D, this.gradientLutTexture);

    gl.uniform1i(uniforms.uPathMetaTexA, 0);
    gl.uniform1i(uniforms.uPathMetaTexB, 1);
    gl.uniform1i(uniforms.uPathMetaTexC, 2);
    gl.uniform1i(uniforms.uPaintMetaTex, 3);
    gl.uniform1i(uniforms.uSegmentTexA, 4);
    gl.uniform1i(uniforms.uSegmentTexB, 5);
    this.setGradientUniforms(uniforms, 6, 11);
    gl.uniform2i(uniforms.uPathMetaTexSize, this.gradientFillPathTextureWidth, this.gradientFillPathTextureHeight);
    gl.uniform2i(uniforms.uSegmentTexSize, this.gradientFillSegmentTextureWidth, this.gradientFillSegmentTextureHeight);
    this.setGradientViewUniforms(uniforms, viewportWidth, viewportHeight, cameraCenterX, cameraCenterY, zoomValue);
    gl.uniform1f(uniforms.uAAScreenPx, 1);
    gl.uniform4f(
      uniforms.uVectorOverride,
      this.vectorOverrideColor[0],
      this.vectorOverrideColor[1],
      this.vectorOverrideColor[2],
      this.vectorOverrideOpacity
    );
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, pathIndex * 4, 4, 1);
  }

  private drawGradientStrokeRun(
    runIndex: number,
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoomValue: number
  ): void {
    const data = this.gradientData;
    if (!data || runIndex < 0 || runIndex >= data.gradientStrokeRunCount) {
      return;
    }
    const segmentCount = Math.max(0, Math.trunc(data.gradientStrokeRunMetaA[runIndex * 4 + 1] ?? 0));
    if (segmentCount === 0) {
      return;
    }
    const gl = this.gl;
    const uniforms = this.gradientStrokeUniforms;
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    gl.useProgram(this.gradientStrokeProgram);
    gl.bindVertexArray(this.gradientPaintVao);

    for (let index = 0; index < this.gradientStrokeTextures.length; index += 1) {
      gl.activeTexture(gl.TEXTURE0 + index);
      gl.bindTexture(gl.TEXTURE_2D, this.gradientStrokeTextures[index]);
    }
    for (let index = 0; index < this.gradientMetaTextures.length; index += 1) {
      gl.activeTexture(gl.TEXTURE5 + index);
      gl.bindTexture(gl.TEXTURE_2D, this.gradientMetaTextures[index]);
    }
    gl.activeTexture(gl.TEXTURE10);
    gl.bindTexture(gl.TEXTURE_2D, this.gradientLutTexture);

    gl.uniform1i(uniforms.uRunMetaTexA, 0);
    gl.uniform1i(uniforms.uEndpointsTex, 1);
    gl.uniform1i(uniforms.uPrimitiveMetaTex, 2);
    gl.uniform1i(uniforms.uPrimitiveBoundsTex, 3);
    gl.uniform1i(uniforms.uStylesTex, 4);
    this.setGradientUniforms(uniforms, 5, 10);
    gl.uniform2i(uniforms.uRunMetaTexSize, this.gradientStrokeRunTextureWidth, this.gradientStrokeRunTextureHeight);
    gl.uniform2i(uniforms.uSegmentTexSize, this.gradientStrokeSegmentTextureWidth, this.gradientStrokeSegmentTextureHeight);
    this.setGradientViewUniforms(uniforms, viewportWidth, viewportHeight, cameraCenterX, cameraCenterY, zoomValue);
    gl.uniform1f(uniforms.uAAScreenPx, 0.9);
    gl.uniform1f(uniforms.uLocalUnitsPerPixel, this.localToClipRenderingEnabled ? this.localUnitsPerPixel : 1 / Math.max(zoomValue, 1e-6));
    gl.uniform1f(uniforms.uStrokeCurveEnabled, this.strokeCurveEnabled ? 1 : 0);
    gl.uniform4f(
      uniforms.uVectorOverride,
      this.vectorOverrideColor[0],
      this.vectorOverrideColor[1],
      this.vectorOverrideColor[2],
      this.vectorOverrideOpacity
    );
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, runIndex * 4, 4, segmentCount);
  }

  private setGradientUniforms(
    uniforms: Readonly<Record<string, WebGLUniformLocation>>,
    firstMetaUnit: number,
    lutUnit: number
  ): void {
    const gl = this.gl;
    gl.uniform1i(uniforms.uGradientMetaTexA, firstMetaUnit);
    gl.uniform1i(uniforms.uGradientMetaTexB, firstMetaUnit + 1);
    gl.uniform1i(uniforms.uGradientMetaTexC, firstMetaUnit + 2);
    gl.uniform1i(uniforms.uGradientMetaTexD, firstMetaUnit + 3);
    gl.uniform1i(uniforms.uGradientMetaTexE, firstMetaUnit + 4);
    gl.uniform1i(uniforms.uGradientLutTex, lutUnit);
    gl.uniform2i(uniforms.uGradientMetaTexSize, this.gradientTextureWidth, this.gradientTextureHeight);
    gl.uniform1i(uniforms.uGradientCount, this.gradientData?.gradientCount ?? 0);
  }

  private setGradientViewUniforms(
    uniforms: Readonly<Record<string, WebGLUniformLocation>>,
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoomValue: number
  ): void {
    const gl = this.gl;
    gl.uniform2f(uniforms.uViewport, viewportWidth, viewportHeight);
    gl.uniform2f(uniforms.uCameraCenter, cameraCenterX, cameraCenterY);
    gl.uniform1f(uniforms.uZoom, zoomValue);
    gl.uniform1f(uniforms.uUseLocalToClip, this.localToClipRenderingEnabled ? 1 : 0);
    if (this.localToClipRenderingEnabled) {
      gl.uniformMatrix4fv(uniforms.uLocalToClip, false, this.localToClipMatrix);
    }
  }

  private prepareRasterProgram(
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoomValue: number
  ): void {
    const gl = this.gl;
    gl.useProgram(this.rasterProgram);
    gl.bindVertexArray(this.blitVao);
    gl.uniform2f(this.uRasterViewport, viewportWidth, viewportHeight);
    gl.uniform2f(this.uRasterCameraCenter, cameraCenterX, cameraCenterY);
    gl.uniform1f(this.uRasterZoom, zoomValue);
    gl.uniform1f(this.uRasterUseLocalToClip, this.localToClipRenderingEnabled ? 1 : 0);
    if (this.localToClipRenderingEnabled) {
      gl.uniformMatrix4fv(this.uRasterLocalToClip, false, this.localToClipMatrix);
    }
  }

  private drawPageBackgrounds(
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoomValue: number
  ): void {
    if (this.pageRects.length === 0 || this.visiblePageRectCount === 0) {
      return;
    }
    const gl = this.gl;
    this.prepareRasterProgram(viewportWidth, viewportHeight, cameraCenterX, cameraCenterY, zoomValue);
    gl.activeTexture(gl.TEXTURE12);
    gl.bindTexture(gl.TEXTURE_2D, this.pageBackgroundTexture);
    gl.uniform1i(this.uRasterTex, 12);
    for (let i = 0; i < this.visiblePageRectCount; i += 1) {
      const rectOffset = this.visiblePageRectIndices[i] * 4;
      const minX = this.pageRects[rectOffset];
      const minY = this.pageRects[rectOffset + 1];
      const width = Math.max(this.pageRects[rectOffset + 2] - minX, 1e-6);
      const height = Math.max(this.pageRects[rectOffset + 3] - minY, 1e-6);
      gl.uniform4f(this.uRasterMatrixABCD, width, 0, 0, height);
      gl.uniform2f(this.uRasterMatrixEF, minX, minY);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
  }

  private drawRasterLayerAtIndex(
    layerIndex: number,
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoomValue: number,
    statePrepared = false
  ): void {
    const layer = this.rasterLayers[layerIndex];
    if (!layer) {
      return;
    }
    const gl = this.gl;
    if (!statePrepared) {
      this.prepareRasterProgram(viewportWidth, viewportHeight, cameraCenterX, cameraCenterY, zoomValue);
      gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
    gl.activeTexture(gl.TEXTURE12);
    gl.bindTexture(gl.TEXTURE_2D, layer.texture);
    gl.uniform1i(this.uRasterTex, 12);
    gl.uniform4f(this.uRasterMatrixABCD, layer.matrix[0], layer.matrix[1], layer.matrix[2], layer.matrix[3]);
    gl.uniform2f(this.uRasterMatrixEF, layer.matrix[4], layer.matrix[5]);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    if (!statePrepared) {
      gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    }
  }

  private drawRasterLayer(
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoomValue = this.zoom
  ): void {
    if (this.rasterLayers.length === 0 && this.pageRects.length === 0) {
      return;
    }

    const gl = this.gl;
    this.drawPageBackgrounds(viewportWidth, viewportHeight, cameraCenterX, cameraCenterY, zoomValue);

    if (this.rasterLayers.length === 0) {
      return;
    }

    this.prepareRasterProgram(viewportWidth, viewportHeight, cameraCenterX, cameraCenterY, zoomValue);
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (const command of this.orderedGradientPaintCommands) {
      if (command.kind === "raster") {
        this.drawRasterLayerAtIndex(
          command.index,
          viewportWidth,
          viewportHeight,
          cameraCenterX,
          cameraCenterY,
          zoomValue,
          true
        );
      }
    }
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  /**
   * Draws search highlights with the live camera uniforms in the same frame
   * as the scene, on top of all content and outside any cached layer.
   */
  private drawSearchHighlights(
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoomValue = this.zoom
  ): void {
    if (this.highlightOthersCount === 0 && !this.highlightHasCurrent && this.highlightSelectionCount === 0) {
      return;
    }

    const gl = this.gl;
    gl.useProgram(this.highlightProgram);
    gl.uniform2f(this.uHighlightViewport, viewportWidth, viewportHeight);
    gl.uniform2f(this.uHighlightCameraCenter, cameraCenterX, cameraCenterY);
    gl.uniform1f(this.uHighlightZoom, zoomValue);
    gl.uniform1f(this.uHighlightMinSizePx, HIGHLIGHT_MIN_SIZE_PX);
    gl.uniform1f(this.uHighlightUseLocalToClip, this.localToClipRenderingEnabled ? 1 : 0);
    if (this.localToClipRenderingEnabled) {
      gl.uniformMatrix4fv(this.uHighlightLocalToClip, false, this.localToClipMatrix);
    }

    // Selection first so the search current-match ring stays visible on top.
    if (this.highlightSelectionCount > 0) {
      gl.bindVertexArray(this.highlightSelectionVao);
      this.drawHighlightBatch(this.highlightSelectionCount, HIGHLIGHT_SELECTION_FILL, HIGHLIGHT_SELECTION_BORDER, HIGHLIGHT_SELECTION_BORDER_PX);
    }
    if (this.highlightOthersCount > 0) {
      gl.bindVertexArray(this.highlightOthersVao);
      this.drawHighlightBatch(this.highlightOthersCount, HIGHLIGHT_OTHER_FILL, HIGHLIGHT_OTHER_BORDER, HIGHLIGHT_OTHER_BORDER_PX);
    }
    if (this.highlightHasCurrent) {
      gl.bindVertexArray(this.highlightCurrentVao);
      this.drawHighlightBatch(1, HIGHLIGHT_CURRENT_FILL, HIGHLIGHT_CURRENT_BORDER, HIGHLIGHT_CURRENT_BORDER_PX);
    }
    gl.bindVertexArray(null);
  }

  private drawHighlightBatch(
    instanceCount: number,
    fillColor: readonly number[],
    borderColor: readonly number[],
    borderPx: number
  ): void {
    const gl = this.gl;
    gl.uniform4f(this.uHighlightFillColor, fillColor[0], fillColor[1], fillColor[2], fillColor[3]);
    gl.uniform4f(this.uHighlightBorderColor, borderColor[0], borderColor[1], borderColor[2], borderColor[3]);
    gl.uniform1f(this.uHighlightBorderPx, borderPx);
    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instanceCount);
  }

  private drawFilledPaths(
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoomValue = this.zoom
  ): number {
    if (!this.scene || this.fillPathCount <= 0) {
      return 0;
    }

    const gl = this.gl;

    gl.useProgram(this.fillProgram);
    gl.bindVertexArray(this.fillVao);

    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, this.fillPathMetaTextureA);
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, this.fillPathMetaTextureB);
    gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_2D, this.fillPathMetaTextureC);
    gl.activeTexture(gl.TEXTURE10);
    gl.bindTexture(gl.TEXTURE_2D, this.fillSegmentTextureA);
    gl.activeTexture(gl.TEXTURE11);
    gl.bindTexture(gl.TEXTURE_2D, this.fillSegmentTextureB);

    gl.uniform1i(this.uFillPathMetaTexA, 7);
    gl.uniform1i(this.uFillPathMetaTexB, 8);
    gl.uniform1i(this.uFillPathMetaTexC, 9);
    gl.uniform1i(this.uFillSegmentTexA, 10);
    gl.uniform1i(this.uFillSegmentTexB, 11);
    gl.uniform2i(this.uFillPathMetaTexSize, this.fillPathMetaTextureWidth, this.fillPathMetaTextureHeight);
    gl.uniform2i(this.uFillSegmentTexSize, this.fillSegmentTextureWidth, this.fillSegmentTextureHeight);
    gl.uniform2f(this.uFillViewport, viewportWidth, viewportHeight);
    gl.uniform2f(this.uFillCameraCenter, cameraCenterX, cameraCenterY);
    gl.uniform1f(this.uFillZoom, zoomValue);
    gl.uniform1f(this.uFillAAScreenPx, 1);
    gl.uniform1f(this.uFillUseLocalToClip, this.localToClipRenderingEnabled ? 1 : 0);
    if (this.localToClipRenderingEnabled) {
      gl.uniformMatrix4fv(this.uFillLocalToClip, false, this.localToClipMatrix);
    }
    gl.uniform4f(
      this.uFillVectorOverride,
      this.vectorOverrideColor[0],
      this.vectorOverrideColor[1],
      this.vectorOverrideColor[2],
      this.vectorOverrideOpacity
    );

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.fillPathCount);
    return this.fillPathCount;
  }

  private drawVisibleSegments(
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoomValue = this.zoom
  ): number {
    if (this.vectorLodRuntime && this.vectorLodLevels.length > 0) {
      return this.drawVectorLodSegments(viewportWidth, viewportHeight, cameraCenterX, cameraCenterY, zoomValue);
    }

    const instanceCount = this.usingAllSegments ? this.segmentCount : this.visibleSegmentCount;
    if (instanceCount === 0) {
      return 0;
    }

    const segmentIdBuffer = this.usingAllSegments ? this.allSegmentIdBuffer : this.visibleSegmentIdBuffer;
    this.drawStrokeInstances(
      {
        textureA: this.segmentTextureA,
        textureB: this.segmentTextureB,
        textureC: this.segmentTextureC,
        textureD: this.segmentTextureD,
        textureWidth: this.segmentTextureWidth,
        textureHeight: this.segmentTextureHeight,
        ownsTextures: false
      },
      segmentIdBuffer,
      instanceCount,
      viewportWidth,
      viewportHeight,
      cameraCenterX,
      cameraCenterY,
      zoomValue
    );

    return instanceCount;
  }

  private drawVectorLodSegments(
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoomValue: number
  ): number {
    if (!this.vectorLodRuntime) {
      return 0;
    }

    let renderedSegments = 0;
    for (let i = 0; i < this.vectorLodRuntime.levels.length; i += 1) {
      const runtimeLevel = this.vectorLodRuntime.levels[i];
      const gpuLevel = this.vectorLodLevels[i];
      const instanceCount = Math.max(0, runtimeLevel.visibleSegmentCount | 0);
      if (!gpuLevel || instanceCount <= 0) {
        continue;
      }
      this.drawStrokeInstances(
        gpuLevel,
        gpuLevel.visibleSegmentIdBuffer,
        instanceCount,
        viewportWidth,
        viewportHeight,
        cameraCenterX,
        cameraCenterY,
        zoomValue
      );
      renderedSegments += instanceCount;
    }
    return renderedSegments;
  }

  private drawStrokeInstances(
    textureSet: StrokeTextureSet,
    segmentIdBuffer: WebGLBuffer,
    instanceCount: number,
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoomValue: number
  ): void {
    const gl = this.gl;

    gl.useProgram(this.segmentProgram);
    gl.bindVertexArray(this.segmentVao);

    gl.bindBuffer(gl.ARRAY_BUFFER, segmentIdBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 4, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, textureSet.textureA);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, textureSet.textureB);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, textureSet.textureC);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, textureSet.textureD);

    gl.uniform1i(this.uSegmentTexA, 0);
    gl.uniform1i(this.uSegmentTexB, 1);
    gl.uniform1i(this.uSegmentStyleTex, 2);
    gl.uniform1i(this.uSegmentBoundsTex, 3);
    gl.uniform2i(this.uSegmentTexSize, textureSet.textureWidth, textureSet.textureHeight);
    gl.uniform2f(this.uViewport, viewportWidth, viewportHeight);
    gl.uniform2f(this.uCameraCenter, cameraCenterX, cameraCenterY);
    gl.uniform1f(this.uZoom, zoomValue);
    gl.uniform1f(this.uAAScreenPx, 1);
    gl.uniform1f(this.uUseLocalToClip, this.localToClipRenderingEnabled ? 1 : 0);
    gl.uniform1f(this.uLocalUnitsPerPixel, this.localUnitsPerPixel);
    if (this.localToClipRenderingEnabled) {
      gl.uniformMatrix4fv(this.uLocalToClip, false, this.localToClipMatrix);
    }
    gl.uniform1f(this.uStrokeCurveEnabled, this.strokeCurveEnabled ? 1 : 0);
    gl.uniform4f(
      this.uStrokeVectorOverride,
      this.vectorOverrideColor[0],
      this.vectorOverrideColor[1],
      this.vectorOverrideColor[2],
      this.vectorOverrideOpacity
    );

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instanceCount);
  }

  private drawTextInstances(
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoomValue = this.zoom,
    textLodProjection?: {
      viewportWidth: number;
      viewportHeight: number;
      cameraCenterX: number;
      cameraCenterY: number;
      zoom: number;
    }
  ): number {
    if (!this.scene || this.textInstanceCount <= 0) {
      return 0;
    }

    const useTextLodSelection = this.updateTextLodSelection(
      textLodProjection?.viewportWidth ?? viewportWidth,
      textLodProjection?.viewportHeight ?? viewportHeight,
      textLodProjection?.cameraCenterX ?? cameraCenterX,
      textLodProjection?.cameraCenterY ?? cameraCenterY,
      textLodProjection?.zoom ?? zoomValue
    );
    if (useTextLodSelection ? this.selectedTextInstanceCount <= 0 : this.visibleTextRanges.length === 0) {
      return 0;
    }

    const gl = this.gl;

    gl.useProgram(this.textProgram);
    gl.bindVertexArray(this.textVao);
    gl.bindBuffer(
      gl.ARRAY_BUFFER,
      useTextLodSelection ? this.selectedTextInstanceIdBuffer : this.allTextInstanceIdBuffer
    );
    gl.enableVertexAttribArray(2);
    gl.vertexAttribDivisor(2, 1);

    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.textInstanceTextureA);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.textInstanceTextureB);
    gl.activeTexture(gl.TEXTURE4);
    gl.bindTexture(gl.TEXTURE_2D, this.textInstanceTextureC);
    gl.activeTexture(gl.TEXTURE5);
    gl.bindTexture(gl.TEXTURE_2D, this.textGlyphMetaTextureA);
    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, this.textGlyphMetaTextureB);
    gl.activeTexture(gl.TEXTURE7);
    gl.bindTexture(gl.TEXTURE_2D, this.textGlyphSegmentTextureA);
    gl.activeTexture(gl.TEXTURE8);
    gl.bindTexture(gl.TEXTURE_2D, this.textGlyphSegmentTextureB);
    gl.activeTexture(gl.TEXTURE9);
    gl.bindTexture(gl.TEXTURE_2D, this.textGlyphRasterMetaTexture);
    gl.activeTexture(gl.TEXTURE13);
    gl.bindTexture(gl.TEXTURE_2D, this.textRasterAtlasTexture);

    gl.uniform1i(this.uTextInstanceTexA, 2);
    gl.uniform1i(this.uTextInstanceTexB, 3);
    gl.uniform1i(this.uTextInstanceTexC, 4);
    gl.uniform1i(this.uTextGlyphMetaTexA, 5);
    gl.uniform1i(this.uTextGlyphMetaTexB, 6);
    gl.uniform1i(this.uTextGlyphSegmentTexA, 7);
    gl.uniform1i(this.uTextGlyphSegmentTexB, 8);
    gl.uniform1i(this.uTextGlyphRasterMetaTex, 9);
    gl.uniform1i(this.uTextRasterAtlasTex, 13);
    gl.uniform2i(this.uTextInstanceTexSize, this.textInstanceTextureWidth, this.textInstanceTextureHeight);
    gl.uniform2i(this.uTextGlyphMetaTexSize, this.textGlyphMetaTextureWidth, this.textGlyphMetaTextureHeight);
    gl.uniform2i(this.uTextGlyphSegmentTexSize, this.textGlyphSegmentTextureWidth, this.textGlyphSegmentTextureHeight);
    gl.uniform2f(this.uTextRasterAtlasSize, this.textRasterAtlasWidth, this.textRasterAtlasHeight);
    gl.uniform2f(this.uTextViewport, viewportWidth, viewportHeight);
    gl.uniform2f(this.uTextCameraCenter, cameraCenterX, cameraCenterY);
    gl.uniform1f(this.uTextZoom, zoomValue);
    gl.uniform1f(this.uTextAAScreenPx, 1.25);
    gl.uniform1f(this.uTextUseLocalToClip, this.localToClipRenderingEnabled ? 1 : 0);
    if (this.localToClipRenderingEnabled) {
      gl.uniformMatrix4fv(this.uTextLocalToClip, false, this.localToClipMatrix);
    }
    gl.uniform1f(this.uTextCurveEnabled, this.strokeCurveEnabled ? 1 : 0);
    gl.uniform1f(this.uTextVectorOnly, this.textVectorOnly ? 1 : 0);
    gl.uniform4f(
      this.uTextVectorOverride,
      this.vectorOverrideColor[0],
      this.vectorOverrideColor[1],
      this.vectorOverrideColor[2],
      this.vectorOverrideOpacity
    );

    if (useTextLodSelection) {
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 4, 0);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.selectedTextInstanceCount);
      return this.selectedTextInstanceCount;
    }
    return this.drawTextInstanceRanges(this.visibleTextRanges);
  }

  private updateTextLodSelection(
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoomValue: number
  ): boolean {
    const runtime = this.textLodRuntime;
    if (!runtime || !this.textLodGpuActive || this.textLodMode === "off") {
      return false;
    }

    const localToClip = this.localToClipRenderingEnabled
      ? this.localToClipMatrix
      : createOrthographicLocalToClip(
          cameraCenterX,
          cameraCenterY,
          zoomValue,
          viewportWidth,
          viewportHeight
        );
    const selection = runtime.update({
      localToClip,
      viewportWidth,
      viewportHeight
    });
    this.selectedTextInstanceCount = selection.instanceIds.length;
    if (!selection.changed) {
      return true;
    }

    if (this.selectedTextInstanceIds.length < selection.instanceIds.length) {
      this.selectedTextInstanceIds = new Float32Array(selection.instanceIds.length);
    }
    for (let i = 0; i < selection.instanceIds.length; i += 1) {
      this.selectedTextInstanceIds[i] = selection.instanceIds[i];
    }
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.selectedTextInstanceIdBuffer);
    this.gl.bufferData(
      this.gl.ARRAY_BUFFER,
      this.selectedTextInstanceIds.subarray(0, selection.instanceIds.length),
      this.gl.DYNAMIC_DRAW
    );
    return true;
  }

  private drawTextInstanceRanges(ranges: InstanceRange[]): number {
    const gl = this.gl;
    let renderedInstanceCount = 0;
    for (const range of ranges) {
      if (range.count <= 0) {
        continue;
      }
      gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 4, range.start * 4);
      gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, range.count);
      renderedInstanceCount += range.count;
    }
    return renderedInstanceCount;
  }

  private blitPanCache(offsetPxX: number, offsetPxY: number, sampleScale: number): void {
    if (!this.panCacheTexture) {
      return;
    }

    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.canvas.width, this.canvas.height);
    gl.clearColor(CLEAR_COLOR_R, CLEAR_COLOR_G, CLEAR_COLOR_B, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.blitProgram);
    gl.bindVertexArray(this.blitVao);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.panCacheTexture);

    gl.uniform1i(this.uCacheTex, 0);
    gl.uniform2f(this.uViewportPx, this.canvas.width, this.canvas.height);
    gl.uniform2f(this.uCacheSizePx, this.panCacheWidth, this.panCacheHeight);
    gl.uniform2f(this.uOffsetPx, offsetPxX, offsetPxY);
    gl.uniform1f(this.uSampleScale, sampleScale);

    gl.disable(gl.BLEND);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.enable(gl.BLEND);
  }

  private ensurePanCacheResources(): boolean {
    const gl = this.gl;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

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
      this.panCacheFramebuffer &&
      this.panCacheWidth === desiredWidth &&
      this.panCacheHeight === desiredHeight
    ) {
      return true;
    }

    this.destroyPanCacheResources();

    const texture = gl.createTexture();
    if (!texture) {
      return false;
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    configureColorTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA8, desiredWidth, desiredHeight, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);

    const framebuffer = gl.createFramebuffer();
    if (!framebuffer) {
      gl.deleteTexture(texture);
      return false;
    }

    gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);

    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);

    if (status !== gl.FRAMEBUFFER_COMPLETE) {
      gl.deleteFramebuffer(framebuffer);
      gl.deleteTexture(texture);
      return false;
    }

    this.panCacheTexture = texture;
    this.panCacheFramebuffer = framebuffer;
    this.panCacheWidth = desiredWidth;
    this.panCacheHeight = desiredHeight;
    this.panCacheValid = false;

    return true;
  }

  private destroyPanCacheResources(): void {
    if (this.panCacheFramebuffer) {
      this.gl.deleteFramebuffer(this.panCacheFramebuffer);
      this.panCacheFramebuffer = null;
    }

    if (this.panCacheTexture) {
      this.gl.deleteTexture(this.panCacheTexture);
      this.panCacheTexture = null;
    }

    this.panCacheWidth = 0;
    this.panCacheHeight = 0;
    this.panCacheValid = false;
    this.panCacheRenderedSegments = 0;
    this.panCacheUsedCulling = false;
  }

  private destroyVectorMinifyResources(): void {
    if (this.vectorMinifyFramebuffer) {
      this.gl.deleteFramebuffer(this.vectorMinifyFramebuffer);
      this.vectorMinifyFramebuffer = null;
    }

    if (this.vectorMinifyTexture) {
      this.gl.deleteTexture(this.vectorMinifyTexture);
      this.vectorMinifyTexture = null;
    }

    this.vectorMinifyWidth = 0;
    this.vectorMinifyHeight = 0;
    this.vectorMinifyWarmupPending = false;
  }

  private updateVisibleSet(
    viewCenterX: number = this.cameraCenterX,
    viewCenterY: number = this.cameraCenterY,
    viewportWidthPx: number = this.canvas.width,
    viewportHeightPx: number = this.canvas.height,
    zoomValue: number = this.zoom
  ): void {
    if (!this.scene) {
      this.visibleSegmentCount = 0;
      this.usingAllSegments = true;
      this.visiblePageRectCount = 0;
      this.visibleTextRanges = [];
      return;
    }

    if (!this.vectorLodRuntime && !this.hasCameraInteractionSinceSceneLoad) {
      this.usingAllSegments = true;
      this.visibleSegmentCount = this.segmentCount;
      this.setAllPagesAndTextVisible();
      return;
    }

    const safeZoom = Math.max(zoomValue, 1e-6);
    const halfViewWidth = viewportWidthPx / (2 * safeZoom);
    const halfViewHeight = viewportHeightPx / (2 * safeZoom);

    const margin = Math.max(16 / safeZoom, this.scene.maxHalfWidth * 2);

    const viewMinX = viewCenterX - halfViewWidth - margin;
    const viewMaxX = viewCenterX + halfViewWidth + margin;
    const viewMinY = viewCenterY - halfViewHeight - margin;
    const viewMaxY = viewCenterY + halfViewHeight + margin;

    this.updateVisiblePagesAndTextRanges(viewMinX, viewMinY, viewMaxX, viewMaxY);

    if (this.vectorLodRuntime) {
      this.updateVectorLodVisibleSet(
        { cameraCenterX: viewCenterX, cameraCenterY: viewCenterY, zoom: safeZoom },
        { width: viewportWidthPx, height: viewportHeightPx },
        null,
        1 / safeZoom
      );
      return;
    }

    if (!this.grid) {
      this.visibleSegmentCount = 0;
      this.usingAllSegments = true;
      return;
    }

    const grid = this.grid;

    const c0 = clampToGrid(Math.floor((viewMinX - grid.minX) / grid.cellWidth), grid.gridWidth);
    const c1 = clampToGrid(Math.floor((viewMaxX - grid.minX) / grid.cellWidth), grid.gridWidth);
    const r0 = clampToGrid(Math.floor((viewMinY - grid.minY) / grid.cellHeight), grid.gridHeight);
    const r1 = clampToGrid(Math.floor((viewMaxY - grid.minY) / grid.cellHeight), grid.gridHeight);

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

    const slice = this.visibleSegmentIds.subarray(0, outCount);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.visibleSegmentIdBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, slice, this.gl.DYNAMIC_DRAW);
  }

  private updateVisibleSetForBounds(
    bounds: Bounds,
    localUnitsPerPixel: number,
    viewportWidthPx: number = this.canvas.width,
    viewportHeightPx: number = this.canvas.height
  ): void {
    if (!this.scene) {
      this.visibleSegmentCount = 0;
      this.usingAllSegments = true;
      this.visiblePageRectCount = 0;
      this.visibleTextRanges = [];
      return;
    }

    const margin = Math.max(16 * Math.max(localUnitsPerPixel, 1e-9), this.scene.maxHalfWidth * 2);
    const viewMinX = bounds.minX - margin;
    const viewMinY = bounds.minY - margin;
    const viewMaxX = bounds.maxX + margin;
    const viewMaxY = bounds.maxY + margin;

    this.updateVisiblePagesAndTextRanges(viewMinX, viewMinY, viewMaxX, viewMaxY);

    if (this.vectorLodRuntime) {
      this.updateVectorLodVisibleSet(
        { cameraCenterX: this.cameraCenterX, cameraCenterY: this.cameraCenterY, zoom: 1 / Math.max(localUnitsPerPixel, 1e-9) },
        { width: viewportWidthPx, height: viewportHeightPx },
        { minX: viewMinX, minY: viewMinY, maxX: viewMaxX, maxY: viewMaxY },
        localUnitsPerPixel
      );
      return;
    }

    if (!this.grid) {
      this.visibleSegmentCount = 0;
      this.usingAllSegments = true;
      return;
    }

    const grid = this.grid;
    const c0 = clampToGrid(Math.floor((viewMinX - grid.minX) / grid.cellWidth), grid.gridWidth);
    const c1 = clampToGrid(Math.floor((viewMaxX - grid.minX) / grid.cellWidth), grid.gridWidth);
    const r0 = clampToGrid(Math.floor((viewMinY - grid.minY) / grid.cellHeight), grid.gridHeight);
    const r1 = clampToGrid(Math.floor((viewMaxY - grid.minY) / grid.cellHeight), grid.gridHeight);

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
    const slice = this.visibleSegmentIds.subarray(0, outCount);
    this.gl.bindBuffer(this.gl.ARRAY_BUFFER, this.visibleSegmentIdBuffer);
    this.gl.bufferData(this.gl.ARRAY_BUFFER, slice, this.gl.DYNAMIC_DRAW);
  }

  private updateVectorLodVisibleSet(
    viewState: ViewState,
    viewport: { width: number; height: number },
    cullingBounds: Bounds | null,
    localUnitsPerPixel: number
  ): void {
    if (!this.vectorLodRuntime) {
      return;
    }

    if (this.localToClipRenderingEnabled) {
      this.vectorLodRuntime.setLocalToClipTransform(this.localToClipMatrix, localUnitsPerPixel);
    } else {
      this.vectorLodRuntime.setScreenSpaceTransform();
      this.vectorLodRuntime.updateForLocalUnitsPerPixel(localUnitsPerPixel);
    }

    this.vectorLodRuntime.update(viewState, viewport, cullingBounds);
    this.vectorLodStats = this.vectorLodRuntime.getStats();
    this.visibleSegmentCount = this.vectorLodStats.renderedSegments;
    this.usingAllSegments = false;

    for (let levelIndex = 0; levelIndex < this.vectorLodRuntime.levels.length; levelIndex += 1) {
      const runtimeLevel = this.vectorLodRuntime.levels[levelIndex];
      const gpuLevel = this.vectorLodLevels[levelIndex];
      if (!gpuLevel) {
        continue;
      }
      const drawCount = Math.max(0, runtimeLevel.visibleSegmentCount | 0);
      if (gpuLevel.visibleSegmentIdsFloat.length < drawCount) {
        gpuLevel.visibleSegmentIdsFloat = new Float32Array(Math.max(1, runtimeLevel.segmentCount));
      }
      for (let i = 0; i < drawCount; i += 1) {
        gpuLevel.visibleSegmentIdsFloat[i] = runtimeLevel.visibleSegmentIds[i];
      }
      this.gl.bindBuffer(this.gl.ARRAY_BUFFER, gpuLevel.visibleSegmentIdBuffer);
      this.gl.bufferData(
        this.gl.ARRAY_BUFFER,
        gpuLevel.visibleSegmentIdsFloat.subarray(0, drawCount),
        this.gl.DYNAMIC_DRAW
      );
    }
  }

  private setAllPagesAndTextVisible(): void {
    const pageCount = Math.floor(this.pageRects.length / 4);
    if (this.visiblePageRectIndices.length < pageCount) {
      this.visiblePageRectIndices = new Uint32Array(pageCount);
    }
    for (let i = 0; i < pageCount; i += 1) {
      this.visiblePageRectIndices[i] = i;
    }
    this.visiblePageRectCount = pageCount;
    this.visibleTextRanges = this.textInstanceCount > 0
      ? [{ start: 0, count: this.textInstanceCount }]
      : [];
  }

  private updateVisiblePagesAndTextRanges(
    viewMinX: number,
    viewMinY: number,
    viewMaxX: number,
    viewMaxY: number
  ): void {
    const pageCount = Math.floor(this.pageRects.length / 4);
    if (pageCount <= 0) {
      this.visiblePageRectCount = 0;
      this.visibleTextRanges = this.textInstanceCount > 0
        ? [{ start: 0, count: this.textInstanceCount }]
        : [];
      return;
    }

    if (this.visiblePageRectIndices.length < pageCount) {
      this.visiblePageRectIndices = new Uint32Array(pageCount);
    }

    const nextTextRanges: InstanceRange[] = [];
    let visiblePageCount = 0;

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex += 1) {
      const offset = pageIndex * 4;
      const minX = Math.min(this.pageRects[offset], this.pageRects[offset + 2]);
      const minY = Math.min(this.pageRects[offset + 1], this.pageRects[offset + 3]);
      const maxX = Math.max(this.pageRects[offset], this.pageRects[offset + 2]);
      const maxY = Math.max(this.pageRects[offset + 1], this.pageRects[offset + 3]);
      if (maxX < viewMinX || minX > viewMaxX || maxY < viewMinY || minY > viewMaxY) {
        continue;
      }

      this.visiblePageRectIndices[visiblePageCount] = pageIndex;
      visiblePageCount += 1;

      const rangeOffset = pageIndex * 2;
      const start = this.pageTextRanges[rangeOffset] ?? 0;
      const count = this.pageTextRanges[rangeOffset + 1] ?? 0;
      this.appendVisibleTextRange(nextTextRanges, start, count);

    }

    this.visiblePageRectCount = visiblePageCount;
    this.visibleTextRanges = nextTextRanges;
  }

  private appendVisibleTextRange(ranges: InstanceRange[], start: number, count: number): void {
    this.appendVisibleInstanceRange(ranges, start, count, 0, this.textInstanceCount);
  }

  private appendVisibleInstanceRange(
    ranges: InstanceRange[],
    start: number,
    count: number,
    regionStart: number,
    regionCount: number
  ): void {
    const regionEnd = regionStart + regionCount;
    const clampedStart = clamp(Math.trunc(start), regionStart, regionEnd);
    const clampedCount = clamp(Math.trunc(count), 0, regionEnd - clampedStart);
    if (clampedCount <= 0) {
      return;
    }

    const last = ranges[ranges.length - 1];
    if (last && clampedStart <= last.start + last.count) {
      const nextEnd = Math.max(last.start + last.count, clampedStart + clampedCount);
      last.count = nextEnd - last.start;
      return;
    }

    ranges.push({ start: clampedStart, count: clampedCount });
  }

  private destroyRasterLayerTextures(): void {
    const gl = this.gl;
    for (const layer of this.rasterLayers) {
      gl.deleteTexture(layer.texture);
    }
    this.rasterLayers = [];
  }

  private uploadRasterLayers(scene: VectorScene): void {
    const rasterSources = this.getSceneRasterLayers(scene);
    const maxRasterTextureSize = Number(this.gl.getParameter(this.gl.MAX_TEXTURE_SIZE));
    for (const [index, source] of rasterSources.entries()) {
      if (source.width > maxRasterTextureSize || source.height > maxRasterTextureSize) {
        throw new Error(
          `Raster layer ${index} requires a ${source.width}x${source.height} texture, ` +
          `but this WebGL2 context supports at most ${maxRasterTextureSize}x${maxRasterTextureSize}.`
        );
      }
    }

    this.destroyRasterLayerTextures();
    const gl = this.gl;

    try {
      for (const source of rasterSources) {
        const texture = this.mustCreateTexture();
        try {
          gl.bindTexture(gl.TEXTURE_2D, texture);
          configureRasterTexture(gl);
          const pixels = source.data.subarray(0, source.width * source.height * 4);
          const premultiplied = premultiplyRgba(pixels);
          gl.texImage2D(
            gl.TEXTURE_2D,
            0,
            gl.RGBA,
            source.width,
            source.height,
            0,
            gl.RGBA,
            gl.UNSIGNED_BYTE,
            premultiplied
          );
          gl.generateMipmap(gl.TEXTURE_2D);
        } catch (error) {
          gl.deleteTexture(texture);
          throw error;
        }

        const matrix = new Float32Array(6);
        if (source.matrix.length >= 6) {
          matrix.set(source.matrix.subarray(0, 6));
        } else {
          matrix[0] = 1;
          matrix[3] = 1;
        }

        this.rasterLayers.push({
          texture,
          matrix,
          paintOrder: source.paintOrder,
          pageIndex: source.pageIndex
        });
      }
    } catch (error) {
      this.destroyRasterLayerTextures();
      throw error;
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

  private uploadGradientPaintData(scene: VectorScene): void {
    const data = readGradientSceneData(scene);
    this.gradientData = data;
    const gl = this.gl;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

    const gradientDims = chooseTextureDimensions(data.gradientCount, maxTextureSize);
    this.gradientTextureWidth = gradientDims.width;
    this.gradientTextureHeight = gradientDims.height;
    const gradientArrays = [data.gradientMetaA, data.gradientMetaB, data.gradientMetaC, data.gradientMetaD, data.gradientMetaE];
    for (let index = 0; index < this.gradientMetaTextures.length; index += 1) {
      this.uploadFloatDataTexture(this.gradientMetaTextures[index], gradientArrays[index], data.gradientCount, gradientDims);
    }

    gl.bindTexture(gl.TEXTURE_2D, this.gradientLutTexture);
    configureGradientLutTexture(gl);
    if (data.gradientCount > 0) {
      const expectedLength = GRADIENT_LUT_WIDTH * data.gradientCount * 4;
      const pixels = new Uint8Array(expectedLength);
      pixels.set(data.gradientLut.subarray(0, expectedLength));
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        GRADIENT_LUT_WIDTH,
        data.gradientCount,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        pixels
      );
    } else {
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, new Uint8Array(4));
    }

    const fillPathDims = chooseTextureDimensions(data.gradientFillPathCount, maxTextureSize);
    const fillSegmentDims = chooseTextureDimensions(data.gradientFillSegmentCount, maxTextureSize);
    this.gradientFillPathTextureWidth = fillPathDims.width;
    this.gradientFillPathTextureHeight = fillPathDims.height;
    this.gradientFillSegmentTextureWidth = fillSegmentDims.width;
    this.gradientFillSegmentTextureHeight = fillSegmentDims.height;
    const fillArrays = [
      data.gradientFillPathMetaA,
      data.gradientFillPathMetaB,
      data.gradientFillPathMetaC,
      data.gradientFillPaintMeta
    ];
    for (let index = 0; index < fillArrays.length; index += 1) {
      this.uploadFloatDataTexture(
        this.gradientFillTextures[index],
        fillArrays[index],
        data.gradientFillPathCount,
        fillPathDims
      );
    }
    this.uploadFloatDataTexture(
      this.gradientFillTextures[4],
      data.gradientFillSegmentsA,
      data.gradientFillSegmentCount,
      fillSegmentDims
    );
    this.uploadFloatDataTexture(
      this.gradientFillTextures[5],
      data.gradientFillSegmentsB,
      data.gradientFillSegmentCount,
      fillSegmentDims
    );

    const strokeRunDims = chooseTextureDimensions(data.gradientStrokeRunCount, maxTextureSize);
    const strokeSegmentDims = chooseTextureDimensions(data.gradientStrokeSegmentCount, maxTextureSize);
    this.gradientStrokeRunTextureWidth = strokeRunDims.width;
    this.gradientStrokeRunTextureHeight = strokeRunDims.height;
    this.gradientStrokeSegmentTextureWidth = strokeSegmentDims.width;
    this.gradientStrokeSegmentTextureHeight = strokeSegmentDims.height;
    this.uploadFloatDataTexture(
      this.gradientStrokeTextures[0],
      data.gradientStrokeRunMetaA,
      data.gradientStrokeRunCount,
      strokeRunDims
    );
    const strokeArrays = [
      data.gradientStrokeEndpoints,
      data.gradientStrokePrimitiveMeta,
      data.gradientStrokePrimitiveBounds,
      data.gradientStrokeStyles
    ];
    for (let index = 0; index < strokeArrays.length; index += 1) {
      this.uploadFloatDataTexture(
        this.gradientStrokeTextures[index + 1],
        strokeArrays[index],
        data.gradientStrokeSegmentCount,
        strokeSegmentDims
      );
    }

    this.orderedGradientPaintCommands = buildOrderedGradientPaintCommands(
      this.getSceneRasterLayers(scene),
      data
    );
    this.gradientPaintRequiresDirectRendering = orderedGradientPaintNeedsDirectRendering(
      this.orderedGradientPaintCommands
    );
  }

  private uploadFloatDataTexture(
    texture: WebGLTexture,
    source: Float32Array,
    itemCount: number,
    dimensions: { width: number; height: number }
  ): void {
    const gl = this.gl;
    const pixels = new Float32Array(dimensions.width * dimensions.height * 4);
    pixels.set(source.subarray(0, Math.min(source.length, Math.max(0, itemCount) * 4)));
    gl.bindTexture(gl.TEXTURE_2D, texture);
    configureFloatTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      dimensions.width,
      dimensions.height,
      0,
      gl.RGBA,
      gl.FLOAT,
      pixels
    );
  }

  private uploadFillPaths(scene: VectorScene): {
    pathMetaTextureWidth: number;
    pathMetaTextureHeight: number;
    segmentTextureWidth: number;
    segmentTextureHeight: number;
  } {
    const gl = this.gl;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

    const pathDims = chooseTextureDimensions(scene.fillPathCount, maxTextureSize);
    const segmentDims = chooseTextureDimensions(scene.fillSegmentCount, maxTextureSize);

    this.fillPathMetaTextureWidth = pathDims.width;
    this.fillPathMetaTextureHeight = pathDims.height;
    this.fillSegmentTextureWidth = segmentDims.width;
    this.fillSegmentTextureHeight = segmentDims.height;

    const pathTexelCount = pathDims.width * pathDims.height;
    const segmentTexelCount = segmentDims.width * segmentDims.height;

    const pathMetaAData = new Float32Array(pathTexelCount * 4);
    pathMetaAData.set(scene.fillPathMetaA);

    const pathMetaBData = new Float32Array(pathTexelCount * 4);
    pathMetaBData.set(scene.fillPathMetaB);

    const pathMetaCData = new Float32Array(pathTexelCount * 4);
    pathMetaCData.set(scene.fillPathMetaC);

    const segmentDataA = new Float32Array(segmentTexelCount * 4);
    segmentDataA.set(scene.fillSegmentsA);

    const segmentDataB = new Float32Array(segmentTexelCount * 4);
    segmentDataB.set(scene.fillSegmentsB);

    gl.bindTexture(gl.TEXTURE_2D, this.fillPathMetaTextureA);
    configureFloatTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      this.fillPathMetaTextureWidth,
      this.fillPathMetaTextureHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      pathMetaAData
    );

    gl.bindTexture(gl.TEXTURE_2D, this.fillPathMetaTextureB);
    configureFloatTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      this.fillPathMetaTextureWidth,
      this.fillPathMetaTextureHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      pathMetaBData
    );

    gl.bindTexture(gl.TEXTURE_2D, this.fillPathMetaTextureC);
    configureFloatTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      this.fillPathMetaTextureWidth,
      this.fillPathMetaTextureHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      pathMetaCData
    );

    gl.bindTexture(gl.TEXTURE_2D, this.fillSegmentTextureA);
    configureFloatTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      this.fillSegmentTextureWidth,
      this.fillSegmentTextureHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      segmentDataA
    );

    gl.bindTexture(gl.TEXTURE_2D, this.fillSegmentTextureB);
    configureFloatTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      this.fillSegmentTextureWidth,
      this.fillSegmentTextureHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      segmentDataB
    );

    return {
      pathMetaTextureWidth: this.fillPathMetaTextureWidth,
      pathMetaTextureHeight: this.fillPathMetaTextureHeight,
      segmentTextureWidth: this.fillSegmentTextureWidth,
      segmentTextureHeight: this.fillSegmentTextureHeight
    };
  }

  private uploadSegments(scene: VectorScene): {
    textureWidth: number;
    textureHeight: number;
    maxTextureSize: number;
  } {
    const textureSet = this.uploadStrokeTextureSet(scene, {
      textureA: this.segmentTextureA,
      textureB: this.segmentTextureB,
      textureC: this.segmentTextureC,
      textureD: this.segmentTextureD
    });
    this.segmentTextureWidth = textureSet.textureWidth;
    this.segmentTextureHeight = textureSet.textureHeight;
    return {
      textureWidth: this.segmentTextureWidth,
      textureHeight: this.segmentTextureHeight,
      maxTextureSize: textureSet.maxTextureSize
    };
  }

  private uploadStrokeTextureSet(
    scene: VectorScene,
    textures: {
      textureA: WebGLTexture;
      textureB: WebGLTexture;
      textureC: WebGLTexture;
      textureD: WebGLTexture;
    }
  ): {
    textureWidth: number;
    textureHeight: number;
    maxTextureSize: number;
  } {
    const gl = this.gl;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;
    const segmentCount = Math.max(0, scene.segmentCount | 0);
    const preferredWidth = Math.ceil(Math.sqrt(segmentCount));
    const textureWidth = clamp(preferredWidth, 1, maxTextureSize);
    const textureHeight = Math.max(1, Math.ceil(segmentCount / textureWidth));

    if (textureHeight > maxTextureSize) {
      throw new Error("Segment texture exceeds GPU limits for this browser/GPU.");
    }

    const texelCount = textureWidth * textureHeight;

    const endpointsTextureData = new Float32Array(texelCount * 4);
    endpointsTextureData.set(scene.endpoints.subarray(0, segmentCount * 4));

    const primitiveMetaTextureData = new Float32Array(texelCount * 4);
    primitiveMetaTextureData.set(scene.primitiveMeta.subarray(0, segmentCount * 4));

    const styleTextureData = new Float32Array(texelCount * 4);
    styleTextureData.set(scene.styles.subarray(0, segmentCount * 4));

    const primitiveBoundsTextureData = new Float32Array(texelCount * 4);
    primitiveBoundsTextureData.set(scene.primitiveBounds.subarray(0, segmentCount * 4));

    gl.bindTexture(gl.TEXTURE_2D, textures.textureA);
    configureFloatTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, textureWidth, textureHeight, 0, gl.RGBA, gl.FLOAT, endpointsTextureData);

    gl.bindTexture(gl.TEXTURE_2D, textures.textureB);
    configureFloatTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, textureWidth, textureHeight, 0, gl.RGBA, gl.FLOAT, primitiveMetaTextureData);

    gl.bindTexture(gl.TEXTURE_2D, textures.textureC);
    configureFloatTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, textureWidth, textureHeight, 0, gl.RGBA, gl.FLOAT, styleTextureData);

    gl.bindTexture(gl.TEXTURE_2D, textures.textureD);
    configureFloatTexture(gl);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA32F, textureWidth, textureHeight, 0, gl.RGBA, gl.FLOAT, primitiveBoundsTextureData);

    return { textureWidth, textureHeight, maxTextureSize };
  }

  private rebuildVectorLod(scene: VectorScene): boolean {
    if (shouldUseVectorStrokeLod(this.vectorLodMode, "webgl", scene.segmentCount)) {
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
    return this.vectorLodLevels.length > 1;
  }

  private uploadVectorLodLevels(): void {
    this.destroyVectorLodResources();
    if (!this.vectorLodRuntime) {
      return;
    }

    for (let i = 0; i < this.vectorLodRuntime.levels.length; i += 1) {
      const level = this.vectorLodRuntime.levels[i];
      const visibleSegmentIdBuffer = this.mustCreateBuffer();
      const visibleSegmentIdsFloat = new Float32Array(Math.max(1, level.segmentCount));
      if (i === 0) {
        this.vectorLodLevels.push({
          textureA: this.segmentTextureA,
          textureB: this.segmentTextureB,
          textureC: this.segmentTextureC,
          textureD: this.segmentTextureD,
          textureWidth: this.segmentTextureWidth,
          textureHeight: this.segmentTextureHeight,
          ownsTextures: false,
          visibleSegmentIdBuffer,
          visibleSegmentIdsFloat
        });
        continue;
      }

      const textureA = this.mustCreateTexture();
      const textureB = this.mustCreateTexture();
      const textureC = this.mustCreateTexture();
      const textureD = this.mustCreateTexture();
      const textureStats = this.uploadStrokeTextureSet(level.scene, { textureA, textureB, textureC, textureD });
      this.vectorLodLevels.push({
        textureA,
        textureB,
        textureC,
        textureD,
        textureWidth: textureStats.textureWidth,
        textureHeight: textureStats.textureHeight,
        ownsTextures: true,
        visibleSegmentIdBuffer,
        visibleSegmentIdsFloat
      });
    }
  }

  private destroyVectorLodResources(): void {
    for (const level of this.vectorLodLevels) {
      this.gl.deleteBuffer(level.visibleSegmentIdBuffer);
      if (level.ownsTextures) {
        this.gl.deleteTexture(level.textureA);
        this.gl.deleteTexture(level.textureB);
        this.gl.deleteTexture(level.textureC);
        this.gl.deleteTexture(level.textureD);
      }
    }
    this.vectorLodLevels = [];
    this.vectorLodStats = null;
  }

  private uploadTextData(scene: VectorScene, textLodData: TextLodBuildData | null): {
    instanceTextureWidth: number;
    instanceTextureHeight: number;
    glyphMetaTextureWidth: number;
    glyphMetaTextureHeight: number;
    glyphSegmentTextureWidth: number;
    glyphSegmentTextureHeight: number;
  } {
    const gl = this.gl;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

    const uploadInstanceCount = textLodData?.combinedInstanceCount ?? scene.textInstanceCount;
    const uploadGlyphCount = scene.textGlyphCount + (textLodData ? 1 : 0);
    const uploadSegmentCount = scene.textGlyphSegmentCount +
      (textLodData ? TEXT_LOD_SOLID_GLYPH_SEGMENT_COUNT : 0);
    const instanceDims = chooseTextureDimensions(uploadInstanceCount, maxTextureSize);
    const glyphMetaDims = chooseTextureDimensions(uploadGlyphCount, maxTextureSize);
    const glyphSegmentDims = chooseTextureDimensions(uploadSegmentCount, maxTextureSize);

    this.textInstanceTextureWidth = instanceDims.width;
    this.textInstanceTextureHeight = instanceDims.height;
    this.textGlyphMetaTextureWidth = glyphMetaDims.width;
    this.textGlyphMetaTextureHeight = glyphMetaDims.height;
    this.textGlyphSegmentTextureWidth = glyphSegmentDims.width;
    this.textGlyphSegmentTextureHeight = glyphSegmentDims.height;

    const instanceTexelCount = instanceDims.width * instanceDims.height;
    const glyphMetaTexelCount = glyphMetaDims.width * glyphMetaDims.height;
    const glyphSegmentTexelCount = glyphSegmentDims.width * glyphSegmentDims.height;

    const instanceAData = new Float32Array(instanceTexelCount * 4);
    const instanceBData = new Float32Array(instanceTexelCount * 4);
    const instanceCFloatData = new Float32Array(instanceTexelCount * 4);

    const glyphMetaAData = new Float32Array(glyphMetaTexelCount * 4);
    const glyphMetaBData = new Float32Array(glyphMetaTexelCount * 4);

    const glyphRasterMetaData = new Float32Array(glyphMetaTexelCount * 4);
    const textRasterAtlas = buildTextRasterAtlas(scene, maxTextureSize);
    if (textRasterAtlas) {
      glyphRasterMetaData.set(textRasterAtlas.glyphUvRects);
      this.textRasterAtlasWidth = textRasterAtlas.width;
      this.textRasterAtlasHeight = textRasterAtlas.height;
    } else {
      this.textRasterAtlasWidth = 1;
      this.textRasterAtlasHeight = 1;
    }

    const glyphSegmentDataA = new Float32Array(glyphSegmentTexelCount * 4);
    const glyphSegmentDataB = new Float32Array(glyphSegmentTexelCount * 4);
    if (textLodData) {
      appendTextLodCombinedPayload(scene, textLodData, {
        textInstanceA: instanceAData,
        textInstanceB: instanceBData,
        textInstanceC: instanceCFloatData,
        textGlyphMetaA: glyphMetaAData,
        textGlyphMetaB: glyphMetaBData,
        textGlyphSegmentsA: glyphSegmentDataA,
        textGlyphSegmentsB: glyphSegmentDataB
      });
    } else {
      instanceAData.set(scene.textInstanceA);
      instanceBData.set(scene.textInstanceB);
      instanceCFloatData.set(scene.textInstanceC);
      glyphMetaAData.set(scene.textGlyphMetaA);
      glyphMetaBData.set(scene.textGlyphMetaB);
      glyphSegmentDataA.set(scene.textGlyphSegmentsA);
      glyphSegmentDataB.set(scene.textGlyphSegmentsB);
    }
    const instanceCData = packNormalizedUint8TextureData(instanceCFloatData, instanceTexelCount);

    gl.bindTexture(gl.TEXTURE_2D, this.textInstanceTextureA);
    configureFloatTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      this.textInstanceTextureWidth,
      this.textInstanceTextureHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      instanceAData
    );

    gl.bindTexture(gl.TEXTURE_2D, this.textInstanceTextureB);
    configureFloatTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      this.textInstanceTextureWidth,
      this.textInstanceTextureHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      instanceBData
    );

    gl.bindTexture(gl.TEXTURE_2D, this.textInstanceTextureC);
    configureByteTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA8,
      this.textInstanceTextureWidth,
      this.textInstanceTextureHeight,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      instanceCData
    );

    gl.bindTexture(gl.TEXTURE_2D, this.textGlyphMetaTextureA);
    configureFloatTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      this.textGlyphMetaTextureWidth,
      this.textGlyphMetaTextureHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      glyphMetaAData
    );

    gl.bindTexture(gl.TEXTURE_2D, this.textGlyphMetaTextureB);
    configureFloatTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      this.textGlyphMetaTextureWidth,
      this.textGlyphMetaTextureHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      glyphMetaBData
    );

    gl.bindTexture(gl.TEXTURE_2D, this.textGlyphRasterMetaTexture);
    configureFloatTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      this.textGlyphMetaTextureWidth,
      this.textGlyphMetaTextureHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      glyphRasterMetaData
    );

    gl.bindTexture(gl.TEXTURE_2D, this.textGlyphSegmentTextureA);
    configureFloatTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      this.textGlyphSegmentTextureWidth,
      this.textGlyphSegmentTextureHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      glyphSegmentDataA
    );

    gl.bindTexture(gl.TEXTURE_2D, this.textGlyphSegmentTextureB);
    configureFloatTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      this.textGlyphSegmentTextureWidth,
      this.textGlyphSegmentTextureHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      glyphSegmentDataB
    );

    gl.bindTexture(gl.TEXTURE_2D, this.textRasterAtlasTexture);
    configureGlyphRasterTexture(gl);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 1);
    const atlasMipChain = buildSingleChannelUint8MipChain(
      textRasterAtlas?.alpha ?? new Uint8Array([0]),
      this.textRasterAtlasWidth,
      this.textRasterAtlasHeight
    );
    for (let mipLevel = 0; mipLevel < atlasMipChain.length; mipLevel += 1) {
      const level = atlasMipChain[mipLevel];
      gl.texImage2D(
        gl.TEXTURE_2D,
        mipLevel,
        gl.R8,
        level.width,
        level.height,
        0,
        gl.RED,
        gl.UNSIGNED_BYTE,
        level.data
      );
    }
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_BASE_LEVEL, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAX_LEVEL, atlasMipChain.length - 1);
    gl.pixelStorei(gl.UNPACK_ALIGNMENT, 4);

    return {
      instanceTextureWidth: this.textInstanceTextureWidth,
      instanceTextureHeight: this.textInstanceTextureHeight,
      glyphMetaTextureWidth: this.textGlyphMetaTextureWidth,
      glyphMetaTextureHeight: this.textGlyphMetaTextureHeight,
      glyphSegmentTextureWidth: this.textGlyphSegmentTextureWidth,
      glyphSegmentTextureHeight: this.textGlyphSegmentTextureHeight
    };
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

  private initializeGeometry(): void {
    const gl = this.gl;

    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    const corners = new Float32Array([
      -1, -1,
      1, -1,
      -1, 1,
      1, 1
    ]);
    gl.bufferData(gl.ARRAY_BUFFER, corners, gl.STATIC_DRAW);

    gl.bindVertexArray(this.segmentVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.vertexAttribDivisor(0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.allSegmentIdBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 4, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.bindVertexArray(this.fillVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.vertexAttribDivisor(0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.allFillPathIdBuffer);
    gl.enableVertexAttribArray(3);
    gl.vertexAttribPointer(3, 1, gl.FLOAT, false, 4, 0);
    gl.vertexAttribDivisor(3, 1);

    gl.bindVertexArray(this.textVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.vertexAttribDivisor(0, 0);

    gl.bindBuffer(gl.ARRAY_BUFFER, this.allTextInstanceIdBuffer);
    gl.enableVertexAttribArray(2);
    gl.vertexAttribPointer(2, 1, gl.FLOAT, false, 4, 0);
    gl.vertexAttribDivisor(2, 1);

    gl.bindVertexArray(this.blitVao);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.vertexAttribDivisor(0, 0);

    for (const [vao, rectBuffer] of [
      [this.highlightOthersVao, this.highlightOthersBuffer],
      [this.highlightCurrentVao, this.highlightCurrentBuffer],
      [this.highlightSelectionVao, this.highlightSelectionBuffer]
    ] as const) {
      gl.bindVertexArray(vao);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.cornerBuffer);
      gl.enableVertexAttribArray(0);
      gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
      gl.vertexAttribDivisor(0, 0);

      gl.bindBuffer(gl.ARRAY_BUFFER, rectBuffer);
      gl.enableVertexAttribArray(1);
      gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 16, 0);
      gl.vertexAttribDivisor(1, 1);
    }

    gl.bindVertexArray(null);
  }

  private initializeState(): void {
    this.ensureRenderState();
  }

  private ensureRenderState(): void {
    const gl = this.gl;
    gl.disable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.disable(gl.SCISSOR_TEST);
    gl.colorMask(true, true, true, true);
    gl.enable(gl.BLEND);
    gl.blendEquationSeparate(gl.FUNC_ADD, gl.FUNC_ADD);
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
  }

  private uploadPageBackgroundTexture(): void {
    const gl = this.gl;
    const color = this.pageBackgroundColor;
    const data = new Uint8Array([
      Math.round(color[0] * 255),
      Math.round(color[1] * 255),
      Math.round(color[2] * 255),
      Math.round(color[3] * 255)
    ]);

    gl.bindTexture(gl.TEXTURE_2D, this.pageBackgroundTexture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, data);
    gl.bindTexture(gl.TEXTURE_2D, null);
  }

  clientToScenePoint(clientX: number, clientY: number): { x: number; y: number } | null {
    if (this.isDisposed) {
      return null;
    }
    return this.clientToWorld(clientX, clientY);
  }

  sceneToClientPoint(sceneX: number, sceneY: number): { x: number; y: number } | null {
    if (this.isDisposed) {
      return null;
    }
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

  private createProgram(vertexSource: string, fragmentSource: string): WebGLProgram {
    const gl = this.gl;

    const vertexShader = this.compileShader(gl.VERTEX_SHADER, vertexSource);
    const fragmentShader = this.compileShader(gl.FRAGMENT_SHADER, fragmentSource);

    const program = gl.createProgram();
    if (!program) {
      throw new Error("Unable to create WebGL program.");
    }

    gl.attachShader(program, vertexShader);
    gl.attachShader(program, fragmentShader);
    gl.linkProgram(program);

    const linkStatus = gl.getProgramParameter(program, gl.LINK_STATUS);
    if (!linkStatus) {
      const error = gl.getProgramInfoLog(program) || "Unknown linker error.";
      gl.deleteProgram(program);
      throw new Error(`Program link failed: ${error}`);
    }

    gl.deleteShader(vertexShader);
    gl.deleteShader(fragmentShader);

    return program;
  }

  private compileShader(type: number, source: string): WebGLShader {
    const shader = this.gl.createShader(type);
    if (!shader) {
      throw new Error("Unable to create shader.");
    }

    this.gl.shaderSource(shader, source);
    this.gl.compileShader(shader);

    const status = this.gl.getShaderParameter(shader, this.gl.COMPILE_STATUS);
    if (!status) {
      const error = this.gl.getShaderInfoLog(shader) || "Unknown shader compiler error.";
      this.gl.deleteShader(shader);
      throw new Error(`Shader compilation failed: ${error}`);
    }

    return shader;
  }

  private createVertexArray(): WebGLVertexArrayObject {
    const vao = this.gl.createVertexArray();
    if (!vao) {
      throw new Error("Unable to create VAO.");
    }
    return vao;
  }

  private mustCreateBuffer(): WebGLBuffer {
    const buffer = this.gl.createBuffer();
    if (!buffer) {
      throw new Error("Unable to create WebGL buffer.");
    }
    return buffer;
  }

  private mustCreateTexture(): WebGLTexture {
    const texture = this.gl.createTexture();
    if (!texture) {
      throw new Error("Unable to create WebGL texture.");
    }
    return texture;
  }

  private mustGetUniformLocation(program: WebGLProgram, name: string): WebGLUniformLocation {
    const location = this.gl.getUniformLocation(program, name);
    if (!location) {
      throw new Error(`Missing uniform: ${name}`);
    }
    return location;
  }

  private mustGetUniformMap(
    program: WebGLProgram,
    names: readonly string[]
  ): Readonly<Record<string, WebGLUniformLocation>> {
    const uniforms: Record<string, WebGLUniformLocation> = {};
    for (const name of names) {
      uniforms[name] = this.mustGetUniformLocation(program, name);
    }
    return uniforms;
  }
}

function configureFloatTexture(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function configureGradientLutTexture(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function configureByteTexture(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function configureColorTexture(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function configureVectorMinifyTexture(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function configureRasterTexture(gl: WebGL2RenderingContext): void {
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
}

function configureGlyphRasterTexture(gl: WebGL2RenderingContext): void {
  configureRasterTexture(gl);
  const anisotropy = gl.getExtension("EXT_texture_filter_anisotropic");
  if (!anisotropy) {
    return;
  }
  const supported = Number(gl.getParameter(anisotropy.MAX_TEXTURE_MAX_ANISOTROPY_EXT));
  if (Number.isFinite(supported) && supported > 1) {
    gl.texParameterf(gl.TEXTURE_2D, anisotropy.TEXTURE_MAX_ANISOTROPY_EXT, Math.min(16, supported));
  }
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

function normalizePageTextRanges(
  scene: VectorScene,
  pageRects: Float32Array,
  textInstanceCount: number
): Uint32Array {
  const pageCount = Math.max(1, Math.floor(pageRects.length / 4));
  const expectedLength = pageCount * 2;
  const maxTextInstanceCount = Math.max(0, textInstanceCount | 0);

  if (scene.pageTextRanges instanceof Uint32Array && scene.pageTextRanges.length >= expectedLength) {
    const out = new Uint32Array(expectedLength);
    let previousEnd = 0;
    for (let i = 0; i < pageCount; i += 1) {
      const offset = i * 2;
      const start = clamp(Math.trunc(scene.pageTextRanges[offset]), previousEnd, maxTextInstanceCount);
      const count = clamp(Math.trunc(scene.pageTextRanges[offset + 1]), 0, maxTextInstanceCount - start);
      out[offset] = start;
      out[offset + 1] = count;
      previousEnd = start + count;
    }
    return out;
  }

  const out = new Uint32Array(expectedLength);
  out[0] = 0;
  out[1] = maxTextInstanceCount;
  for (let i = 1; i < pageCount; i += 1) {
    const offset = i * 2;
    out[offset] = maxTextInstanceCount;
    out[offset + 1] = 0;
  }
  return out;
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
