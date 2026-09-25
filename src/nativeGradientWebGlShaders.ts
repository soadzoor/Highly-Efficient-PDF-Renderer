import { STROKE_COVERAGE_GLSL } from "./strokeCoverageShaders";
import { FILL_COVERAGE_GLSL, FILL_COVERAGE_VERTEX_GLSL } from "./fillCoverageShaders";
import { GRADIENT_PARAMETER_GLSL, GRADIENT_BACKGROUND_GLSL } from "./gradientSampling";
import { VECTOR_CLIP_GLSL } from "./vectorClipShaders";

const GRADIENT_COMMON = `
${VECTOR_CLIP_GLSL}
${GRADIENT_PARAMETER_GLSL}
${GRADIENT_BACKGROUND_GLSL}
uniform sampler2D uGradientMetaTexA;
uniform sampler2D uGradientMetaTexB;
uniform sampler2D uGradientMetaTexC;
uniform sampler2D uGradientMetaTexD;
uniform sampler2D uGradientMetaTexE;
uniform sampler2D uGradientLutTex;
uniform ivec2 uGradientMetaTexSize;
uniform int uGradientCount;

ivec2 gradientCoord(int index) {
  return ivec2(index % uGradientMetaTexSize.x, index / uGradientMetaTexSize.x);
}

vec4 samplePdfGradient(int index, vec2 scenePoint) {
  if (index < 0 || index >= uGradientCount) {
    return vec4(0.0);
  }

  ivec2 coord = gradientCoord(index);
  vec4 metaA = texelFetch(uGradientMetaTexA, coord, 0);
  vec4 metaB = texelFetch(uGradientMetaTexB, coord, 0);
  vec4 metaC = texelFetch(uGradientMetaTexC, coord, 0);
  vec4 metaD = texelFetch(uGradientMetaTexD, coord, 0);
  vec4 metaE = texelFetch(uGradientMetaTexE, coord, 0);
  vec2 point = mat2(metaB.x, metaB.y, metaB.z, metaB.w) * scenePoint + metaC.xy;

  if (
    metaA.y >= 0.5 &&
    (point.x < metaE.x || point.y < metaE.y || point.x > metaE.z || point.y > metaE.w)
  ) {
    return vec4(0.0);
  }

  vec2 parameter = heprGradientParameter(metaA, metaC, metaD, point);
  if (parameter.y < 0.5) return heprGradientBackground(metaA.w);
  float t = parameter.x;

  float lutX = (clamp(t, 0.0, 1.0) * 1023.0 + 0.5) / 1024.0;
  float lutY = (float(index) + 0.5) / float(max(uGradientCount, 1));
  return texture(uGradientLutTex, vec2(lutX, lutY));
}
`;

export const GRADIENT_FILL_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;
// GLSL ES defaults int to highp in a vertex shader and mediump in a
// fragment one, so a uniform both stages declare must say which. Texel
// indices into the segment stores also outrun mediump's 16-bit range.
precision highp int;
precision highp sampler2D;

uniform sampler2D uPathMetaTexA;
uniform sampler2D uPathMetaTexB;
uniform sampler2D uPathMetaTexC;
uniform sampler2D uPaintMetaTex;
uniform ivec2 uPathMetaTexSize;
// The band index rides in the segment store after the segments, costing no
// sampler unit of its own. A negative base means there is none.
uniform sampler2D uSegmentTexA;
uniform ivec2 uSegmentTexSize;
uniform int uBandBase;
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;
// World bounds of the paint's clip chain; nothing outside them survives the
// clip. Unclipped and projected draws receive an unbounded rectangle.
uniform vec4 uClipBounds;

flat out int vSegmentStart;
flat out int vSegmentCount;
/** (first band texel, band count, first band's y, band height); zero count scans linearly. */
flat out vec4 vBands;
flat out int vSourceGradientIndex;
flat out int vMaskGradientIndex;
flat out vec3 vSolidColor;
flat out float vAlpha;
flat out float vFillRule;
flat out float vFillHasCompanionStroke;
out vec2 vLocal;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  return ivec2(index % sizeValue.x, index / sizeValue.x);
}

vec2 cornerFromIndex(int index) {
  if (index == 0) return vec2(-1.0, -1.0);
  if (index == 1) return vec2(1.0, -1.0);
  if (index == 2) return vec2(-1.0, 1.0);
  return vec2(1.0, 1.0);
}

