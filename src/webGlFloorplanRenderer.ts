import type { Bounds, VectorScene } from "./pdfVectorExtractor";
import { buildSpatialGrid, type SpatialGrid } from "./spatialGrid";
import { buildTextRasterAtlas } from "./textRasterAtlas";

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

out vec2 vLocal;
flat out vec2 vP0;
flat out vec2 vP1;
flat out vec2 vP2;
flat out float vPrimitiveType;
flat out float vHalfWidth;
flat out float vAAWorld;
flat out vec3 vColor;
flat out float vAlpha;

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
    vHalfWidth = 0.0;
    vAAWorld = 1.0;
    vColor = color;
    vAlpha = 0.0;
    return;
  }

  if (isHairline) {
    halfWidth = max(0.5 / max(uZoom, 1e-4), 1e-5);
  }

  float aaWorld = max(1.0 / uZoom, 0.0001) * uAAScreenPx;
  if (isHairline) {
    aaWorld = max(0.35 / max(uZoom, 1e-4), 5e-5);
  }

  float extent = halfWidth + aaWorld;
  vec2 worldMin = primitiveBounds.xy - vec2(extent);
  vec2 worldMax = primitiveBounds.zw + vec2(extent);
  vec2 corner01 = aCorner * 0.5 + 0.5;
  vec2 worldPosition = mix(worldMin, worldMax, corner01);

  vec2 screen = (worldPosition - uCameraCenter) * uZoom + 0.5 * uViewport;
  vec2 clip = (screen / (0.5 * uViewport)) - 1.0;

  gl_Position = vec4(clip, 0.0, 1.0);

  vLocal = worldPosition;
  vP0 = p0;
  vP1 = p1;
  vP2 = p2;
  vPrimitiveType = primitiveType;
  vHalfWidth = halfWidth;
  vAAWorld = aaWorld;
  vColor = color;
  vAlpha = alpha;
}
`;

const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
uniform float uStrokeCurveEnabled;
uniform vec4 uVectorOverride;
in vec2 vLocal;
flat in vec2 vP0;
flat in vec2 vP1;
flat in vec2 vP2;
flat in float vPrimitiveType;
flat in float vHalfWidth;
flat in float vAAWorld;
flat in vec3 vColor;
flat in float vAlpha;

out vec4 outColor;

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

  float distanceToSegment = (uStrokeCurveEnabled >= 0.5 && vPrimitiveType >= 0.5)
    ? distanceToQuadraticBezier(vLocal, vP0, vP1, vP2)
    : distanceToLineSegment(vLocal, vP0, vP2);

  float coverage = 1.0 - smoothstep(vHalfWidth - vAAWorld, vHalfWidth + vAAWorld, distanceToSegment);
  float alpha = coverage * vAlpha;

  if (alpha <= 0.001) {
    discard;
  }

  vec3 color = mix(vColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
  outColor = vec4(color, alpha);
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

  vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
  vec2 clip = (screen / (0.5 * uViewport)) - 1.0;
  gl_Position = vec4(clip, 0.0, 1.0);

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
    outColor = vec4(color, alpha);
    return;
  }

  float signedDistance = inside ? -minDistance : minDistance;

  float pixelToLocalX = length(vec2(dFdx(vLocal.x), dFdy(vLocal.x)));
  float pixelToLocalY = length(vec2(dFdx(vLocal.y), dFdy(vLocal.y)));
  float aaWidth = max(max(pixelToLocalX, pixelToLocalY) * uFillAAScreenPx, 1e-4);

  float alpha = clamp(0.5 - signedDistance / aaWidth, 0.0, 1.0) * vAlpha;
  if (alpha <= 0.001) {
    discard;
  }

  outColor = vec4(color, alpha);
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
  vec4 glyphRasterMeta = texelFetch(uTextGlyphRasterMetaTex, coordFromIndex(glyphIndex, uTextGlyphMetaTexSize), 0);

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

  vec2 minBounds = glyphMetaA.zw;
  vec2 maxBounds = glyphMetaB.xy;
  vec2 corner01 = aCorner * 0.5 + 0.5;
  vec2 local = mix(minBounds, maxBounds, corner01);

  vec2 world = vec2(
    instanceA.x * local.x + instanceA.z * local.y + instanceB.x,
    instanceA.y * local.x + instanceA.w * local.y + instanceB.y
  );

  vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
  vec2 clip = (screen / (0.5 * uViewport)) - 1.0;

  gl_Position = vec4(clip, 0.0, 1.0);
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

const int MAX_GLYPH_PRIMITIVES = 256;
const float TEXT_PRIMITIVE_QUADRATIC = 1.0;
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
  if (vSegmentCount <= 0) {
    discard;
  }

  if (uTextVectorOnly < 0.5 && vRasterRect.z > 0.0 && vRasterRect.w > 0.0) {
    vec2 atlasPxSize = max(uTextRasterAtlasSize, vec2(1.0));
    vec2 nc = vec2(vNormCoord.x, 1.0 - vNormCoord.y) * (vRasterRect.zw * atlasPxSize);
    if (min(fwidth(nc.x), fwidth(nc.y)) > 2.0) {
      vec2 uvCenter = vec2(
        vRasterRect.x + vNormCoord.x * vRasterRect.z,
        vRasterRect.y + (1.0 - vNormCoord.y) * vRasterRect.w
      );
      vec2 texel = 1.0 / atlasPxSize;
      vec2 uvMin = vRasterRect.xy + texel * 0.5;
      vec2 uvMax = vRasterRect.xy + vRasterRect.zw - texel * 0.5;
      vec2 dx = dFdx(nc) * 0.33 * texel;
      vec2 dy = dFdy(nc) * 0.33 * texel;
      float mipBias = -1.25;
      float alpha = (1.0 / 3.0) * texture(uTextRasterAtlasTex, clamp(uvCenter, uvMin, uvMax), mipBias).r +
        (1.0 / 6.0) * (
          texture(uTextRasterAtlasTex, clamp(uvCenter - dx - dy, uvMin, uvMax), mipBias).r +
          texture(uTextRasterAtlasTex, clamp(uvCenter - dx + dy, uvMin, uvMax), mipBias).r +
          texture(uTextRasterAtlasTex, clamp(uvCenter + dx - dy, uvMin, uvMax), mipBias).r +
          texture(uTextRasterAtlasTex, clamp(uvCenter + dx + dy, uvMin, uvMax), mipBias).r
        );
      alpha *= vColorAlpha;
      if (alpha <= 0.001) {
        discard;
      }
      vec3 color = mix(vColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
      outColor = vec4(color, alpha);
      return;
    }
  }

  float minDistance = 1e20;
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

    if (uTextCurveEnabled >= 0.5 && primitiveType >= TEXT_PRIMITIVE_QUADRATIC) {
      minDistance = min(minDistance, distanceToQuadraticBezier(vLocal, p0, p1, p2));
      accumulateQuadraticCrossing(p0, p1, p2, vLocal, winding);
    } else {
      minDistance = min(minDistance, distanceToLineSegment(vLocal, p0, p2));
      accumulateLineCrossing(p0, p2, vLocal, winding);
    }
  }

  bool insideWinding = winding != 0;
  bool inside = insideWinding;
  float signedDistance = inside ? -minDistance : minDistance;

  float pixelToLocalX = length(vec2(dFdx(vLocal.x), dFdy(vLocal.x)));
  float pixelToLocalY = length(vec2(dFdx(vLocal.y), dFdy(vLocal.y)));
  float localPerPixel = max(pixelToLocalX, pixelToLocalY);

  float baseAAWidth = max(localPerPixel * uTextAAScreenPx, 1e-4);
  float alphaBase = 1.0 - smoothstep(-baseAAWidth, baseAAWidth, signedDistance);
  float alpha = alphaBase * vColorAlpha;
  if (alpha <= 0.001) {
    discard;
  }

  vec3 color = mix(vColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
  outColor = vec4(color, alpha);
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

  vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
  vec2 clip = (screen / (0.5 * uViewport)) - 1.0;

  gl_Position = vec4(clip, 0.0, 1.0);
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

export interface DrawStats {
  renderedSegments: number;
  totalSegments: number;
  usedCulling: boolean;
  zoom: number;
}

export interface SceneStats {
  gridWidth: number;
  gridHeight: number;
  gridIndexCount: number;
  maxCellPopulation: number;
  fillPathTextureWidth: number;
  fillPathTextureHeight: number;
  fillSegmentTextureWidth: number;
  fillSegmentTextureHeight: number;
  textureWidth: number;
  textureHeight: number;
  maxTextureSize: number;
  textInstanceTextureWidth: number;
  textInstanceTextureHeight: number;
  textGlyphTextureWidth: number;
  textGlyphTextureHeight: number;
  textSegmentTextureWidth: number;
  textSegmentTextureHeight: number;
}

export interface ViewState {
  cameraCenterX: number;
  cameraCenterY: number;
  zoom: number;
}

type FrameListener = (stats: DrawStats) => void;

interface RasterLayerGpu {
  texture: WebGLTexture;
  matrix: Float32Array;
}

export class WebGlFloorplanRenderer {
  private readonly canvas: HTMLCanvasElement;

  private readonly gl: WebGL2RenderingContext;

  private readonly segmentProgram: WebGLProgram;

  private readonly fillProgram: WebGLProgram;

  private readonly textProgram: WebGLProgram;

  private readonly blitProgram: WebGLProgram;

  private readonly vectorCompositeProgram: WebGLProgram;

  private readonly rasterProgram: WebGLProgram;

  private readonly segmentVao: WebGLVertexArrayObject;

  private readonly fillVao: WebGLVertexArrayObject;

  private readonly textVao: WebGLVertexArrayObject;

  private readonly blitVao: WebGLVertexArrayObject;

  private readonly cornerBuffer: WebGLBuffer;

  private readonly allSegmentIdBuffer: WebGLBuffer;

  private readonly visibleSegmentIdBuffer: WebGLBuffer;

  private readonly allFillPathIdBuffer: WebGLBuffer;

  private readonly allTextInstanceIdBuffer: WebGLBuffer;

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

  private readonly uSegmentTexA: WebGLUniformLocation;

  private readonly uSegmentTexB: WebGLUniformLocation;

  private readonly uSegmentStyleTex: WebGLUniformLocation;

  private readonly uSegmentBoundsTex: WebGLUniformLocation;

  private readonly uSegmentTexSize: WebGLUniformLocation;

  private readonly uViewport: WebGLUniformLocation;

  private readonly uCameraCenter: WebGLUniformLocation;

  private readonly uZoom: WebGLUniformLocation;

  private readonly uAAScreenPx: WebGLUniformLocation;

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

  private scene: VectorScene | null = null;

  private grid: SpatialGrid | null = null;

  private sceneStats: SceneStats | null = null;

  private allSegmentIds = new Float32Array(0);

  private visibleSegmentIds = new Float32Array(0);

  private allFillPathIds = new Float32Array(0);

  private allTextInstanceIds = new Float32Array(0);

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

  private pageRects: Float32Array<ArrayBufferLike> = new Float32Array(0);

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

  private panOptimizationEnabled = true;

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

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;

    const context = canvas.getContext("webgl2", {
      antialias: false,
      depth: false,
      stencil: false,
      alpha: false,
      premultipliedAlpha: false
    });

    if (!context) {
      throw new Error("WebGL2 is required for this proof-of-concept renderer.");
    }

    this.gl = context;

    this.segmentProgram = this.createProgram(VERTEX_SHADER_SOURCE, FRAGMENT_SHADER_SOURCE);
    this.fillProgram = this.createProgram(FILL_VERTEX_SHADER_SOURCE, FILL_FRAGMENT_SHADER_SOURCE);
    this.textProgram = this.createProgram(TEXT_VERTEX_SHADER_SOURCE, TEXT_FRAGMENT_SHADER_SOURCE);
    this.blitProgram = this.createProgram(BLIT_VERTEX_SHADER_SOURCE, BLIT_FRAGMENT_SHADER_SOURCE);
    this.vectorCompositeProgram = this.createProgram(BLIT_VERTEX_SHADER_SOURCE, VECTOR_COMPOSITE_FRAGMENT_SHADER_SOURCE);
    this.rasterProgram = this.createProgram(RASTER_VERTEX_SHADER_SOURCE, RASTER_FRAGMENT_SHADER_SOURCE);

    this.segmentVao = this.createVertexArray();
    this.fillVao = this.createVertexArray();
    this.textVao = this.createVertexArray();
    this.blitVao = this.createVertexArray();

    this.cornerBuffer = this.mustCreateBuffer();
    this.allSegmentIdBuffer = this.mustCreateBuffer();
    this.visibleSegmentIdBuffer = this.mustCreateBuffer();
    this.allFillPathIdBuffer = this.mustCreateBuffer();
    this.allTextInstanceIdBuffer = this.mustCreateBuffer();

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

    this.uSegmentTexA = this.mustGetUniformLocation(this.segmentProgram, "uSegmentTexA");
    this.uSegmentTexB = this.mustGetUniformLocation(this.segmentProgram, "uSegmentTexB");
    this.uSegmentStyleTex = this.mustGetUniformLocation(this.segmentProgram, "uSegmentStyleTex");
    this.uSegmentBoundsTex = this.mustGetUniformLocation(this.segmentProgram, "uSegmentBoundsTex");
    this.uSegmentTexSize = this.mustGetUniformLocation(this.segmentProgram, "uSegmentTexSize");
    this.uViewport = this.mustGetUniformLocation(this.segmentProgram, "uViewport");
    this.uCameraCenter = this.mustGetUniformLocation(this.segmentProgram, "uCameraCenter");
    this.uZoom = this.mustGetUniformLocation(this.segmentProgram, "uZoom");
    this.uAAScreenPx = this.mustGetUniformLocation(this.segmentProgram, "uAAScreenPx");
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
    const nextWidth = Math.max(1, Math.round(this.canvas.clientWidth * devicePixelRatio));
    const nextHeight = Math.max(1, Math.round(this.canvas.clientHeight * devicePixelRatio));

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
    this.scene = scene;
    this.segmentCount = scene.segmentCount;
    this.fillPathCount = scene.fillPathCount;
    this.textInstanceCount = scene.textInstanceCount;
    this.pageRects = normalizePageRects(scene);
    this.buildSegmentBounds(scene);
    this.isPanInteracting = false;
    this.panCacheValid = false;
    this.destroyVectorMinifyResources();

    this.grid = this.segmentCount > 0 ? buildSpatialGrid(scene) : null;
    this.uploadRasterLayers(scene);
    const fillTextureStats = this.uploadFillPaths(scene);
    const textureStats = this.uploadSegments(scene);
    const textTextureStats = this.uploadTextData(scene);
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

  dispose(): void {
    if (this.rafHandle !== 0) {
      cancelAnimationFrame(this.rafHandle);
      this.rafHandle = 0;
    }
    this.frameListener = null;
    this.destroyPanCacheResources();
    this.destroyVectorMinifyResources();
    for (const layer of this.rasterLayers) {
      this.gl.deleteTexture(layer.texture);
    }
    this.rasterLayers = [];
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
    const gl = this.gl;
    let useVectorMinify = this.shouldUseVectorMinifyPath() && this.ensureVectorMinifyResources();
    // Keep still/moving appearance consistent on large pan-optimized scenes.
    // Pan-cache path renders vectors directly; matching that avoids thickness shifts while camera moves.
    if (this.panOptimizationEnabled && this.segmentCount >= PAN_CACHE_MIN_SEGMENTS) {
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

    if (this.rasterRenderingEnabled) {
      this.drawRasterLayer(this.canvas.width, this.canvas.height, this.cameraCenterX, this.cameraCenterY);
    }
    let instanceCount = 0;
    if (useVectorMinify) {
      instanceCount = this.renderVectorLayerIntoMinifyTarget(
        this.vectorMinifyWidth,
        this.vectorMinifyHeight,
        this.cameraCenterX,
        this.cameraCenterY
      );
      this.compositeVectorMinifyLayer();
    } else {
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
    cameraCenterY: number
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

    if (this.fillRenderingEnabled) {
      this.drawFilledPaths(viewportWidth, viewportHeight, cameraCenterX, cameraCenterY, effectiveZoom);
    }
    const instanceCount = this.strokeRenderingEnabled
      ? this.drawVisibleSegments(viewportWidth, viewportHeight, cameraCenterX, cameraCenterY, effectiveZoom)
      : 0;
    if (this.textRenderingEnabled) {
      this.drawTextInstances(viewportWidth, viewportHeight, cameraCenterX, cameraCenterY, effectiveZoom);
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

      if (this.rasterRenderingEnabled) {
        this.drawRasterLayer(
          this.panCacheWidth,
          this.panCacheHeight,
          this.panCacheCenterX,
          this.panCacheCenterY
        );
      }
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

  private drawRasterLayer(
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number
  ): void {
    if (this.rasterLayers.length === 0 && this.pageRects.length === 0) {
      return;
    }

    const gl = this.gl;
    gl.useProgram(this.rasterProgram);
    gl.bindVertexArray(this.blitVao);

    gl.uniform2f(this.uRasterViewport, viewportWidth, viewportHeight);
    gl.uniform2f(this.uRasterCameraCenter, cameraCenterX, cameraCenterY);
    gl.uniform1f(this.uRasterZoom, this.zoom);

    if (this.pageRects.length > 0) {
      gl.activeTexture(gl.TEXTURE12);
      gl.bindTexture(gl.TEXTURE_2D, this.pageBackgroundTexture);
      gl.uniform1i(this.uRasterTex, 12);

      for (let i = 0; i < this.pageRects.length; i += 4) {
        const minX = this.pageRects[i];
        const minY = this.pageRects[i + 1];
        const maxX = this.pageRects[i + 2];
        const maxY = this.pageRects[i + 3];
        const width = Math.max(maxX - minX, 1e-6);
        const height = Math.max(maxY - minY, 1e-6);
        gl.uniform4f(this.uRasterMatrixABCD, width, 0, 0, height);
        gl.uniform2f(this.uRasterMatrixEF, minX, minY);
        gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
      }
    }

    if (this.rasterLayers.length === 0) {
      return;
    }

    // Raster textures are premultiplied on upload to avoid dark/gray filtering fringes.
    gl.blendFuncSeparate(gl.ONE, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
    for (const layer of this.rasterLayers) {
      gl.activeTexture(gl.TEXTURE12);
      gl.bindTexture(gl.TEXTURE_2D, layer.texture);
      gl.uniform1i(this.uRasterTex, 12);
      gl.uniform4f(
        this.uRasterMatrixABCD,
        layer.matrix[0],
        layer.matrix[1],
        layer.matrix[2],
        layer.matrix[3]
      );
      gl.uniform2f(this.uRasterMatrixEF, layer.matrix[4], layer.matrix[5]);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    }
    gl.blendFuncSeparate(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA, gl.ONE, gl.ONE_MINUS_SRC_ALPHA);
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
    const instanceCount = this.usingAllSegments ? this.segmentCount : this.visibleSegmentCount;
    if (instanceCount === 0) {
      return 0;
    }

    const gl = this.gl;

    gl.useProgram(this.segmentProgram);
    gl.bindVertexArray(this.segmentVao);

    const segmentIdBuffer = this.usingAllSegments ? this.allSegmentIdBuffer : this.visibleSegmentIdBuffer;
    gl.bindBuffer(gl.ARRAY_BUFFER, segmentIdBuffer);
    gl.enableVertexAttribArray(1);
    gl.vertexAttribPointer(1, 1, gl.FLOAT, false, 4, 0);
    gl.vertexAttribDivisor(1, 1);

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.segmentTextureA);
    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, this.segmentTextureB);
    gl.activeTexture(gl.TEXTURE2);
    gl.bindTexture(gl.TEXTURE_2D, this.segmentTextureC);
    gl.activeTexture(gl.TEXTURE3);
    gl.bindTexture(gl.TEXTURE_2D, this.segmentTextureD);

    gl.uniform1i(this.uSegmentTexA, 0);
    gl.uniform1i(this.uSegmentTexB, 1);
    gl.uniform1i(this.uSegmentStyleTex, 2);
    gl.uniform1i(this.uSegmentBoundsTex, 3);
    gl.uniform2i(this.uSegmentTexSize, this.segmentTextureWidth, this.segmentTextureHeight);
    gl.uniform2f(this.uViewport, viewportWidth, viewportHeight);
    gl.uniform2f(this.uCameraCenter, cameraCenterX, cameraCenterY);
    gl.uniform1f(this.uZoom, zoomValue);
    gl.uniform1f(this.uAAScreenPx, 1);
    gl.uniform1f(this.uStrokeCurveEnabled, this.strokeCurveEnabled ? 1 : 0);
    gl.uniform4f(
      this.uStrokeVectorOverride,
      this.vectorOverrideColor[0],
      this.vectorOverrideColor[1],
      this.vectorOverrideColor[2],
      this.vectorOverrideOpacity
    );

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, instanceCount);

    return instanceCount;
  }

  private drawTextInstances(
    viewportWidth: number,
    viewportHeight: number,
    cameraCenterX: number,
    cameraCenterY: number,
    zoomValue = this.zoom
  ): number {
    if (!this.scene || this.textInstanceCount <= 0) {
      return 0;
    }

    const gl = this.gl;

    gl.useProgram(this.textProgram);
    gl.bindVertexArray(this.textVao);

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
    gl.uniform1f(this.uTextCurveEnabled, this.strokeCurveEnabled ? 1 : 0);
    gl.uniform1f(this.uTextVectorOnly, this.textVectorOnly ? 1 : 0);
    gl.uniform4f(
      this.uTextVectorOverride,
      this.vectorOverrideColor[0],
      this.vectorOverrideColor[1],
      this.vectorOverrideColor[2],
      this.vectorOverrideOpacity
    );

    gl.drawArraysInstanced(gl.TRIANGLE_STRIP, 0, 4, this.textInstanceCount);
    return this.textInstanceCount;
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

  private uploadRasterLayers(scene: VectorScene): void {
    const gl = this.gl;
    for (const layer of this.rasterLayers) {
      gl.deleteTexture(layer.texture);
    }
    this.rasterLayers = [];

    for (const source of this.getSceneRasterLayers(scene)) {
      const texture = gl.createTexture();
      if (!texture) {
        continue;
      }

      gl.bindTexture(gl.TEXTURE_2D, texture);
      configureRasterTexture(gl);
      const pixels = source.data.subarray(0, source.width * source.height * 4);
      const premultiplied = premultiplyRgba(pixels);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, source.width, source.height, 0, gl.RGBA, gl.UNSIGNED_BYTE, premultiplied);
      gl.generateMipmap(gl.TEXTURE_2D);

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

      this.rasterLayers.push({ texture, matrix });
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
    const gl = this.gl;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

    const preferredWidth = Math.ceil(Math.sqrt(scene.segmentCount));
    this.segmentTextureWidth = clamp(preferredWidth, 1, maxTextureSize);
    this.segmentTextureHeight = Math.max(1, Math.ceil(scene.segmentCount / this.segmentTextureWidth));

    if (this.segmentTextureHeight > maxTextureSize) {
      throw new Error("Segment texture exceeds GPU limits for this browser/GPU.");
    }

    const texelCount = this.segmentTextureWidth * this.segmentTextureHeight;

    const endpointsTextureData = new Float32Array(texelCount * 4);
    endpointsTextureData.set(scene.endpoints);

    const primitiveMetaTextureData = new Float32Array(texelCount * 4);
    primitiveMetaTextureData.set(scene.primitiveMeta);

    const styleTextureData = new Float32Array(texelCount * 4);
    styleTextureData.set(scene.styles);

    const primitiveBoundsTextureData = new Float32Array(texelCount * 4);
    primitiveBoundsTextureData.set(scene.primitiveBounds);

    gl.bindTexture(gl.TEXTURE_2D, this.segmentTextureA);
    configureFloatTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      this.segmentTextureWidth,
      this.segmentTextureHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      endpointsTextureData
    );

    gl.bindTexture(gl.TEXTURE_2D, this.segmentTextureB);
    configureFloatTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      this.segmentTextureWidth,
      this.segmentTextureHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      primitiveMetaTextureData
    );

    gl.bindTexture(gl.TEXTURE_2D, this.segmentTextureC);
    configureFloatTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      this.segmentTextureWidth,
      this.segmentTextureHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      styleTextureData
    );

    gl.bindTexture(gl.TEXTURE_2D, this.segmentTextureD);
    configureFloatTexture(gl);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA32F,
      this.segmentTextureWidth,
      this.segmentTextureHeight,
      0,
      gl.RGBA,
      gl.FLOAT,
      primitiveBoundsTextureData
    );

    return {
      textureWidth: this.segmentTextureWidth,
      textureHeight: this.segmentTextureHeight,
      maxTextureSize
    };
  }

  private uploadTextData(scene: VectorScene): {
    instanceTextureWidth: number;
    instanceTextureHeight: number;
    glyphMetaTextureWidth: number;
    glyphMetaTextureHeight: number;
    glyphSegmentTextureWidth: number;
    glyphSegmentTextureHeight: number;
  } {
    const gl = this.gl;
    const maxTextureSize = gl.getParameter(gl.MAX_TEXTURE_SIZE) as number;

    const instanceDims = chooseTextureDimensions(scene.textInstanceCount, maxTextureSize);
    const glyphMetaDims = chooseTextureDimensions(scene.textGlyphCount, maxTextureSize);
    const glyphSegmentDims = chooseTextureDimensions(scene.textGlyphSegmentCount, maxTextureSize);

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
    instanceAData.set(scene.textInstanceA);

    const instanceBData = new Float32Array(instanceTexelCount * 4);
    instanceBData.set(scene.textInstanceB);

    const instanceCData = new Float32Array(instanceTexelCount * 4);
    instanceCData.set(scene.textInstanceC);

    const glyphMetaAData = new Float32Array(glyphMetaTexelCount * 4);
    glyphMetaAData.set(scene.textGlyphMetaA);

    const glyphMetaBData = new Float32Array(glyphMetaTexelCount * 4);
    glyphMetaBData.set(scene.textGlyphMetaB);

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
    glyphSegmentDataA.set(scene.textGlyphSegmentsA);

    const glyphSegmentDataB = new Float32Array(glyphSegmentTexelCount * 4);
    glyphSegmentDataB.set(scene.textGlyphSegmentsB);

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
    configureRasterTexture(gl);
    if (textRasterAtlas) {
      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        this.textRasterAtlasWidth,
        this.textRasterAtlasHeight,
        0,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        textRasterAtlas.rgba
      );
    } else {
      const transparent = new Uint8Array([0, 0, 0, 0]);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 1, 1, 0, gl.RGBA, gl.UNSIGNED_BYTE, transparent);
    }
    gl.generateMipmap(gl.TEXTURE_2D);

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
}

function configureFloatTexture(gl: WebGL2RenderingContext): void {
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
