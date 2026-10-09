import { TEXT_RASTER_ATLAS_PADDING_PX } from "./textRasterAtlasConstants";
import { STROKE_COVERAGE_GLSL, STROKE_DENSITY_GLSL } from "./strokeCoverageShaders";
import { FILL_COVERAGE_GLSL, FILL_COVERAGE_VERTEX_GLSL } from "./fillCoverageShaders";
import { VECTOR_CELL_COVERAGE_GLSL } from "./vectorCellShaders";
import { RASTER_CLIP_GLSL } from "./rasterClipShaders";
import { VECTOR_INSTANCE_CLIP_GLSL } from "./vectorClipShaders";

const GLSL_OUTPUT_COLOR_HELPERS = `
vec4 heprThreeEncodeOutputColor(vec4 color) {
  // Scene colors are display/sRGB components already. The canvas framebuffer is
  // unorm, so encoding them again would wash dark colors toward gray.
  return color;
}

float heprThreeLinearCoverageToOutputAlpha(float coverage) {
  return clamp(coverage, 0.0, 1.0);
}
`;

export const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp sampler2D;

layout(location = 0) in vec2 aCorner;
layout(location = 4) in float aVectorClipIndex;
flat out float vVectorClipIndex;
layout(location = 1) in float aSegmentIndex;

uniform sampler2D uSegmentTexA;
uniform sampler2D uSegmentTexB;
uniform sampler2D uSegmentStyleTex;
uniform sampler2D uSegmentBoundsTex;
uniform ivec2 uSegmentTexSize;
#ifdef HEPR_SPLIT_STROKE_STORE
// IDs from uSegmentSplit read a second texture set, so the first can share
// the scene's own arrays (see splitStrokeTextures).
uniform sampler2D uSegmentTailTexA;
uniform sampler2D uSegmentTailTexB;
uniform sampler2D uSegmentTailStyleTex;
uniform sampler2D uSegmentTailBoundsTex;
uniform ivec2 uSegmentTailTexSize;
uniform int uSegmentSplit;
#endif
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
  vVectorClipIndex = aVectorClipIndex - 1.0;
  int index = int(aSegmentIndex);
#ifdef HEPR_SPLIT_STROKE_STORE
  vec4 primitiveA;
  vec4 primitiveB;
  vec4 style;
  vec4 primitiveBounds;
  if (index >= uSegmentSplit) {
    int tailIndex = index - uSegmentSplit;
    ivec2 tailCoord = ivec2(tailIndex % uSegmentTailTexSize.x, tailIndex / uSegmentTailTexSize.x);
    primitiveA = texelFetch(uSegmentTailTexA, tailCoord, 0);
    primitiveB = texelFetch(uSegmentTailTexB, tailCoord, 0);
    style = texelFetch(uSegmentTailStyleTex, tailCoord, 0);
    primitiveBounds = texelFetch(uSegmentTailBoundsTex, tailCoord, 0);
  } else {
    primitiveA = texelFetch(uSegmentTexA, segmentCoord(index), 0);
    primitiveB = texelFetch(uSegmentTexB, segmentCoord(index), 0);
    style = texelFetch(uSegmentStyleTex, segmentCoord(index), 0);
    primitiveBounds = texelFetch(uSegmentBoundsTex, segmentCoord(index), 0);
  }
#else
  vec4 primitiveA = texelFetch(uSegmentTexA, segmentCoord(index), 0);
  vec4 primitiveB = texelFetch(uSegmentTexB, segmentCoord(index), 0);
  vec4 style = texelFetch(uSegmentStyleTex, segmentCoord(index), 0);
  vec4 primitiveBounds = texelFetch(uSegmentBoundsTex, segmentCoord(index), 0);
