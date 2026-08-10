const GRADIENT_COMMON = `
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

  vec2 p0 = metaC.zw;
  vec2 p1 = metaD.xy;
  vec2 axis = p1 - p0;
  float t = 0.0;
  if (metaA.x < 0.5) {
    float denominator = dot(axis, axis);
    if (denominator <= 1e-12) {
      return vec4(0.0);
    }
    t = dot(point - p0, axis) / denominator;
  } else {
    float radius0 = metaD.z;
    float radiusDelta = metaD.w - radius0;
    vec2 offset = point - p0;
    float coefficientA = dot(axis, axis) - radiusDelta * radiusDelta;
    float coefficientB = -2.0 * (dot(offset, axis) + radius0 * radiusDelta);
    float coefficientC = dot(offset, offset) - radius0 * radius0;
    float firstRoot = -1e20;
    float secondRoot = -1e20;
    if (abs(coefficientA) <= 1e-10) {
      if (abs(coefficientB) <= 1e-10) {
        return vec4(0.0);
      }
      firstRoot = -coefficientC / coefficientB;
    } else {
      float discriminant = coefficientB * coefficientB - 4.0 * coefficientA * coefficientC;
      if (discriminant < 0.0) {
        return vec4(0.0);
      }
      float rootDelta = sqrt(max(discriminant, 0.0));
      firstRoot = (-coefficientB - rootDelta) / (2.0 * coefficientA);
      secondRoot = (-coefficientB + rootDelta) / (2.0 * coefficientA);
    }
    bool firstValid = firstRoot > -1e19 && radius0 + firstRoot * radiusDelta >= 0.0;
    bool secondValid = secondRoot > -1e19 && radius0 + secondRoot * radiusDelta >= 0.0;
    if (!firstValid && !secondValid) {
      return vec4(0.0);
    }
    t = secondValid ? secondRoot : firstRoot;
    if (firstValid && secondValid) {
      t = max(firstRoot, secondRoot);
    }
  }

  float lutX = (clamp(t, 0.0, 1.0) * 1023.0 + 0.5) / 1024.0;
  float lutY = (float(index) + 0.5) / float(max(uGradientCount, 1));
  return texture(uGradientLutTex, vec2(lutX, lutY));
}
`;

export const GRADIENT_FILL_VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;
precision highp sampler2D;

uniform sampler2D uPathMetaTexA;
uniform sampler2D uPathMetaTexB;
uniform sampler2D uPathMetaTexC;
uniform sampler2D uPaintMetaTex;
uniform ivec2 uPathMetaTexSize;
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;

flat out int vSegmentStart;
flat out int vSegmentCount;
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
  if (segmentCount <= 0 || alpha <= 0.001) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    vSegmentStart = 0;
    vSegmentCount = 0;
    vSourceGradientIndex = -1;
    vMaskGradientIndex = -1;
    vSolidColor = vec3(0.0);
    vAlpha = 0.0;
    vFillRule = 0.0;
    vFillHasCompanionStroke = 0.0;
    vLocal = vec2(0.0);
    return;
  }

  vec2 corner01 = cornerFromIndex(cornerIndex) * 0.5 + 0.5;
  vec2 world = mix(metaA.zw, metaB.xy, corner01);
  if (uUseLocalToClip >= 0.5) {
    gl_Position = uLocalToClip * vec4(world, 0.0, 1.0);
  } else {
    vec2 screen = (world - uCameraCenter) * uZoom + 0.5 * uViewport;
    gl_Position = vec4((screen / (0.5 * uViewport)) - 1.0, 0.0, 1.0);
  }

  vSegmentStart = int(metaA.x + 0.5);
  vSegmentCount = segmentCount;
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
precision highp sampler2D;

uniform sampler2D uSegmentTexA;
uniform sampler2D uSegmentTexB;
uniform ivec2 uSegmentTexSize;
uniform float uAAScreenPx;
uniform vec4 uVectorOverride;
${GRADIENT_COMMON}

flat in int vSegmentStart;
flat in int vSegmentCount;
flat in int vSourceGradientIndex;
flat in int vMaskGradientIndex;
flat in vec3 vSolidColor;
flat in float vAlpha;
flat in float vFillRule;
flat in float vFillHasCompanionStroke;
in vec2 vLocal;

out vec4 outColor;

const int MAX_PATH_PRIMITIVES = 2048;
const int QUADRATIC_STEPS = 8;

ivec2 coordFromIndex(int index, ivec2 sizeValue) {
  return ivec2(index % sizeValue.x, index / sizeValue.x);
}