${FILL_COVERAGE_VERTEX_GLSL}

void main() {
  int pathIndex = gl_VertexID / 4;
  int cornerIndex = gl_VertexID - pathIndex * 4;
  ivec2 coord = coordFromIndex(pathIndex, uPathMetaTexSize);
  vec4 metaA = texelFetch(uPathMetaTexA, coord, 0);
  vec4 metaB = texelFetch(uPathMetaTexB, coord, 0);
  vec4 metaC = texelFetch(uPathMetaTexC, coord, 0);
  vec4 paintMeta = texelFetch(uPaintMetaTex, coord, 0);

  int segmentCount = int(metaA.y + 0.5);
  float alpha = metaC.w;
  vec2 corner01 = cornerFromIndex(cornerIndex) * 0.5 + 0.5;
  // Reach pixels whose footprint touches a path narrower than a pixel.
  vec2 margin = heprCoverageMargin(heprPathToPixel(mix(metaA.zw, metaB.xy, corner01),
    uUseLocalToClip, uLocalToClip, uZoom, uViewport));
  // A page-sized gradient under a small clip would otherwise shade the whole
  // page. The clip's antialiasing reaches under a pixel past its bounds, so
  // the same one-pixel margin keeps every covered fragment; a path and clip
  // farther apart than that leave nothing to draw. Projected draws, whose
  // corners have different margins, are never clamped.
  vec2 low = max(metaA.zw, uClipBounds.xy) - margin;
  vec2 high = min(metaB.xy, uClipBounds.zw) + margin;
  if (segmentCount <= 0 || alpha <= 0.001 || any(greaterThan(low, high))) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    vSegmentStart = 0;
    vSegmentCount = 0;
    vBands = vec4(0.0);
    vSourceGradientIndex = -1;
    vMaskGradientIndex = -1;
    vSolidColor = vec3(0.0);
    vAlpha = 0.0;
    vFillRule = 0.0;
    vFillHasCompanionStroke = 0.0;
    vLocal = vec2(0.0);
    return;
  }

  vec2 world = mix(low, high, corner01);
  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  } else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    gl_Position = vec4((screen / (0.5 * uViewport)) - 1.0, 0.0, 1.0);
  }

  vSegmentStart = int(metaA.x + 0.5);
  vSegmentCount = segmentCount;
  vBands = uBandBase < 0 ? vec4(0.0)
    : texelFetch(uSegmentTexA, coordFromIndex(uBandBase + pathIndex, uSegmentTexSize), 0);
  vSourceGradientIndex = int(round(paintMeta.x));
  vMaskGradientIndex = int(round(paintMeta.y));
  vSolidColor = vec3(metaB.z, metaB.w, metaC.z);
  vAlpha = alpha;
  vFillRule = metaC.x;
  vFillHasCompanionStroke = metaC.y;
  vLocal = world;
}
`;

export const GRADIENT_FILL_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
// GLSL ES defaults int to highp in a vertex shader and mediump in a
// fragment one, so a uniform both stages declare must say which. Texel
// indices into the segment stores also outrun mediump's 16-bit range.
precision highp int;
precision highp sampler2D;

uniform sampler2D uSegmentTexA;
uniform sampler2D uSegmentTexB;
uniform ivec2 uSegmentTexSize;
uniform float uAAScreenPx;
uniform vec4 uVectorOverride;
uniform vec4 uPrimitiveOverride;
uniform int uBandEntries;
${GRADIENT_COMMON}

flat in int vSegmentStart;
flat in int vSegmentCount;
flat in vec4 vBands;
flat in int vSourceGradientIndex;
flat in int vMaskGradientIndex;
flat in vec3 vSolidColor;
flat in float vAlpha;
flat in float vFillRule;
in vec2 vLocal;

out vec4 outColor;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  return ivec2(index % sizeValue.x, index / sizeValue.x);
}

${FILL_COVERAGE_GLSL}

void main() {
  // Evaluate the pixel footprint before alpha tests or per-fragment clipping.
  float dxLocal = length(vec2(dFdx(vLocal.x), dFdy(vLocal.x)));
  float dyLocal = length(vec2(dFdx(vLocal.y), dFdy(vLocal.y)));
  float aaWidth = max(max(dxLocal, dyLocal) * uAAScreenPx, 1e-4);
  vec2 footprint = max(vec2(dxLocal, dyLocal) * uAAScreenPx, vec2(1e-4));
  if (vSegmentCount <= 0 || vAlpha <= 0.001) discard;

  // Average the winding number over the footprint box. The bands spanning the
  // box's rows hold every segment that can contribute, and each integrates
  // only its own rows, so a segment held by two bands is not counted twice.
  vec4 box = vec4(vLocal - 0.5 * footprint, 1.0 / footprint);
  float winding = 0.0;
  int bandCount = int(vBands.y);
  int firstBand = 0;
  int lastBand = 0;
  if (bandCount > 0) {
    float bandHeight = vBands.w;
    firstBand = clamp(int(floor((box.y - vBands.z) / bandHeight)), 0, bandCount - 1);
    lastBand = clamp(int(floor((box.y + footprint.y - vBands.z) / bandHeight)), 0, bandCount - 1);
  }

  for (int band = firstBand; band <= lastBand; band += 1) {
    int count = vSegmentCount;
    int entry = 0;
    if (bandCount > 0) {
      vec4 range = texelFetch(uSegmentTexA, coordFromIndex(int(vBands.x) + band, uSegmentTexSize), 0);
      entry = int(range.x);
      count = int(range.y);
    }
    vec2 rows = heprBandRows(vBands, band, bandCount, box);
    for (int primitiveIndex = 0; primitiveIndex < count; primitiveIndex += 1) {
      int segment = vSegmentStart + primitiveIndex;
      if (bandCount > 0) {
        int packedIndex = entry + primitiveIndex;
        vec4 packed = texelFetch(uSegmentTexA,
          coordFromIndex(uBandEntries + (packedIndex >> 2), uSegmentTexSize), 0);
        segment = int(packed[packedIndex & 3]);
      }
      ivec2 coord = coordFromIndex(segment, uSegmentTexSize);
      vec4 primitiveA = texelFetch(uSegmentTexA, coord, 0);
      vec4 primitiveB = texelFetch(uSegmentTexB, coord, 0);
      winding += heprSegmentCoverage(primitiveA.xy, primitiveA.zw, primitiveB.xy,
        primitiveB.z >= 0.5, box, rows.x, rows.y);
    }
  }

  float coverage = heprFillCoverage(winding, vFillRule >= 0.5);

  vec4 source = vSourceGradientIndex >= 0
    ? samplePdfGradient(vSourceGradientIndex, vLocal)
    : vec4(vSolidColor, 1.0);
  float maskAlpha = vMaskGradientIndex >= 0 ? samplePdfGradient(vMaskGradientIndex, vLocal).a : 1.0;
  float alpha = coverage * vAlpha * source.a * maskAlpha;
  if (alpha <= 0.001) discard;
  vec3 baseColor = uPrimitiveOverride.a > 0.5 ? uPrimitiveOverride.rgb : source.rgb;
  vec3 color = mix(baseColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
  outColor = vec4(color, clamp(alpha, 0.0, 1.0) * heprVectorClipAA(vLocal, aaWidth));
}
`;