#endif

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

  if ((geometryLength == 0.0 && !isRoundCap) || alpha <= 0.001) {
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

export const FRAGMENT_SHADER_SOURCE = `#version 300 es
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

${VECTOR_INSTANCE_CLIP_GLSL}
${STROKE_COVERAGE_GLSL}
${STROKE_DENSITY_GLSL}

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

  float coverage = heprStrokeCoverage(distanceToSegment, halfWidth, aaWorld);
  float alpha = heprThreeLinearCoverageToOutputAlpha(coverage) * vAlpha;
  alpha = heprStrokeLodAlpha(alpha, vPrimitiveType);

  if (alpha <= 0.0) {
    discard;
  }

  vec3 color = mix(vColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
  outColor = heprThreeEncodeOutputColor(vec4(color, alpha));
  outColor *= heprVectorClip(vLocal);
}
`;

export const FILL_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;
// GLSL ES defaults int to highp in a vertex shader and mediump in a
// fragment one, so a uniform both stages declare must say which. Texel
// indices into the segment stores also outrun mediump's 16-bit range.
precision highp int;
precision highp sampler2D;

layout(location = 0) in vec2 aCorner;
layout(location = 4) in float aVectorClipIndex;
flat out float vVectorClipIndex;
layout(location = 3) in float aFillPathIndex;

uniform sampler2D uFillPathMetaTexA;
uniform sampler2D uFillPathMetaTexB;
uniform sampler2D uFillPathMetaTexC;
uniform ivec2 uFillPathMetaTexSize;
// The band index rides in the segment store, after the segments themselves, so
// it costs no sampler unit of its own. A negative base means there is none.
uniform sampler2D uFillSegmentTexA;
uniform ivec2 uFillSegmentTexSize;
uniform int uFillBandBase;
// Per-path cell headers follow in the same store, from one less than this
// texel: zero, the value of a uniform the host never sets, means none.
uniform int uFillCellHeaders;
// Bounds have their own small store: optional clip indexes can fill the main
// clip texture without disabling quad shrinking.
uniform int uFillClipBoundsEnabled;
uniform highp sampler2D uFillClipBoundsTex;
uniform float uVectorClipIndex;
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;

flat out int vSegmentStart;
flat out int vSegmentCount;
/** (first band texel, band count, first band's y, band height); zero count scans linearly. */
flat out vec4 vFillBands;
/** (first level texel, level count, finest cell size, level step); zero count uses the bands. */
flat out vec4 vFillCells;
flat out vec2 vFillOrigin;
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

${FILL_COVERAGE_VERTEX_GLSL}

vec4 heprFillInstanceClipBounds(float instanceClipIndex) {
  // A single initialized return avoids warnings in ANGLE's HLSL translation.
  vec4 bounds = vec4(-1e38, -1e38, 1e38, 1e38);
  int clipIndex = int(uVectorClipIndex < -1.5 ? instanceClipIndex : uVectorClipIndex);
  // Projected views retain their original per-corner expansion. In the native
  // orthographic view the margin is constant, including within indirect batches.
  if (uUseLocalToClip < 0.5 && uFillClipBoundsEnabled > 0 && clipIndex >= 0) {
    bounds = texelFetch(uFillClipBoundsTex,
      coordFromIndex(clipIndex, textureSize(uFillClipBoundsTex, 0)), 0);
  }
  return bounds;
}

vec4 heprFillQuadBounds(vec2 minBounds, vec2 maxBounds, vec2 margin, vec4 clipBounds) {
  // Empty clips can contain infinite bounds; reject them before arithmetic.
  if (clipBounds.x > clipBounds.z || clipBounds.y > clipBounds.w) {
    return vec4(1.0, 1.0, 0.0, 0.0);
  }
  return vec4(max(minBounds.x, clipBounds.x) - margin.x,
    max(minBounds.y, clipBounds.y) - margin.y,
    min(maxBounds.x, clipBounds.z) + margin.x,
    min(maxBounds.y, clipBounds.w) + margin.y);
}

void heprCullFill() {
  gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
  vSegmentStart = 0;
  vSegmentCount = 0;
  vFillBands = vec4(0.0);
  vFillCells = vec4(0.0);
  vFillOrigin = vec2(0.0);
  vColor = vec3(0.0);
  vAlpha = 0.0;
  vFillRule = 0.0;
  vFillHasCompanionStroke = 0.0;
  vLocal = vec2(0.0);
}

void main() {
  vVectorClipIndex = aVectorClipIndex - 1.0;
  int pathIndex = int(aFillPathIndex);
  vec4 metaA = texelFetch(uFillPathMetaTexA, coordFromIndex(pathIndex, uFillPathMetaTexSize), 0);
  vec4 metaB = texelFetch(uFillPathMetaTexB, coordFromIndex(pathIndex, uFillPathMetaTexSize), 0);
  vec4 metaC = texelFetch(uFillPathMetaTexC, coordFromIndex(pathIndex, uFillPathMetaTexSize), 0);

  int segmentCount = int(metaA.y);
  float alpha = metaC.w;
  if (segmentCount <= 0 || alpha <= 0.001) {
    heprCullFill();
    return;
  }

  vec2 minBounds = metaA.zw;
  vec2 maxBounds = metaB.xy;
  vec2 corner01 = aCorner * 0.5 + 0.5;
  // Pixels whose footprint reaches the path need fragments even when the path
  // is thinner than a pixel and falls between pixel centres.
  vec2 margin = heprCoverageMargin(heprPathToPixel(mix(minBounds, maxBounds, corner01),
    uUseLocalToClip, uLocalToClip, uZoom, uViewport));
  margin = heprBoundCoverageMargin(mix(minBounds, maxBounds, corner01), margin, mat2(1.0),
    uUseLocalToClip, uLocalToClip, uViewport);
  vec4 quad = heprFillQuadBounds(minBounds, maxBounds, margin,
    heprFillInstanceClipBounds(vVectorClipIndex));
  if (quad.x > quad.z || quad.y > quad.w) {
    heprCullFill();
    return;
  }
  vec2 world = mix(quad.xy, quad.zw, corner01);

  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  } else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    vec2 clip = (screen / (0.5 * uViewport)) - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
  }

  vSegmentStart = int(metaA.x);
  vSegmentCount = segmentCount;
  vFillBands = uFillBandBase < 0 ? vec4(0.0)
    : texelFetch(uFillSegmentTexA, coordFromIndex(uFillBandBase + pathIndex, uFillSegmentTexSize), 0);
  vFillCells = uFillCellHeaders <= 0 ? vec4(0.0)
    : texelFetch(uFillSegmentTexA, coordFromIndex(uFillCellHeaders - 1 + pathIndex, uFillSegmentTexSize), 0);
  vFillOrigin = minBounds;
  vColor = vec3(metaB.z, metaB.w, metaC.z);
  vAlpha = alpha;
  vFillRule = metaC.x;
  vFillHasCompanionStroke = metaC.y;
  vLocal = world;
}
`;

export const FILL_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
// GLSL ES defaults int to highp in a vertex shader and mediump in a
// fragment one, so a uniform both stages declare must say which. Texel
// indices into the segment stores also outrun mediump's 16-bit range.
precision highp int;
precision highp sampler2D;

uniform sampler2D uFillSegmentTexA;
uniform sampler2D uFillSegmentTexB;
uniform ivec2 uFillSegmentTexSize;
uniform float uFillAAScreenPx;
uniform vec4 uVectorOverride;
uniform int uFillBandEntries;

flat in int vSegmentStart;
flat in int vSegmentCount;
flat in vec4 vFillBands;
flat in vec4 vFillCells;
flat in vec2 vFillOrigin;
flat in vec3 vColor;
flat in float vAlpha;
flat in float vFillRule;
in vec2 vLocal;

out vec4 outColor;

${GLSL_OUTPUT_COLOR_HELPERS}

const float FILL_PRIMITIVE_QUADRATIC = 1.0;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  int x = index % sizeValue.x;
  int y = index / sizeValue.x;
  return ivec2(x, y);
}

${FILL_COVERAGE_GLSL}

vec4 heprCellFetchA(int index) {
  return texelFetch(uFillSegmentTexA, coordFromIndex(index, uFillSegmentTexSize), 0);
}

vec4 heprCellFetchB(int index) {
  return texelFetch(uFillSegmentTexB, coordFromIndex(index, uFillSegmentTexSize), 0);
}

${VECTOR_CELL_COVERAGE_GLSL}

${VECTOR_INSTANCE_CLIP_GLSL}

void main() {
  // The path-space footprint of this pixel, taken before any discard.
  vec2 footprint = max(vec2(
    length(vec2(dFdx(vLocal.x), dFdy(vLocal.x))),
    length(vec2(dFdx(vLocal.y), dFdy(vLocal.y)))
  ) * uFillAAScreenPx, vec2(1e-4));
  if (vSegmentCount <= 0 || vAlpha <= 0.001) {
    discard;
  }

  // Average the winding number over the footprint box. A path with a cell
  // index reads only the cells under the box. Otherwise only a segment that
  // reaches the box's rows can contribute, so the bands spanning those rows
  // are the whole search. Each band integrates only its own rows, so a
  // segment listed in two bands contributes each part once.
  vec4 box = vec4(vLocal - 0.5 * footprint, 1.0 / footprint);
  float winding = 0.0;
  if (vFillCells.y > 0.0) {
    // The cell index bounds this to the geometry near the pixel at any zoom.
    winding = heprCellWinding(vFillCells, vFillOrigin, box, footprint);
  } else {
    int bandCount = int(vFillBands.y);
    int firstBand = 0;
    int lastBand = 0;
    if (bandCount > 0) {
      float bandHeight = vFillBands.w;
      firstBand = clamp(int(floor((box.y - vFillBands.z) / bandHeight)), 0, bandCount - 1);
      lastBand = clamp(int(floor((box.y + footprint.y - vFillBands.z) / bandHeight)), 0, bandCount - 1);
    }

    for (int band = firstBand; band <= lastBand; band += 1) {
      int count = vSegmentCount;
      int entry = 0;
      if (bandCount > 0) {
        vec4 range = texelFetch(uFillSegmentTexA,
          coordFromIndex(int(vFillBands.x) + band, uFillSegmentTexSize), 0);
        entry = int(range.x);
        count = int(range.y);
      }
      vec2 rows = heprBandRows(vFillBands, band, bandCount, box);
      for (int i = 0; i < count; i += 1) {
        int segment = vSegmentStart + i;
        if (bandCount > 0) {
          int packedIndex = entry + i;
          vec4 packed = texelFetch(uFillSegmentTexA,
            coordFromIndex(uFillBandEntries + (packedIndex >> 2), uFillSegmentTexSize), 0);
          segment = int(packed[packedIndex & 3]);
        }
        vec4 primitiveA = texelFetch(uFillSegmentTexA, coordFromIndex(segment, uFillSegmentTexSize), 0);
        vec4 primitiveB = texelFetch(uFillSegmentTexB, coordFromIndex(segment, uFillSegmentTexSize), 0);
        winding += heprSegmentCoverage(primitiveA.xy, primitiveA.zw, primitiveB.xy,
          primitiveB.z >= FILL_PRIMITIVE_QUADRATIC, box, rows.x, rows.y);
      }
    }
  }

  vec3 color = mix(vColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
  // A companion stroke no longer hides a hard fill edge: thin filled shapes
  // need their own coverage, and wide strokes still cover the edge.
  float coverage = heprFillCoverage(winding, vFillRule >= 0.5);
  float alpha = heprThreeLinearCoverageToOutputAlpha(coverage) * vAlpha;
  if (alpha <= 0.001) {
    discard;
  }

  outColor = heprThreeEncodeOutputColor(vec4(color, alpha));
  outColor *= heprVectorClip(vLocal);
}
`;