float distanceToLine(vec2 point, vec2 start, vec2 end) {
  vec2 delta = end - start;
  float lengthSquared = dot(delta, delta);
  if (lengthSquared <= 1e-10) return length(point - start);
  float t = clamp(dot(point - start, delta) / lengthSquared, 0.0, 1.0);
  return length(point - (start + delta * t));
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

vec2 quadraticPoint(vec2 p0, vec2 p1, vec2 p2, float t) {
  float oneMinusT = 1.0 - t;
  return oneMinusT * oneMinusT * p0 + 2.0 * oneMinusT * t * p1 + t * t * p2;
}

void accumulateCrossing(vec2 start, vec2 end, vec2 point, inout int winding, inout int crossings) {
  bool upward = start.y <= point.y && end.y > point.y;
  bool downward = start.y > point.y && end.y <= point.y;
  if (!upward && !downward) return;
  float denominator = end.y - start.y;
  if (abs(denominator) <= 1e-6) return;
  float x = start.x + (point.y - start.y) * (end.x - start.x) / denominator;
  if (x > point.x) {
    crossings += 1;
    winding += upward ? 1 : -1;
  }
}

void main() {
  if (vSegmentCount <= 0 || vAlpha <= 0.001) discard;
  float minDistance = 1e20;
  int winding = 0;
  int crossings = 0;

  for (int primitiveIndex = 0; primitiveIndex < MAX_PATH_PRIMITIVES; primitiveIndex += 1) {
    if (primitiveIndex >= vSegmentCount) break;
    ivec2 coord = coordFromIndex(vSegmentStart + primitiveIndex, uSegmentTexSize);
    vec4 primitiveA = texelFetch(uSegmentTexA, coord, 0);
    vec4 primitiveB = texelFetch(uSegmentTexB, coord, 0);
    vec2 p0 = primitiveA.xy;
    vec2 p1 = primitiveA.zw;
    vec2 p2 = primitiveB.xy;
    if (primitiveB.z >= 0.5) {
      minDistance = min(minDistance, distanceToQuadratic(vLocal, p0, p1, p2));
      vec2 previous = p0;
      for (int step = 1; step <= QUADRATIC_STEPS; step += 1) {
        vec2 next = quadraticPoint(p0, p1, p2, float(step) / float(QUADRATIC_STEPS));
        accumulateCrossing(previous, next, vLocal, winding, crossings);
        previous = next;
      }
    } else {
      minDistance = min(minDistance, distanceToLine(vLocal, p0, p2));
      accumulateCrossing(p0, p2, vLocal, winding, crossings);
    }
  }

  bool inside = vFillRule >= 0.5 ? ((crossings & 1) == 1) : (winding != 0);
  float coverage;
  if (vFillHasCompanionStroke >= 0.5) {
    coverage = inside ? 1.0 : 0.0;
  } else {
    float signedDistance = inside ? -minDistance : minDistance;
    float dx = length(vec2(dFdx(vLocal.x), dFdy(vLocal.x)));
    float dy = length(vec2(dFdx(vLocal.y), dFdy(vLocal.y)));
    float aaWidth = max(max(dx, dy) * uAAScreenPx, 1e-4);
    coverage = clamp(0.5 - signedDistance / aaWidth, 0.0, 1.0);
  }

  vec4 source = vSourceGradientIndex >= 0
    ? samplePdfGradient(vSourceGradientIndex, vLocal)
    : vec4(vSolidColor, 1.0);
  float maskAlpha = vMaskGradientIndex >= 0 ? samplePdfGradient(vMaskGradientIndex, vLocal).a : 1.0;
  float alpha = coverage * vAlpha * source.a * maskAlpha;
  if (alpha <= 0.001) discard;
  vec3 color = mix(source.rgb, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
  outColor = vec4(color, clamp(alpha, 0.0, 1.0));
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
  if ((geometryLength < 1e-5 && !isRoundCap) || alpha <= 0.001) {
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
precision highp sampler2D;

uniform float uStrokeCurveEnabled;
uniform float uAAScreenPx;
uniform vec4 uVectorOverride;
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
  if (vAlpha <= 0.001) discard;
  if (
    vHasClipBounds >= 0.5 &&
    (vLocal.x < vClipBounds.x || vLocal.y < vClipBounds.y || vLocal.x > vClipBounds.z || vLocal.y > vClipBounds.w)
  ) discard;

  float distanceValue = uStrokeCurveEnabled >= 0.5 && vPrimitiveType >= 0.5
    ? distanceToQuadratic(vLocal, vP0, vP1, vP2)
    : distanceToLine(vLocal, vP0, vP2);
  float dx = length(vec2(dFdx(vLocal.x), dFdy(vLocal.x)));
  float dy = length(vec2(dFdx(vLocal.y), dFdy(vLocal.y)));
  float localPerPixel = max(max(dx, dy), 1e-6);
  float aaWorld = max(localPerPixel * uAAScreenPx, 5e-5);
  float halfWidth = vIsHairline >= 0.5 ? max(0.5 * localPerPixel, 1e-5) : vHalfWidth;
  float coverage = 1.0 - smoothstep(halfWidth - aaWorld, halfWidth + aaWorld, distanceValue);

  vec4 source = vSourceGradientIndex >= 0
    ? samplePdfGradient(vSourceGradientIndex, vLocal)
    : vec4(vSolidColor, 1.0);
  float maskAlpha = vMaskGradientIndex >= 0 ? samplePdfGradient(vMaskGradientIndex, vLocal).a : 1.0;
  float alpha = coverage * vAlpha * source.a * maskAlpha;
  if (alpha <= 0.001) discard;
  vec3 color = mix(source.rgb, uVectorOverride.rgb, clamp(uVectorOverride.a, 0.0, 1.0));
  outColor = vec4(color, clamp(alpha, 0.0, 1.0));
}
`;