export const GRADIENT_STROKE_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uRunMetaTexA;
uniform sampler2D uEndpointsTex;
uniform sampler2D uPrimitiveMetaTex;
uniform sampler2D uPrimitiveBoundsTex;
uniform sampler2D uStylesTex;
uniform ivec2 uRunMetaTexSize;
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
flat out vec3 vSolidColor;
flat out float vAlpha;
flat out vec4 vClipBounds;
flat out float vHasClipBounds;
flat out int vSourceGradientIndex;
flat out int vMaskGradientIndex;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  return ivec2(index % sizeValue.x, index / sizeValue.x);
}

vec2 cornerFromIndex(int index) {
  if (index == 0) return vec2(-1.0, -1.0);
  if (index == 1) return vec2(1.0, -1.0);
  if (index == 2) return vec2(-1.0, 1.0);
  return vec2(1.0, 1.0);
}

void main() {
  int runIndex = gl_VertexID / 4;
  int cornerIndex = gl_VertexID - runIndex * 4;
  vec4 runMeta = texelFetch(uRunMetaTexA, coordFromIndex(runIndex, uRunMetaTexSize), 0);
  int segmentIndex = int(runMeta.x + 0.5) + gl_InstanceID;
  ivec2 segmentCoord = coordFromIndex(segmentIndex, uSegmentTexSize);
  vec4 primitiveA = texelFetch(uEndpointsTex, segmentCoord, 0);
  vec4 primitiveB = texelFetch(uPrimitiveMetaTex, segmentCoord, 0);
  vec4 bounds = texelFetch(uPrimitiveBoundsTex, segmentCoord, 0);
  vec4 style = texelFetch(uStylesTex, segmentCoord, 0);

  vec2 p0 = primitiveA.xy;
  vec2 p1 = primitiveA.zw;
  vec2 p2 = primitiveB.xy;
  float primitiveType = primitiveB.z;
  float packedStyle = primitiveB.w;
  float styleFlags = floor(packedStyle / 2.0 + 1e-6);
  float alpha = packedStyle - styleFlags * 2.0;
  bool isHairline = mod(styleFlags, 2.0) >= 0.5;
  bool isRoundCap = mod(floor(styleFlags * 0.5), 2.0) >= 0.5;
  bool hasClipBounds = mod(floor(styleFlags * 0.25), 2.0) >= 0.5;
  float localUnitsPerPixel = uUseLocalToClip >= 0.5 ? max(uLocalUnitsPerPixel, 1e-6) : 1.0 / max(uZoom, 1e-4);
  float halfWidth = isHairline ? max(0.5 * localUnitsPerPixel, 1e-5) : style.x;
  float aaWorld = isHairline
    ? max(0.35 * localUnitsPerPixel, 5e-5)
    : max(localUnitsPerPixel, 0.0001) * uAAScreenPx;
  float geometryLength = primitiveType >= 0.5 ? length(p1 - p0) + length(p2 - p1) : length(p2 - p0);
  if ((geometryLength == 0.0 && !isRoundCap) || alpha <= 0.001) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    vAlpha = 0.0;
    return;
  }

  float extent = halfWidth + aaWorld;
  vec2 axisDelta = p2 - p0;
  float axisLength = length(axisDelta);
  vec2 axisU = axisLength > 1e-6 ? axisDelta / axisLength : vec2(1.0, 0.0);
  vec2 axisV = vec2(-axisU.y, axisU.x);
  vec2 control = p1 - p0;
  float controlU = dot(control, axisU);
  float controlV = dot(control, axisV);
  vec2 corner01 = cornerFromIndex(cornerIndex) * 0.5 + 0.5;
  vec2 worldMin = bounds.xy - vec2(extent);
  vec2 worldMax = bounds.zw + vec2(extent);
  float minU = min(min(0.0, controlU), axisLength) - extent;
  float maxU = max(max(0.0, controlU), axisLength) + extent;
  float minV = min(0.0, controlV) - extent;
  float maxV = max(0.0, controlV) + extent;
  float axisArea = (worldMax.x - worldMin.x) * (worldMax.y - worldMin.y);
  float orientedArea = (maxU - minU) * (maxV - minV);
  vec2 world = orientedArea < axisArea
    ? p0 + axisU * mix(minU, maxU, corner01.x) + axisV * mix(minV, maxV, corner01.y)
    : mix(worldMin, worldMax, corner01);

  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  } else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    gl_Position = vec4((screen / (0.5 * uViewport)) - 1.0, 0.0, 1.0);
  }
  vLocal = world;
  vP0 = p0;
  vP1 = p1;
  vP2 = p2;
  vPrimitiveType = primitiveType;
  vIsHairline = isHairline ? 1.0 : 0.0;
  vHalfWidth = halfWidth;
  vSolidColor = style.yzw;
  vAlpha = alpha;
  vClipBounds = bounds;
  vHasClipBounds = hasClipBounds ? 1.0 : 0.0;
  vSourceGradientIndex = int(round(runMeta.z));
  vMaskGradientIndex = int(round(runMeta.w));
}
`;

export const GRADIENT_STROKE_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
${STROKE_COVERAGE_GLSL}
precision highp sampler2D;

uniform float uStrokeCurveEnabled;
uniform float uAAScreenPx;
uniform vec4 uVectorOverride;
uniform vec4 uPrimitiveOverride;
${GRADIENT_COMMON}

in vec2 vLocal;
flat in vec2 vP0;
flat in vec2 vP1;
flat in vec2 vP2;
flat in float vPrimitiveType;
flat in float vIsHairline;
flat in float vHalfWidth;
flat in vec3 vSolidColor;
flat in float vAlpha;
flat in vec4 vClipBounds;
flat in float vHasClipBounds;
flat in int vSourceGradientIndex;
flat in int vMaskGradientIndex;
out vec4 outColor;

float distanceToLine(vec2 point, vec2 start, vec2 end) {
  vec2 delta = end - start;
  float lengthSquared = dot(delta, delta);
  if (lengthSquared <= 1e-10) return length(point - start);
  float t = clamp(dot(point - start, delta) / lengthSquared, 0.0, 1.0);
  return length(point - (start + delta * t));
}

vec2 quadraticPoint(vec2 p0, vec2 p1, vec2 p2, float t) {
  float oneMinusT = 1.0 - t;
  return oneMinusT * oneMinusT * p0 + 2.0 * oneMinusT * t * p1 + t * t * p2;
}

float distanceToQuadratic(vec2 point, vec2 p0, vec2 p1, vec2 p2) {
  vec2 aa = p1 - p0;
  vec2 bb = p0 - 2.0 * p1 + p2;
  vec2 cc = aa * 2.0;
  vec2 dd = p0 - point;
  float bbLengthSquared = dot(bb, bb);
  if (bbLengthSquared <= 1e-12) return distanceToLine(point, p0, p2);
  float inverse = 1.0 / bbLengthSquared;
  float kx = inverse * dot(aa, bb);
  float ky = inverse * (2.0 * dot(aa, aa) + dot(dd, bb)) / 3.0;
  float kz = inverse * dot(dd, aa);
  float p = ky - kx * kx;
  float q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  float h = q * q + 4.0 * p * p * p;
  float best = 1e20;
  if (h >= 0.0) {
    float hSqrt = sqrt(h);
    vec2 roots = (vec2(hSqrt, -hSqrt) - q) * 0.5;
    vec2 uv = sign(roots) * pow(abs(roots), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    vec2 delta = dd + (cc + bb * t) * t;
    best = dot(delta, delta);
  } else {
    float z = sqrt(-p);
    float angle = acos(clamp(q / (2.0 * p * z), -1.0, 1.0)) / 3.0;
    float cosine = cos(angle);
    float sine = sin(angle) * 1.732050808;
    vec3 roots = clamp(vec3(cosine + cosine, -sine - cosine, sine - cosine) * z - kx, 0.0, 1.0);
    for (int rootIndex = 0; rootIndex < 3; rootIndex += 1) {
      float t = roots[rootIndex];
      vec2 delta = dd + (cc + bb * t) * t;
      best = min(best, dot(delta, delta));
    }
  }
  return sqrt(max(best, 0.0));
}

void main() {
  float dx = length(vec2(dFdx(vLocal.x), dFdy(vLocal.x)));
  float dy = length(vec2(dFdx(vLocal.y), dFdy(vLocal.y)));
  float localPerPixel = max(max(dx, dy), 1e-6);
  if (vAlpha <= 0.001) discard;
  if (
    vHasClipBounds >= 0.5 &&
    (vLocal.x < vClipBounds.x || vLocal.y < vClipBounds.y || vLocal.x > vClipBounds.z || vLocal.y > vClipBounds.w)
  ) discard;

  float distanceValue = uStrokeCurveEnabled >= 0.5 && vPrimitiveType >= 0.5
    ? distanceToQuadratic(vLocal, vP0, vP1, vP2)
    : distanceToLine(vLocal, vP0, vP2);
  float aaWorld = max(localPerPixel * uAAScreenPx, 5e-5);
  float halfWidth = vIsHairline >= 0.5 ? max(0.5 * localPerPixel, 1e-5) : vHalfWidth;
  float coverage = heprStrokeCoverage(distanceValue, halfWidth, aaWorld);

  vec4 source = vSourceGradientIndex >= 0
    ? samplePdfGradient(vSourceGradientIndex, vLocal)
    : vec4(vSolidColor, 1.0);
  float maskAlpha = vMaskGradientIndex >= 0 ? samplePdfGradient(vMaskGradientIndex, vLocal).a : 1.0;
  float alpha = coverage * vAlpha * source.a * maskAlpha;
  if (alpha <= 0.001) discard;
  vec3 baseColor = uPrimitiveOverride.a > 0.5 ? uPrimitiveOverride.rgb : source.rgb;
  vec3 color = mix(baseColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
  outColor = vec4(color, clamp(alpha, 0.0, 1.0) * heprVectorClipAA(vLocal, localPerPixel));
}
`;