export const TEXT_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp sampler2D;

layout(location = 0) in vec2 aCorner;
layout(location = 4) in float aVectorClipIndex;
flat out float vVectorClipIndex;
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
flat out float vInkDensity;
out vec2 vNormCoord;
out vec2 vLocal;
out vec2 vWorld;
flat out vec4 vClipRect;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  int x = index % sizeValue.x;
  int y = index / sizeValue.x;
  return ivec2(x, y);
}

${FILL_COVERAGE_VERTEX_GLSL}

void main() {
  vVectorClipIndex = aVectorClipIndex - 1.0;
  int instanceIndex = int(aTextInstanceIndex);
  vec4 instanceA = texelFetch(uTextInstanceTexA, coordFromIndex(instanceIndex, uTextInstanceTexSize), 0);
  vec4 instanceB = texelFetch(uTextInstanceTexB, coordFromIndex(instanceIndex, uTextInstanceTexSize), 0);
  vec4 instanceC = texelFetch(uTextInstanceTexC, coordFromIndex(instanceIndex, uTextInstanceTexSize), 0);

  int glyphIndex = int(instanceB.z);
  vec4 glyphMetaA = texelFetch(uTextGlyphMetaTexA, coordFromIndex(glyphIndex, uTextGlyphMetaTexSize), 0);
  vec4 glyphMetaB = texelFetch(uTextGlyphMetaTexB, coordFromIndex(glyphIndex, uTextGlyphMetaTexSize), 0);

  int segmentCount = int(glyphMetaA.y);
  if (segmentCount <= 0) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    vSegmentStart = 0;
    vSegmentCount = 0;
    vColor = vec3(0.0);
    vColorAlpha = 0.0;
    vRasterRect = vec4(0.0);
    vInkDensity = 0.0;
    vNormCoord = vec2(0.0);
    vLocal = vec2(0.0);
    vWorld = vec2(0.0);
    vClipRect = vec4(0.0);
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
  // Widen the glyph quad by a pixel in glyph space, so stems and dots thinner
  // than a pixel reach every pixel their footprint touches.
  mat2 glyphToWorld = mat2(instanceA.x, instanceA.y, instanceA.z, instanceA.w);
  vec2 cornerWorld = glyphToWorld * mix(minBounds, maxBounds, corner01) + instanceB.xy;
  mat2 glyphToPixel = heprPathToPixel(cornerWorld, uUseLocalToClip, uLocalToClip, uZoom, uViewport) * glyphToWorld;
  vec2 margin = heprCoverageMargin(glyphToPixel);
  margin = heprBoundCoverageMarginFromPixel(cornerWorld, margin, glyphToWorld, glyphToPixel, uUseLocalToClip, uLocalToClip);
  vec2 local = mix(minBounds - margin, maxBounds + margin, corner01);

  vec2 world = vec2(
    instanceA.x * local.x + instanceA.z * local.y + instanceB.x,
    instanceA.y * local.x + instanceA.w * local.y + instanceB.y
  );
  int clipRef = int(instanceB.w);
  vClipRect = clipRef > 0
    ? texelFetch(uTextGlyphMetaTexA, coordFromIndex(clipRef - 1, uTextGlyphMetaTexSize), 0)
    : vec4(0.0);

  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  } else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    vec2 clip = (screen / (0.5 * uViewport)) - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
  }
  vSegmentStart = int(glyphMetaA.x);
  vSegmentCount = segmentCount;
  vColor = instanceC.rgb;
  vColorAlpha = instanceC.a;
  vRasterRect = glyphRasterMeta;
  vInkDensity = glyphMetaB.z;
  // Unclamped, so the margin samples the atlas tile's transparent padding.
  vNormCoord = (local - minBounds) / max(maxBounds - minBounds, vec2(1e-6));
  vLocal = local;
  vWorld = world;
}
`;

export const TEXT_FRAGMENT_SHADER_SOURCE = `#version 300 es
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
flat in vec4 vClipRect;
in vec2 vWorld;
flat in float vColorAlpha;
flat in vec4 vRasterRect;
flat in float vInkDensity;
in vec2 vNormCoord;
in vec2 vLocal;

