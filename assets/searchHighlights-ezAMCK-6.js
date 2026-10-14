import{Bi as e,Cr as t,D as n,Dr as r,Dt as i,E as a,Ft as o,Ii as s,It as c,Li as l,Lt as u,Mt as d,Nt as ee,Ot as te,Pt as f,Ri as p,S as ne,Sr as re,Tt as ie,br as ae,ji as m,kt as oe,wt as se,xr as h,zi as ce}from"./drawCallMetrics-Df8R-dhE.js";import{_ as g,h as _,m as v}from"./structureData-CsRdvAzL.js";import{c as y,f as b,h as x,o as S}from"./scenePaintGraph-Bq99RSsx.js";import{o as le,s as ue}from"./textRasterAtlas-CZ13_jYw.js";import{n as de,t as fe}from"./vectorFillBandShaders-CRyg2aoB.js";var C=`
${ie}
${ce}
${l}
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
`,w=`#version 300 es
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
`,T=`#version 300 es
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
${C}

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

${d}

vec4 heprCellFetchA(int index) {
  return texelFetch(uSegmentTexA, coordFromIndex(index, uSegmentTexSize), 0);
}

vec4 heprCellFetchB(int index) {
  return texelFetch(uSegmentTexB, coordFromIndex(index, uSegmentTexSize), 0);
}

${i}

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
`,E=`#version 300 es
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
`,D=`#version 300 es
precision highp float;
${c}
precision highp sampler2D;

uniform float uStrokeCurveEnabled;
uniform float uAAScreenPx;
uniform vec4 uVectorOverride;
uniform vec4 uPrimitiveOverride;
${C}

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
`,O=`
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
`,k=`
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
`,A=`
${se}
fn gradientCoord(index : i32) -> vec2i {
  let dimensions = textureDimensions(uGradientMetaA);
  return vec2i(index % i32(dimensions.x), index / i32(dimensions.x));
}

${e}
${p}

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
`;function j(e){return k.replace(`GRADIENT_META_A_BINDING`,String(e)).replace(`GRADIENT_META_B_BINDING`,String(e+1)).replace(`GRADIENT_META_C_BINDING`,String(e+2)).replace(`GRADIENT_META_D_BINDING`,String(e+3)).replace(`GRADIENT_META_E_BINDING`,String(e+4)).replace(`GRADIENT_SAMPLER_BINDING`,String(e+5)).replace(`GRADIENT_LUT_BINDING`,String(e+6))}var M=`
${O}
@group(0) @binding(0) var<uniform> uCamera : CameraUniforms;
@group(0) @binding(1) var uPathMetaA : texture_2d<f32>;
@group(0) @binding(2) var uPathMetaB : texture_2d<f32>;
@group(0) @binding(3) var uPathMetaC : texture_2d<f32>;
@group(0) @binding(4) var uPaintMeta : texture_2d<f32>;
@group(0) @binding(5) var uSegmentsA : texture_2d<f32>;
@group(0) @binding(6) var uSegmentsB : texture_2d<f32>;
${j(7)}
${A}
${fe}
${oe}
${o}
${f}
${te}

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
${de({bands:`inData.bands`,y:`inData.local.y`,radius:`0.5 * footprint.y`,count:`inData.segmentCount`,start:`inData.segmentStart`,texture:`uSegmentsA`,entries:`uCamera.fillBands.w`,setup:`let rows = heprBandRows(bandInfo, band, bandCount, box);`,edge:`
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
`,N=`
${u}
${O}
@group(0) @binding(0) var<uniform> uCamera : CameraUniforms;
@group(0) @binding(1) var uRunMetaA : texture_2d<f32>;
@group(0) @binding(2) var uEndpoints : texture_2d<f32>;
@group(0) @binding(3) var uPrimitiveMeta : texture_2d<f32>;
@group(0) @binding(4) var uPrimitiveBounds : texture_2d<f32>;
@group(0) @binding(5) var uStyles : texture_2d<f32>;
${j(6)}
${A}

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
`,P=w.replace(`uniform sampler2D uPathMetaTexA;`,`layout(location=0) in vec2 aMeshPosition;
layout(location=1) in vec4 aMeshColor;
uniform int uMeshPathIndex;
out vec4 vMeshColor;
uniform sampler2D uPathMetaTexA;`).replace(`int pathIndex = gl_VertexID / 4;`,`vMeshColor = aMeshColor;
  int pathIndex = uMeshPathIndex;`).replace(`vec2 world = mix(low, high, corner01);`,`vec2 world = aMeshPosition;`),F=T.replace(`uniform sampler2D uSegmentTexA;`,`in vec4 vMeshColor;
