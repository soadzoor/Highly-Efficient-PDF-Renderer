import{At as e,Ct as t,Dt as n,Et as r,Ft as i,Mt as a,Nt as o,Pt as s,St as c,T as l,Tt as u,Yr as d,b as f,cr as p,dr as m,ei as h,fr as g,ii as _,jt as ee,mr as v,ni as te,pr as ne,ri as re,ti as y,w as b}from"./drawCallMetrics-D8SN3rSM.js";import{_ as x,h as S,m as C}from"./structureData-DMK2kZdU.js";import{c as w,o as T,u as E}from"./scenePaintGraph-BzrmcX_0.js";import{o as D,s as O}from"./textRasterAtlas-BNR5i65a.js";import{n as k,t as A}from"./vectorFillBandShaders-CRyg2aoB.js";var j=`
${t}
${re}
${y}
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
`,M=`#version 300 es
precision highp float;



precision highp int;
precision highp sampler2D;

uniform sampler2D uPathMetaTexA;
uniform sampler2D uPathMetaTexB;
uniform sampler2D uPathMetaTexC;
uniform sampler2D uPaintMetaTex;
uniform ivec2 uPathMetaTexSize;


uniform sampler2D uSegmentTexA;
uniform ivec2 uSegmentTexSize;
uniform int uBandBase;


uniform int uCellHeaders;
uniform vec2 uViewport;
uniform vec2 uCameraCenter;
uniform float uZoom;
uniform float uUseLocalToClip;
uniform mat4 uLocalToClip;


uniform vec4 uClipBounds;

flat out int vSegmentStart;
flat out int vSegmentCount;

flat out vec4 vBands;

flat out vec4 vCells;
flat out vec2 vCellOrigin;
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

${ee}

void main() {
  int pathIndex = gl_VertexID / 4;
  int cornerIndex = gl_VertexID - pathIndex * 4;
  ivec2 coord = coordFromIndex(pathIndex, uPathMetaTexSize);
  vec4 metaA = texelFetch(uPathMetaTexA, coord, 0);
  vec4 metaB = texelFetch(uPathMetaTexB, coord, 0);
  vec4 metaC = texelFetch(uPathMetaTexC, coord, 0);
  vec4 paintMeta = texelFetch(uPaintMetaTex, coord, 0);

  int segmentCount = int(metaA.y);
  float alpha = metaC.w;
  vec2 corner01 = cornerFromIndex(cornerIndex) * 0.5 + 0.5;
  
  vec2 margin = heprCoverageMargin(heprPathToPixel(mix(metaA.zw, metaB.xy, corner01),
    uUseLocalToClip, uLocalToClip, uZoom, uViewport));
  margin = heprBoundCoverageMargin(mix(max(metaA.zw, uClipBounds.xy), min(metaB.xy, uClipBounds.zw), corner01),
    margin, mat2(1.0), uUseLocalToClip, uLocalToClip, uViewport);
  
  
  
  
  
  vec2 low = max(metaA.zw, uClipBounds.xy) - margin;
  vec2 high = min(metaB.xy, uClipBounds.zw) + margin;
  if (segmentCount <= 0 || alpha <= 0.001 || any(greaterThan(low, high))) {
    gl_Position = vec4(-2.0, -2.0, 0.0, 1.0);
    vSegmentStart = 0;
    vSegmentCount = 0;
    vBands = vec4(0.0);
    vCells = vec4(0.0);
    vCellOrigin = vec2(0.0);
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

  vSegmentStart = int(metaA.x);
  vSegmentCount = segmentCount;
  vBands = uBandBase < 0 ? vec4(0.0)
    : texelFetch(uSegmentTexA, coordFromIndex(uBandBase + pathIndex, uSegmentTexSize), 0);
  vCells = uCellHeaders <= 0 ? vec4(0.0)
    : texelFetch(uSegmentTexA, coordFromIndex(uCellHeaders - 1 + pathIndex, uSegmentTexSize), 0);
  vCellOrigin = metaA.zw;
  vSourceGradientIndex = int(round(paintMeta.x));
  vMaskGradientIndex = int(round(paintMeta.y));
  vSolidColor = vec3(metaB.z, metaB.w, metaC.z);
  vAlpha = alpha;
  vFillRule = metaC.x;
  vFillHasCompanionStroke = metaC.y;
  vLocal = world;
}
`,N=`#version 300 es
precision highp float;



precision highp int;
precision highp sampler2D;

uniform sampler2D uSegmentTexA;
uniform sampler2D uSegmentTexB;
uniform ivec2 uSegmentTexSize;
uniform float uAAScreenPx;
uniform vec4 uVectorOverride;
uniform vec4 uPrimitiveOverride;
uniform int uBandEntries;
${j}

flat in int vSegmentStart;
flat in int vSegmentCount;
flat in vec4 vBands;
flat in vec4 vCells;
flat in vec2 vCellOrigin;
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

${e}

vec4 heprCellFetchA(int index) {
  return texelFetch(uSegmentTexA, coordFromIndex(index, uSegmentTexSize), 0);
}

vec4 heprCellFetchB(int index) {
  return texelFetch(uSegmentTexB, coordFromIndex(index, uSegmentTexSize), 0);
}

${u}

void main() {
  
  float dxLocal = length(vec2(dFdx(vLocal.x), dFdy(vLocal.x)));
  float dyLocal = length(vec2(dFdx(vLocal.y), dFdy(vLocal.y)));
  float aaWidth = max(max(dxLocal, dyLocal) * uAAScreenPx, 1e-4);
  vec2 footprint = max(vec2(dxLocal, dyLocal) * uAAScreenPx, vec2(1e-4));
  if (vSegmentCount <= 0 || vAlpha <= 0.001) discard;

  
  
  
  
  vec4 box = vec4(vLocal - 0.5 * footprint, 1.0 / footprint);
  float winding = 0.0;
  if (vCells.y > 0.0) {
    winding = heprCellWinding(vCells, vCellOrigin, box, footprint);
  } else {
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
`,P=`#version 300 es
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
  int segmentIndex = int(runMeta.x) + gl_InstanceID;
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
`,F=`#version 300 es
precision highp float;
${s}
precision highp sampler2D;

uniform float uStrokeCurveEnabled;
uniform float uAAScreenPx;
uniform vec4 uVectorOverride;
uniform vec4 uPrimitiveOverride;
${j}

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
`,I=`
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
  fillBands : vec4f,
  fillCells : vec4f,
};
`,L=`
@group(2) @binding(0) var<uniform> uPrimitiveOverride : vec4f;
@group(1) @binding(0) var uVectorClipTex : texture_2d<f32>;
// x of index is the paint's clip; bounds are its clip chain's world bounds,
// unbounded for unclipped and per-instance clips.
struct VectorClipUniform { index : vec4f, bounds : vec4f };
@group(1) @binding(1) var<uniform> uVectorClip : VectorClipUniform;
@group(0) @binding(GRADIENT_META_A_BINDING) var uGradientMetaA : texture_2d<f32>;
@group(0) @binding(GRADIENT_META_B_BINDING) var uGradientMetaB : texture_2d<f32>;
@group(0) @binding(GRADIENT_META_C_BINDING) var uGradientMetaC : texture_2d<f32>;
@group(0) @binding(GRADIENT_META_D_BINDING) var uGradientMetaD : texture_2d<f32>;
@group(0) @binding(GRADIENT_META_E_BINDING) var uGradientMetaE : texture_2d<f32>;
@group(0) @binding(GRADIENT_SAMPLER_BINDING) var uGradientSampler : sampler;
@group(0) @binding(GRADIENT_LUT_BINDING) var uGradientLut : texture_2d<f32>;
`,R=`
${c}
fn gradientCoord(index : i32) -> vec2i {
  let dimensions = textureDimensions(uGradientMetaA);
  return vec2i(index % i32(dimensions.x), index / i32(dimensions.x));
}

${_}
${te}

fn samplePdfGradient(index : i32, scenePoint : vec2f) -> vec4f {
  let gradientCount = i32(textureDimensions(uGradientLut).y);
  if (index < 0 || index >= gradientCount) {
    return vec4f(0.0);
  }
  let coord = gradientCoord(index);
  let metaA = textureLoad(uGradientMetaA, coord, 0);
  let metaB = textureLoad(uGradientMetaB, coord, 0);
  let metaC = textureLoad(uGradientMetaC, coord, 0);
  let metaD = textureLoad(uGradientMetaD, coord, 0);
  let metaE = textureLoad(uGradientMetaE, coord, 0);
  let transform = mat2x2f(vec2f(metaB.x, metaB.y), vec2f(metaB.z, metaB.w));
  let point = transform * scenePoint + metaC.xy;

  if (
    metaA.y >= 0.5 &&
    (point.x < metaE.x || point.y < metaE.y || point.x > metaE.z || point.y > metaE.w)
  ) {
    return vec4f(0.0);
  }

  let parameter = heprGradientParameter(metaA, metaC, metaD, point);
  if (parameter.y < 0.5) { return heprGradientBackground(metaA.w); }
  let t = parameter.x;

  let lutX = (clamp(t, 0.0, 1.0) * 1023.0 + 0.5) / 1024.0;
  let lutY = (f32(index) + 0.5) / f32(max(gradientCount, 1));
  return textureSampleLevel(uGradientLut, uGradientSampler, vec2f(lutX, lutY), 0.0);
}

fn cornerFromVertexIndex(vertexIndex : u32) -> vec2f {
  switch (vertexIndex & 3u) {
    case 0u: { return vec2f(-1.0, -1.0); }
    case 1u: { return vec2f(1.0, -1.0); }
    case 2u: { return vec2f(-1.0, 1.0); }
    default: { return vec2f(1.0, 1.0); }
  }
}

fn coordFromIndex(index : i32, width : i32) -> vec2i {
  return vec2i(index % width, index / width);
}

fn distanceToLine(point : vec2f, start : vec2f, end : vec2f) -> f32 {
  let delta = end - start;
  let lengthSquared = dot(delta, delta);
  if (lengthSquared <= 1e-10) {
    return length(point - start);
  }
  let t = clamp(dot(point - start, delta) / lengthSquared, 0.0, 1.0);
  return length(point - (start + delta * t));
}

fn distanceToQuadratic(point : vec2f, p0 : vec2f, p1 : vec2f, p2 : vec2f) -> f32 {
  let aa = p1 - p0;
  let bb = p0 - 2.0 * p1 + p2;
  let cc = aa * 2.0;
  let dd = p0 - point;
  let bbLengthSquared = dot(bb, bb);
  if (bbLengthSquared <= 1e-12) {
    return distanceToLine(point, p0, p2);
  }
  let inverse = 1.0 / bbLengthSquared;
  let kx = inverse * dot(aa, bb);
  let ky = inverse * (2.0 * dot(aa, aa) + dot(dd, bb)) / 3.0;
  let kz = inverse * dot(dd, aa);
  let p = ky - kx * kx;
  let q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  let h = q * q + 4.0 * p * p * p;
  var best = 1e20;
  if (h >= 0.0) {
    let hSqrt = sqrt(h);
    let roots = (vec2f(hSqrt, -hSqrt) - q) * 0.5;
    let uv = sign(roots) * pow(abs(roots), vec2f(1.0 / 3.0));
    let t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    let delta = dd + (cc + bb * t) * t;
    best = dot(delta, delta);
  } else {
    let z = sqrt(-p);
    let angle = acos(clamp(q / (2.0 * p * z), -1.0, 1.0)) / 3.0;
    let cosine = cos(angle);
    let sine = sin(angle) * 1.732050808;
    let roots = clamp(vec3f(cosine + cosine, -sine - cosine, sine - cosine) * z - kx, vec3f(0.0), vec3f(1.0));
    for (var rootIndex = 0; rootIndex < 3; rootIndex = rootIndex + 1) {
      let t = roots[rootIndex];
      let delta = dd + (cc + bb * t) * t;
      best = min(best, dot(delta, delta));
    }
  }
  return sqrt(max(best, 0.0));
}

fn quadraticPoint(p0 : vec2f, p1 : vec2f, p2 : vec2f, t : f32) -> vec2f {
  let oneMinusT = 1.0 - t;
  return oneMinusT * oneMinusT * p0 + 2.0 * oneMinusT * t * p1 + t * t * p2;
}
`;function z(e){return L.replace(`GRADIENT_META_A_BINDING`,String(e)).replace(`GRADIENT_META_B_BINDING`,String(e+1)).replace(`GRADIENT_META_C_BINDING`,String(e+2)).replace(`GRADIENT_META_D_BINDING`,String(e+3)).replace(`GRADIENT_META_E_BINDING`,String(e+4)).replace(`GRADIENT_SAMPLER_BINDING`,String(e+5)).replace(`GRADIENT_LUT_BINDING`,String(e+6))}var B=`
${I}
@group(0) @binding(0) var<uniform> uCamera : CameraUniforms;
@group(0) @binding(1) var uPathMetaA : texture_2d<f32>;
@group(0) @binding(2) var uPathMetaB : texture_2d<f32>;
@group(0) @binding(3) var uPathMetaC : texture_2d<f32>;
@group(0) @binding(4) var uPaintMeta : texture_2d<f32>;
@group(0) @binding(5) var uSegmentsA : texture_2d<f32>;
@group(0) @binding(6) var uSegmentsB : texture_2d<f32>;
${z(7)}
${R}
${A}
${n}
${o}
${a}
${r}

struct FillOut {
  @builtin(position) position : vec4f,
  @location(0) local : vec2f,
  @location(1) @interpolate(flat) segmentStart : i32,
  @location(2) @interpolate(flat) segmentCount : i32,
  @location(3) @interpolate(flat) solidColor : vec3f,
  @location(4) @interpolate(flat) alpha : f32,
  @location(5) @interpolate(flat) fillRule : f32,
  @location(6) @interpolate(flat) companionStroke : f32,
  @location(7) @interpolate(flat) sourceGradient : i32,
  @location(8) @interpolate(flat) maskGradient : i32,
  @location(9) @interpolate(flat) bands : vec4f,
  @location(10) @interpolate(flat) cells : vec4f,
  @location(11) @interpolate(flat) origin : vec2f,
};

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> FillOut {
  let pathIndex = i32(vertexIndex / 4u);
  let dimensions = textureDimensions(uPathMetaA);
  let coord = coordFromIndex(pathIndex, i32(dimensions.x));
  let metaA = textureLoad(uPathMetaA, coord, 0);
  let metaB = textureLoad(uPathMetaB, coord, 0);
  let metaC = textureLoad(uPathMetaC, coord, 0);
  let paintMeta = textureLoad(uPaintMeta, coord, 0);
  let segmentCount = i32(metaA.y);
  let alpha = metaC.w;
  var out : FillOut;
  out.bands = heprFillBandInfo(f32(pathIndex), uCamera.fillBands.z, uSegmentsA);
  out.cells = heprFillCellInfo(f32(pathIndex), uCamera.fillCells.y, uSegmentsA);
  out.origin = metaA.zw;
  
  let margin = heprCoverageMargin(mat2x2f(uCamera.zoom, 0.0, 0.0, uCamera.zoom));
  
  
  let low = max(metaA.zw, uVectorClip.bounds.xy) - margin;
  let high = min(metaB.xy, uVectorClip.bounds.zw) + margin;
  if (segmentCount <= 0 || alpha <= 0.001 || any(low > high)) {
    out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
    out.local = vec2f(0.0);
    out.segmentStart = 0;
    out.segmentCount = 0;
    out.solidColor = vec3f(0.0);
    out.alpha = 0.0;
    out.fillRule = 0.0;
    out.companionStroke = 0.0;
    out.sourceGradient = -1;
    out.maskGradient = -1;
    return out;
  }
  let corner = cornerFromVertexIndex(vertexIndex) * 0.5 + 0.5;
  let world = mix(low, high, corner);
  let screen = (world - uCamera.cameraCenter) * uCamera.zoom + 0.5 * uCamera.viewport;
  out.position = vec4f((screen / (0.5 * uCamera.viewport)) - 1.0, 0.0, 1.0);
  out.local = world;
  out.segmentStart = i32(metaA.x);
  out.segmentCount = segmentCount;
  out.solidColor = vec3f(metaB.z, metaB.w, metaC.z);
  out.alpha = alpha;
  out.fillRule = metaC.x;
  out.companionStroke = metaC.y;
  out.sourceGradient = i32(round(paintMeta.x));
  out.maskGradient = i32(round(paintMeta.y));
  return out;
}

@fragment
fn fsMain(inData : FillOut) -> @location(0) vec4f {
  
  
  let dx = length(vec2f(dpdx(inData.local.x), dpdy(inData.local.x)));
  let dy = length(vec2f(dpdx(inData.local.y), dpdy(inData.local.y)));
  let aaWidth = max(max(dx, dy) * uCamera.fillAAScreenPx, 1e-4);
  let footprint = max(vec2f(dx, dy) * uCamera.fillAAScreenPx, vec2f(1e-4));
  if (inData.segmentCount <= 0 || inData.alpha <= 0.001) { discard; }
  let dimensions = textureDimensions(uSegmentsA);
  
  
  
  let box = vec4f(inData.local - 0.5 * footprint, 1.0 / footprint);
  var winding = 0.0;
  if (inData.cells.y > 0.0) {
    winding = heprCellWinding(inData.cells, inData.origin, box, footprint, uSegmentsA, uSegmentsB);
  } else {
${k({bands:`inData.bands`,y:`inData.local.y`,radius:`0.5 * footprint.y`,count:`inData.segmentCount`,start:`inData.segmentStart`,texture:`uSegmentsA`,entries:`uCamera.fillBands.w`,setup:`let rows = heprBandRows(bandInfo, band, bandCount, box);`,edge:`
    let coord = coordFromIndex(segmentIndex, i32(dimensions.x));
    let primitiveA = textureLoad(uSegmentsA, coord, 0);
    let primitiveB = textureLoad(uSegmentsB, coord, 0);
    winding = winding + heprSegmentCoverage(primitiveA.xy, primitiveA.zw, primitiveB.xy,
      primitiveB.z >= 0.5, box, rows.x, rows.y);