out vec4 outColor;

${GLSL_OUTPUT_COLOR_HELPERS}

const float TEXT_PRIMITIVE_QUADRATIC = 1.0;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  int x = index % sizeValue.x;
  int y = index / sizeValue.x;
  return ivec2(x, y);
}

${FILL_COVERAGE_GLSL}

${VECTOR_INSTANCE_CLIP_GLSL}

void main() {
  if (vClipRect.z > vClipRect.x && vClipRect.w > vClipRect.y &&
      (vWorld.x < vClipRect.x || vWorld.y < vClipRect.y ||
       vWorld.x > vClipRect.z || vWorld.y > vClipRect.w)) {
    discard;
  }
  vec2 localDx = dFdx(vLocal);
  vec2 localDy = dFdy(vLocal);
  float pixelToLocalX = length(vec2(localDx.x, localDy.x));
  float pixelToLocalY = length(vec2(localDx.y, localDy.y));
  vec2 glyphPixel = vec2(
    length(vec2(dFdx(vNormCoord.x), dFdy(vNormCoord.x))),
    length(vec2(dFdx(vNormCoord.y), dFdy(vNormCoord.y)))
  );
  vec2 atlasPxSize = max(uTextRasterAtlasSize, vec2(1.0));
  vec2 nc = vec2(vNormCoord.x, 1.0 - vNormCoord.y) * (vRasterRect.zw * atlasPxSize);
  vec2 dncDx = dFdx(nc);
  vec2 dncDy = dFdy(nc);
  float ncFwidthX = abs(dncDx.x) + abs(dncDy.x);
  float ncFwidthY = abs(dncDx.y) + abs(dncDy.y);

  if (vSegmentCount <= 0) {
    discard;
  }

  // A glyph a few pixels across is its box at mean ink density, as coarse
  // text LOD runs are, so switching between them changes nothing. Its shape
  // fades in as it grows from 2.5 to 5 pixels.
  float glyphPixels = 1.0 / max(min(glyphPixel.x, glyphPixel.y), 1e-6);
  float detail = clamp((glyphPixels - 2.5) / 2.5, 0.0, 1.0);
  vec2 halfBox = max(0.5 * uTextAAScreenPx * glyphPixel, vec2(1e-6));
  vec2 boxOverlap = max(min(vNormCoord + halfBox, vec2(1.0)) - max(vNormCoord - halfBox, vec2(0.0)), vec2(0.0)) /
    (2.0 * halfBox);
  float coverage = clamp(vInkDensity, 0.0, 1.0) * boxOverlap.x * boxOverlap.y;

  if (detail > 0.0) {
    float detailCoverage = 0.0;
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
      // The widened quad reaches past the glyph box into its tile's transparent
      // padding, which must read as empty rather than repeat the edge texels.
      vec2 padding = texel * ${TEXT_RASTER_ATLAS_PADDING_PX - 0.5};
      vec2 uvMin = vRasterRect.xy - padding;
      vec2 uvMax = vRasterRect.xy + vRasterRect.zw + padding;
      vec2 tapDx = dncDx * 0.33 * texel;
      vec2 tapDy = dncDy * 0.33 * texel;
      // Scale explicit gradients by exp2(-1.25) to preserve the previous mip
      // bias while matching the WGSL anisotropic footprint exactly.
      vec2 mipBiasedUvDx = dncDx * texel * 0.42044820762685725;
      vec2 mipBiasedUvDy = dncDy * texel * 0.42044820762685725;
      // Coarser mips than the padding blend neighbouring glyphs' ink in.
      float mipCap = min(1.0, ${TEXT_RASTER_ATLAS_PADDING_PX}.0 /
        max(max(length(dncDx), length(dncDy)) * 0.42044820762685725, 1e-6));
      mipBiasedUvDx *= mipCap;
      mipBiasedUvDy *= mipCap;
      detailCoverage = (1.0 / 3.0) * textureGrad(
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
    } else {
      // Average the glyph's nonzero winding number over the pixel footprint in
      // glyph space. Thin stems keep their ink instead of snapping to pixels.
      vec2 footprint = max(vec2(pixelToLocalX, pixelToLocalY) * uTextAAScreenPx, vec2(1e-4));
      vec4 box = vec4(vLocal - 0.5 * footprint, 1.0 / footprint);
      float winding = 0.0;
      for (int i = 0; i < vSegmentCount; i += 1) {
        vec4 primitiveA = texelFetch(uTextGlyphSegmentTexA, coordFromIndex(vSegmentStart + i, uTextGlyphSegmentTexSize), 0);
        vec4 primitiveB = texelFetch(uTextGlyphSegmentTexB, coordFromIndex(vSegmentStart + i, uTextGlyphSegmentTexSize), 0);
        winding += heprSegmentCoverage(primitiveA.xy, primitiveA.zw, primitiveB.xy,
          uTextCurveEnabled >= 0.5 && primitiveB.z >= TEXT_PRIMITIVE_QUADRATIC, box, 0.0, 1.0);
      }
      detailCoverage = heprFillCoverage(winding, false);
    }
    coverage = mix(coverage, detailCoverage, detail);
  }

  float alpha = heprThreeLinearCoverageToOutputAlpha(coverage) * vColorAlpha;
  if (alpha <= 0.001) {
    discard;
  }

  vec3 color = mix(vColor, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
  outColor = heprThreeEncodeOutputColor(vec4(color, alpha));
  outColor *= heprVectorClip(vWorld);
}
`;

export const BLIT_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;

void main() {
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`;

export const VECTOR_COMPOSITE_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

uniform sampler2D uVectorLayerTex;
uniform vec2 uViewportPx;

out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / max(uViewportPx, vec2(1.0));
  outColor = texture(uVectorLayerTex, clamp(uv, vec2(0.0), vec2(1.0)));
}
`;

export const RASTER_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;

#ifdef INSTANCED_PAGE_BACKGROUNDS
layout(location = 1) in vec4 aPageRect;
#else
uniform vec4 uRasterMatrixABCD;
uniform vec2 uRasterMatrixEF;
// A tile's part of the image's unit square, and the same corners in its
// texture. Left unset (zero), they draw the whole image from one texture.
uniform vec4 uRasterQuad;
uniform vec4 uRasterUv;
#endif
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;

out vec2 vUv;
out vec2 vWorld;

void main() {
  vec2 corner01 = aCorner * 0.5 + 0.5;
  vec2 localTopDown = vec2(corner01.x, 1.0 - corner01.y);
  vec2 uv = localTopDown;

#ifdef INSTANCED_PAGE_BACKGROUNDS
  vec2 world = aPageRect.xy + aPageRect.zw * localTopDown;
#else
  float a = uRasterMatrixABCD.x;
  float b = uRasterMatrixABCD.y;
  float c = uRasterMatrixABCD.z;
  float d = uRasterMatrixABCD.w;
  float e = uRasterMatrixEF.x;
  float f = uRasterMatrixEF.y;

  bool wholeImage = uRasterQuad == vec4(0.0);
  vec4 quad = wholeImage ? vec4(0.0, 0.0, 1.0, 1.0) : uRasterQuad;
  vec4 tileUv = wholeImage ? vec4(0.0, 0.0, 1.0, 1.0) : uRasterUv;
  // Corners select, never interpolate, so neighboring tiles share exact edges.
  bvec2 farCorner = greaterThan(localTopDown, vec2(0.5));
  vec2 tileCorner = mix(quad.xy, quad.zw, farCorner);
  uv = mix(tileUv.xy, tileUv.zw, farCorner);

  vec2 world = vec2(
    a * tileCorner.x + c * tileCorner.y + e,
    b * tileCorner.x + d * tileCorner.y + f
  );
#endif

  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  } else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    vec2 clip = (screen / (0.5 * uViewport)) - 1.0;
    gl_Position = vec4(clip, 0.0, 1.0);
  }
  vWorld = world;
  vUv = uv;
}
`;

export const RASTER_FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uRasterTex;
uniform float uRasterOpacity;
in vec2 vUv;
in vec2 vWorld;
out vec4 outColor;

${RASTER_CLIP_GLSL}

void main() {
  // Polygon clip edges are antialiased; rectangular tile/page clips stay
  // solid. Measure the footprint before any discard. Color is premultiplied.
  float clipAAWidth = max(max(length(vec2(dFdx(vWorld.x), dFdy(vWorld.x))),
    length(vec2(dFdx(vWorld.y), dFdy(vWorld.y)))), 1e-4);
  vec4 color = texture(uRasterTex, vUv) * uRasterOpacity;
  if (color.a <= 0.001) {
    discard;
  }
  outColor = color;
  outColor *= heprVectorClipAA(vWorld, clipAAWidth);
}
`;

export const HIGHLIGHT_VERTEX_SHADER_SOURCE = `#version 300 es
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

export const HIGHLIGHT_FRAGMENT_SHADER_SOURCE = `#version 300 es
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