uniform sampler2D uSegmentTexA;`).replace(`vec4 source = vSourceGradientIndex >= 0
    ? samplePdfGradient(vSourceGradientIndex, vLocal)
    : vec4(vSolidColor, 1.0);`,`vec4 source = vMeshColor;
  ivec2 meshCoord = gradientCoord(vSourceGradientIndex);
  vec4 meshA = texelFetch(uGradientMetaTexA, meshCoord, 0);
  vec4 meshB = texelFetch(uGradientMetaTexB, meshCoord, 0);
  vec4 meshC = texelFetch(uGradientMetaTexC, meshCoord, 0);
  vec4 meshE = texelFetch(uGradientMetaTexE, meshCoord, 0);
  vec2 meshPoint = mat2(meshB.x, meshB.y, meshB.z, meshB.w) * vLocal + meshC.xy;
  if (meshA.y >= 0.5 && (meshPoint.x < meshE.x || meshPoint.y < meshE.y || meshPoint.x > meshE.z || meshPoint.y > meshE.w)) discard;`),I=M.replace(`struct FillOut {`,`struct FillOut {
  @location(12) meshColor : vec4f,`).replace(`fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> FillOut {`,`fn vsMain(@builtin(vertex_index) vertexIndex : u32, @builtin(instance_index) paintIndex : u32,
    @location(0) meshPosition : vec2f, @location(1) meshColor : vec4f) -> FillOut {`).replace(`let pathIndex = i32(vertexIndex / 4u);`,`let pathIndex = i32(paintIndex);`).replace(`var out : FillOut;`,`var out : FillOut;
  out.meshColor = meshColor;`).replace(`let world = mix(low, high, corner);`,`let world = meshPosition;`).replace(`let source = select(vec4f(inData.solidColor, 1.0), samplePdfGradient(inData.sourceGradient, inData.local), inData.sourceGradient >= 0);`,`let source = inData.meshColor;
  let meshCoord = gradientCoord(inData.sourceGradient);
  let meshA = textureLoad(uGradientMetaA, meshCoord, 0);
  let meshB = textureLoad(uGradientMetaB, meshCoord, 0);
  let meshC = textureLoad(uGradientMetaC, meshCoord, 0);
  let meshE = textureLoad(uGradientMetaE, meshCoord, 0);
  let meshPoint = mat2x2f(meshB.xy, meshB.zw) * inData.local + meshC.xy;
  if (meshA.y >= 0.5 && (meshPoint.x < meshE.x || meshPoint.y < meshE.y || meshPoint.x > meshE.z || meshPoint.y > meshE.w)) { discard; }`),L=[{arrayStride:24,attributes:[{shaderLocation:0,offset:0,format:`float32x2`},{shaderLocation:1,offset:8,format:`float32x4`}]}],R=new WeakMap;function z(e){let t=e.drawRuns;if(!t)return null;let n=new Map;t.forEach((e,t)=>{let r=n.get(e.kind);r?r.push(t):n.set(e.kind,[t])});let r=new Map;for(let[e,i]of n)i.sort((e,n)=>t[e].first-t[n].first),r.set(e,{firsts:Int32Array.from(i,e=>t[e].first),ends:Int32Array.from(i,e=>t[e].first+t[e].count),indices:Int32Array.from(i)});return r}function B(e,t,n){let r=e?.get(t);if(!r)return-1;let i=0,a=r.firsts.length-1,o=-1;for(;i<=a;){let e=i+a>>1;r.firsts[e]<=n?(o=e,i=e+1):a=e-1}return o<0||n>=r.ends[o]?-1:o}function V(e,t,n,r,i){let a;if(t&&n&&t.spanOrdered){a=R.get(t),(!a||a.coverageRevision!==t.coverageRevision||a.segments!==n||a.lookup!==r)&&(a={coverageRevision:t.coverageRevision,segments:n,lookup:r,ranges:new WeakMap},R.set(t,a));let o=a.ranges.get(e);if(o!==void 0){if(o){o.revision!==t.revision&&H(o,t);for(let e=o.first;e<o.end;e++)i(t.batches[e])}else for(let t of e)i(t);return}}let o=1/0,s=-1/0;if(t&&n&&t.spanOrdered){let i=new Set,a=!0;for(let c of e){let e=r?.get(c.kind),l=B(r,c.kind,c.first),u=c.first,d=u+c.count;for(;e&&l>=0&&u<d;){let r=e.indices[l];if(e.firsts[l]!==u||e.ends[l]>d||!t.scheduledRuns[r]||i.has(r))break;i.add(r),o=Math.min(o,n[r]),s=Math.max(s,n[r]),u=e.ends[l++]}if(u!==d){a=!1;break}}(!a||i.size!==t.scheduledSpanRunCount(o,s))&&(o=1/0,s=-1/0)}if(!t||o>s){a?.ranges.set(e,null);for(let t of e)i(t);return}let c={low:o,high:s,revision:t.revision,first:0,end:0};H(c,t),a?.ranges.set(e,c);for(let e=c.first;e<c.end;e++)i(t.batches[e])}function H(e,t){let n=t.batchSegments,r=0,i=n.length-1;for(;r<=i;){let t=r+i>>1;n[t]<e.low?r=t+1:i=t-1}for(e.first=r,i=n.length-1;r<=i;){let t=r+i>>1;n[t]<=e.high?r=t+1:i=t-1}e.end=r,e.revision=t.revision}var U=4,pe=8,W=64,me=250,he=`cameraCenterX.cameraCenterY.zoom.viewportWidth.viewportHeight.unitsPerPixel.schedulePadding.frameGapMs.cameraPositionX.cameraPositionY.cameraPositionZ.cameraQuaternionX.cameraQuaternionY.cameraQuaternionZ.cameraQuaternionW.cameraUpX.cameraUpY.cameraUpZ.cameraTargetX.cameraTargetY.cameraTargetZ.cameraDistanceToTarget.cameraTiltDegrees.cameraFovYDegrees.cameraAspect.cameraNear.cameraFar.cameraZoom.controlsChanged`.split(`.`),G=[`Transition timings include work between frames. Asynchronous preparation spans include worker/queue wait; nested spans overlap. Events retain the latest 120 transitions and summaries up to 256 samples per name.`,`CPU times cover JavaScript and command submission, excluding asynchronous GPU execution.`,`Frame intervals describe rendered frames, not a continuous FPS benchmark; gaps over 250 ms are omitted.`,`GPU times sample every fourth rendered frame without waiting; unresolved or invalid samples are discarded.`,`GPU timers measure the command-stream span, including possible gaps during CPU preparation, not pure GPU busy time. CPU and GPU measurements overlap and must not be added.`,`Section and counter summaries include zero for completed frames in which that metric was absent.`,`Nested CPU sections overlap; do not add parent, child, and GL-call timings. Slow GL calls include driver waits, not just GPU execution.`,`Frame context frameGapMs preserves gaps omitted from interval summaries. Events retain up to eight longest instrumented calls per frame.`,`Frame records are a bounded subset of slow CPU/GPU, high-batch and timeline frames; their selection is not a representative performance distribution.`,`GPU operation timings put each draw, clear and blit between its own timer queries, so the GPU cannot overlap it with neighbours; their sum can exceed an untimed span. A sum far below the frame span means the GPU spent that time waiting for commands.`,`Source identifiers at an operation position describe its first sampled draw; visibility and scheduling can change them on later frames.`,`Geometry area estimates are omitted unless geometryDiagnostics is enabled; their per-instance scans add CPU work to captured frames.`],ge=class{transitions=[];transitionSamples=new Map;gl;now;active=!1;disposed=!1;maxFrames=600;maxFrameRecords=120;captureGeometryDiagnostics=!1;startedAt=0;endedAt=0;frameStart=null;previousFrame=null;frameInterval=null;frameContext=null;ignoredFrameGaps=0;discardedMetricNames=0;frameIntervals=[];frameCpu=[];frameStarts=[];recordedIntervals=[];frameContexts=[];frameEvents=[];events=[];frameGpuTimes=[];frameGpuStates=[];cpuSections=new Map;counters=new Map;openSections=new Map;sectionTotals=new Map;counterTotals=new Map;extension=null;gpuStatus=`disabled`;gpuReason=null;activeQuery=null;pendingQueries=[];gpuTimes=[];droppedGpuSamples=0;describeProgram;describeDraw;operations=null;gpuTimer;externalOperations=null;externalTiming=!1;constructor(e={}){this.gl=e.gl,this.now=e.now??(()=>performance.now()),this.describeProgram=e.describeProgram,this.describeDraw=e.describeDraw,this.gpuTimer=e.gpuTimer}get enabled(){return this.active}get geometryDiagnostics(){return this.active&&this.captureGeometryDiagnostics}start(e={}){if(this.disposed)throw Error(`Render performance profiler is disposed.`);let t=e.maxFrames??600,n=e.maxFrameRecords??120;if(!Number.isInteger(t)||t<1||t>1e4)throw RangeError(`maxFrames must be an integer from 1 to 10000.`);if(!Number.isInteger(n)||n<0||n>1e3)throw RangeError(`maxFrameRecords must be an integer from 0 to 1000.`);if(e.gpu!==void 0&&typeof e.gpu!=`boolean`)throw TypeError(`gpu must be a boolean.`);if(e.gpuOperations!==void 0&&typeof e.gpuOperations!=`boolean`)throw TypeError(`gpuOperations must be a boolean.`);if(e.geometryDiagnostics!==void 0&&typeof e.geometryDiagnostics!=`boolean`)throw TypeError(`geometryDiagnostics must be a boolean.`);if(e.gpuOperations&&e.gpu===!1)throw TypeError(`gpuOperations requires gpu timing.`);if(this.reset(),this.maxFrames=t,this.maxFrameRecords=n,this.captureGeometryDiagnostics=e.geometryDiagnostics??!1,this.startedAt=this.now(),this.endedAt=this.startedAt,this.active=!0,e.gpu!==!1){if(this.gpuTimer){let t=this.gpuTimer.unavailableReason;this.gpuStatus=t?`unavailable`:`available`,this.gpuReason=t,!t&&e.gpuOperations&&(this.externalOperations=new Z);return}if(!this.gl){this.gpuStatus=`unavailable`,this.gpuReason=`No WebGL2 context was provided.`;return}try{this.extension=this.gl.getExtension(`EXT_disjoint_timer_query_webgl2`),this.gpuStatus=this.extension?`available`:`unavailable`,this.gpuReason=this.extension?null:`EXT_disjoint_timer_query_webgl2 is unavailable.`,this.extension&&e.gpuOperations&&(this.operations=new be(this.gl,this.extension,this.describeProgram,this.describeDraw))}catch{this.gpuStatus=`unavailable`,this.gpuReason=`The WebGL timer-query extension could not be initialized.`}}}beginFrame(e){if(!this.active||this.frameStart!==null)return;let t=this.now(),n=e!==void 0&&Number.isFinite(e)?e:t;this.frameInterval=null;let r=this.previousFrame===null?null:n-this.previousFrame;if(this.previousFrame!==null){let e=n-this.previousFrame;e>me?this.ignoredFrameGaps++:e>0&&(this.frameIntervals.push(e),this.frameInterval=e)}if(this.previousFrame=n,this.frameStart=t,this.frameContext=this.maxFrameRecords?{frameGapMs:r!==null&&r>0?r:null}:null,this.events=[],this.pollGpu(),this.gpuTimer){if(this.gpuStatus!==`available`||this.frameCpu.length%U!==0)return;let e=this.frameCpu.length;this.externalTiming=this.gpuTimer.beginFrame(e),this.externalTiming||this.droppedGpuSamples++,this.maxFrameRecords&&(this.frameGpuStates[e]=this.externalTiming?`pending`:`discarded`);return}if(this.gpuStatus===`available`&&this.operations?.beginFrame(this.frameCpu.length),this.gpuStatus!==`available`||this.frameCpu.length%U!==0)return;if(this.maxFrameRecords&&(this.frameGpuStates[this.frameCpu.length]=`discarded`),this.pendingQueries.length>=pe){this.droppedGpuSamples++;return}let i=this.gl,a=this.extension;try{if(i.getQuery(a.TIME_ELAPSED_EXT,i.CURRENT_QUERY)){this.droppedGpuSamples++;return}let e=i.createQuery();if(!e){this.droppedGpuSamples++;return}this.activeQuery={query:e,frame:this.frameCpu.length},i.beginQuery(a.TIME_ELAPSED_EXT,e),this.maxFrameRecords&&(this.frameGpuStates[this.frameCpu.length]=`pending`)}catch{this.disableGpu(`A WebGL timer query could not be started.`)}}endFrame(){if(!this.active||this.frameStart===null)return;let e=this.now();for(let[t,n]of this.openSections)this.sectionTotals.set(t,(this.sectionTotals.get(t)??0)+Math.max(0,e-n));this.openSections.clear(),this.recordMetrics(this.cpuSections,this.sectionTotals),this.recordMetrics(this.counters,this.counterTotals),this.maxFrameRecords&&(this.frameStarts.push(Math.max(0,this.frameStart-this.startedAt)),this.recordedIntervals.push(this.frameInterval),this.frameContexts.push(this.frameContext??{}),this.frameEvents.push(this.events)),this.frameCpu.push(Math.max(0,e-this.frameStart)),this.frameStart=null,this.endedAt=e,this.operations?.endFrame(),this.externalTiming&&(this.externalTiming=!1,this.gpuTimer.endFrame()),this.finishGpuQuery(),this.frameCpu.length>=this.maxFrames&&this.finish()}beginSection(e){this.active&&this.frameStart!==null&&!this.openSections.has(e)&&this.ensureMetric(this.cpuSections,e)&&this.openSections.set(e,this.now())}endSection(e){if(!this.active||this.frameStart===null)return;let t=this.openSections.get(e);t!==void 0&&(this.openSections.delete(e),this.sectionTotals.set(e,(this.sectionTotals.get(e)??0)+Math.max(0,this.now()-t)))}addSectionTime(e,t){!this.active||this.frameStart===null||!Number.isFinite(t)||t<0||this.ensureMetric(this.cpuSections,e)&&this.sectionTotals.set(e,(this.sectionTotals.get(e)??0)+t)}recordEvent(e,t){!this.active||this.frameStart===null||!this.maxFrameRecords||!Number.isFinite(t)||t<0||this.events.length===8&&t<=this.events[7].durationMs||(this.events.push({name:e.slice(0,96),durationMs:t}),this.events.sort((e,t)=>t.durationMs-e.durationMs),this.events.length>8&&(this.events.length=8))}add(e,t=1){this.active&&this.frameStart!==null&&Number.isFinite(t)&&this.ensureMetric(this.counters,e)&&this.counterTotals.set(e,(this.counterTotals.get(e)??0)+t)}setFrameContext(e){if(this.active&&this.frameStart!==null&&this.maxFrameRecords){this.frameContext??={};for(let t of he){let n=e[t];(n===null||typeof n==`number`&&Number.isFinite(n))&&(this.frameContext[t]=n)}}}stop(){return this.finish(),this.getReport()}recordTransition(e,t){if(!this.active||!Number.isFinite(t)||t<0||!e||e.length>128)return;let n=this.transitionSamples.get(e);if(!n){if(this.transitionSamples.size>=W)return;this.transitionSamples.set(e,n=[])}n.length<256&&n.push(t),this.transitions.push({name:e,durationMs:t,startMs:Math.max(0,this.now()-this.startedAt-t)}),this.transitions.length>120&&this.transitions.shift()}reset(){this.finish(),this.startedAt=this.endedAt=0,this.previousFrame=null,this.frameInterval=null,this.frameContext=null,this.captureGeometryDiagnostics=!1,this.ignoredFrameGaps=this.discardedMetricNames=this.droppedGpuSamples=0,this.frameIntervals.length=this.frameCpu.length=this.gpuTimes.length=0,this.frameStarts.length=this.recordedIntervals.length=this.frameContexts.length=this.frameEvents.length=0,this.events=[],this.frameGpuTimes.length=this.frameGpuStates.length=0,this.cpuSections.clear(),this.counters.clear(),this.transitions.length=0,this.transitionSamples.clear(),this.operations=null,this.externalOperations=null,this.externalTiming=!1,this.extension=null,this.gpuStatus=`disabled`,this.gpuReason=null}getReport(){return{active:this.active,frames:this.frameCpu.length,maxFrames:this.maxFrames,geometryDiagnostics:this.captureGeometryDiagnostics,transitions:this.transitions.map(e=>({...e})),transitionSections:Object.fromEntries([...this.transitionSamples].map(([e,t])=>[e,K(t)])),elapsedMs:Math.max(0,(this.active?this.now():this.endedAt)-this.startedAt),frameIntervalMs:K(this.frameIntervals),frameCpuMs:K(this.frameCpu),cpuSections:Object.fromEntries([...this.cpuSections].map(([e,t])=>[e,K(t)])),counters:Object.fromEntries([...this.counters].map(([e,t])=>[e,K(t)])),frameRecords:this.getFrameRecords(),frameRecordLimit:this.maxFrameRecords,ignoredFrameGaps:this.ignoredFrameGaps,discardedMetricNames:this.discardedMetricNames,gpu:{status:this.gpuStatus,reason:this.gpuReason,frameMs:K(this.gpuTimes),pendingSamples:this.pendingQueries.length+ +!!this.activeQuery,droppedSamples:this.droppedGpuSamples,sampleEvery:U,operations:this.operationReport()},notes:this.gpuTimer?.note?[...G,this.gpuTimer.note]:[...G]}}dispose(){this.finish(),this.disposed=!0}operationReport(){if(this.externalOperations){let{frameMs:e,frameOperations:t,...n}=this.externalOperations.totals();return{status:this.gpuStatus===`available`?`available`:`unavailable`,reason:this.gpuReason,sampleEvery:U,droppedFrames:0,...n,frameMs:K(e),operationsPerFrame:K(t)}}if(!this.operations)return null;let{frameMs:e,frameOperations:t,...n}=this.operations.totals();return{...n,frameMs:K(e),operationsPerFrame:K(t)}}ensureMetric(e,t){return e.has(t)?!0:e.size>=W?(this.discardedMetricNames++,!1):(e.set(t,Array(this.frameCpu.length).fill(0)),!0)}recordMetrics(e,t){for(let[n,r]of e)r.push(t.get(n)??0);t.clear()}getFrameRecords(){let e=this.frameCpu.length,t=Math.min(this.maxFrameRecords,e);if(!t)return[];let n=new Map,r=(e,r)=>{let i=n.get(e);if(!i){if(n.size>=t)return;i=new Set,n.set(e,i)}i.add(r)},i=Math.max(1,Math.floor(t/4)),a=(t,n)=>{let a=[];for(let n=0;n<e;n++)(t[n]??0)>0&&a.push(n);a.sort((e,n)=>t[n]-t[e]||e-n);for(let e=0;e<Math.min(i,a.length);e++)r(a[e],n)};a(this.frameCpu,`slow-cpu`),a(this.frameGpuTimes,`slow-gpu`);let o=this.counters.get(`drawBatches`)??this.counters.get(`drawCalls`);if(!o){o=Array(e).fill(0);for(let[t,n]of this.counters)if(t.endsWith(`Batches`))for(let t=0;t<e;t++)o[t]+=n[t]??0}a(o,`high-batches`);let s=[...n.keys()].filter(e=>this.frameCpu[e]>=100).sort((e,t)=>this.frameCpu[t]-this.frameCpu[e]);for(let t of s)t>0&&r(t-1,`stall-neighbour`),t+1<e&&r(t+1,`stall-neighbour`);r(0,`timeline`),r(e-1,`timeline`);for(let i=2;n.size<t&&i<e*2;i*=2)for(let a=1;a<i&&n.size<t;a+=2)r(Math.round(a*(e-1)/i),`timeline`);for(let i=0;n.size<t&&i<e;i++)r(i,`timeline`);return[...n].sort(([e],[t])=>e-t).map(([e,t])=>({frame:e+1,startMs:this.frameStarts[e],intervalMs:this.recordedIntervals[e],cpuMs:this.frameCpu[e],gpuMs:this.frameGpuTimes[e]??null,gpuStatus:this.frameGpuStates[e]??`not-sampled`,context:{...this.frameContexts[e]},cpuSectionsMs:Object.fromEntries([...this.cpuSections].map(([t,n])=>[t,n[e]??0])),counters:Object.fromEntries([...this.counters].map(([t,n])=>[t,n[e]??0])),reasons:[...t],events:this.frameEvents[e].map(e=>({...e}))}))}finish(){if(this.active){if(this.endedAt=this.now(),this.finishGpuQuery(),this.pollGpu(),this.gpuTimer){this.externalTiming&&(this.externalTiming=!1,this.gpuTimer.endFrame()),this.droppedGpuSamples+=this.gpuTimer.cancel();for(let e=0;e<this.frameGpuStates.length;e++)this.frameGpuStates[e]===`pending`&&this.discardFrameGpu(e)}this.releaseQueries(),this.operations?.dispose(),this.active=!1,this.frameStart=null,this.openSections.clear(),this.sectionTotals.clear(),this.counterTotals.clear()}}finishGpuQuery(){if(!this.activeQuery)return;let e=this.activeQuery;this.activeQuery=null;try{this.gl.endQuery(this.extension.TIME_ELAPSED_EXT),this.pendingQueries.push(e)}catch{try{this.gl.deleteQuery(e.query)}catch{}this.discardFrameGpu(e.frame),this.droppedGpuSamples++,this.disableGpu(`A WebGL timer query could not be completed.`)}}pollGpu(){if(this.gpuStatus!==`available`)return;if(this.gpuTimer){for(let e of this.gpuTimer.takeResults()){if(e.ms===null||!Number.isFinite(e.ms)||e.ms<0){this.droppedGpuSamples++,this.discardFrameGpu(e.frame);continue}this.gpuTimes.push(e.ms),this.maxFrameRecords&&(this.frameGpuTimes[e.frame]=e.ms,this.frameGpuStates[e.frame]=`available`),e.operations&&this.externalOperations&&this.externalOperations.addFrame(e.operations)}return}let e=this.gl;try{if(e.getParameter(this.extension.GPU_DISJOINT_EXT)){this.gpuStatus=`disjoint`,this.gpuReason=`GPU clock disjoint detected; GPU timings were discarded for this capture.`,this.operations?.discardPending(),this.droppedGpuSamples+=this.gpuTimes.length,this.gpuTimes.length=0;for(let e=0;e<this.frameGpuStates.length;e++)this.frameGpuStates[e]===`available`&&this.discardFrameGpu(e);this.releaseQueries();return}for(;this.pendingQueries.length;){let t=this.pendingQueries[0],n=t.query;if(!e.getQueryParameter(n,e.QUERY_RESULT_AVAILABLE))break;let r=Number(e.getQueryParameter(n,e.QUERY_RESULT));if(this.pendingQueries.shift(),e.deleteQuery(n),Number.isFinite(r)&&r>=0){let e=r/1e6;this.gpuTimes.push(e),this.maxFrameRecords&&(this.frameGpuTimes[t.frame]=e,this.frameGpuStates[t.frame]=`available`)}else this.droppedGpuSamples++,this.discardFrameGpu(t.frame)}this.operations?.poll()}catch{this.disableGpu(`WebGL timer-query results could not be read.`)}}disableGpu(e){this.gpuStatus=`unavailable`,this.gpuReason=e,this.releaseQueries()}releaseQueries(){if(this.activeQuery){try{this.gl.endQuery(this.extension.TIME_ELAPSED_EXT)}catch{}this.pendingQueries.push(this.activeQuery),this.activeQuery=null}for(let e of this.pendingQueries){try{this.gl.deleteQuery(e.query)}catch{}this.discardFrameGpu(e.frame),this.droppedGpuSamples++}this.pendingQueries.length=0}discardFrameGpu(e){this.maxFrameRecords&&(this.frameGpuTimes[e]=null,this.frameGpuStates[e]=`discarded`)}};function K(e){if(!e.length)return{samples:0,total:0,average:null,p50:null,p95:null,min:null,max:null};let t=[...e].sort((e,t)=>e-t),n=e.reduce((e,t)=>e+t,0),r=e=>{let n=(t.length-1)*e,r=Math.floor(n);return t[r]+(t[Math.ceil(n)]-t[r])*(n-r)};return{samples:e.length,total:n,average:n/e.length,p50:r(.5),p95:r(.95),min:t[0],max:t[t.length-1]}}function q(e){return K(e).p50??0}var J=8,_e=2,ve=2,Y=4096,X=16,ye={drawArrays:e=>[e[2],1],drawArraysInstanced:e=>[e[2],e[3]],drawElements:e=>[e[1],1],drawElementsInstanced:e=>[e[1],e[4]],clear:()=>[null,null],blitFramebuffer:()=>[null,null]},Z=class{frameMs=[];frameOperations=[];labels=new Map;positions=new Map;slowest=[];get frames(){return this.frameMs.length}addFrame(e){let t=this.frameMs.length,n=0;for(let r of e){let e=r.ms;n+=e;let i=this.labels.get(r.label);for(i||this.labels.set(r.label,i={calls:0,ms:0,maxMs:0,frameMs:[]}),i.calls++,i.ms+=e,i.maxMs=Math.max(i.maxMs,e);i.frameMs.length<=t;)i.frameMs.push(0);i.frameMs[t]+=e;let a=`${r.order}:${r.label}`,o=this.positions.get(a);o?o.ms.push(e):this.positions.size<Y&&this.positions.set(a,{detail:{...r},ms:[e]}),(this.slowest.length<X||e>this.slowest[this.slowest.length-1].ms)&&(this.slowest.push({...r}),this.slowest.sort((e,t)=>t.ms-e.ms),this.slowest.length=Math.min(this.slowest.length,X))}this.frameMs.push(n),this.frameOperations.push(e.length)}totals(){let e=Math.max(1,this.frameMs.length),t=e=>({...e,viewport:[...e.viewport],scissor:e.scissor?[...e.scissor]:null,...e.source?{source:{...e.source,ids:[...e.source.ids],clips:[...e.source.clips],...e.source.kinds?{kinds:[...e.source.kinds]}:{}}}:{}}),n=[...this.labels].map(([t,n])=>{let r=[...n.frameMs];for(;r.length<this.frameMs.length;)r.push(0);return{label:t,operationsPerFrame:n.calls/e,msPerFrame:n.ms/e,medianMsPerFrame:q(r),maxMs:n.maxMs}}).sort((e,t)=>t.medianMsPerFrame-e.medianMsPerFrame||t.msPerFrame-e.msPerFrame),r=[...this.positions.values()].filter(e=>e.ms.length*2>=this.frameMs.length),i=r.map(e=>({...t(e.detail),ms:q(e.ms),frames:e.ms.length})).sort((e,t)=>t.ms-e.ms||e.order-t.order).slice(0,X),a=r.map(({detail:e,ms:n})=>({order:e.order,label:e.label,instances:e.instances,ms:q(n),...e.source?{source:t(e).source}:{}})).sort((e,t)=>e.order-t.order||e.label.localeCompare(t.label));return{frameMs:[...this.frameMs],frameOperations:[...this.frameOperations],byLabel:n,slowest:this.slowest.map(t),typical:i,byPosition:a}}},be=class{gl;extension;describe;describeDraw;restores=[];ordinals=new Map;installed=!0;timing=!1;program=null;offscreen=!1;viewportSize=[0,0];scissorEnabled=!1;scissorBox=[0,0,0,0];frame=[];pending=[];stats=new Z;droppedFrames=0;status=`available`;reason=null;constructor(e,t,n=()=>null,r){this.gl=e,this.extension=t,this.describe=n,this.describeDraw=r;try{this.program=e.getParameter(e.CURRENT_PROGRAM),this.offscreen=e.getParameter(e.DRAW_FRAMEBUFFER_BINDING)!==null;let t=e.getParameter(e.VIEWPORT);t&&(this.viewportSize=[t[2],t[3]]);let n=e.getParameter(e.SCISSOR_BOX);n&&(this.scissorBox=[n[0],n[1],n[2],n[3]]),this.scissorEnabled=e.isEnabled(e.SCISSOR_TEST)}catch{}this.install()}beginFrame(e){if(this.timing=!1,this.installed&&this.status===`available`&&e%J===_e){if(this.pending.length>=ve){this.droppedFrames++;return}try{if(this.gl.getQuery(this.extension.TIME_ELAPSED_EXT,this.gl.CURRENT_QUERY)){this.droppedFrames++;return}}catch{this.disable(`WebGL timer queries could not be inspected.`);return}this.timing=!0}}endFrame(){this.timing&&this.frame.length&&this.pending.push(this.frame),this.frame=[],this.timing=!1}poll(){let e=this.gl;try{for(;this.pending.length;){let t=this.pending[0];if(!e.getQueryParameter(t[t.length-1].query,e.QUERY_RESULT_AVAILABLE))return;this.pending.shift();let n=!0,r=t.map(t=>{let r=Number(e.getQueryParameter(t.query,e.QUERY_RESULT));return e.deleteQuery(t.query),(!Number.isFinite(r)||r<0)&&(n=!1),r/1e6});if(!n){this.droppedFrames++;continue}this.stats.addFrame(t.map(({query:e,...t},n)=>({...t,ms:r[n]})))}}catch{this.disable(`WebGL timer-query results could not be read.`)}}discardPending(){this.droppedFrames+=this.pending.length,this.release(),this.status=`disjoint`,this.reason=`GPU clock disjoint detected; operation timings in flight were discarded.`}totals(){return{status:this.status,reason:this.reason,sampleEvery:J,droppedFrames:this.droppedFrames,...this.stats.totals()}}dispose(){this.endFrame(),this.release(),this.installed=!1;for(let e of this.restores)e();this.restores.length=0}label(e){if(e===`clear`||e===`blitFramebuffer`)return`${e===`clear`?`clear`:`blit`} → ${this.offscreen?`offscreen`:`screen`}`;let t=this.describe(this.program);if(!t){if(!this.program)t=`no program`;else{let e=this.ordinals.get(this.program);e===void 0&&this.ordinals.set(this.program,e=this.ordinals.size+1),t=`program#${e}`}}return`${t} → ${this.offscreen?`offscreen`:`screen`}`}install(){let e=this.gl,t=e,n=(n,i)=>{let a=t[n];if(typeof a!=`function`)return;let o=Object.getOwnPropertyDescriptor(t,n),s=i((...t)=>Reflect.apply(a,e,t)),c=function(...e){return r.installed?s(...e):Reflect.apply(a,this,e)};try{Object.defineProperty(t,n,{configurable:!0,writable:!0,value:c}),this.restores.push(()=>{t[n]===c&&(o?Object.defineProperty(t,n,o):delete t[n])})}catch{}},r=this;n(`useProgram`,e=>(...t)=>(r.program=t[0],e(...t))),n(`bindFramebuffer`,t=>(...n)=>((n[0]===e.FRAMEBUFFER||n[0]===e.DRAW_FRAMEBUFFER)&&(r.offscreen=n[1]!==null),t(...n))),n(`viewport`,e=>(...t)=>(r.viewportSize=[t[2],t[3]],e(...t))),n(`scissor`,e=>(...t)=>(r.scissorBox=[t[0],t[1],t[2],t[3]],e(...t)));for(let t of[`enable`,`disable`])n(t,n=>(...i)=>(i[0]===e.SCISSOR_TEST&&(r.scissorEnabled=t===`enable`),n(...i)));for(let[t,i]of Object.entries(ye))n(t,n=>(...a)=>{if(!r.timing||r.frame.length>=Y)return n(...a);let o=null;try{o=e.createQuery(),o&&e.beginQuery(r.extension.TIME_ELAPSED_EXT,o)}catch{r.disable(`A WebGL timer query could not be started.`),o=null}try{return n(...a)}finally{if(o)try{e.endQuery(r.extension.TIME_ELAPSED_EXT);let[n,s]=i(a),c=t===`blitFramebuffer`?Math.abs(a[6]-a[4])*Math.abs(a[7]-a[5]):null,l=t.startsWith(`draw`)?r.describeDraw?.(r.program,s??0):void 0;r.frame.push({query:o,label:r.label(t),order:r.frame.length,call:t,vertices:n,instances:s,pixels:c,target:r.offscreen?`offscreen`:`screen`,viewport:[...r.viewportSize],scissor:r.scissorEnabled?[...r.scissorBox]:null,...l?{source:l}:{}})}catch{r.disable(`A WebGL timer query could not be completed.`)}}})}disable(e){this.timing=!1,this.release(),this.status=`unavailable`,this.reason=e}release(){for(let e of[...this.frame,...this.pending.flat()])try{this.gl.deleteQuery(e.query)}catch{}this.frame=[],this.pending.length=0}};function xe(e,t){let n=new Map;for(let t of e){let e=n.get(t.kind);e||n.set(t.kind,e=new Map),e.set(t.index,t)}let r=[];for(let[e,i]of n){let n=[...i.values()].sort((e,t)=>e.index-t.index),a=t[e];for(let t=0;t<n.length;){let i=n[t],o=Math.floor(i.index/a),s=t+1;for(;s<n.length&&n[s].index===n[s-1].index+1&&Math.floor(n[s].index/a)===o;)s++;let c=s-t,l=c===1?i.pixels:i.pixels instanceof Uint8Array?new Uint8Array(c*4):new Float32Array(c*4);if(c>1)for(let e=t;e<s;e++)l.set(n[e].pixels,(e-t)*4);r.push({kind:e,index:i.index,count:c,pixels:l}),t=s}}return r}var Se=class{colors=new Map;scene;constructor(e){this.scene=e}update(e){for(let t of e){if(s(this.scene,t.ref),t.ref.kind===`raster`)throw TypeError(`Raster primitives cannot be recolored.`);if(t.color&&(t.color.length!==3||!t.color.every(e=>Number.isFinite(e)&&e>=0&&e<=1)))throw TypeError(`Primitive colors must contain three normalized channels.`)}let t=e.flatMap(e=>Ce(this.scene,e));for(let t of e)t.color?this.colors.set(m(t.ref),{ref:{...t.ref},color:[...t.color]}):this.colors.delete(m(t.ref));return t}updates(){return[...this.colors.values()]}has(e){for(let t of this.colors.values())if(t.ref.kind===e)return!0;return!1}gradient(e,t){return this.colors.get(`${e}:${t}`)?.color??null}};function Ce(e,{ref:t,color:n}){let r=t.index*4;if(t.kind===`stroke`){let i=e.styles.slice(r,r+4);return n&&i.set(n,1),[{kind:`stroke`,index:t.index,pixels:i}]}if(t.kind===`fill`){let i=e.fillPathMetaB.slice(r,r+4),a=e.fillPathMetaC.slice(r,r+4);return n&&(i[2]=n[0],i[3]=n[1],a[2]=n[2]),[{kind:`fillB`,index:t.index,pixels:i},{kind:`fillC`,index:t.index,pixels:a}]}if(t.kind===`text`){let i=new Uint8Array(4);for(let t=0;t<4;t++){let a=t<3&&n?n[t]:e.textInstanceC[r+t];i[t]=Math.round(Math.max(0,Math.min(1,a))*255)}return[{kind:`text`,index:t.index,pixels:i}]}return[]}var we=class{entries=new Map;device;layout;constructor(e,t){this.device=e,this.layout=t}update(e){for(let{ref:t,color:n}of e){if(t.kind!==`gradient-fill`&&t.kind!==`gradient-stroke`)continue;let e=m(t),r=this.entries.get(e);if(!n){r?.buffer.destroy(),this.entries.delete(e);continue}let i=r??this.createEntry();this.device.queue.writeBuffer(i.buffer,0,new Float32Array([...n,1])),this.entries.set(e,i)}}bindGroup(e,t){let n=this.entries.get(`${e}:${t}`);if(n)return n.bindGroup;let r=this.entries.get(`default`);return r||(r=this.createEntry(),this.entries.set(`default`,r)),r.bindGroup}dispose(){for(let e of this.entries.values())e.buffer.destroy();this.entries.clear()}createEntry(){let e=globalThis.GPUBufferUsage,t=this.device.createBuffer({size:16,usage:e.UNIFORM|e.COPY_DST});return{buffer:t,bindGroup:this.device.createBindGroup({layout:this.layout,entries:[{binding:0,resource:{buffer:t}}]})}}};function Q(e,t){let n=g(e.clipPaths,Math.min(_,t**2)),r=Math.max(1,Math.min(t,Math.ceil(Math.sqrt(n.length/4)))),i=Math.max(1,Math.ceil(n.length/4/r));if(i>t)throw RangeError(`Primitive highlight clips exceed GPU limits.`);let a=new Float32Array(r*i*4);return a.set(n),{data:a,width:r,height:i}}var Te=class{program;buffer;vao;clips;uniforms={};count=0;selectionCount=0;matrix=new Float32Array(16);capacityBytes=0;clipWidth=0;clipHeight=0;gl;constructor(e,t){this.gl=e,this.program=t(a.replace(`layout(location=2) in float aHighlightIndex;`,``).replace(`aHighlightIndex <`,`float(gl_InstanceID) <`),ne);let n=e.createBuffer(),r=e.createVertexArray(),i=e.createTexture();if(!n||!r||!i)throw e.deleteBuffer(n),e.deleteVertexArray(r),e.deleteTexture(i),e.deleteProgram(this.program),Error(`Unable to allocate primitive highlight resources.`);this.buffer=n,this.vao=r,this.clips=i;for(let t of[`uLocalToClip`,`uLocalUnitsPerPixel`,`uPixelRatio`,`uSelectionCount`,`uVectorClipTex`])this.uniforms[t]=e.getUniformLocation(this.program,t);e.bindVertexArray(r),e.bindBuffer(e.ARRAY_BUFFER,n);for(let t=0;t<2;t++)e.enableVertexAttribArray(t),e.vertexAttribPointer(t,4,e.FLOAT,!1,32,t*16),e.vertexAttribDivisor(t,1);e.bindVertexArray(null)}set(e){if(this.count=e?.count??0,this.selectionCount=e?.selectionCount??0,!e||!this.count)return;let t=this.gl,n=Q(e,t.getParameter(t.MAX_TEXTURE_SIZE));t.bindBuffer(t.ARRAY_BUFFER,this.buffer),this.capacityBytes<this.count*32&&(this.capacityBytes=Math.max(this.count*32,this.capacityBytes*2,1024),t.bufferData(t.ARRAY_BUFFER,this.capacityBytes,t.DYNAMIC_DRAW)),t.bufferSubData(t.ARRAY_BUFFER,0,e.segments.subarray(0,this.count*8)),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,this.clips),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),this.clipWidth!==n.width||this.clipHeight!==n.height?(this.clipWidth=n.width,this.clipHeight=n.height,t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,n.width,n.height,0,t.RGBA,t.FLOAT,n.data)):t.texSubImage2D(t.TEXTURE_2D,0,0,0,n.width,n.height,t.RGBA,t.FLOAT,n.data)}draw(e,t,n){if(!this.count)return 0;let r=this.gl;return this.matrix.set(e),r.useProgram(this.program),r.uniformMatrix4fv(this.uniforms.uLocalToClip,!1,this.matrix),r.uniform1f(this.uniforms.uLocalUnitsPerPixel,t),r.uniform1f(this.uniforms.uPixelRatio,n),r.uniform1f(this.uniforms.uSelectionCount,this.selectionCount),r.activeTexture(r.TEXTURE0),r.bindTexture(r.TEXTURE_2D,this.clips),r.uniform1i(this.uniforms.uVectorClipTex,0),r.enable(r.BLEND),r.blendFuncSeparate(r.SRC_ALPHA,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA),r.bindVertexArray(this.vao),r.drawArraysInstanced(r.TRIANGLE_STRIP,0,4,this.count),r.bindVertexArray(null),1}dispose(){this.gl.deleteProgram(this.program),this.gl.deleteBuffer(this.buffer),this.gl.deleteVertexArray(this.vao),this.gl.deleteTexture(this.clips)}},Ee=class{pipeline;camera;segments=null;clips=null;bindGroup=null;count=0;selectionCount=0;cameraData=new Float32Array(20);device;capacityBytes=0;clipWidth=0;clipHeight=0;constructor(e,t){this.device=e;let r=globalThis.GPUBufferUsage;this.camera=e.createBuffer({size:80,usage:r.UNIFORM|r.COPY_DST});let i=e.createShaderModule({code:n}),a=globalThis.GPUShaderStage,o=e.createBindGroupLayout({entries:[{binding:0,visibility:a.VERTEX|a.FRAGMENT,buffer:{type:`uniform`,minBindingSize:80}},{binding:1,visibility:a.VERTEX,buffer:{type:`read-only-storage`}},{binding:2,visibility:a.FRAGMENT,texture:{sampleType:`unfilterable-float`}}]});this.pipeline=e.createRenderPipeline({layout:e.createPipelineLayout({bindGroupLayouts:[o]}),vertex:{module:i,entryPoint:`vsMain`},fragment:{module:i,entryPoint:`fsMain`,targets:[{format:t,blend:{color:{srcFactor:`src-alpha`,dstFactor:`one-minus-src-alpha`,operation:`add`},alpha:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`,operation:`add`}}}]},primitive:{topology:`triangle-strip`}})}set(e){if(this.count=e?.count??0,this.selectionCount=e?.selectionCount??0,!e||!this.count)return;let t=globalThis.GPUBufferUsage,n=globalThis.GPUTextureUsage,r=Q(e,this.device.limits.maxTextureDimension2D),i=!1;this.capacityBytes<this.count*32&&(this.segments?.destroy(),this.capacityBytes=Math.max(this.count*32,this.capacityBytes*2,1024),this.segments=this.device.createBuffer({size:this.capacityBytes,usage:t.STORAGE|t.COPY_DST}),i=!0),this.device.queue.writeBuffer(this.segments,0,e.segments.subarray(0,this.count*8)),(this.clipWidth!==r.width||this.clipHeight!==r.height)&&(this.clips?.destroy(),this.clipWidth=r.width,this.clipHeight=r.height,this.clips=this.device.createTexture({size:[r.width,r.height],format:`rgba32float`,usage:n.TEXTURE_BINDING|n.COPY_DST}),i=!0),this.device.queue.writeTexture({texture:this.clips},r.data,{bytesPerRow:r.width*16},[r.width,r.height]),(i||!this.bindGroup)&&(this.bindGroup=this.device.createBindGroup({layout:this.pipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.camera}},{binding:1,resource:{buffer:this.segments}},{binding:2,resource:this.clips.createView()}]}))}draw(e,t,n,r){return!this.count||!this.bindGroup?0:(this.cameraData.set(t,0),this.cameraData.set([n,r,this.selectionCount,0],16),this.device.queue.writeBuffer(this.camera,0,this.cameraData),e.setPipeline(this.pipeline),e.setBindGroup(0,this.bindGroup),e.draw(4,this.count),1)}dispose(){this.camera.destroy(),this.segments?.destroy(),this.clips?.destroy()}},De=class e{clipCodes;originals;clearances;padding=NaN;static create(t,n){return!t.clipPaths?.length||!t.drawRuns?.some(e=>e.clipIndex!==void 0&&(e.kind===`stroke`||e.kind===`fill`||e.kind===`text`))?null:new e(t,n)}constructor(e,t){let n=e.drawRuns;this.clipCodes=Uint32Array.from(n,e=>(e.clipIndex??-1)+1),this.originals=this.clipCodes.slice(),this.clearances=new Float64Array(n.length).fill(-1/0);let r=g(e.clipPaths),i=new y(e,t),a=[0,0,0,0];n.forEach((e,t)=>{if(e.clipIndex===void 0||e.kind!==`stroke`&&e.kind!==`fill`&&e.kind!==`text`)return;let n=e.clipIndex*4;if(r[n]!==-1||r[n+2]!==-1)return;let o=r[n+1]*4;i.getUnclippedBounds(t,0,a),!(!a.every(Number.isFinite)||a[0]>a[2]||a[1]>a[3])&&(this.clearances[t]=Math.min(a[0]-r[o],a[1]-r[o+1],r[o+2]-a[2],r[o+3]-a[3]))})}update(e){let t=e!==null&&Number.isFinite(e)&&e>0?Math.max(.001,4*2**Math.ceil(Math.log2(Math.max(1e-6,e)))):1/0;if(t===this.padding)return!1;this.padding=t;let n=!1;for(let e=0;e<this.clipCodes.length;e++){let r=this.clearances[e]>t?0:this.originals[e];this.clipCodes[e]!==r&&(this.clipCodes[e]=r,n=!0)}return n}},Oe=class{batches=[];revision=0;coverageRevision=0;batchSegments=[];spanOrdered=!0;scheduledRuns;scheduledSpanPrefix=new Uint32Array;floatInstanceData=new Float32Array;uintInstanceData=new Uint32Array(2);floatInstancesDirty=!0;get floatInstances(){return this.floatInstanceData.length<this.uintInstanceData.length&&(this.floatInstanceData=new Float32Array(this.uintInstanceData.length)),this.floatInstancesDirty&&=(this.floatInstanceData.set(this.uintInstanceData.subarray(0,this.instanceCount*2)),!1),this.floatInstanceData}get uintInstances(){return this.uintInstanceData}strokeRecords;cullingPadding;instanceCount=0;culledSegmentCount=0;get paintOrderApproximated(){return this.scheduler?.paintOrderApproximated??!1}runtime;runIndices=new Map;rankToId;idToRank;runRankOffsets;layout=null;selectionLimit;selectedRanks=new Uint32Array;selectedRankBits;selectedRankWords;orderedSelectedCount=0;previousSelectedIds=new Uint32Array;previousSelectedCount=0;sourceRuns;runRanges;visiblePaints=[];scheduler=null;segments=null;scene;strokeSourceRuns;strokeColorsMatchSource;clipElision;redundancy;redundancyIds=new Uint32Array;redundancyEnabled=!0;blackPreserved=!0;previousSelectedRanks=new Uint32Array;previousRankCount=0;previousRuns=[];previousRunsAreSource=!1;initialized=!1;dirty=!0;orderDirty=!1;textSelection=null;textSelectionRevision=0;get colorBatchingEnabled(){return this.redundancyEnabled&&this.strokeColorsMatchSource}get blackDarkenSourceOverEnabled(){return this.colorBatchingEnabled&&this.blackPreserved}constructor(e,n){this.scene=e,this.runtime=n,this.cullingPadding=(n?.levels.at(-1)?.tolerance??0)*2;let r=e.drawRuns;this.sourceRuns=r,this.runRanges=new Uint32Array(r.length*2);let i=new Uint32Array(e.segmentCount);r.forEach((e,t)=>{this.runIndices.set(e,t),e.kind===`stroke`&&i.fill(t,e.first,e.first+e.count)}),this.strokeRecords=b(e);let a=t(e)??ke(e.segmentCount);this.selectionLimit=e.segmentCount,n&&(this.layout=ae(e,n.levels),this.strokeRecords=re(this.layout),a=h(this.layout),this.selectionLimit=n.levels.reduce((e,t)=>e+t.segmentCount,0));let o=this.strokeRecords.count;this.rankToId=new Uint32Array(o),this.idToRank=new Uint32Array(o),this.runRankOffsets=new Uint32Array(r.length+1),this.selectedRankBits=new Uint32Array(Math.ceil(o/32)),this.selectedRankWords=new Uint32Array(Math.ceil(this.selectedRankBits.length/32));let s=new Uint32Array(e.segmentCount);for(let e=0;e<o;e++)s[a[e]]++;for(let e=0;e<s.length;e++)this.runRankOffsets[i[e]+1]+=s[e];for(let e=1;e<this.runRankOffsets.length;e++)this.runRankOffsets[e]+=this.runRankOffsets[e-1];let c=this.runRankOffsets.slice(0,-1);for(let e=0;e<s.length;e++){let t=i[e],n=s[e];s[e]=c[t],c[t]+=n}let l=new Uint32Array(o);for(let e=0;e<o;e++){let t=a[e],n=s[t]++;this.rankToId[n]=e,this.idToRank[e]=n,l[e]=i[t]}this.strokeSourceRuns=l,this.strokeColorsMatchSource=!n||x(e,this.strokeRecords,a),this.rebuildScheduler(),this.clipElision=De.create(e,{records:this.strokeRecords,sourceRuns:l}),this.redundancy=new le(e,{records:this.strokeRecords,sourceRuns:l}),this.scheduledRuns=new Uint8Array(r.length)}scheduledSpanRunCount(e,t){return this.scheduledSpanPrefix[t+1]-this.scheduledSpanPrefix[e]}createRunCuller(){return new y(this.scene,this.runtime?{records:this.strokeRecords,sourceRuns:this.strokeSourceRuns}:void 0)}invalidate(){this.dirty=!0}setTextSelection(e){let t=e?.revision??0;(this.textSelection!==e||this.textSelectionRevision!==t)&&(e&&this.scheduler?.includeTextLod(e.data),this.textSelection=e,this.textSelectionRevision=t,this.orderDirty=!0)}setColorCommutationEnabled(e){this.redundancyEnabled!==e&&(this.redundancyEnabled=e,(r(this.scene)?S(this.scene,this.colorBatchingEnabled,this.blackDarkenSourceOverEnabled):null)===this.segments?this.scheduler?.setColorCommutationEnabled(e):this.rebuildScheduler(),this.orderDirty=!0,this.dirty=!0)}setBlackDarkenSourceOverEnabled(e){this.blackPreserved!==e&&(this.blackPreserved=e,(r(this.scene)?S(this.scene,this.colorBatchingEnabled,this.blackDarkenSourceOverEnabled):null)!==this.segments&&(this.rebuildScheduler(),this.orderDirty=!0,this.dirty=!0))}rebuildScheduler(){this.segments=r(this.scene)?S(this.scene,this.colorBatchingEnabled,this.blackDarkenSourceOverEnabled):null;let e=0;for(let t of this.segments??[])e=Math.max(e,t);this.scheduledSpanPrefix=new Uint32Array(e+2),this.scheduler=ue.create(this.scene,this.strokeRecords,this.strokeSourceRuns,this.segments),this.scheduler?.setColorCommutationEnabled(this.redundancyEnabled),this.textSelection&&this.scheduler?.includeTextLod(this.textSelection.data)}update(e,t=null){let n=this.clipElision?.update(t)??!1,r=(this.scheduler?.updateScale(t)??!1)||this.orderDirty||n;this.orderDirty=!1;let i=this.initialized&&e.length===this.previousRuns.length;if(i&&!(e===this.sourceRuns&&this.previousRunsAreSource)){for(let t=0;t<e.length;t++)if(e[t]!==this.previousRuns[t]){i=!1;break}}if(i&&(this.previousRunsAreSource=e===this.sourceRuns),!this.dirty&&i&&!r)return!1;this.dirty=!1;let a=0,o=this.initialized;if(this.runtime){let e=this.layout,t=this.runtime.levels.reduce((e,t)=>e+t.visibleSegmentCount,0);this.previousSelectedIds=$(this.previousSelectedIds,t,this.selectionLimit,!0),this.selectedRanks=$(this.selectedRanks,t,this.idToRank.length),this.runtime.levels.forEach((t,n)=>{let r=e.records[n],i=e.bases[n];for(let e=0;e<t.visibleSegmentCount;e++){let n=t.visibleSegmentIds[e],s=r?r[n]:i+n;this.previousSelectedIds[a]!==s&&(o=!1),this.previousSelectedIds[a++]=s}})}if(o&&=a===this.previousSelectedCount,this.previousSelectedCount=a,o&&i&&!r)return!1;if(!o){for(let e=0;e<a;e++){let t=this.idToRank[this.previousSelectedIds[e]],n=t>>>5;this.selectedRankBits[n]|=1<<(t&31),this.selectedRankWords[n>>>5]|=1<<(n&31)}let e=0;for(let t=0;t<this.selectedRankWords.length;t++){let n=this.selectedRankWords[t];for(this.selectedRankWords[t]=0;n!==0;){let r=t*32+31-Math.clz32(n&-n),i=this.selectedRankBits[r];for(this.selectedRankBits[r]=0;i!==0;)this.selectedRanks[e++]=r*32+31-Math.clz32(i&-i),i=(i&i-1)>>>0;n=(n&n-1)>>>0}}this.orderedSelectedCount=e}a=this.orderedSelectedCount;let s=i&&a===this.previousRankCount;if(s){for(let e=0;e<a;e++)if(this.previousSelectedRanks[e]!==this.selectedRanks[e]){s=!1;break}}if(s&&!r)return!1;if(this.initialized=!0,!i){this.previousRuns.length=e.length;for(let t=0;t<e.length;t++)this.previousRuns[t]=e[t]}this.previousRunsAreSource=e===this.sourceRuns,this.previousSelectedRanks.length<a&&(this.previousSelectedRanks=new Uint32Array(Math.min(this.selectedRanks.length,Math.max(a,this.previousSelectedRanks.length*2)))),this.previousSelectedRanks.set(this.selectedRanks.subarray(0,a)),this.previousRankCount=a,this.revision++,i||this.coverageRevision++,this.batches.length=0,this.batchSegments.length=0,this.spanOrdered=!0,this.instanceCount=0,this.culledSegmentCount=0,this.visiblePaints.length=0,this.scheduledRuns.fill(0),this.scheduledSpanPrefix.fill(0);let c=0;for(let t of e){let e=this.runIndices.get(t);this.scheduledRuns[e]=1,this.scheduledSpanPrefix[(this.segments?.[e]??0)+1]++;let n=t.first,r=t.count;if(t.kind===`stroke`&&this.runtime){for(;c<a&&this.selectedRanks[c]<this.runRankOffsets[e];)c++;for(n=c;c<a&&this.selectedRanks[c]<this.runRankOffsets[e+1];)c++;r=c-n}t.kind===`text`&&this.textSelection&&(n=this.textSelection.ranges[e*2],r=this.textSelection.ranges[e*2+1]),r!==0&&(this.runRanges[e*2]=n,this.runRanges[e*2+1]=r,this.visiblePaints.push(e))}for(let e=1;e<this.scheduledSpanPrefix.length;e++)this.scheduledSpanPrefix[e]+=this.scheduledSpanPrefix[e-1];let l=0,u=0;for(let e of this.visiblePaints){let t=this.sourceRuns[e].kind,n=this.runRanges[e*2+1];t===`stroke`&&(l+=n),(t===`stroke`||t===`fill`||t===`text`)&&(u+=n)}if(this.uintInstanceData=$(this.uintInstanceData,u*2),this.redundancyEnabled){this.redundancyIds=$(this.redundancyIds,Math.min(l,this.redundancy.candidateCount),this.rankToId.length);let e=0;for(let t of this.visiblePaints){if(this.sourceRuns[t].kind!==`stroke`)continue;let n=this.runRanges[t*2],r=n+this.runRanges[t*2+1];for(let t=n;t<r;t++){let n=this.runtime?this.rankToId[this.selectedRanks[t]]:t;this.redundancy.isCandidate(n)&&(e===this.redundancyIds.length&&(this.redundancyIds=$(this.redundancyIds,e+1,1/0,!0)),this.redundancyIds[e++]=n)}}this.redundancy.update(this.redundancyIds,e),this.culledSegmentCount=this.redundancy.culledCount}let d=this.scheduler?.schedule(this.visiblePaints)??this.visiblePaints;for(let e of d){let t=this.sourceRuns[e],n=this.segments?this.segments[e]:0,r=this.runRanges[e*2],i=this.runRanges[e*2+1];if(t.kind!==`stroke`&&t.kind!==`fill`&&t.kind!==`text`){this.pushBatch({...t},n);continue}let a=this.instanceCount,o=t.kind===`text`&&this.textSelection?(t.clipIndex??-1)+1:this.clipElision?.clipCodes[e]??(t.clipIndex??-1)+1;if(t.kind===`text`&&this.textSelection)for(let e=r;e<r+i;e++)this.appendInstance(this.textSelection.instanceIds[e],o);else if(t.kind===`stroke`&&this.runtime)for(let e=r;e<r+i;e++){let t=this.rankToId[this.selectedRanks[e]];(!this.redundancyEnabled||this.redundancy.isRetained(t))&&this.appendInstance(t,o)}else for(let e=r;e<r+i;e++)(t.kind!==`stroke`||!this.redundancyEnabled||this.redundancy.isRetained(e))&&this.appendInstance(e,o);let s=this.instanceCount-a;if(!s)continue;let c=this.batches[this.batches.length-1];c?.kind===t.kind&&c.clipIndex===-2&&c.blendMode===t.blendMode&&this.batchSegments[this.batches.length-1]===n?c.count+=s:this.pushBatch({kind:t.kind,first:a,count:s,clipIndex:-2,...t.blendMode?{blendMode:t.blendMode}:{}},n)}return this.floatInstancesDirty=!0,!0}pushBatch(e,t){let n=this.batches[this.batches.length-1];if(e.kind===`raster`&&!e.blendMode&&v(n,e)&&this.batchSegments[this.batchSegments.length-1]===t){n.count+=e.count;return}t<(this.batchSegments[this.batchSegments.length-1]??0)&&(this.spanOrdered=!1),this.batches.push(e),this.batchSegments.push(t)}appendInstance(e,t){let n=this.instanceCount*2;this.uintInstances[n]=e,this.uintInstances[n+1]=t,this.instanceCount++}};function ke(e){let t=new Uint32Array(e);for(let n=0;n<e;n++)t[n]=n;return t}function $(e,t,n=1/0,r=!1){if(e.length>=t)return e;let i=new Uint32Array(Math.min(n,Math.max(t,e.length*2,256)));return r&&i.set(e),i}var Ae=class{batches=[];batchSegments=[];instanceCount=0;revision=0;instanceData=new Uint32Array;floatData=new Float32Array;floatsDirty=!1;source=null;sourceRevision=-1;get uintInstances(){return this.instanceData}get floatInstances(){if(this.floatData.length<this.instanceCount*3&&(this.floatData=new Float32Array(this.instanceData.length),this.floatsDirty=!0),this.floatsDirty){let e=this.instanceCount*3;for(let t=0;t<e;t++)this.floatData[t]=this.instanceData[t];this.floatsDirty=!1}return this.floatData}update(e){if(this.source===e&&this.sourceRevision===e.revision)return!1;this.source=e,this.sourceRevision=e.revision,this.batches.length=0,this.batchSegments.length=0,this.instanceCount=0;let t=[];for(let n=0;n<e.batches.length;){let r=e.batchSegments[n]??0,i=n,a=0,o=0;for(;i<e.batches.length&&(e.batchSegments[i]??0)===r;){let t=e.batches[i];if(!je(t))break;t.kind===`stroke`?a+=t.count:o+=t.count,i++}if(a>0&&o>0){let e=a+o;this.batches.push({kind:`mixed-vector`,first:this.instanceCount,count:e,strokeCount:a,fillCount:o,clipIndex:-2}),this.batchSegments.push(r),t.push({first:n,end:i,output:this.instanceCount}),this.instanceCount+=e,n=i}else{let t=Math.max(i,n+1);for(let r=n;r<t;r++)this.batches.push(e.batches[r]),this.batchSegments.push(e.batchSegments[r]??0);n=t}}let n=this.instanceCount*3;this.instanceData.length<n&&(this.instanceData=new Uint32Array(Math.max(n,this.instanceData.length*2)));let r=e.uintInstances;for(let n of t){let t=n.output*3;for(let i=n.first;i<n.end;i++){let n=e.batches[i],a=n.kind===`stroke`?0:1;for(let e=n.first;e<n.first+n.count;e++)this.instanceData[t++]=r[e*2],this.instanceData[t++]=r[e*2+1],this.instanceData[t++]=a}}return this.floatsDirty=!0,this.revision++,!0}};function je(e){return(e.kind===`stroke`||e.kind===`fill`)&&e.clipIndex===-2&&e.blendMode===void 0&&e.count>0}var Me=1e5;function Ne(e,t){return e>Me&&t===0}function Pe(e){let t=e?Math.floor(e.count):0,n=e&&Number.isFinite(t)?Math.min(Math.max(0,t),Math.floor(e.rects.length/4)):0;if(!e||n===0)return null;let r=Math.floor(e.currentIndex),i=r>=0&&r<n?r:-1,a=Math.floor(e.currentCount??1),o=i>=0?Math.min(Number.isFinite(a)?Math.max(1,a):1,n-i):0,s=i+o,c=n-o,l=new Float32Array(c*4),u=0;for(let t=0;t<n;t+=1)t>=i&&t<s||(l.set(e.rects.subarray(t*4,t*4+4),u*4),u+=1);return{otherRects:l,otherCount:c,currentRects:o>0?e.rects.slice(i*4,s*4):new Float32Array,currentCount:o}}export{E as S,M as _,Te as a,w as b,we as c,z as d,V as f,I as g,L as h,Oe as i,xe as l,P as m,Ne as n,Ee as o,F as p,Ae as r,Se as s,Pe as t,ge as u,N as v,D as x,T as y};