`})}
  }
  let coverage = heprFillCoverage(winding, inData.fillRule >= 0.5);
  let source = select(vec4f(inData.solidColor, 1.0), samplePdfGradient(inData.sourceGradient, inData.local), inData.sourceGradient >= 0);
  let maskAlpha = select(1.0, samplePdfGradient(inData.maskGradient, inData.local).a, inData.maskGradient >= 0);
  let alpha = coverage * inData.alpha * source.a * maskAlpha;
  if (alpha <= 0.001) { discard; }
  let baseColor = select(source.rgb, uPrimitiveOverride.rgb, uPrimitiveOverride.a > 0.5);
  let color = mix(baseColor, uCamera.vectorOverride.xyz, clamp(uCamera.vectorOverride.w, 0.0, 1.0));
  return vec4f(color, clamp(alpha, 0.0, 1.0) * heprVectorClipAA(inData.local, uVectorClip.index.x, uVectorClipTex, aaWidth));
}
`,V=`
${i}
${I}
@group(0) @binding(0) var<uniform> uCamera : CameraUniforms;
@group(0) @binding(1) var uRunMetaA : texture_2d<f32>;
@group(0) @binding(2) var uEndpoints : texture_2d<f32>;
@group(0) @binding(3) var uPrimitiveMeta : texture_2d<f32>;
@group(0) @binding(4) var uPrimitiveBounds : texture_2d<f32>;
@group(0) @binding(5) var uStyles : texture_2d<f32>;
${z(6)}
${R}

struct StrokeOut {
  @builtin(position) position : vec4f,
  @location(0) local : vec2f,
  @location(1) @interpolate(flat) p0 : vec2f,
  @location(2) @interpolate(flat) p1 : vec2f,
  @location(3) @interpolate(flat) p2 : vec2f,
  @location(4) @interpolate(flat) primitiveType : f32,
  @location(5) @interpolate(flat) halfWidth : f32,
  @location(6) @interpolate(flat) solidColor : vec3f,
  @location(7) @interpolate(flat) alpha : f32,
  @location(8) @interpolate(flat) clipBounds : vec4f,
  @location(9) @interpolate(flat) hasClipBounds : f32,
  @location(10) @interpolate(flat) sourceGradient : i32,
  @location(11) @interpolate(flat) maskGradient : i32,
};

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32, @builtin(instance_index) instanceIndex : u32) -> StrokeOut {
  let runIndex = i32(vertexIndex / 4u);
  let runDimensions = textureDimensions(uRunMetaA);
  let runMeta = textureLoad(uRunMetaA, coordFromIndex(runIndex, i32(runDimensions.x)), 0);
  let segmentIndex = i32(runMeta.x) + i32(instanceIndex);
  let segmentDimensions = textureDimensions(uEndpoints);
  let coord = coordFromIndex(segmentIndex, i32(segmentDimensions.x));
  let primitiveA = textureLoad(uEndpoints, coord, 0);
  let primitiveB = textureLoad(uPrimitiveMeta, coord, 0);
  let bounds = textureLoad(uPrimitiveBounds, coord, 0);
  let style = textureLoad(uStyles, coord, 0);
  let p0 = primitiveA.xy;
  let p1 = primitiveA.zw;
  let p2 = primitiveB.xy;
  let packedStyle = primitiveB.w;
  let flags = i32(floor(packedStyle / 2.0 + 1e-6));
  let alpha = clamp(packedStyle - f32(flags) * 2.0, 0.0, 1.0);
  let hairline = (flags & 1) != 0;
  let roundCap = (flags & 2) != 0;
  let clipped = (flags & 4) != 0;
  let geometryLength = select(length(p2 - p0), length(p1 - p0) + length(p2 - p1), primitiveB.z >= 0.5);
  var out : StrokeOut;
  if ((geometryLength == 0.0 && !roundCap) || alpha <= 0.001) {
    out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
    out.local = vec2f(0.0);
    out.p0 = vec2f(0.0);
    out.p1 = vec2f(0.0);
    out.p2 = vec2f(0.0);
    out.primitiveType = 0.0;
    out.halfWidth = 0.0;
    out.solidColor = vec3f(0.0);
    out.alpha = 0.0;
    out.clipBounds = vec4f(0.0);
    out.hasClipBounds = 0.0;
    out.sourceGradient = -1;
    out.maskGradient = -1;
    return out;
  }
  let localPerPixel = 1.0 / max(uCamera.zoom, 1e-4);
  let halfWidth = select(style.x, max(0.5 * localPerPixel, 1e-5), hairline);
  let aaWorld = select(
    max(localPerPixel, 0.0001) * uCamera.strokeAAScreenPx,
    max(0.35 * localPerPixel, 5e-5),
    hairline
  );
  let extent = halfWidth + aaWorld;
  let corner = cornerFromVertexIndex(vertexIndex) * 0.5 + 0.5;
  let world = mix(bounds.xy - vec2f(extent), bounds.zw + vec2f(extent), corner);
  let screen = (world - uCamera.cameraCenter) * uCamera.zoom + 0.5 * uCamera.viewport;
  out.position = vec4f((screen / (0.5 * uCamera.viewport)) - 1.0, 0.0, 1.0);
  out.local = world;
  out.p0 = p0;
  out.p1 = p1;
  out.p2 = p2;
  out.primitiveType = primitiveB.z;
  out.halfWidth = halfWidth;
  out.solidColor = style.yzw;
  out.alpha = alpha;
  out.clipBounds = bounds;
  out.hasClipBounds = select(0.0, 1.0, clipped);
  out.sourceGradient = i32(round(runMeta.z));
  out.maskGradient = i32(round(runMeta.w));
  return out;
}

@fragment
fn fsMain(inData : StrokeOut) -> @location(0) vec4f {
  
  
  let dx = length(vec2f(dpdx(inData.local.x), dpdy(inData.local.x)));
  let dy = length(vec2f(dpdx(inData.local.y), dpdy(inData.local.y)));
  let localPerPixel = max(max(dx, dy), 1e-6);
  if (inData.alpha <= 0.001) { discard; }
  if (
    inData.hasClipBounds >= 0.5 &&
    (inData.local.x < inData.clipBounds.x || inData.local.y < inData.clipBounds.y ||
      inData.local.x > inData.clipBounds.z || inData.local.y > inData.clipBounds.w)
  ) { discard; }
  let distanceValue = select(
    distanceToLine(inData.local, inData.p0, inData.p2),
    distanceToQuadratic(inData.local, inData.p0, inData.p1, inData.p2),
    uCamera.strokeCurveEnabled >= 0.5 && inData.primitiveType >= 0.5
  );
  let aaWorld = max(localPerPixel * uCamera.strokeAAScreenPx, 5e-5);
  let coverage = heprStrokeCoverage(distanceValue, inData.halfWidth, aaWorld);
  let source = select(vec4f(inData.solidColor, 1.0), samplePdfGradient(inData.sourceGradient, inData.local), inData.sourceGradient >= 0);
  let maskAlpha = select(1.0, samplePdfGradient(inData.maskGradient, inData.local).a, inData.maskGradient >= 0);
  let alpha = coverage * inData.alpha * source.a * maskAlpha;
  if (alpha <= 0.001) { discard; }
  let baseColor = select(source.rgb, uPrimitiveOverride.rgb, uPrimitiveOverride.a > 0.5);
  let color = mix(baseColor, uCamera.vectorOverride.xyz, clamp(uCamera.vectorOverride.w, 0.0, 1.0));
  return vec4f(color, clamp(alpha, 0.0, 1.0) * heprVectorClipAA(inData.local, uVectorClip.index.x, uVectorClipTex, localPerPixel));
}
`,H=M.replace(`uniform sampler2D uPathMetaTexA;`,`layout(location=0) in vec2 aMeshPosition;
layout(location=1) in vec4 aMeshColor;
uniform int uMeshPathIndex;
out vec4 vMeshColor;
uniform sampler2D uPathMetaTexA;`).replace(`int pathIndex = gl_VertexID / 4;`,`vMeshColor = aMeshColor;
  int pathIndex = uMeshPathIndex;`).replace(`vec2 world = mix(low, high, corner01);`,`vec2 world = aMeshPosition;`),U=N.replace(`uniform sampler2D uSegmentTexA;`,`in vec4 vMeshColor;
uniform sampler2D uSegmentTexA;`).replace(`vec4 source = vSourceGradientIndex >= 0
    ? samplePdfGradient(vSourceGradientIndex, vLocal)
    : vec4(vSolidColor, 1.0);`,`vec4 source = vMeshColor;
  ivec2 meshCoord = gradientCoord(vSourceGradientIndex);
  vec4 meshA = texelFetch(uGradientMetaTexA, meshCoord, 0);
  vec4 meshB = texelFetch(uGradientMetaTexB, meshCoord, 0);
  vec4 meshC = texelFetch(uGradientMetaTexC, meshCoord, 0);
  vec4 meshE = texelFetch(uGradientMetaTexE, meshCoord, 0);
  vec2 meshPoint = mat2(meshB.x, meshB.y, meshB.z, meshB.w) * vLocal + meshC.xy;
  if (meshA.y >= 0.5 && (meshPoint.x < meshE.x || meshPoint.y < meshE.y || meshPoint.x > meshE.z || meshPoint.y > meshE.w)) discard;`),W=B.replace(`struct FillOut {`,`struct FillOut {
  @location(12) meshColor : vec4f,`).replace(`fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> FillOut {`,`fn vsMain(@builtin(vertex_index) vertexIndex : u32, @builtin(instance_index) paintIndex : u32,
    @location(0) meshPosition : vec2f, @location(1) meshColor : vec4f) -> FillOut {`).replace(`let pathIndex = i32(vertexIndex / 4u);`,`let pathIndex = i32(paintIndex);`).replace(`var out : FillOut;`,`var out : FillOut;
  out.meshColor = meshColor;`).replace(`let world = mix(low, high, corner);`,`let world = meshPosition;`).replace(`let source = select(vec4f(inData.solidColor, 1.0), samplePdfGradient(inData.sourceGradient, inData.local), inData.sourceGradient >= 0);`,`let source = inData.meshColor;
  let meshCoord = gradientCoord(inData.sourceGradient);
  let meshA = textureLoad(uGradientMetaA, meshCoord, 0);
  let meshB = textureLoad(uGradientMetaB, meshCoord, 0);
  let meshC = textureLoad(uGradientMetaC, meshCoord, 0);
  let meshE = textureLoad(uGradientMetaE, meshCoord, 0);
  let meshPoint = mat2x2f(meshB.xy, meshB.zw) * inData.local + meshC.xy;
  if (meshA.y >= 0.5 && (meshPoint.x < meshE.x || meshPoint.y < meshE.y || meshPoint.x > meshE.z || meshPoint.y > meshE.w)) { discard; }`),G=[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:`float32x2`},{shaderLocation:1,offset:8,format:`float32x4`}]}];function K(e){let t=e.drawRuns;if(!t)return null;let n=new Map;t.forEach((e,t)=>{let r=n.get(e.kind);r?r.push(t):n.set(e.kind,[t])});let r=new Map;for(let[e,i]of n)i.sort((e,n)=>t[e].first-t[n].first),r.set(e,{firsts:Int32Array.from(i,e=>t[e].first),ends:Int32Array.from(i,e=>t[e].first+t[e].count),indices:Int32Array.from(i)});return r}function q(e,t,n){let r=e?.get(t);if(!r)return-1;let i=0,a=r.firsts.length-1,o=-1;for(;i<=a;){let e=i+a>>1;r.firsts[e]<=n?(o=e,i=e+1):a=e-1}return o<0||n>=r.ends[o]?-1:o}function J(e,t,n,r,i){let a=1/0,o=-1/0;if(t&&n&&t.spanOrdered){let i=new Set,s=!0;for(let c of e){let e=r?.get(c.kind),l=q(r,c.kind,c.first),u=c.first,d=u+c.count;for(;e&&l>=0&&u<d;){let r=e.indices[l];if(e.firsts[l]!==u||e.ends[l]>d||!t.scheduledRuns[r]||i.has(r))break;i.add(r),a=Math.min(a,n[r]),o=Math.max(o,n[r]),u=e.ends[l++]}if(u!==d){s=!1;break}}(!s||i.size!==t.scheduledSpanRunCount(a,o))&&(a=1/0,o=-1/0)}if(!t||a>o){for(let t of e)i(t);return}let s=t.batchSegments,c=0,l=s.length-1;for(;c<=l;){let e=c+l>>1;s[e]<a?c=e+1:l=e-1}for(let e=c;e<t.batches.length&&s[e]<=o;e++)i(t.batches[e])}function Y(e,t){let n=new Map;for(let t of e){let e=n.get(t.kind);e||n.set(t.kind,e=new Map),e.set(t.index,t)}let r=[];for(let[e,i]of n){let n=[...i.values()].sort((e,t)=>e.index-t.index),a=t[e];for(let t=0;t<n.length;){let i=n[t],o=Math.floor(i.index/a),s=t+1;for(;s<n.length&&n[s].index===n[s-1].index+1&&Math.floor(n[s].index/a)===o;)s++;let c=s-t,l=c===1?i.pixels:i.pixels instanceof Uint8Array?new Uint8Array(c*4):new Float32Array(c*4);if(c>1)for(let e=t;e<s;e++)l.set(n[e].pixels,(e-t)*4);r.push({kind:e,index:i.index,count:c,pixels:l}),t=s}}return r}var X=class{colors=new Map;scene;constructor(e){this.scene=e}update(e){for(let t of e){if(h(this.scene,t.ref),t.ref.kind===`raster`)throw TypeError(`Raster primitives cannot be recolored.`);if(t.color&&(t.color.length!==3||!t.color.every(e=>Number.isFinite(e)&&e>=0&&e<=1)))throw TypeError(`Primitive colors must contain three normalized channels.`)}let t=e.flatMap(e=>ie(this.scene,e));for(let t of e)t.color?this.colors.set(d(t.ref),{ref:{...t.ref},color:[...t.color]}):this.colors.delete(d(t.ref));return t}updates(){return[...this.colors.values()]}has(e){for(let t of this.colors.values())if(t.ref.kind===e)return!0;return!1}gradient(e,t){return this.colors.get(`${e}:${t}`)?.color??null}};function ie(e,{ref:t,color:n}){let r=t.index*4;if(t.kind===`stroke`){let i=e.styles.slice(r,r+4);return n&&i.set(n,1),[{kind:`stroke`,index:t.index,pixels:i}]}if(t.kind===`fill`){let i=e.fillPathMetaB.slice(r,r+4),a=e.fillPathMetaC.slice(r,r+4);return n&&(i[2]=n[0],i[3]=n[1],a[2]=n[2]),[{kind:`fillB`,index:t.index,pixels:i},{kind:`fillC`,index:t.index,pixels:a}]}if(t.kind===`text`){let i=new Uint8Array(4);for(let t=0;t<4;t++){let a=t<3&&n?n[t]:e.textInstanceC[r+t];i[t]=Math.round(Math.max(0,Math.min(1,a))*255)}return[{kind:`text`,index:t.index,pixels:i}]}return[]}var ae=class{entries=new Map;device;layout;constructor(e,t){this.device=e,this.layout=t}update(e){for(let{ref:t,color:n}of e){if(t.kind!==`gradient-fill`&&t.kind!==`gradient-stroke`)continue;let e=d(t),r=this.entries.get(e);if(!n){r?.buffer.destroy(),this.entries.delete(e);continue}let i=r??this.createEntry();this.device.queue.writeBuffer(i.buffer,0,new Float32Array([...n,1])),this.entries.set(e,i)}}bindGroup(e,t){let n=this.entries.get(`${e}:${t}`);if(n)return n.bindGroup;let r=this.entries.get(`default`);return r||(r=this.createEntry(),this.entries.set(`default`,r)),r.bindGroup}dispose(){for(let e of this.entries.values())e.buffer.destroy();this.entries.clear()}createEntry(){let e=globalThis.GPUBufferUsage,t=this.device.createBuffer({size:16,usage:e.UNIFORM|e.COPY_DST});return{buffer:t,bindGroup:this.device.createBindGroup({layout:this.layout,entries:[{binding:0,resource:{buffer:t}}]})}}};function Z(e,t){let n=x(e.clipPaths,Math.min(S,t**2)),r=Math.max(1,Math.min(t,Math.ceil(Math.sqrt(n.length/4)))),i=Math.max(1,Math.ceil(n.length/4/r));if(i>t)throw RangeError(`Primitive highlight clips exceed GPU limits.`);let a=new Float32Array(r*i*4);return a.set(n),{data:a,width:r,height:i}}var oe=class{program;buffer;vao;clips;uniforms={};count=0;selectionCount=0;matrix=new Float32Array(16);capacityBytes=0;clipWidth=0;clipHeight=0;gl;constructor(e,t){this.gl=e,this.program=t(b.replace(`layout(location=2) in float aHighlightIndex;`,``).replace(`aHighlightIndex <`,`float(gl_InstanceID) <`),f);let n=e.createBuffer(),r=e.createVertexArray(),i=e.createTexture();if(!n||!r||!i)throw e.deleteBuffer(n),e.deleteVertexArray(r),e.deleteTexture(i),e.deleteProgram(this.program),Error(`Unable to allocate primitive highlight resources.`);this.buffer=n,this.vao=r,this.clips=i;for(let t of[`uLocalToClip`,`uLocalUnitsPerPixel`,`uPixelRatio`,`uSelectionCount`,`uVectorClipTex`])this.uniforms[t]=e.getUniformLocation(this.program,t);e.bindVertexArray(r),e.bindBuffer(e.ARRAY_BUFFER,n);for(let t=0;t<2;t++)e.enableVertexAttribArray(t),e.vertexAttribPointer(t,4,e.FLOAT,!1,32,t*16),e.vertexAttribDivisor(t,1);e.bindVertexArray(null)}set(e){if(this.count=e?.count??0,this.selectionCount=e?.selectionCount??0,!e||!this.count)return;let t=this.gl,n=Z(e,t.getParameter(t.MAX_TEXTURE_SIZE));t.bindBuffer(t.ARRAY_BUFFER,this.buffer),this.capacityBytes<this.count*32&&(this.capacityBytes=Math.max(this.count*32,this.capacityBytes*2,1024),t.bufferData(t.ARRAY_BUFFER,this.capacityBytes,t.DYNAMIC_DRAW)),t.bufferSubData(t.ARRAY_BUFFER,0,e.segments.subarray(0,this.count*8)),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,this.clips),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),this.clipWidth!==n.width||this.clipHeight!==n.height?(this.clipWidth=n.width,this.clipHeight=n.height,t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,n.width,n.height,0,t.RGBA,t.FLOAT,n.data)):t.texSubImage2D(t.TEXTURE_2D,0,0,0,n.width,n.height,t.RGBA,t.FLOAT,n.data)}draw(e,t,n){if(!this.count)return 0;let r=this.gl;return this.matrix.set(e),r.useProgram(this.program),r.uniformMatrix4fv(this.uniforms.uLocalToClip,!1,this.matrix),r.uniform1f(this.uniforms.uLocalUnitsPerPixel,t),r.uniform1f(this.uniforms.uPixelRatio,n),r.uniform1f(this.uniforms.uSelectionCount,this.selectionCount),r.activeTexture(r.TEXTURE0),r.bindTexture(r.TEXTURE_2D,this.clips),r.uniform1i(this.uniforms.uVectorClipTex,0),r.enable(r.BLEND),r.blendFuncSeparate(r.SRC_ALPHA,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA),r.bindVertexArray(this.vao),r.drawArraysInstanced(r.TRIANGLE_STRIP,0,4,this.count),r.bindVertexArray(null),1}dispose(){this.gl.deleteProgram(this.program),this.gl.deleteBuffer(this.buffer),this.gl.deleteVertexArray(this.vao),this.gl.deleteTexture(this.clips)}},se=class{pipeline;camera;segments=null;clips=null;bindGroup=null;count=0;selectionCount=0;cameraData=new Float32Array(20);device;capacityBytes=0;clipWidth=0;clipHeight=0;constructor(e,t){this.device=e;let n=globalThis.GPUBufferUsage;this.camera=e.createBuffer({size:80,usage:n.UNIFORM|n.COPY_DST});let r=e.createShaderModule({code:l}),i=globalThis.GPUShaderStage,a=e.createBindGroupLayout({entries:[{binding:0,visibility:i.VERTEX|i.FRAGMENT,buffer:{type:`uniform`,minBindingSize:80}},{binding:1,visibility:i.VERTEX,buffer:{type:`read-only-storage`}},{binding:2,visibility:i.FRAGMENT,texture:{sampleType:`unfilterable-float`}}]});this.pipeline=e.createRenderPipeline({layout:e.createPipelineLayout({bindGroupLayouts:[a]}),vertex:{module:r,entryPoint:`vsMain`},fragment:{module:r,entryPoint:`fsMain`,targets:[{format:t,blend:{color:{srcFactor:`src-alpha`,dstFactor:`one-minus-src-alpha`,operation:`add`},alpha:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`,operation:`add`}}}]},primitive:{topology:`triangle-strip`}})}set(e){if(this.count=e?.count??0,this.selectionCount=e?.selectionCount??0,!e||!this.count)return;let t=globalThis.GPUBufferUsage,n=globalThis.GPUTextureUsage,r=Z(e,this.device.limits.maxTextureDimension2D),i=!1;this.capacityBytes<this.count*32&&(this.segments?.destroy(),this.capacityBytes=Math.max(this.count*32,this.capacityBytes*2,1024),this.segments=this.device.createBuffer({size:this.capacityBytes,usage:t.STORAGE|t.COPY_DST}),i=!0),this.device.queue.writeBuffer(this.segments,0,e.segments.subarray(0,this.count*8)),(this.clipWidth!==r.width||this.clipHeight!==r.height)&&(this.clips?.destroy(),this.clipWidth=r.width,this.clipHeight=r.height,this.clips=this.device.createTexture({size:[r.width,r.height],format:`rgba32float`,usage:n.TEXTURE_BINDING|n.COPY_DST}),i=!0),this.device.queue.writeTexture({texture:this.clips},r.data,{bytesPerRow:r.width*16},[r.width,r.height]),(i||!this.bindGroup)&&(this.bindGroup=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.camera}},{binding:1,resource:{buffer:this.segments}},{binding:2,resource:this.clips.createView()}]}))}draw(e,t,n,r){return!this.count||!this.bindGroup?0:(this.cameraData.set(t,0),this.cameraData.set([n,r,this.selectionCount,0],16),this.device.queue.writeBuffer(this.camera,0,this.cameraData),e.setPipeline(this.pipeline),e.setBindGroup(0,this.bindGroup),e.draw(4,this.count),1)}dispose(){this.camera.destroy(),this.segments?.destroy(),this.clips?.destroy()}},Q=class e{clipCodes;originals;clearances;padding=NaN;static create(t,n){return!t.clipPaths?.length||!t.drawRuns?.some(e=>e.clipIndex!==void 0&&(e.kind===`stroke`||e.kind===`fill`||e.kind===`text`))?null:new e(t,n)}constructor(e,t){let n=e.drawRuns;this.clipCodes=Uint32Array.from(n,e=>(e.clipIndex??-1)+1),this.originals=this.clipCodes.slice(),this.clearances=new Float64Array(n.length).fill(-1/0);let r=x(e.clipPaths),i=new w(e,t),a=[0,0,0,0];n.forEach((e,t)=>{if(e.clipIndex===void 0||e.kind!==`stroke`&&e.kind!==`fill`&&e.kind!==`text`)return;let n=e.clipIndex*4;if(r[n]!==-1||r[n+2]!==-1)return;let o=r[n+1]*4;i.getUnclippedBounds(t,0,a),!(!a.every(Number.isFinite)||a[0]>a[2]||a[1]>a[3])&&(this.clearances[t]=Math.min(a[0]-r[o],a[1]-r[o+1],r[o+2]-a[2],r[o+3]-a[3]))})}update(e){let t=e!==null&&Number.isFinite(e)&&e>0?Math.max(.001,4*2**Math.ceil(Math.log2(Math.max(1e-6,e)))):1/0;if(t===this.padding)return!1;this.padding=t;let n=!1;for(let e=0;e<this.clipCodes.length;e++){let r=this.clearances[e]>t?0:this.originals[e];this.clipCodes[e]!==r&&(this.clipCodes[e]=r,n=!0)}return n}},ce=class{batches=[];batchSegments=[];spanOrdered=!0;scheduledRuns;scheduledSpanPrefix;floatInstanceData=new Float32Array;uintInstanceData=new Uint32Array(2);floatInstancesDirty=!0;get floatInstances(){return this.floatInstanceData.length<this.uintInstanceData.length&&(this.floatInstanceData=new Float32Array(this.uintInstanceData.length)),this.floatInstancesDirty&&=(this.floatInstanceData.set(this.uintInstanceData.subarray(0,this.instanceCount*2)),!1),this.floatInstanceData}get uintInstances(){return this.uintInstanceData}strokeRecords;cullingPadding;instanceCount=0;culledSegmentCount=0;get paintOrderApproximated(){return this.scheduler?.paintOrderApproximated??!1}runtime;runIndices=new Map;rankToId;idToRank;runRankOffsets;layout=null;selectionLimit;selectedRanks=new Uint32Array;selectedRankBits;selectedRankWords;orderedSelectedCount=0;previousSelectedIds=new Uint32Array;previousSelectedCount=0;sourceRuns;runRanges;visiblePaints=[];scheduler;segments;clipElision;redundancy;redundancyIds=new Uint32Array;redundancyEnabled=!0;previousSelectedRanks=new Uint32Array;previousRankCount=0;previousRuns=[];previousRunsAreSource=!1;initialized=!1;dirty=!0;orderDirty=!1;textSelection=null;textSelectionRevision=0;constructor(e,t){this.runtime=t,this.cullingPadding=(t?.levels.at(-1)?.tolerance??0)*2;let n=e.drawRuns;this.sourceRuns=n,this.runRanges=new Uint32Array(n.length*2);let r=new Uint32Array(e.segmentCount);n.forEach((e,t)=>{this.runIndices.set(e,t),e.kind===`stroke`&&r.fill(t,e.first,e.first+e.count)}),this.strokeRecords=E(e);let i=v(e)??le(e.segmentCount);this.selectionLimit=e.segmentCount,t&&(this.layout=m(e,t.levels),this.strokeRecords=ne(this.layout),i=g(this.layout),this.selectionLimit=t.levels.reduce((e,t)=>e+t.segmentCount,0));let a=this.strokeRecords.count;this.rankToId=new Uint32Array(a),this.idToRank=new Uint32Array(a),this.runRankOffsets=new Uint32Array(n.length+1),this.selectedRankBits=new Uint32Array(Math.ceil(a/32)),this.selectedRankWords=new Uint32Array(Math.ceil(this.selectedRankBits.length/32));let o=new Uint32Array(e.segmentCount);for(let e=0;e<a;e++)o[i[e]]++;for(let e=0;e<o.length;e++)this.runRankOffsets[r[e]+1]+=o[e];for(let e=1;e<this.runRankOffsets.length;e++)this.runRankOffsets[e]+=this.runRankOffsets[e-1];let s=this.runRankOffsets.slice(0,-1);for(let e=0;e<o.length;e++){let t=r[e],n=o[e];o[e]=s[t],s[t]+=n}let c=new Uint32Array(a);for(let e=0;e<a;e++){let t=i[e],n=o[t]++;this.rankToId[n]=e,this.idToRank[e]=n,c[e]=r[t]}this.segments=p(e)?T(e):null;let l=0;for(let e of this.segments??[])l=Math.max(l,e);this.scheduledSpanPrefix=new Uint32Array(l+2),this.scheduler=O.create(e,this.strokeRecords,c,this.segments),this.clipElision=Q.create(e,{records:this.strokeRecords,sourceRuns:c}),this.redundancy=new D(e,{records:this.strokeRecords,sourceRuns:c}),this.scheduledRuns=new Uint8Array(n.length)}scheduledSpanRunCount(e,t){return this.scheduledSpanPrefix[t+1]-this.scheduledSpanPrefix[e]}invalidate(){this.dirty=!0}setTextSelection(e){let t=e?.revision??0;(this.textSelection!==e||this.textSelectionRevision!==t)&&(e&&this.scheduler?.includeTextLod(e.data),this.textSelection=e,this.textSelectionRevision=t,this.orderDirty=!0)}setColorCommutationEnabled(e){((this.scheduler?.setColorCommutationEnabled(e)??!1)||this.redundancyEnabled!==e)&&(this.redundancyEnabled=e,this.orderDirty=!0,this.dirty=!0)}update(e,t=null){let n=this.clipElision?.update(t)??!1,r=(this.scheduler?.updateScale(t)??!1)||this.orderDirty||n;this.orderDirty=!1;let i=this.initialized&&e.length===this.previousRuns.length;if(i&&!(e===this.sourceRuns&&this.previousRunsAreSource)){for(let t=0;t<e.length;t++)if(e[t]!==this.previousRuns[t]){i=!1;break}}if(i&&(this.previousRunsAreSource=e===this.sourceRuns),!this.dirty&&i&&!r)return!1;this.dirty=!1;let a=0,o=this.initialized;if(this.runtime){let e=this.layout,t=this.runtime.levels.reduce((e,t)=>e+t.visibleSegmentCount,0);this.previousSelectedIds=$(this.previousSelectedIds,t,this.selectionLimit,!0),this.selectedRanks=$(this.selectedRanks,t,this.idToRank.length),this.runtime.levels.forEach((t,n)=>{let r=e.records[n],i=e.bases[n];for(let e=0;e<t.visibleSegmentCount;e++){let n=t.visibleSegmentIds[e],s=r?r[n]:i+n;this.previousSelectedIds[a]!==s&&(o=!1),this.previousSelectedIds[a++]=s}})}if(o&&=a===this.previousSelectedCount,this.previousSelectedCount=a,o&&i&&!r)return!1;if(!o){for(let e=0;e<a;e++){let t=this.idToRank[this.previousSelectedIds[e]],n=t>>>5;this.selectedRankBits[n]|=1<<(t&31),this.selectedRankWords[n>>>5]|=1<<(n&31)}let e=0;for(let t=0;t<this.selectedRankWords.length;t++){let n=this.selectedRankWords[t];for(this.selectedRankWords[t]=0;n!==0;){let r=t*32+31-Math.clz32(n&-n),i=this.selectedRankBits[r];for(this.selectedRankBits[r]=0;i!==0;)this.selectedRanks[e++]=r*32+31-Math.clz32(i&-i),i=(i&i-1)>>>0;n=(n&n-1)>>>0}}this.orderedSelectedCount=e}a=this.orderedSelectedCount;let s=i&&a===this.previousRankCount;if(s){for(let e=0;e<a;e++)if(this.previousSelectedRanks[e]!==this.selectedRanks[e]){s=!1;break}}if(s&&!r)return!1;if(this.initialized=!0,!i){this.previousRuns.length=e.length;for(let t=0;t<e.length;t++)this.previousRuns[t]=e[t]}this.previousRunsAreSource=e===this.sourceRuns,this.previousSelectedRanks.length<a&&(this.previousSelectedRanks=new Uint32Array(Math.min(this.selectedRanks.length,Math.max(a,this.previousSelectedRanks.length*2)))),this.previousSelectedRanks.set(this.selectedRanks.subarray(0,a)),this.previousRankCount=a,this.batches.length=0,this.batchSegments.length=0,this.spanOrdered=!0,this.instanceCount=0,this.culledSegmentCount=0,this.visiblePaints.length=0,this.scheduledRuns.fill(0),this.scheduledSpanPrefix.fill(0);let c=0;for(let t of e){let e=this.runIndices.get(t);this.scheduledRuns[e]=1,this.scheduledSpanPrefix[(this.segments?.[e]??0)+1]++;let n=t.first,r=t.count;if(t.kind===`stroke`&&this.runtime){for(;c<a&&this.selectedRanks[c]<this.runRankOffsets[e];)c++;for(n=c;c<a&&this.selectedRanks[c]<this.runRankOffsets[e+1];)c++;r=c-n}t.kind===`text`&&this.textSelection&&(n=this.textSelection.ranges[e*2],r=this.textSelection.ranges[e*2+1]),r!==0&&(this.runRanges[e*2]=n,this.runRanges[e*2+1]=r,this.visiblePaints.push(e))}for(let e=1;e<this.scheduledSpanPrefix.length;e++)this.scheduledSpanPrefix[e]+=this.scheduledSpanPrefix[e-1];let l=0,u=0;for(let e of this.visiblePaints){let t=this.sourceRuns[e].kind,n=this.runRanges[e*2+1];t===`stroke`&&(l+=n),(t===`stroke`||t===`fill`||t===`text`)&&(u+=n)}if(this.uintInstanceData=$(this.uintInstanceData,u*2),this.redundancyEnabled){this.redundancyIds=$(this.redundancyIds,Math.min(l,this.redundancy.candidateCount),this.rankToId.length);let e=0;for(let t of this.visiblePaints){if(this.sourceRuns[t].kind!==`stroke`)continue;let n=this.runRanges[t*2],r=n+this.runRanges[t*2+1];for(let t=n;t<r;t++){let n=this.runtime?this.rankToId[this.selectedRanks[t]]:t;this.redundancy.isCandidate(n)&&(e===this.redundancyIds.length&&(this.redundancyIds=$(this.redundancyIds,e+1,1/0,!0)),this.redundancyIds[e++]=n)}}this.redundancy.update(this.redundancyIds,e),this.culledSegmentCount=this.redundancy.culledCount}let d=this.scheduler?.schedule(this.visiblePaints)??this.visiblePaints;for(let e of d){let t=this.sourceRuns[e],n=this.segments?this.segments[e]:0,r=this.runRanges[e*2],i=this.runRanges[e*2+1];if(t.kind!==`stroke`&&t.kind!==`fill`&&t.kind!==`text`){this.pushBatch({...t},n);continue}let a=this.instanceCount,o=t.kind===`text`&&this.textSelection?(t.clipIndex??-1)+1:this.clipElision?.clipCodes[e]??(t.clipIndex??-1)+1;if(t.kind===`text`&&this.textSelection)for(let e=r;e<r+i;e++)this.appendInstance(this.textSelection.instanceIds[e],o);else if(t.kind===`stroke`&&this.runtime)for(let e=r;e<r+i;e++){let t=this.rankToId[this.selectedRanks[e]];(!this.redundancyEnabled||this.redundancy.isRetained(t))&&this.appendInstance(t,o)}else for(let e=r;e<r+i;e++)(t.kind!==`stroke`||!this.redundancyEnabled||this.redundancy.isRetained(e))&&this.appendInstance(e,o);let s=this.instanceCount-a;if(!s)continue;let c=this.batches[this.batches.length-1];c?.kind===t.kind&&c.clipIndex===-2&&c.blendMode===t.blendMode&&this.batchSegments[this.batches.length-1]===n?c.count+=s:this.pushBatch({kind:t.kind,first:a,count:s,clipIndex:-2,...t.blendMode?{blendMode:t.blendMode}:{}},n)}return this.floatInstancesDirty=!0,!0}pushBatch(e,t){let n=this.batches[this.batches.length-1];if(e.kind===`raster`&&!e.blendMode&&C(n,e)&&this.batchSegments[this.batchSegments.length-1]===t){n.count+=e.count;return}t<(this.batchSegments[this.batchSegments.length-1]??0)&&(this.spanOrdered=!1),this.batches.push(e),this.batchSegments.push(t)}appendInstance(e,t){let n=this.instanceCount*2;this.uintInstances[n]=e,this.uintInstances[n+1]=t,this.instanceCount++}};function le(e){let t=new Uint32Array(e);for(let n=0;n<e;n++)t[n]=n;return t}function $(e,t,n=1/0,r=!1){if(e.length>=t)return e;let i=new Uint32Array(Math.min(n,Math.max(t,e.length*2,256)));return r&&i.set(e),i}var ue=1e5;function de(e,t){return e>ue&&t===0}function fe(e){let t=e?Math.floor(e.count):0,n=e&&Number.isFinite(t)?Math.min(Math.max(0,t),Math.floor(e.rects.length/4)):0;if(!e||n===0)return null;let r=Math.floor(e.currentIndex),i=r>=0&&r<n?r:-1,a=Math.floor(e.currentCount??1),o=i>=0?Math.min(Number.isFinite(a)?Math.max(1,a):1,n-i):0,s=i+o,c=n-o,l=new Float32Array(c*4),u=0;for(let t=0;t<n;t+=1)t>=i&&t<s||(l.set(e.rects.subarray(t*4,t*4+4),u*4),u+=1);return{otherRects:l,otherCount:c,currentRects:o>0?e.rects.slice(i*4,s*4):new Float32Array,currentCount:o}}export{N as _,se as a,P as b,Y as c,U as d,H as f,V as g,B as h,oe as i,K as l,W as m,de as n,X as o,G as p,ce as r,ae as s,fe as t,J as u,M as v,F as y};