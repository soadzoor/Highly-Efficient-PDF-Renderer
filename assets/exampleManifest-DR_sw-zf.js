const __vite__mapDeps=(i,m=__vite__mapDeps,d=(m.f||(m.f=["./pdf-BtsxYlBu.js","./preload-helper-xBbMyY7u.js","./pdf-Bb-_Bid1.js","./pdf-D9R3BgnU.js"])))=>i.map(i=>d[i]);
import{t as e}from"./preload-helper-xBbMyY7u.js";var t=Object.create,n=Object.defineProperty,r=Object.getOwnPropertyDescriptor,i=Object.getOwnPropertyNames,a=Object.getPrototypeOf,o=Object.prototype.hasOwnProperty,s=(e,t)=>()=>(t||(e((t={exports:{}}).exports,t),e=null),t.exports),c=(e,t,a,s)=>{if(t&&typeof t==`object`||typeof t==`function`)for(var c=i(t),l=0,u=c.length,d;l<u;l++)d=c[l],!o.call(e,d)&&d!==a&&n(e,d,{get:(e=>t[e]).bind(null,d),enumerable:!(s=r(t,d))||s.enumerable});return e},l=(e,r,i)=>(i=e==null?{}:t(a(e)),c(r||!e||!e.__esModule?n(i,`default`,{value:e,enumerable:!0}):i,e)),u=(e=>typeof require<`u`?require:typeof Proxy<`u`?new Proxy(e,{get:(e,t)=>(typeof require<`u`?require:e)[t]}):e)(function(e){if(typeof require<`u`)return require.apply(this,arguments);throw Error('Calling `require` for "'+e+"\" in an environment that doesn't expose the `require` function. See https://rolldown.rs/in-depth/bundling-cjs#require-external-modules for more details.")});(function(){let e=document.createElement(`link`).relList;if(e&&e.supports&&e.supports(`modulepreload`))return;for(let e of document.querySelectorAll(`link[rel="modulepreload"]`))n(e);new MutationObserver(e=>{for(let t of e)if(t.type===`childList`)for(let e of t.addedNodes)e.tagName===`LINK`&&e.rel===`modulepreload`&&n(e)}).observe(document,{childList:!0,subtree:!0});function t(e){let t={};return e.integrity&&(t.integrity=e.integrity),e.referrerPolicy&&(t.referrerPolicy=e.referrerPolicy),e.crossOrigin===`use-credentials`?t.credentials=`include`:e.crossOrigin===`anonymous`?t.credentials=`omit`:t.credentials=`same-origin`,t}function n(e){if(e.ep)return;e.ep=!0;let n=t(e);fetch(e.href,n)}})();var d=``+new URL(`pdf.worker.min-FHbmGBN0.mjs`,import.meta.url).href,f=64,p=1024,m=3e4,h=22e4;function g(e){let t=e.segmentCount,n=Math.max(e.bounds.maxX-e.bounds.minX,1e-5),r=Math.max(e.bounds.maxY-e.bounds.minY,1e-5),{gridWidth:i,gridHeight:a}=_(t,n,r),o=i*a,s=n/i,c=r/a,l=new Uint32Array(o),u=0;for(let n=0;n<t;n+=1){let t=n*4,r=n*4,o=e.styles[r]+.35,d=e.primitiveBounds[t]-o,f=e.primitiveBounds[t+1]-o,p=e.primitiveBounds[t+2]+o,m=e.primitiveBounds[t+3]+o,h=v(Math.floor((d-e.bounds.minX)/s),i),g=v(Math.floor((p-e.bounds.minX)/s),i),_=v(Math.floor((f-e.bounds.minY)/c),a),y=v(Math.floor((m-e.bounds.minY)/c),a);for(let e=_;e<=y;e+=1){let t=e*i+h;for(let e=h;e<=g;e+=1){let e=l[t]+1;l[t]=e,e>u&&(u=e),t+=1}}}let d=new Uint32Array(o+1);for(let e=0;e<o;e+=1)d[e+1]=d[e]+l[e];let f=d[o],p=new Uint32Array(f),m=d.slice(0,o);for(let n=0;n<t;n+=1){let t=n*4,r=n*4,o=e.styles[r]+.35,l=e.primitiveBounds[t]-o,u=e.primitiveBounds[t+1]-o,d=e.primitiveBounds[t+2]+o,f=e.primitiveBounds[t+3]+o,h=v(Math.floor((l-e.bounds.minX)/s),i),g=v(Math.floor((d-e.bounds.minX)/s),i),_=v(Math.floor((u-e.bounds.minY)/c),a),y=v(Math.floor((f-e.bounds.minY)/c),a);for(let e=_;e<=y;e+=1){let t=e*i+h;for(let e=h;e<=g;e+=1){let e=m[t];p[e]=n,m[t]=e+1,t+=1}}}return{gridWidth:i,gridHeight:a,minX:e.bounds.minX,minY:e.bounds.minY,maxX:e.bounds.maxX,maxY:e.bounds.maxY,cellWidth:s,cellHeight:c,offsets:d,counts:l,indices:p,maxCellPopulation:u}}function _(e,t,n){let r=y(Math.round(e/8),m,h),i=t/n,a=Math.round(Math.sqrt(r*i)),o=Math.round(r/Math.max(a,1));return a=y(a,f,p),o=y(o,f,p),{gridWidth:a,gridHeight:o}}function v(e,t){return e<0?0:e>=t?t-1:e}function y(e,t,n){return e<t?t:e>n?n:e}var b=96,x=[1,.85,.7,.55,.4,.3],S=8,C=256,w=8,T=.001;function E(e,t){if(typeof document>`u`||e.textGlyphCount<=0)return null;let n=new Float32Array(e.textGlyphCount*4),r=M(Math.trunc(t)||4096,256,8192),i=null;for(let t of x){let n=D(e,Math.max(S,Math.round(b*t)));if(n.length===0)return null;let a=O(n,r);if(a){i=a;break}}if(!i)return null;let a=document.createElement(`canvas`);a.width=i.width,a.height=i.height;let o=a.getContext(`2d`,{alpha:!0,willReadFrequently:!0});if(!o)return null;o.setTransform(1,0,0,1,0,0),o.clearRect(0,0,i.width,i.height),o.fillStyle=`#ffffff`,o.globalCompositeOperation=`source-over`;for(let t of i.placements){if(!k(o,t,e))continue;o.fill(`nonzero`);let r=t.index*4;n[r]=(t.x+w)/i.width,n[r+1]=(t.y+w)/i.height,n[r+2]=t.innerWidth/i.width,n[r+3]=t.innerHeight/i.height}let s=o.getImageData(0,0,i.width,i.height),c=new Uint8Array(i.width*i.height);for(let e=0,t=0;t<c.length;e+=4,t+=1)c[t]=s.data[e+3];return{width:i.width,height:i.height,alpha:c,glyphUvRects:n}}function D(e,t){let n=[];for(let r=0;r<e.textGlyphCount;r+=1){let i=r*4,a=Math.max(0,Math.trunc(e.textGlyphMetaA[i])),o=Math.max(0,Math.trunc(e.textGlyphMetaA[i+1]));if(o<=0)continue;let s=e.textGlyphMetaA[i+2],c=e.textGlyphMetaA[i+3],l=e.textGlyphMetaB[i],u=e.textGlyphMetaB[i+1],d=l-s,f=u-c;if(!Number.isFinite(d)||!Number.isFinite(f)||d<=1e-6||f<=1e-6)continue;let p=t/Math.max(d,f),m=M(Math.ceil(d*p),S,C),h=M(Math.ceil(f*p),S,C);n.push({index:r,segmentStart:a,segmentCount:o,minX:s,minY:c,maxX:l,maxY:u,innerWidth:m,innerHeight:h,tileWidth:m+w*2,tileHeight:h+w*2,x:0,y:0})}return n}function O(e,t){if(e.length===0)return null;let n=e.slice().sort((e,t)=>e.tileHeight===t.tileHeight?t.tileWidth-e.tileWidth:t.tileHeight-e.tileHeight),r=n.reduce((e,t)=>e+t.tileWidth*t.tileHeight,0),i=n.reduce((e,t)=>Math.max(e,t.tileWidth),0),a=M(j(Math.ceil(Math.sqrt(r)*1.15)),i,t);for(;a<=t;){let e=0,r=0,i=0,o=!1;for(let s of n){if(s.tileWidth>a){o=!0;break}if(e+s.tileWidth>a&&(e=0,r+=i,i=0),s.x=e,s.y=r,e+=s.tileWidth,i=Math.max(i,s.tileHeight),r+i>t){o=!0;break}}if(!o){let e=r+i,o=M(j(Math.max(e,1)),1,t);if(o<=t)return{placements:n,width:a,height:o}}if(a===t)break;a=Math.min(t,a*2)}return null}function k(e,t,n){let r=Math.max(t.maxX-t.minX,1e-6),i=Math.max(t.maxY-t.minY,1e-6),a=t.innerWidth/r,o=t.innerHeight/i,s=t.x+w-t.minX*a,c=t.y+w+t.maxY*o,l=e=>s+e*a,u=e=>c-e*o;e.beginPath();let d=!1,f=!1,p=0,m=0,h=0,g=0;for(let r=0;r<t.segmentCount;r+=1){let i=(t.segmentStart+r)*4;if(i+3>=n.textGlyphSegmentsA.length||i+3>=n.textGlyphSegmentsB.length)break;let a=n.textGlyphSegmentsA[i],o=n.textGlyphSegmentsA[i+1],s=n.textGlyphSegmentsA[i+2],c=n.textGlyphSegmentsA[i+3],_=n.textGlyphSegmentsB[i],v=n.textGlyphSegmentsB[i+1],y=n.textGlyphSegmentsB[i+2];(!f||!A(a,o,h,g))&&(f&&e.closePath(),e.moveTo(l(a),u(o)),f=!0,p=a,m=o),y>=.5?e.quadraticCurveTo(l(s),u(c),l(_),u(v)):e.lineTo(l(_),u(v)),d=!0,h=_,g=v,A(h,g,p,m)&&(e.closePath(),f=!1)}return f&&e.closePath(),d}function A(e,t,n,r){return Math.abs(e-n)<=T&&Math.abs(t-r)<=T}function j(e){if(e<=1)return 1;let t=1;for(;t<e;)t<<=1;return t}function M(e,t,n){return e<t?t:e>n?n:e}var N=`#version 300 es
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
`,P=`#version 300 es
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
`,F=`#version 300 es
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
`,I=`#version 300 es
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
`,L=`#version 300 es
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
`,R=`#version 300 es
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
`,z=`#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;

void main() {
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`,B=`#version 300 es
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
`,V=`#version 300 es
precision highp float;

uniform sampler2D uVectorLayerTex;
uniform vec2 uViewportPx;

out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / max(uViewportPx, vec2(1.0));
  outColor = texture(uVectorLayerTex, clamp(uv, vec2(0.0), vec2(1.0)));
}
`,H=`#version 300 es
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
`,U=`#version 300 es
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
`,ee=140,W=3e5,te=1.8,ne=96,re=1e-5,ie=.75,G=1.3333333333,ae=2,oe=2.25,se=24,ce=24,le=1e-4,ue=1e-5,de=64,fe=5,pe=2e4,me=120,he=160/255,ge=169/255,_e=175/255,ve=N,ye=P,be=F,xe=I,Se=L,Ce=R,we=H,Te=U,Ee=class{canvas;gl;segmentProgram;fillProgram;textProgram;blitProgram;vectorCompositeProgram;rasterProgram;segmentVao;fillVao;textVao;blitVao;cornerBuffer;allSegmentIdBuffer;visibleSegmentIdBuffer;allFillPathIdBuffer;allTextInstanceIdBuffer;segmentTextureA;segmentTextureB;segmentTextureC;segmentTextureD;fillPathMetaTextureA;fillPathMetaTextureB;fillPathMetaTextureC;fillSegmentTextureA;fillSegmentTextureB;textInstanceTextureA;textInstanceTextureB;textInstanceTextureC;textGlyphMetaTextureA;textGlyphMetaTextureB;textGlyphRasterMetaTexture;textGlyphSegmentTextureA;textGlyphSegmentTextureB;textRasterAtlasTexture;pageBackgroundTexture;uSegmentTexA;uSegmentTexB;uSegmentStyleTex;uSegmentBoundsTex;uSegmentTexSize;uViewport;uCameraCenter;uZoom;uAAScreenPx;uStrokeCurveEnabled;uStrokeVectorOverride;uFillPathMetaTexA;uFillPathMetaTexB;uFillPathMetaTexC;uFillSegmentTexA;uFillSegmentTexB;uFillPathMetaTexSize;uFillSegmentTexSize;uFillViewport;uFillCameraCenter;uFillZoom;uFillAAScreenPx;uFillVectorOverride;uTextInstanceTexA;uTextInstanceTexB;uTextInstanceTexC;uTextGlyphMetaTexA;uTextGlyphMetaTexB;uTextGlyphRasterMetaTex;uTextGlyphSegmentTexA;uTextGlyphSegmentTexB;uTextInstanceTexSize;uTextGlyphMetaTexSize;uTextGlyphSegmentTexSize;uTextViewport;uTextCameraCenter;uTextZoom;uTextAAScreenPx;uTextCurveEnabled;uTextRasterAtlasTex;uTextRasterAtlasSize;uTextVectorOnly;uTextVectorOverride;uCacheTex;uViewportPx;uCacheSizePx;uOffsetPx;uSampleScale;uVectorLayerTex;uVectorLayerViewportPx;uRasterTex;uRasterMatrixABCD;uRasterMatrixEF;uRasterViewport;uRasterCameraCenter;uRasterZoom;scene=null;grid=null;sceneStats=null;allSegmentIds=new Float32Array;visibleSegmentIds=new Float32Array;allFillPathIds=new Float32Array;allTextInstanceIds=new Float32Array;segmentMarks=new Uint32Array;segmentMinX=new Float32Array;segmentMinY=new Float32Array;segmentMaxX=new Float32Array;segmentMaxY=new Float32Array;markToken=1;segmentCount=0;fillPathCount=0;textInstanceCount=0;rasterLayers=[];pageRects=new Float32Array;pageTextRanges=new Uint32Array;visiblePageRectIndices=new Uint32Array;visiblePageRectCount=0;visibleTextRanges=[];visibleSegmentCount=0;usingAllSegments=!0;segmentTextureWidth=1;segmentTextureHeight=1;fillPathMetaTextureWidth=1;fillPathMetaTextureHeight=1;fillSegmentTextureWidth=1;fillSegmentTextureHeight=1;textInstanceTextureWidth=1;textInstanceTextureHeight=1;textGlyphMetaTextureWidth=1;textGlyphMetaTextureHeight=1;textRasterAtlasWidth=1;textRasterAtlasHeight=1;textGlyphSegmentTextureWidth=1;textGlyphSegmentTextureHeight=1;needsVisibleSetUpdate=!1;rafHandle=0;frameListener=null;interactionViewportProvider=null;externalFrameDriver=!1;presentedCameraCenterX=0;presentedCameraCenterY=0;presentedZoom=1;presentedFrameSerial=0;cameraCenterX=0;cameraCenterY=0;zoom=1;targetCameraCenterX=0;targetCameraCenterY=0;targetZoom=1;lastCameraAnimationTimeMs=0;hasZoomAnchor=!1;zoomAnchorClientX=0;zoomAnchorClientY=0;zoomAnchorWorldX=0;zoomAnchorWorldY=0;panVelocityWorldX=0;panVelocityWorldY=0;lastPanVelocityUpdateTimeMs=0;lastPanFrameCameraX=0;lastPanFrameCameraY=0;lastPanFrameTimeMs=0;minZoom=.01;maxZoom=4096;lastInteractionTime=-1/0;isPanInteracting=!1;panCacheTexture=null;panCacheFramebuffer=null;panCacheWidth=0;panCacheHeight=0;panCacheValid=!1;panCacheCenterX=0;panCacheCenterY=0;panCacheZoom=1;panCacheRenderedSegments=0;panCacheUsedCulling=!1;vectorMinifyTexture=null;vectorMinifyFramebuffer=null;vectorMinifyWidth=0;vectorMinifyHeight=0;vectorMinifyWarmupPending=!1;panOptimizationEnabled=!0;rasterRenderingEnabled=!0;fillRenderingEnabled=!0;strokeRenderingEnabled=!0;textRenderingEnabled=!0;strokeCurveEnabled=!0;textVectorOnly=!1;hasCameraInteractionSinceSceneLoad=!1;pageBackgroundColor=[1,1,1,1];vectorOverrideColor=[0,0,0];vectorOverrideOpacity=0;isDisposed=!1;constructor(e){this.canvas=e;let t=e.getContext(`webgl2`,{antialias:!1,depth:!1,stencil:!1,alpha:!1,premultipliedAlpha:!1});if(!t)throw Error(`WebGL2 is required for this proof-of-concept renderer.`);this.gl=t,this.segmentProgram=this.createProgram(N,P),this.fillProgram=this.createProgram(F,I),this.textProgram=this.createProgram(L,R),this.blitProgram=this.createProgram(z,B),this.vectorCompositeProgram=this.createProgram(z,V),this.rasterProgram=this.createProgram(H,U),this.segmentVao=this.createVertexArray(),this.fillVao=this.createVertexArray(),this.textVao=this.createVertexArray(),this.blitVao=this.createVertexArray(),this.cornerBuffer=this.mustCreateBuffer(),this.allSegmentIdBuffer=this.mustCreateBuffer(),this.visibleSegmentIdBuffer=this.mustCreateBuffer(),this.allFillPathIdBuffer=this.mustCreateBuffer(),this.allTextInstanceIdBuffer=this.mustCreateBuffer(),this.segmentTextureA=this.mustCreateTexture(),this.segmentTextureB=this.mustCreateTexture(),this.segmentTextureC=this.mustCreateTexture(),this.segmentTextureD=this.mustCreateTexture(),this.fillPathMetaTextureA=this.mustCreateTexture(),this.fillPathMetaTextureB=this.mustCreateTexture(),this.fillPathMetaTextureC=this.mustCreateTexture(),this.fillSegmentTextureA=this.mustCreateTexture(),this.fillSegmentTextureB=this.mustCreateTexture(),this.textInstanceTextureA=this.mustCreateTexture(),this.textInstanceTextureB=this.mustCreateTexture(),this.textInstanceTextureC=this.mustCreateTexture(),this.textGlyphMetaTextureA=this.mustCreateTexture(),this.textGlyphMetaTextureB=this.mustCreateTexture(),this.textGlyphRasterMetaTexture=this.mustCreateTexture(),this.textGlyphSegmentTextureA=this.mustCreateTexture(),this.textGlyphSegmentTextureB=this.mustCreateTexture(),this.textRasterAtlasTexture=this.mustCreateTexture(),this.pageBackgroundTexture=this.mustCreateTexture(),this.uSegmentTexA=this.mustGetUniformLocation(this.segmentProgram,`uSegmentTexA`),this.uSegmentTexB=this.mustGetUniformLocation(this.segmentProgram,`uSegmentTexB`),this.uSegmentStyleTex=this.mustGetUniformLocation(this.segmentProgram,`uSegmentStyleTex`),this.uSegmentBoundsTex=this.mustGetUniformLocation(this.segmentProgram,`uSegmentBoundsTex`),this.uSegmentTexSize=this.mustGetUniformLocation(this.segmentProgram,`uSegmentTexSize`),this.uViewport=this.mustGetUniformLocation(this.segmentProgram,`uViewport`),this.uCameraCenter=this.mustGetUniformLocation(this.segmentProgram,`uCameraCenter`),this.uZoom=this.mustGetUniformLocation(this.segmentProgram,`uZoom`),this.uAAScreenPx=this.mustGetUniformLocation(this.segmentProgram,`uAAScreenPx`),this.uStrokeCurveEnabled=this.mustGetUniformLocation(this.segmentProgram,`uStrokeCurveEnabled`),this.uStrokeVectorOverride=this.mustGetUniformLocation(this.segmentProgram,`uVectorOverride`),this.uFillPathMetaTexA=this.mustGetUniformLocation(this.fillProgram,`uFillPathMetaTexA`),this.uFillPathMetaTexB=this.mustGetUniformLocation(this.fillProgram,`uFillPathMetaTexB`),this.uFillPathMetaTexC=this.mustGetUniformLocation(this.fillProgram,`uFillPathMetaTexC`),this.uFillSegmentTexA=this.mustGetUniformLocation(this.fillProgram,`uFillSegmentTexA`),this.uFillSegmentTexB=this.mustGetUniformLocation(this.fillProgram,`uFillSegmentTexB`),this.uFillPathMetaTexSize=this.mustGetUniformLocation(this.fillProgram,`uFillPathMetaTexSize`),this.uFillSegmentTexSize=this.mustGetUniformLocation(this.fillProgram,`uFillSegmentTexSize`),this.uFillViewport=this.mustGetUniformLocation(this.fillProgram,`uViewport`),this.uFillCameraCenter=this.mustGetUniformLocation(this.fillProgram,`uCameraCenter`),this.uFillZoom=this.mustGetUniformLocation(this.fillProgram,`uZoom`),this.uFillAAScreenPx=this.mustGetUniformLocation(this.fillProgram,`uFillAAScreenPx`),this.uFillVectorOverride=this.mustGetUniformLocation(this.fillProgram,`uVectorOverride`),this.uTextInstanceTexA=this.mustGetUniformLocation(this.textProgram,`uTextInstanceTexA`),this.uTextInstanceTexB=this.mustGetUniformLocation(this.textProgram,`uTextInstanceTexB`),this.uTextInstanceTexC=this.mustGetUniformLocation(this.textProgram,`uTextInstanceTexC`),this.uTextGlyphMetaTexA=this.mustGetUniformLocation(this.textProgram,`uTextGlyphMetaTexA`),this.uTextGlyphMetaTexB=this.mustGetUniformLocation(this.textProgram,`uTextGlyphMetaTexB`),this.uTextGlyphRasterMetaTex=this.mustGetUniformLocation(this.textProgram,`uTextGlyphRasterMetaTex`),this.uTextGlyphSegmentTexA=this.mustGetUniformLocation(this.textProgram,`uTextGlyphSegmentTexA`),this.uTextGlyphSegmentTexB=this.mustGetUniformLocation(this.textProgram,`uTextGlyphSegmentTexB`),this.uTextInstanceTexSize=this.mustGetUniformLocation(this.textProgram,`uTextInstanceTexSize`),this.uTextGlyphMetaTexSize=this.mustGetUniformLocation(this.textProgram,`uTextGlyphMetaTexSize`),this.uTextGlyphSegmentTexSize=this.mustGetUniformLocation(this.textProgram,`uTextGlyphSegmentTexSize`),this.uTextViewport=this.mustGetUniformLocation(this.textProgram,`uViewport`),this.uTextCameraCenter=this.mustGetUniformLocation(this.textProgram,`uCameraCenter`),this.uTextZoom=this.mustGetUniformLocation(this.textProgram,`uZoom`),this.uTextAAScreenPx=this.mustGetUniformLocation(this.textProgram,`uTextAAScreenPx`),this.uTextCurveEnabled=this.mustGetUniformLocation(this.textProgram,`uTextCurveEnabled`),this.uTextRasterAtlasTex=this.mustGetUniformLocation(this.textProgram,`uTextRasterAtlasTex`),this.uTextRasterAtlasSize=this.mustGetUniformLocation(this.textProgram,`uTextRasterAtlasSize`),this.uTextVectorOnly=this.mustGetUniformLocation(this.textProgram,`uTextVectorOnly`),this.uTextVectorOverride=this.mustGetUniformLocation(this.textProgram,`uVectorOverride`),this.uCacheTex=this.mustGetUniformLocation(this.blitProgram,`uCacheTex`),this.uViewportPx=this.mustGetUniformLocation(this.blitProgram,`uViewportPx`),this.uCacheSizePx=this.mustGetUniformLocation(this.blitProgram,`uCacheSizePx`),this.uOffsetPx=this.mustGetUniformLocation(this.blitProgram,`uOffsetPx`),this.uSampleScale=this.mustGetUniformLocation(this.blitProgram,`uSampleScale`),this.uVectorLayerTex=this.mustGetUniformLocation(this.vectorCompositeProgram,`uVectorLayerTex`),this.uVectorLayerViewportPx=this.mustGetUniformLocation(this.vectorCompositeProgram,`uViewportPx`),this.uRasterTex=this.mustGetUniformLocation(this.rasterProgram,`uRasterTex`),this.uRasterMatrixABCD=this.mustGetUniformLocation(this.rasterProgram,`uRasterMatrixABCD`),this.uRasterMatrixEF=this.mustGetUniformLocation(this.rasterProgram,`uRasterMatrixEF`),this.uRasterViewport=this.mustGetUniformLocation(this.rasterProgram,`uViewport`),this.uRasterCameraCenter=this.mustGetUniformLocation(this.rasterProgram,`uCameraCenter`),this.uRasterZoom=this.mustGetUniformLocation(this.rasterProgram,`uZoom`),this.initializeGeometry(),this.initializeState(),this.uploadPageBackgroundTexture()}setFrameListener(e){this.frameListener=e}setExternalFrameDriver(e){let t=!!e;this.externalFrameDriver!==t&&(this.externalFrameDriver=t,this.externalFrameDriver&&this.rafHandle!==0&&(cancelAnimationFrame(this.rafHandle),this.rafHandle=0))}renderExternalFrame(e=performance.now()){this.render(e)}setPanOptimizationEnabled(e){let t=!!e;this.panOptimizationEnabled!==t&&(this.panOptimizationEnabled=t,this.isPanInteracting=!1,this.panCacheValid=!1,this.panOptimizationEnabled||this.destroyPanCacheResources(),this.needsVisibleSetUpdate=!0,this.requestFrame())}setStrokeCurveEnabled(e){let t=!!e;this.strokeCurveEnabled!==t&&(this.strokeCurveEnabled=t,this.requestFrame())}setRasterRenderingEnabled(e){let t=!!e;this.rasterRenderingEnabled!==t&&(this.rasterRenderingEnabled=t,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setStrokeRenderingEnabled(e){let t=!!e;this.strokeRenderingEnabled!==t&&(this.strokeRenderingEnabled=t,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setFillRenderingEnabled(e){let t=!!e;this.fillRenderingEnabled!==t&&(this.fillRenderingEnabled=t,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setTextRenderingEnabled(e){let t=!!e;this.textRenderingEnabled!==t&&(this.textRenderingEnabled=t,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setTextVectorOnly(e){let t=!!e;this.textVectorOnly!==t&&(this.textVectorOnly=t,this.panCacheValid=!1,this.textVectorOnly&&this.destroyVectorMinifyResources(),this.requestFrame())}setPageBackgroundColor(e,t,n,r){let i=K(e,0,1),a=K(t,0,1),o=K(n,0,1),s=K(r,0,1),c=this.pageBackgroundColor;Math.abs(c[0]-i)<=1e-6&&Math.abs(c[1]-a)<=1e-6&&Math.abs(c[2]-o)<=1e-6&&Math.abs(c[3]-s)<=1e-6||(this.pageBackgroundColor=[i,a,o,s],this.uploadPageBackgroundTexture(),this.panCacheValid=!1,this.requestFrame())}setVectorColorOverride(e,t,n,r){let i=K(e,0,1),a=K(t,0,1),o=K(n,0,1),s=K(r,0,1),c=this.vectorOverrideColor;Math.abs(c[0]-i)<=1e-6&&Math.abs(c[1]-a)<=1e-6&&Math.abs(c[2]-o)<=1e-6&&Math.abs(this.vectorOverrideOpacity-s)<=1e-6||(this.vectorOverrideColor=[i,a,o],this.vectorOverrideOpacity=s,this.panCacheValid=!1,this.requestFrame())}setInteractionViewportProvider(e){this.interactionViewportProvider=e}beginPanInteraction(){this.hasCameraInteractionSinceSceneLoad=!0,this.syncCameraTargetsToCurrent(),this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameCameraX=this.cameraCenterX,this.lastPanFrameCameraY=this.cameraCenterY,this.lastPanFrameTimeMs=0,this.isPanInteracting=!0,this.markInteraction()}endPanInteraction(){this.isPanInteracting=!1;let e=performance.now(),t=this.lastPanVelocityUpdateTimeMs>0&&e-this.lastPanVelocityUpdateTimeMs<=me?Math.hypot(this.panVelocityWorldX,this.panVelocityWorldY):0;Number.isFinite(t)&&t>=fe?(this.targetCameraCenterX=this.cameraCenterX+this.panVelocityWorldX/se,this.targetCameraCenterY=this.cameraCenterY+this.panVelocityWorldY/se,this.lastCameraAnimationTimeMs=0):(this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY),this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameTimeMs=0,this.markInteraction(),this.needsVisibleSetUpdate=!0,this.requestFrame()}resize(){let e=window.devicePixelRatio||1,t=Math.max(1,Math.round(this.canvas.clientWidth*e)),n=Math.max(1,Math.round(this.canvas.clientHeight*e));this.canvas.width===t&&this.canvas.height===n||(this.canvas.width=t,this.canvas.height=n,this.destroyPanCacheResources(),this.destroyVectorMinifyResources(),this.needsVisibleSetUpdate=!0,this.requestFrame())}setScene(e){this.scene=e,this.segmentCount=e.segmentCount,this.fillPathCount=e.fillPathCount,this.textInstanceCount=e.textInstanceCount,this.pageRects=Fe(e),this.pageTextRanges=Ie(e,this.pageRects,this.textInstanceCount),this.visiblePageRectIndices.length<Math.floor(this.pageRects.length/4)&&(this.visiblePageRectIndices=new Uint32Array(Math.floor(this.pageRects.length/4))),this.visiblePageRectCount=0,this.visibleTextRanges=[],this.buildSegmentBounds(e),this.isPanInteracting=!1,this.panCacheValid=!1,this.destroyVectorMinifyResources(),this.grid=this.segmentCount>0?g(e):null,this.uploadRasterLayers(e);let t=this.uploadFillPaths(e),n=this.uploadSegments(e),r=this.uploadTextData(e);this.sceneStats={gridWidth:this.grid?.gridWidth??0,gridHeight:this.grid?.gridHeight??0,gridIndexCount:this.grid?.indices.length??0,maxCellPopulation:this.grid?.maxCellPopulation??0,fillPathTextureWidth:t.pathMetaTextureWidth,fillPathTextureHeight:t.pathMetaTextureHeight,fillSegmentTextureWidth:t.segmentTextureWidth,fillSegmentTextureHeight:t.segmentTextureHeight,textureWidth:n.textureWidth,textureHeight:n.textureHeight,maxTextureSize:n.maxTextureSize,textInstanceTextureWidth:r.instanceTextureWidth,textInstanceTextureHeight:r.instanceTextureHeight,textGlyphTextureWidth:r.glyphMetaTextureWidth,textGlyphTextureHeight:r.glyphMetaTextureHeight,textSegmentTextureWidth:r.glyphSegmentTextureWidth,textSegmentTextureHeight:r.glyphSegmentTextureHeight},this.allSegmentIds=new Float32Array(this.segmentCount);for(let e=0;e<this.segmentCount;e+=1)this.allSegmentIds[e]=e;this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.allSegmentIdBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,this.allSegmentIds,this.gl.STATIC_DRAW),this.allFillPathIds=new Float32Array(this.fillPathCount);for(let e=0;e<this.fillPathCount;e+=1)this.allFillPathIds[e]=e;this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.allFillPathIdBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,this.allFillPathIds,this.gl.STATIC_DRAW),this.allTextInstanceIds=new Float32Array(this.textInstanceCount);for(let e=0;e<this.textInstanceCount;e+=1)this.allTextInstanceIds[e]=e;return this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.allTextInstanceIdBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,this.allTextInstanceIds,this.gl.STATIC_DRAW),this.visibleSegmentIds.length<this.segmentCount&&(this.visibleSegmentIds=new Float32Array(this.segmentCount)),this.segmentMarks.length<this.segmentCount&&(this.segmentMarks=new Uint32Array(this.segmentCount),this.markToken=1),this.visibleSegmentCount=this.segmentCount,this.usingAllSegments=!0,this.setAllPagesAndTextVisible(),this.minZoom=.01,this.maxZoom=8192,this.hasCameraInteractionSinceSceneLoad=!0,this.syncCameraTargetsToCurrent(),this.needsVisibleSetUpdate=!0,this.requestFrame(),this.sceneStats}getSceneStats(){return this.sceneStats}getViewState(){return{cameraCenterX:this.cameraCenterX,cameraCenterY:this.cameraCenterY,zoom:this.zoom}}getPresentedViewState(){return{cameraCenterX:this.presentedCameraCenterX,cameraCenterY:this.presentedCameraCenterY,zoom:this.presentedZoom}}getPresentedFrameSerial(){return this.presentedFrameSerial}setViewState(e){let t=Number(e.cameraCenterX),n=Number(e.cameraCenterY),r=Number(e.zoom);if(!Number.isFinite(t)||!Number.isFinite(n)||!Number.isFinite(r))return;this.cameraCenterX=t,this.cameraCenterY=n;let i=K(r,this.minZoom,this.maxZoom);this.zoom=i,this.targetCameraCenterX=t,this.targetCameraCenterY=n,this.targetZoom=i,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1,this.isPanInteracting=!1,this.panCacheValid=!1,this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.needsVisibleSetUpdate=!0,this.requestFrame()}fitToBounds(e,t=64){let n=Math.max(e.maxX-e.minX,1e-4),r=Math.max(e.maxY-e.minY,1e-4),i=Math.max(1,this.canvas.width-t*2),a=Math.max(1,this.canvas.height-t*2),o=K(Math.min(i/n,a/r),1e-8,this.maxZoom);this.minZoom=Math.min(this.minZoom,o);let s=(e.minX+e.maxX)*.5,c=(e.minY+e.maxY)*.5;this.zoom=o,this.cameraCenterX=s,this.cameraCenterY=c,this.targetZoom=o,this.targetCameraCenterX=s,this.targetCameraCenterY=c,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1,this.isPanInteracting=!1,this.panCacheValid=!1,this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.needsVisibleSetUpdate=!0,this.requestFrame()}dispose(){if(this.isDisposed)return;this.isDisposed=!0,this.rafHandle!==0&&(cancelAnimationFrame(this.rafHandle),this.rafHandle=0),this.externalFrameDriver=!0,this.frameListener=null,this.interactionViewportProvider=null,this.destroyPanCacheResources(),this.destroyVectorMinifyResources();let e=this.gl;for(let t of this.rasterLayers)e.deleteTexture(t.texture);this.rasterLayers=[];let t=[this.segmentTextureA,this.segmentTextureB,this.segmentTextureC,this.segmentTextureD,this.fillPathMetaTextureA,this.fillPathMetaTextureB,this.fillPathMetaTextureC,this.fillSegmentTextureA,this.fillSegmentTextureB,this.textInstanceTextureA,this.textInstanceTextureB,this.textInstanceTextureC,this.textGlyphMetaTextureA,this.textGlyphMetaTextureB,this.textGlyphRasterMetaTexture,this.textGlyphSegmentTextureA,this.textGlyphSegmentTextureB,this.textRasterAtlasTexture,this.pageBackgroundTexture];for(let n of t)e.deleteTexture(n);let n=[this.cornerBuffer,this.allSegmentIdBuffer,this.visibleSegmentIdBuffer,this.allFillPathIdBuffer,this.allTextInstanceIdBuffer];for(let t of n)e.deleteBuffer(t);let r=[this.segmentVao,this.fillVao,this.textVao,this.blitVao];for(let t of r)e.deleteVertexArray(t);let i=[this.segmentProgram,this.fillProgram,this.textProgram,this.blitProgram,this.vectorCompositeProgram,this.rasterProgram];for(let t of i)e.deleteProgram(t);e.bindVertexArray(null),e.bindBuffer(e.ARRAY_BUFFER,null),e.bindBuffer(e.ELEMENT_ARRAY_BUFFER,null),e.bindFramebuffer(e.FRAMEBUFFER,null),e.useProgram(null);for(let t=0;t<=13;t+=1)e.activeTexture(e.TEXTURE0+t),e.bindTexture(e.TEXTURE_2D,null);e.activeTexture(e.TEXTURE0),this.scene=null,this.grid=null,this.sceneStats=null,this.pageRects=new Float32Array,this.pageTextRanges=new Uint32Array,this.visiblePageRectIndices=new Uint32Array,this.visibleTextRanges=[]}panByPixels(e,t){if(!Number.isFinite(e)||!Number.isFinite(t))return;this.hasCameraInteractionSinceSceneLoad=!0,this.markInteraction(),this.hasZoomAnchor=!1;let n=this.resolveClientToPixelScale(),r=-(e*n.x)/this.zoom,i=t*n.y/this.zoom;this.cameraCenterX+=r,this.cameraCenterY+=i,this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY,this.needsVisibleSetUpdate=!0,this.requestFrame()}zoomAtClientPoint(e,t,n){let r=K(n,.1,10);this.hasCameraInteractionSinceSceneLoad=!0,this.markInteraction();let i=this.clientToWorld(e,t),a=K(this.targetZoom*r,this.minZoom,this.maxZoom);this.hasZoomAnchor=!0,this.zoomAnchorClientX=e,this.zoomAnchorClientY=t,this.zoomAnchorWorldX=i.x,this.zoomAnchorWorldY=i.y,this.targetZoom=a;let o=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,a);this.targetCameraCenterX=o.x,this.targetCameraCenterY=o.y,this.needsVisibleSetUpdate=!0,this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameTimeMs=0,this.requestFrame()}requestFrame(){this.externalFrameDriver||this.rafHandle===0&&(this.rafHandle=requestAnimationFrame(e=>{this.rafHandle=0,this.render(e)}))}render(e=performance.now()){let t=this.updateCameraWithDamping(e);this.updatePanReleaseVelocitySample(e);let n=this.gl;if(this.ensureRenderState(),!this.scene||this.fillPathCount===0&&this.segmentCount===0&&this.textInstanceCount===0&&this.rasterLayers.length===0&&this.pageRects.length===0){n.bindFramebuffer(n.FRAMEBUFFER,null),n.viewport(0,0,this.canvas.width,this.canvas.height),n.clearColor(he,ge,_e,1),n.clear(n.COLOR_BUFFER_BIT),this.capturePresentedFrameState(),this.frameListener?.({renderedSegments:0,totalSegments:0,usedCulling:!1,zoom:this.zoom}),t&&this.requestFrame();return}this.shouldUsePanCache(t)?this.renderWithPanCache():this.renderDirectToScreen(),this.capturePresentedFrameState(),t&&this.requestFrame()}capturePresentedFrameState(){this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.presentedFrameSerial+=1}shouldUsePanCache(e){return!this.panOptimizationEnabled||this.segmentCount<W?!1:this.isPanInteracting?!0:e}renderDirectToScreen(){let e=this.gl,t=this.shouldUseVectorMinifyPath()&&this.ensureVectorMinifyResources();if(this.panOptimizationEnabled&&this.segmentCount>=W&&(t=!1),t&&this.vectorMinifyWarmupPending&&(t=!1,this.vectorMinifyWarmupPending=!1,this.needsVisibleSetUpdate=!0,this.requestFrame()),e.bindFramebuffer(e.FRAMEBUFFER,null),e.viewport(0,0,this.canvas.width,this.canvas.height),e.clearColor(he,ge,_e,1),e.clear(e.COLOR_BUFFER_BIT),this.needsVisibleSetUpdate){if(t){let e=this.computeVectorMinifyZoom(this.vectorMinifyWidth,this.vectorMinifyHeight);this.updateVisibleSet(this.cameraCenterX,this.cameraCenterY,this.vectorMinifyWidth,this.vectorMinifyHeight,e)}else this.updateVisibleSet(this.cameraCenterX,this.cameraCenterY,this.canvas.width,this.canvas.height,this.zoom);this.needsVisibleSetUpdate=!1}this.rasterRenderingEnabled&&this.drawRasterLayer(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY);let n=0;t?(n=this.renderVectorLayerIntoMinifyTarget(this.vectorMinifyWidth,this.vectorMinifyHeight,this.cameraCenterX,this.cameraCenterY),this.compositeVectorMinifyLayer()):(this.fillRenderingEnabled&&this.drawFilledPaths(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY),this.strokeRenderingEnabled&&(n=this.drawVisibleSegments(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY)),this.textRenderingEnabled&&this.drawTextInstances(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY)),this.frameListener?.({renderedSegments:n,totalSegments:this.segmentCount,usedCulling:!this.usingAllSegments,zoom:this.zoom})}hasVectorContent(){return this.fillRenderingEnabled&&this.fillPathCount>0||this.strokeRenderingEnabled&&this.segmentCount>0||this.textRenderingEnabled&&this.textInstanceCount>0}shouldUseVectorMinifyPath(){return this.textVectorOnly||!this.hasVectorContent()||this.textInstanceCount>1e5&&this.segmentCount===0?!1:this.zoom<=oe}computeVectorMinifyZoom(e,t){let n=Math.min(e/Math.max(1,this.canvas.width),t/Math.max(1,this.canvas.height));return this.zoom*Math.max(1,n)}ensureVectorMinifyResources(){let e=this.gl,t=e.getParameter(e.MAX_TEXTURE_SIZE),n=t/Math.max(1,this.canvas.width),r=t/Math.max(1,this.canvas.height),i=Math.max(1,Math.min(ae,n,r)),a=Math.max(this.canvas.width,Math.floor(this.canvas.width*i)),o=Math.max(this.canvas.height,Math.floor(this.canvas.height*i));if(a<this.canvas.width||o<this.canvas.height)return!1;if(this.vectorMinifyTexture&&this.vectorMinifyFramebuffer&&this.vectorMinifyWidth===a&&this.vectorMinifyHeight===o)return!0;this.destroyVectorMinifyResources();let s=e.createTexture();if(!s)return!1;e.bindTexture(e.TEXTURE_2D,s),Ae(e),e.texStorage2D(e.TEXTURE_2D,1,e.RGBA8,a,o);let c=e.createFramebuffer();if(!c)return e.deleteTexture(s),!1;e.bindFramebuffer(e.FRAMEBUFFER,c),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,s,0);let l=e.checkFramebufferStatus(e.FRAMEBUFFER);return e.bindFramebuffer(e.FRAMEBUFFER,null),l===e.FRAMEBUFFER_COMPLETE?(this.vectorMinifyTexture=s,this.vectorMinifyFramebuffer=c,this.vectorMinifyWidth=a,this.vectorMinifyHeight=o,this.vectorMinifyWarmupPending=!0,!0):(e.deleteFramebuffer(c),e.deleteTexture(s),!1)}renderVectorLayerIntoMinifyTarget(e,t,n,r){if(!this.vectorMinifyFramebuffer||!this.vectorMinifyTexture)return 0;let i=this.gl,a=this.computeVectorMinifyZoom(e,t);i.bindFramebuffer(i.FRAMEBUFFER,this.vectorMinifyFramebuffer),i.viewport(0,0,e,t),i.clearColor(0,0,0,0),i.clear(i.COLOR_BUFFER_BIT),i.blendFuncSeparate(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA),this.fillRenderingEnabled&&this.drawFilledPaths(e,t,n,r,a);let o=this.strokeRenderingEnabled?this.drawVisibleSegments(e,t,n,r,a):0;return this.textRenderingEnabled&&this.drawTextInstances(e,t,n,r,a),i.bindTexture(i.TEXTURE_2D,this.vectorMinifyTexture),i.bindFramebuffer(i.FRAMEBUFFER,null),o}compositeVectorMinifyLayer(){if(!this.vectorMinifyTexture)return;let e=this.gl;e.bindFramebuffer(e.FRAMEBUFFER,null),e.viewport(0,0,this.canvas.width,this.canvas.height),e.useProgram(this.vectorCompositeProgram),e.bindVertexArray(this.blitVao),e.activeTexture(e.TEXTURE0),e.bindTexture(e.TEXTURE_2D,this.vectorMinifyTexture),e.uniform1i(this.uVectorLayerTex,0),e.uniform2f(this.uVectorLayerViewportPx,this.canvas.width,this.canvas.height),e.blendFuncSeparate(e.ONE,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA),e.drawArrays(e.TRIANGLE_STRIP,0,4),e.blendFuncSeparate(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA)}renderWithPanCache(){if(!this.ensurePanCacheResources()){this.renderDirectToScreen();return}let e=this.panCacheZoom/Math.max(this.zoom,1e-6),t=(this.cameraCenterX-this.panCacheCenterX)*this.panCacheZoom,n=(this.cameraCenterY-this.panCacheCenterY)*this.panCacheZoom,r=this.panCacheWidth*.5-2,i=this.panCacheHeight*.5-2,a=this.canvas.width*.5*Math.abs(e),o=this.canvas.height*.5*Math.abs(e),s=r-a,c=i-o,l=this.zoom/Math.max(this.panCacheZoom,1e-6),u=l<ie||l>G,d=Math.abs(this.targetZoom-this.zoom)<=ue&&Math.abs(this.panCacheZoom-this.zoom)>re,f=s<0||c<0||Math.abs(t)>s||Math.abs(n)>c;if(!this.panCacheValid||u||f||d){this.panCacheCenterX=this.cameraCenterX,this.panCacheCenterY=this.cameraCenterY,this.panCacheZoom=this.zoom,this.updateVisibleSet(this.panCacheCenterX,this.panCacheCenterY,this.panCacheWidth,this.panCacheHeight),this.needsVisibleSetUpdate=!1;let r=this.gl;r.bindFramebuffer(r.FRAMEBUFFER,this.panCacheFramebuffer),r.viewport(0,0,this.panCacheWidth,this.panCacheHeight),r.clearColor(he,ge,_e,1),r.clear(r.COLOR_BUFFER_BIT),this.rasterRenderingEnabled&&this.drawRasterLayer(this.panCacheWidth,this.panCacheHeight,this.panCacheCenterX,this.panCacheCenterY),this.fillRenderingEnabled&&this.drawFilledPaths(this.panCacheWidth,this.panCacheHeight,this.panCacheCenterX,this.panCacheCenterY),this.panCacheRenderedSegments=this.strokeRenderingEnabled?this.drawVisibleSegments(this.panCacheWidth,this.panCacheHeight,this.panCacheCenterX,this.panCacheCenterY):0,this.textRenderingEnabled&&this.drawTextInstances(this.panCacheWidth,this.panCacheHeight,this.panCacheCenterX,this.panCacheCenterY),this.panCacheUsedCulling=!this.usingAllSegments,this.panCacheValid=!0,e=1,t=0,n=0}this.blitPanCache(t,n,e),this.frameListener?.({renderedSegments:this.panCacheRenderedSegments,totalSegments:this.segmentCount,usedCulling:this.panCacheUsedCulling,zoom:this.zoom})}drawRasterLayer(e,t,n,r){if(this.rasterLayers.length===0&&this.pageRects.length===0)return;let i=this.gl;if(i.useProgram(this.rasterProgram),i.bindVertexArray(this.blitVao),i.uniform2f(this.uRasterViewport,e,t),i.uniform2f(this.uRasterCameraCenter,n,r),i.uniform1f(this.uRasterZoom,this.zoom),this.pageRects.length>0&&this.visiblePageRectCount>0){i.activeTexture(i.TEXTURE12),i.bindTexture(i.TEXTURE_2D,this.pageBackgroundTexture),i.uniform1i(this.uRasterTex,12);for(let e=0;e<this.visiblePageRectCount;e+=1){let t=this.visiblePageRectIndices[e]*4,n=this.pageRects[t],r=this.pageRects[t+1],a=this.pageRects[t+2],o=this.pageRects[t+3],s=Math.max(a-n,1e-6),c=Math.max(o-r,1e-6);i.uniform4f(this.uRasterMatrixABCD,s,0,0,c),i.uniform2f(this.uRasterMatrixEF,n,r),i.drawArrays(i.TRIANGLE_STRIP,0,4)}}if(this.rasterLayers.length!==0){i.blendFuncSeparate(i.ONE,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA);for(let e of this.rasterLayers)i.activeTexture(i.TEXTURE12),i.bindTexture(i.TEXTURE_2D,e.texture),i.uniform1i(this.uRasterTex,12),i.uniform4f(this.uRasterMatrixABCD,e.matrix[0],e.matrix[1],e.matrix[2],e.matrix[3]),i.uniform2f(this.uRasterMatrixEF,e.matrix[4],e.matrix[5]),i.drawArrays(i.TRIANGLE_STRIP,0,4);i.blendFuncSeparate(i.SRC_ALPHA,i.ONE_MINUS_SRC_ALPHA,i.ONE,i.ONE_MINUS_SRC_ALPHA)}}drawFilledPaths(e,t,n,r,i=this.zoom){if(!this.scene||this.fillPathCount<=0)return 0;let a=this.gl;return a.useProgram(this.fillProgram),a.bindVertexArray(this.fillVao),a.activeTexture(a.TEXTURE7),a.bindTexture(a.TEXTURE_2D,this.fillPathMetaTextureA),a.activeTexture(a.TEXTURE8),a.bindTexture(a.TEXTURE_2D,this.fillPathMetaTextureB),a.activeTexture(a.TEXTURE9),a.bindTexture(a.TEXTURE_2D,this.fillPathMetaTextureC),a.activeTexture(a.TEXTURE10),a.bindTexture(a.TEXTURE_2D,this.fillSegmentTextureA),a.activeTexture(a.TEXTURE11),a.bindTexture(a.TEXTURE_2D,this.fillSegmentTextureB),a.uniform1i(this.uFillPathMetaTexA,7),a.uniform1i(this.uFillPathMetaTexB,8),a.uniform1i(this.uFillPathMetaTexC,9),a.uniform1i(this.uFillSegmentTexA,10),a.uniform1i(this.uFillSegmentTexB,11),a.uniform2i(this.uFillPathMetaTexSize,this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight),a.uniform2i(this.uFillSegmentTexSize,this.fillSegmentTextureWidth,this.fillSegmentTextureHeight),a.uniform2f(this.uFillViewport,e,t),a.uniform2f(this.uFillCameraCenter,n,r),a.uniform1f(this.uFillZoom,i),a.uniform1f(this.uFillAAScreenPx,1),a.uniform4f(this.uFillVectorOverride,this.vectorOverrideColor[0],this.vectorOverrideColor[1],this.vectorOverrideColor[2],this.vectorOverrideOpacity),a.drawArraysInstanced(a.TRIANGLE_STRIP,0,4,this.fillPathCount),this.fillPathCount}drawVisibleSegments(e,t,n,r,i=this.zoom){let a=this.usingAllSegments?this.segmentCount:this.visibleSegmentCount;if(a===0)return 0;let o=this.gl;o.useProgram(this.segmentProgram),o.bindVertexArray(this.segmentVao);let s=this.usingAllSegments?this.allSegmentIdBuffer:this.visibleSegmentIdBuffer;return o.bindBuffer(o.ARRAY_BUFFER,s),o.enableVertexAttribArray(1),o.vertexAttribPointer(1,1,o.FLOAT,!1,4,0),o.vertexAttribDivisor(1,1),o.activeTexture(o.TEXTURE0),o.bindTexture(o.TEXTURE_2D,this.segmentTextureA),o.activeTexture(o.TEXTURE1),o.bindTexture(o.TEXTURE_2D,this.segmentTextureB),o.activeTexture(o.TEXTURE2),o.bindTexture(o.TEXTURE_2D,this.segmentTextureC),o.activeTexture(o.TEXTURE3),o.bindTexture(o.TEXTURE_2D,this.segmentTextureD),o.uniform1i(this.uSegmentTexA,0),o.uniform1i(this.uSegmentTexB,1),o.uniform1i(this.uSegmentStyleTex,2),o.uniform1i(this.uSegmentBoundsTex,3),o.uniform2i(this.uSegmentTexSize,this.segmentTextureWidth,this.segmentTextureHeight),o.uniform2f(this.uViewport,e,t),o.uniform2f(this.uCameraCenter,n,r),o.uniform1f(this.uZoom,i),o.uniform1f(this.uAAScreenPx,1),o.uniform1f(this.uStrokeCurveEnabled,+!!this.strokeCurveEnabled),o.uniform4f(this.uStrokeVectorOverride,this.vectorOverrideColor[0],this.vectorOverrideColor[1],this.vectorOverrideColor[2],this.vectorOverrideOpacity),o.drawArraysInstanced(o.TRIANGLE_STRIP,0,4,a),a}drawTextInstances(e,t,n,r,i=this.zoom){if(!this.scene||this.textInstanceCount<=0||this.visibleTextRanges.length===0)return 0;let a=this.gl;a.useProgram(this.textProgram),a.bindVertexArray(this.textVao),a.bindBuffer(a.ARRAY_BUFFER,this.allTextInstanceIdBuffer),a.enableVertexAttribArray(2),a.vertexAttribDivisor(2,1),a.activeTexture(a.TEXTURE2),a.bindTexture(a.TEXTURE_2D,this.textInstanceTextureA),a.activeTexture(a.TEXTURE3),a.bindTexture(a.TEXTURE_2D,this.textInstanceTextureB),a.activeTexture(a.TEXTURE4),a.bindTexture(a.TEXTURE_2D,this.textInstanceTextureC),a.activeTexture(a.TEXTURE5),a.bindTexture(a.TEXTURE_2D,this.textGlyphMetaTextureA),a.activeTexture(a.TEXTURE6),a.bindTexture(a.TEXTURE_2D,this.textGlyphMetaTextureB),a.activeTexture(a.TEXTURE7),a.bindTexture(a.TEXTURE_2D,this.textGlyphSegmentTextureA),a.activeTexture(a.TEXTURE8),a.bindTexture(a.TEXTURE_2D,this.textGlyphSegmentTextureB),a.activeTexture(a.TEXTURE9),a.bindTexture(a.TEXTURE_2D,this.textGlyphRasterMetaTexture),a.activeTexture(a.TEXTURE13),a.bindTexture(a.TEXTURE_2D,this.textRasterAtlasTexture),a.uniform1i(this.uTextInstanceTexA,2),a.uniform1i(this.uTextInstanceTexB,3),a.uniform1i(this.uTextInstanceTexC,4),a.uniform1i(this.uTextGlyphMetaTexA,5),a.uniform1i(this.uTextGlyphMetaTexB,6),a.uniform1i(this.uTextGlyphSegmentTexA,7),a.uniform1i(this.uTextGlyphSegmentTexB,8),a.uniform1i(this.uTextGlyphRasterMetaTex,9),a.uniform1i(this.uTextRasterAtlasTex,13),a.uniform2i(this.uTextInstanceTexSize,this.textInstanceTextureWidth,this.textInstanceTextureHeight),a.uniform2i(this.uTextGlyphMetaTexSize,this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight),a.uniform2i(this.uTextGlyphSegmentTexSize,this.textGlyphSegmentTextureWidth,this.textGlyphSegmentTextureHeight),a.uniform2f(this.uTextRasterAtlasSize,this.textRasterAtlasWidth,this.textRasterAtlasHeight),a.uniform2f(this.uTextViewport,e,t),a.uniform2f(this.uTextCameraCenter,n,r),a.uniform1f(this.uTextZoom,i),a.uniform1f(this.uTextAAScreenPx,1.25),a.uniform1f(this.uTextCurveEnabled,+!!this.strokeCurveEnabled),a.uniform1f(this.uTextVectorOnly,+!!this.textVectorOnly),a.uniform4f(this.uTextVectorOverride,this.vectorOverrideColor[0],this.vectorOverrideColor[1],this.vectorOverrideColor[2],this.vectorOverrideOpacity);let o=0;for(let e of this.visibleTextRanges)e.count<=0||(a.vertexAttribPointer(2,1,a.FLOAT,!1,4,e.start*4),a.drawArraysInstanced(a.TRIANGLE_STRIP,0,4,e.count),o+=e.count);return o}blitPanCache(e,t,n){if(!this.panCacheTexture)return;let r=this.gl;r.bindFramebuffer(r.FRAMEBUFFER,null),r.viewport(0,0,this.canvas.width,this.canvas.height),r.clearColor(he,ge,_e,1),r.clear(r.COLOR_BUFFER_BIT),r.useProgram(this.blitProgram),r.bindVertexArray(this.blitVao),r.activeTexture(r.TEXTURE0),r.bindTexture(r.TEXTURE_2D,this.panCacheTexture),r.uniform1i(this.uCacheTex,0),r.uniform2f(this.uViewportPx,this.canvas.width,this.canvas.height),r.uniform2f(this.uCacheSizePx,this.panCacheWidth,this.panCacheHeight),r.uniform2f(this.uOffsetPx,e,t),r.uniform1f(this.uSampleScale,n),r.disable(r.BLEND),r.drawArrays(r.TRIANGLE_STRIP,0,4),r.enable(r.BLEND)}ensurePanCacheResources(){let e=this.gl,t=e.getParameter(e.MAX_TEXTURE_SIZE),n=Math.min(t,Math.max(this.canvas.width+ne*2,Math.ceil(this.canvas.width*te))),r=Math.min(t,Math.max(this.canvas.height+ne*2,Math.ceil(this.canvas.height*te)));if(n<this.canvas.width||r<this.canvas.height)return!1;if(this.panCacheTexture&&this.panCacheFramebuffer&&this.panCacheWidth===n&&this.panCacheHeight===r)return!0;this.destroyPanCacheResources();let i=e.createTexture();if(!i)return!1;e.bindTexture(e.TEXTURE_2D,i),ke(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,n,r,0,e.RGBA,e.UNSIGNED_BYTE,null);let a=e.createFramebuffer();if(!a)return e.deleteTexture(i),!1;e.bindFramebuffer(e.FRAMEBUFFER,a),e.framebufferTexture2D(e.FRAMEBUFFER,e.COLOR_ATTACHMENT0,e.TEXTURE_2D,i,0);let o=e.checkFramebufferStatus(e.FRAMEBUFFER);return e.bindFramebuffer(e.FRAMEBUFFER,null),o===e.FRAMEBUFFER_COMPLETE?(this.panCacheTexture=i,this.panCacheFramebuffer=a,this.panCacheWidth=n,this.panCacheHeight=r,this.panCacheValid=!1,!0):(e.deleteFramebuffer(a),e.deleteTexture(i),!1)}destroyPanCacheResources(){this.panCacheFramebuffer&&=(this.gl.deleteFramebuffer(this.panCacheFramebuffer),null),this.panCacheTexture&&=(this.gl.deleteTexture(this.panCacheTexture),null),this.panCacheWidth=0,this.panCacheHeight=0,this.panCacheValid=!1,this.panCacheRenderedSegments=0,this.panCacheUsedCulling=!1}destroyVectorMinifyResources(){this.vectorMinifyFramebuffer&&=(this.gl.deleteFramebuffer(this.vectorMinifyFramebuffer),null),this.vectorMinifyTexture&&=(this.gl.deleteTexture(this.vectorMinifyTexture),null),this.vectorMinifyWidth=0,this.vectorMinifyHeight=0,this.vectorMinifyWarmupPending=!1}updateVisibleSet(e=this.cameraCenterX,t=this.cameraCenterY,n=this.canvas.width,r=this.canvas.height,i=this.zoom){if(!this.scene){this.visibleSegmentCount=0,this.usingAllSegments=!0,this.visiblePageRectCount=0,this.visibleTextRanges=[];return}if(!this.hasCameraInteractionSinceSceneLoad){this.usingAllSegments=!0,this.visibleSegmentCount=this.segmentCount,this.setAllPagesAndTextVisible();return}let a=Math.max(i,1e-6),o=n/(2*a),s=r/(2*a),c=Math.max(16/a,this.scene.maxHalfWidth*2),l=e-o-c,u=e+o+c,d=t-s-c,f=t+s+c;if(this.updateVisiblePagesAndTextRanges(l,d,u,f),!this.grid){this.visibleSegmentCount=0,this.usingAllSegments=!0;return}let p=this.grid,m=Le(Math.floor((l-p.minX)/p.cellWidth),p.gridWidth),h=Le(Math.floor((u-p.minX)/p.cellWidth),p.gridWidth),g=Le(Math.floor((d-p.minY)/p.cellHeight),p.gridHeight),_=Le(Math.floor((f-p.minY)/p.cellHeight),p.gridHeight);this.usingAllSegments=!1,this.markToken+=1,this.markToken===4294967295&&(this.segmentMarks.fill(0),this.markToken=1);let v=0;for(let e=g;e<=_;e+=1){let t=e*p.gridWidth+m;for(let e=m;e<=h;e+=1){let e=p.offsets[t],n=p.counts[t];for(let t=0;t<n;t+=1){let n=p.indices[e+t];this.segmentMarks[n]!==this.markToken&&(this.segmentMarks[n]=this.markToken,!(this.segmentMaxX[n]<l||this.segmentMinX[n]>u||this.segmentMaxY[n]<d||this.segmentMinY[n]>f)&&(this.visibleSegmentIds[v]=n,v+=1))}t+=1}}this.visibleSegmentCount=v;let y=this.visibleSegmentIds.subarray(0,v);this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.visibleSegmentIdBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,y,this.gl.DYNAMIC_DRAW)}setAllPagesAndTextVisible(){let e=Math.floor(this.pageRects.length/4);this.visiblePageRectIndices.length<e&&(this.visiblePageRectIndices=new Uint32Array(e));for(let t=0;t<e;t+=1)this.visiblePageRectIndices[t]=t;this.visiblePageRectCount=e,this.visibleTextRanges=this.textInstanceCount>0?[{start:0,count:this.textInstanceCount}]:[]}updateVisiblePagesAndTextRanges(e,t,n,r){let i=Math.floor(this.pageRects.length/4);if(i<=0){this.visiblePageRectCount=0,this.visibleTextRanges=this.textInstanceCount>0?[{start:0,count:this.textInstanceCount}]:[];return}this.visiblePageRectIndices.length<i&&(this.visiblePageRectIndices=new Uint32Array(i));let a=[],o=0;for(let s=0;s<i;s+=1){let i=s*4,c=Math.min(this.pageRects[i],this.pageRects[i+2]),l=Math.min(this.pageRects[i+1],this.pageRects[i+3]),u=Math.max(this.pageRects[i],this.pageRects[i+2]),d=Math.max(this.pageRects[i+1],this.pageRects[i+3]);if(u<e||c>n||d<t||l>r)continue;this.visiblePageRectIndices[o]=s,o+=1;let f=s*2,p=this.pageTextRanges[f]??0,m=this.pageTextRanges[f+1]??0;this.appendVisibleTextRange(a,p,m)}this.visiblePageRectCount=o,this.visibleTextRanges=a}appendVisibleTextRange(e,t,n){let r=K(Math.trunc(t),0,this.textInstanceCount),i=K(Math.trunc(n),0,this.textInstanceCount-r);if(i<=0)return;let a=e[e.length-1];if(a&&r<=a.start+a.count){a.count=Math.max(a.start+a.count,r+i)-a.start;return}e.push({start:r,count:i})}uploadRasterLayers(e){let t=this.gl;for(let e of this.rasterLayers)t.deleteTexture(e.texture);this.rasterLayers=[];for(let n of this.getSceneRasterLayers(e)){let e=t.createTexture();if(!e)continue;t.bindTexture(t.TEXTURE_2D,e),je(t);let r=Me(n.data.subarray(0,n.width*n.height*4));t.texImage2D(t.TEXTURE_2D,0,t.RGBA,n.width,n.height,0,t.RGBA,t.UNSIGNED_BYTE,r),t.generateMipmap(t.TEXTURE_2D);let i=new Float32Array(6);n.matrix.length>=6?(i[0]=n.matrix[0],i[1]=n.matrix[1],i[2]=n.matrix[2],i[3]=n.matrix[3],i[4]=n.matrix[4],i[5]=n.matrix[5]):(i[0]=1,i[3]=1),this.rasterLayers.push({texture:e,matrix:i})}}getSceneRasterLayers(e){let t=[];if(Array.isArray(e.rasterLayers))for(let n of e.rasterLayers){let e=Math.max(0,Math.trunc(n?.width??0)),r=Math.max(0,Math.trunc(n?.height??0));e<=0||r<=0||!(n.data instanceof Uint8Array)||n.data.length<e*r*4||t.push({width:e,height:r,data:n.data,matrix:n.matrix instanceof Float32Array?n.matrix:new Float32Array(n.matrix)})}if(t.length>0)return t;let n=Math.max(0,Math.trunc(e.rasterLayerWidth)),r=Math.max(0,Math.trunc(e.rasterLayerHeight));return n<=0||r<=0||e.rasterLayerData.length<n*r*4||t.push({width:n,height:r,data:e.rasterLayerData,matrix:e.rasterLayerMatrix}),t}uploadFillPaths(e){let t=this.gl,n=t.getParameter(t.MAX_TEXTURE_SIZE),r=Pe(e.fillPathCount,n),i=Pe(e.fillSegmentCount,n);this.fillPathMetaTextureWidth=r.width,this.fillPathMetaTextureHeight=r.height,this.fillSegmentTextureWidth=i.width,this.fillSegmentTextureHeight=i.height;let a=r.width*r.height,o=i.width*i.height,s=new Float32Array(a*4);s.set(e.fillPathMetaA);let c=new Float32Array(a*4);c.set(e.fillPathMetaB);let l=new Float32Array(a*4);l.set(e.fillPathMetaC);let u=new Float32Array(o*4);u.set(e.fillSegmentsA);let d=new Float32Array(o*4);return d.set(e.fillSegmentsB),t.bindTexture(t.TEXTURE_2D,this.fillPathMetaTextureA),De(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,0,t.RGBA,t.FLOAT,s),t.bindTexture(t.TEXTURE_2D,this.fillPathMetaTextureB),De(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,0,t.RGBA,t.FLOAT,c),t.bindTexture(t.TEXTURE_2D,this.fillPathMetaTextureC),De(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,0,t.RGBA,t.FLOAT,l),t.bindTexture(t.TEXTURE_2D,this.fillSegmentTextureA),De(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,this.fillSegmentTextureWidth,this.fillSegmentTextureHeight,0,t.RGBA,t.FLOAT,u),t.bindTexture(t.TEXTURE_2D,this.fillSegmentTextureB),De(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,this.fillSegmentTextureWidth,this.fillSegmentTextureHeight,0,t.RGBA,t.FLOAT,d),{pathMetaTextureWidth:this.fillPathMetaTextureWidth,pathMetaTextureHeight:this.fillPathMetaTextureHeight,segmentTextureWidth:this.fillSegmentTextureWidth,segmentTextureHeight:this.fillSegmentTextureHeight}}uploadSegments(e){let t=this.gl,n=t.getParameter(t.MAX_TEXTURE_SIZE),r=Math.ceil(Math.sqrt(e.segmentCount));if(this.segmentTextureWidth=K(r,1,n),this.segmentTextureHeight=Math.max(1,Math.ceil(e.segmentCount/this.segmentTextureWidth)),this.segmentTextureHeight>n)throw Error(`Segment texture exceeds GPU limits for this browser/GPU.`);let i=this.segmentTextureWidth*this.segmentTextureHeight,a=new Float32Array(i*4);a.set(e.endpoints);let o=new Float32Array(i*4);o.set(e.primitiveMeta);let s=new Float32Array(i*4);s.set(e.styles);let c=new Float32Array(i*4);return c.set(e.primitiveBounds),t.bindTexture(t.TEXTURE_2D,this.segmentTextureA),De(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,this.segmentTextureWidth,this.segmentTextureHeight,0,t.RGBA,t.FLOAT,a),t.bindTexture(t.TEXTURE_2D,this.segmentTextureB),De(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,this.segmentTextureWidth,this.segmentTextureHeight,0,t.RGBA,t.FLOAT,o),t.bindTexture(t.TEXTURE_2D,this.segmentTextureC),De(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,this.segmentTextureWidth,this.segmentTextureHeight,0,t.RGBA,t.FLOAT,s),t.bindTexture(t.TEXTURE_2D,this.segmentTextureD),De(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,this.segmentTextureWidth,this.segmentTextureHeight,0,t.RGBA,t.FLOAT,c),{textureWidth:this.segmentTextureWidth,textureHeight:this.segmentTextureHeight,maxTextureSize:n}}uploadTextData(e){let t=this.gl,n=t.getParameter(t.MAX_TEXTURE_SIZE),r=Pe(e.textInstanceCount,n),i=Pe(e.textGlyphCount,n),a=Pe(e.textGlyphSegmentCount,n);this.textInstanceTextureWidth=r.width,this.textInstanceTextureHeight=r.height,this.textGlyphMetaTextureWidth=i.width,this.textGlyphMetaTextureHeight=i.height,this.textGlyphSegmentTextureWidth=a.width,this.textGlyphSegmentTextureHeight=a.height;let o=r.width*r.height,s=i.width*i.height,c=a.width*a.height,l=new Float32Array(o*4);l.set(e.textInstanceA);let u=new Float32Array(o*4);u.set(e.textInstanceB);let d=Ne(e.textInstanceC,o),f=new Float32Array(s*4);f.set(e.textGlyphMetaA);let p=new Float32Array(s*4);p.set(e.textGlyphMetaB);let m=new Float32Array(s*4),h=E(e,n);h?(m.set(h.glyphUvRects),this.textRasterAtlasWidth=h.width,this.textRasterAtlasHeight=h.height):(this.textRasterAtlasWidth=1,this.textRasterAtlasHeight=1);let g=new Float32Array(c*4);g.set(e.textGlyphSegmentsA);let _=new Float32Array(c*4);if(_.set(e.textGlyphSegmentsB),t.bindTexture(t.TEXTURE_2D,this.textInstanceTextureA),De(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,this.textInstanceTextureWidth,this.textInstanceTextureHeight,0,t.RGBA,t.FLOAT,l),t.bindTexture(t.TEXTURE_2D,this.textInstanceTextureB),De(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,this.textInstanceTextureWidth,this.textInstanceTextureHeight,0,t.RGBA,t.FLOAT,u),t.bindTexture(t.TEXTURE_2D,this.textInstanceTextureC),Oe(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA8,this.textInstanceTextureWidth,this.textInstanceTextureHeight,0,t.RGBA,t.UNSIGNED_BYTE,d),t.bindTexture(t.TEXTURE_2D,this.textGlyphMetaTextureA),De(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,0,t.RGBA,t.FLOAT,f),t.bindTexture(t.TEXTURE_2D,this.textGlyphMetaTextureB),De(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,0,t.RGBA,t.FLOAT,p),t.bindTexture(t.TEXTURE_2D,this.textGlyphRasterMetaTexture),De(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,0,t.RGBA,t.FLOAT,m),t.bindTexture(t.TEXTURE_2D,this.textGlyphSegmentTextureA),De(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,this.textGlyphSegmentTextureWidth,this.textGlyphSegmentTextureHeight,0,t.RGBA,t.FLOAT,g),t.bindTexture(t.TEXTURE_2D,this.textGlyphSegmentTextureB),De(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA32F,this.textGlyphSegmentTextureWidth,this.textGlyphSegmentTextureHeight,0,t.RGBA,t.FLOAT,_),t.bindTexture(t.TEXTURE_2D,this.textRasterAtlasTexture),je(t),t.pixelStorei(t.UNPACK_ALIGNMENT,1),h)t.texImage2D(t.TEXTURE_2D,0,t.R8,this.textRasterAtlasWidth,this.textRasterAtlasHeight,0,t.RED,t.UNSIGNED_BYTE,h.alpha);else{let e=new Uint8Array([0]);t.texImage2D(t.TEXTURE_2D,0,t.R8,1,1,0,t.RED,t.UNSIGNED_BYTE,e)}return t.pixelStorei(t.UNPACK_ALIGNMENT,4),t.generateMipmap(t.TEXTURE_2D),{instanceTextureWidth:this.textInstanceTextureWidth,instanceTextureHeight:this.textInstanceTextureHeight,glyphMetaTextureWidth:this.textGlyphMetaTextureWidth,glyphMetaTextureHeight:this.textGlyphMetaTextureHeight,glyphSegmentTextureWidth:this.textGlyphSegmentTextureWidth,glyphSegmentTextureHeight:this.textGlyphSegmentTextureHeight}}buildSegmentBounds(e){this.segmentMinX.length<this.segmentCount&&(this.segmentMinX=new Float32Array(this.segmentCount),this.segmentMinY=new Float32Array(this.segmentCount),this.segmentMaxX=new Float32Array(this.segmentCount),this.segmentMaxY=new Float32Array(this.segmentCount));for(let t=0;t<this.segmentCount;t+=1){let n=t*4,r=t*4,i=e.styles[r]+.35;this.segmentMinX[t]=e.primitiveBounds[n]-i,this.segmentMinY[t]=e.primitiveBounds[n+1]-i,this.segmentMaxX[t]=e.primitiveBounds[n+2]+i,this.segmentMaxY[t]=e.primitiveBounds[n+3]+i}}markInteraction(){this.lastInteractionTime=performance.now()}isInteractionActive(){return performance.now()-this.lastInteractionTime<=ee}initializeGeometry(){let e=this.gl;e.bindBuffer(e.ARRAY_BUFFER,this.cornerBuffer);let t=new Float32Array([-1,-1,1,-1,-1,1,1,1]);e.bufferData(e.ARRAY_BUFFER,t,e.STATIC_DRAW),e.bindVertexArray(this.segmentVao),e.bindBuffer(e.ARRAY_BUFFER,this.cornerBuffer),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,8,0),e.vertexAttribDivisor(0,0),e.bindBuffer(e.ARRAY_BUFFER,this.allSegmentIdBuffer),e.enableVertexAttribArray(1),e.vertexAttribPointer(1,1,e.FLOAT,!1,4,0),e.vertexAttribDivisor(1,1),e.bindVertexArray(this.fillVao),e.bindBuffer(e.ARRAY_BUFFER,this.cornerBuffer),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,8,0),e.vertexAttribDivisor(0,0),e.bindBuffer(e.ARRAY_BUFFER,this.allFillPathIdBuffer),e.enableVertexAttribArray(3),e.vertexAttribPointer(3,1,e.FLOAT,!1,4,0),e.vertexAttribDivisor(3,1),e.bindVertexArray(this.textVao),e.bindBuffer(e.ARRAY_BUFFER,this.cornerBuffer),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,8,0),e.vertexAttribDivisor(0,0),e.bindBuffer(e.ARRAY_BUFFER,this.allTextInstanceIdBuffer),e.enableVertexAttribArray(2),e.vertexAttribPointer(2,1,e.FLOAT,!1,4,0),e.vertexAttribDivisor(2,1),e.bindVertexArray(this.blitVao),e.bindBuffer(e.ARRAY_BUFFER,this.cornerBuffer),e.enableVertexAttribArray(0),e.vertexAttribPointer(0,2,e.FLOAT,!1,8,0),e.vertexAttribDivisor(0,0),e.bindVertexArray(null)}initializeState(){this.ensureRenderState()}ensureRenderState(){let e=this.gl;e.disable(e.DEPTH_TEST),e.disable(e.CULL_FACE),e.disable(e.SCISSOR_TEST),e.colorMask(!0,!0,!0,!0),e.enable(e.BLEND),e.blendEquationSeparate(e.FUNC_ADD,e.FUNC_ADD),e.blendFuncSeparate(e.SRC_ALPHA,e.ONE_MINUS_SRC_ALPHA,e.ONE,e.ONE_MINUS_SRC_ALPHA)}uploadPageBackgroundTexture(){let e=this.gl,t=this.pageBackgroundColor,n=new Uint8Array([Math.round(t[0]*255),Math.round(t[1]*255),Math.round(t[2]*255),Math.round(t[3]*255)]);e.bindTexture(e.TEXTURE_2D,this.pageBackgroundTexture),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE),e.texImage2D(e.TEXTURE_2D,0,e.RGBA,1,1,0,e.RGBA,e.UNSIGNED_BYTE,n),e.bindTexture(e.TEXTURE_2D,null)}clientToWorld(e,t){return this.clientToWorldAt(e,t,this.cameraCenterX,this.cameraCenterY,this.zoom)}clientToWorldAt(e,t,n,r,i){let a=this.resolveInteractionViewportRect(),o=this.resolveClientToPixelScale(a),s=(e-a.left)*o.x,c=(a.bottom-t)*o.y;return{x:(s-this.canvas.width*.5)/i+n,y:(c-this.canvas.height*.5)/i+r}}syncCameraTargetsToCurrent(){this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY,this.targetZoom=this.zoom,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1}updatePanReleaseVelocitySample(e){if(!this.isPanInteracting){this.lastPanFrameTimeMs=0;return}if(this.lastPanFrameTimeMs>0){let t=e-this.lastPanFrameTimeMs;if(t>.1){let n=this.cameraCenterX-this.lastPanFrameCameraX,r=this.cameraCenterY-this.lastPanFrameCameraY,i=n*1e3/t,a=r*1e3/t,o=Math.hypot(i,a);if(Number.isFinite(o)&&o>=fe){if(o>pe){let e=pe/o;i*=e,a*=e}this.panVelocityWorldX=i,this.panVelocityWorldY=a,this.lastPanVelocityUpdateTimeMs=e}}}this.lastPanFrameCameraX=this.cameraCenterX,this.lastPanFrameCameraY=this.cameraCenterY,this.lastPanFrameTimeMs=e}updateCameraWithDamping(e){let t=Math.abs(this.targetCameraCenterX-this.cameraCenterX)>le||Math.abs(this.targetCameraCenterY-this.cameraCenterY)>le,n=Math.abs(this.targetZoom-this.zoom)>ue;if(!t&&!n)return this.hasZoomAnchor=!1,this.lastCameraAnimationTimeMs=e,!1;this.lastCameraAnimationTimeMs<=0&&(this.lastCameraAnimationTimeMs=e-16);let r=K(e-this.lastCameraAnimationTimeMs,0,de);this.lastCameraAnimationTimeMs=e;let i=r/1e3,a=1-Math.exp(-se*i),o=1-Math.exp(-ce*i);if(n&&(this.zoom+=(this.targetZoom-this.zoom)*o,Math.abs(this.targetZoom-this.zoom)<=ue&&(this.zoom=this.targetZoom)),this.hasZoomAnchor){let e=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,this.zoom),r=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,this.targetZoom);this.cameraCenterX=e.x,this.cameraCenterY=e.y,this.targetCameraCenterX=r.x,this.targetCameraCenterY=r.y,n||(this.hasZoomAnchor=!1),t=!1}else t&&(this.cameraCenterX+=(this.targetCameraCenterX-this.cameraCenterX)*a,this.cameraCenterY+=(this.targetCameraCenterY-this.cameraCenterY)*a,Math.abs(this.targetCameraCenterX-this.cameraCenterX)<=le&&(this.cameraCenterX=this.targetCameraCenterX),Math.abs(this.targetCameraCenterY-this.cameraCenterY)<=le&&(this.cameraCenterY=this.targetCameraCenterY));return this.markInteraction(),this.needsVisibleSetUpdate=!0,t=Math.abs(this.targetCameraCenterX-this.cameraCenterX)>le||Math.abs(this.targetCameraCenterY-this.cameraCenterY)>le,n=Math.abs(this.targetZoom-this.zoom)>ue,t||n}computeCameraCenterForAnchor(e,t,n,r,i){let a=this.resolveInteractionViewportRect(),o=this.resolveClientToPixelScale(a),s=(e-a.left)*o.x,c=(a.bottom-t)*o.y;return{x:n-(s-this.canvas.width*.5)/i,y:r-(c-this.canvas.height*.5)/i}}resolveInteractionViewportRect(){return this.interactionViewportProvider?.()||this.canvas.getBoundingClientRect()}resolveClientToPixelScale(e){let t=e??this.resolveInteractionViewportRect(),n=Math.max(window.devicePixelRatio||1,1e-6),r=t.width>1e-6?this.canvas.width/t.width:n,i=t.height>1e-6?this.canvas.height/t.height:n;return{x:Math.max(1e-6,r),y:Math.max(1e-6,i)}}createProgram(e,t){let n=this.gl,r=this.compileShader(n.VERTEX_SHADER,e),i=this.compileShader(n.FRAGMENT_SHADER,t),a=n.createProgram();if(!a)throw Error(`Unable to create WebGL program.`);if(n.attachShader(a,r),n.attachShader(a,i),n.linkProgram(a),!n.getProgramParameter(a,n.LINK_STATUS)){let e=n.getProgramInfoLog(a)||`Unknown linker error.`;throw n.deleteProgram(a),Error(`Program link failed: ${e}`)}return n.deleteShader(r),n.deleteShader(i),a}compileShader(e,t){let n=this.gl.createShader(e);if(!n)throw Error(`Unable to create shader.`);if(this.gl.shaderSource(n,t),this.gl.compileShader(n),!this.gl.getShaderParameter(n,this.gl.COMPILE_STATUS)){let e=this.gl.getShaderInfoLog(n)||`Unknown shader compiler error.`;throw this.gl.deleteShader(n),Error(`Shader compilation failed: ${e}`)}return n}createVertexArray(){let e=this.gl.createVertexArray();if(!e)throw Error(`Unable to create VAO.`);return e}mustCreateBuffer(){let e=this.gl.createBuffer();if(!e)throw Error(`Unable to create WebGL buffer.`);return e}mustCreateTexture(){let e=this.gl.createTexture();if(!e)throw Error(`Unable to create WebGL texture.`);return e}mustGetUniformLocation(e,t){let n=this.gl.getUniformLocation(e,t);if(!n)throw Error(`Missing uniform: ${t}`);return n}};function De(e){e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE)}function Oe(e){e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.NEAREST),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE)}function ke(e){e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE)}function Ae(e){e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE)}function je(e){e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MIN_FILTER,e.LINEAR_MIPMAP_LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_MAG_FILTER,e.LINEAR),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_S,e.CLAMP_TO_EDGE),e.texParameteri(e.TEXTURE_2D,e.TEXTURE_WRAP_T,e.CLAMP_TO_EDGE)}function Me(e){let t=new Uint8Array(e.length);for(let n=0;n+3<e.length;n+=4){let r=e[n+3];if(r<=0){t[n]=0,t[n+1]=0,t[n+2]=0,t[n+3]=0;continue}if(r>=255){t[n]=e[n],t[n+1]=e[n+1],t[n+2]=e[n+2],t[n+3]=255;continue}let i=r/255;t[n]=Math.round(e[n]*i),t[n+1]=Math.round(e[n+1]*i),t[n+2]=Math.round(e[n+2]*i),t[n+3]=r}return t}function Ne(e,t){let n=new Uint8Array(t*4),r=Math.min(e.length,n.length);for(let t=0;t<r;t+=1)n[t]=Math.round(K(e[t],0,1)*255);return n}function Pe(e,t){let n=Math.max(1,e),r=K(Math.ceil(Math.sqrt(n)),1,t),i=Math.max(1,Math.ceil(n/r));if(i>t)throw Error(`Data texture exceeds GPU limits for this browser/GPU.`);return{width:r,height:i}}function Fe(e){return e.pageRects instanceof Float32Array&&e.pageRects.length>=4?new Float32Array(e.pageRects):new Float32Array([e.pageBounds.minX,e.pageBounds.minY,e.pageBounds.maxX,e.pageBounds.maxY])}function Ie(e,t,n){let r=Math.max(1,Math.floor(t.length/4)),i=r*2,a=Math.max(0,n|0);if(e.pageTextRanges instanceof Uint32Array&&e.pageTextRanges.length>=i){let t=new Uint32Array(i),n=0;for(let i=0;i<r;i+=1){let r=i*2,o=K(Math.trunc(e.pageTextRanges[r]),n,a),s=K(Math.trunc(e.pageTextRanges[r+1]),0,a-o);t[r]=o,t[r+1]=s,n=o+s}return t}let o=new Uint32Array(i);o[0]=0,o[1]=a;for(let e=1;e<r;e+=1){let t=e*2;o[t]=a,o[t+1]=0}return o}function K(e,t,n){return e<t?t:e>n?n:e}function Le(e,t){return e<0?0:e>=t?t-1:e}var Re=140,ze=.92,Be=3e5,Ve=1.8,He=96,Ue=1e-5,We=.75,Ge=1.3333333333,Ke=2,qe=2.25,Je=24,Ye=24,Xe=1e-4,Ze=1e-5,Qe=64,$e=5,et=2e4,tt=120,nt={r:160/255,g:169/255,b:175/255,a:1},rt=16,it=64,at=12,ot=48,st=4,ct=16,lt=8,ut=32,dt=`
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
`,ft=`
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
`,pt=`
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
`,mt=`
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
`,ht=`
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
`,gt=`
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
`,_t=class e{canvas;gpuDevice;gpuContext;presentationFormat;strokePipeline;fillPipeline;textPipeline;rasterPipeline;blitPipeline;vectorCompositePipeline;cameraUniformBuffer;blitUniformBuffer;vectorCompositeUniformBuffer;panCacheSampler;rasterLayerSampler;vectorCompositeSampler;strokeBindGroupLayout;fillBindGroupLayout;textBindGroupLayout;rasterBindGroupLayout;blitBindGroupLayout;vectorCompositeBindGroupLayout;strokeBindGroupAll=null;strokeBindGroupVisible=null;fillBindGroup=null;textBindGroup=null;blitBindGroup=null;vectorCompositeBindGroup=null;segmentTextureA=null;segmentTextureB=null;segmentTextureC=null;segmentTextureD=null;fillPathMetaTextureA=null;fillPathMetaTextureB=null;fillPathMetaTextureC=null;fillSegmentTextureA=null;fillSegmentTextureB=null;textInstanceTextureA=null;textInstanceTextureB=null;textInstanceTextureC=null;rasterLayerResources=[];pageBackgroundResources=[];textGlyphMetaTextureA=null;textGlyphMetaTextureB=null;textGlyphRasterMetaTexture=null;textGlyphSegmentTextureA=null;textGlyphSegmentTextureB=null;textRasterAtlasTexture=null;pageBackgroundTexture=null;segmentIdBufferAll=null;segmentIdBufferVisible=null;panCacheTexture=null;panCacheWidth=0;panCacheHeight=0;panCacheValid=!1;panCacheCenterX=0;panCacheCenterY=0;panCacheZoom=1;panCacheRenderedSegments=0;panCacheUsedCulling=!1;vectorMinifyTexture=null;vectorMinifyWidth=0;vectorMinifyHeight=0;scene=null;sceneStats=null;grid=null;frameListener=null;interactionViewportProvider=null;presentedCameraCenterX=0;presentedCameraCenterY=0;presentedZoom=1;presentedFrameSerial=0;rafHandle=0;externalFrameDriver=!1;externalFramePending=!1;cameraCenterX=0;cameraCenterY=0;zoom=1;targetCameraCenterX=0;targetCameraCenterY=0;targetZoom=1;lastCameraAnimationTimeMs=0;hasZoomAnchor=!1;zoomAnchorClientX=0;zoomAnchorClientY=0;zoomAnchorWorldX=0;zoomAnchorWorldY=0;panVelocityWorldX=0;panVelocityWorldY=0;lastPanVelocityUpdateTimeMs=0;lastPanFrameCameraX=0;lastPanFrameCameraY=0;lastPanFrameTimeMs=0;minZoom=.01;maxZoom=8192;strokeCurveEnabled=!0;rasterRenderingEnabled=!0;fillRenderingEnabled=!0;strokeRenderingEnabled=!0;textRenderingEnabled=!0;textVectorOnly=!1;pageBackgroundColor=[1,1,1,1];vectorOverrideColor=[0,0,0];vectorOverrideOpacity=0;panOptimizationEnabled=!0;isPanInteracting=!1;hasCameraInteractionSinceSceneLoad=!1;lastInteractionTime=-1/0;needsVisibleSetUpdate=!1;segmentCount=0;fillPathCount=0;textInstanceCount=0;visibleSegmentCount=0;usingAllSegments=!0;segmentTextureWidth=1;segmentTextureHeight=1;fillPathMetaTextureWidth=1;fillPathMetaTextureHeight=1;fillSegmentTextureWidth=1;fillSegmentTextureHeight=1;textInstanceTextureWidth=1;textInstanceTextureHeight=1;textGlyphMetaTextureWidth=1;textGlyphMetaTextureHeight=1;textGlyphSegmentTextureWidth=1;textGlyphSegmentTextureHeight=1;allSegmentIds=new Uint32Array;visibleSegmentIds=new Uint32Array;segmentMarks=new Uint32Array;segmentMinX=new Float32Array;segmentMinY=new Float32Array;segmentMaxX=new Float32Array;segmentMaxY=new Float32Array;markToken=1;constructor(e,t,n,r){this.canvas=e,this.gpuDevice=t,this.gpuContext=n,this.presentationFormat=r,this.configureContext();let i=globalThis.GPUBufferUsage,a=globalThis.GPUShaderStage;this.cameraUniformBuffer=this.gpuDevice.createBuffer({size:it,usage:i.UNIFORM|i.COPY_DST}),this.blitUniformBuffer=this.gpuDevice.createBuffer({size:ot,usage:i.UNIFORM|i.COPY_DST}),this.vectorCompositeUniformBuffer=this.gpuDevice.createBuffer({size:ct,usage:i.UNIFORM|i.COPY_DST}),this.strokeBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:a.VERTEX|a.FRAGMENT,buffer:{type:`uniform`,minBindingSize:it}},{binding:1,visibility:a.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:2,visibility:a.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:3,visibility:a.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:4,visibility:a.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:5,visibility:a.VERTEX,buffer:{type:`read-only-storage`}}]}),this.fillBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:a.VERTEX|a.FRAGMENT,buffer:{type:`uniform`,minBindingSize:it}},{binding:1,visibility:a.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:2,visibility:a.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:3,visibility:a.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:4,visibility:a.FRAGMENT,texture:{sampleType:`unfilterable-float`}},{binding:5,visibility:a.FRAGMENT,texture:{sampleType:`unfilterable-float`}}]}),this.textBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:a.VERTEX|a.FRAGMENT,buffer:{type:`uniform`,minBindingSize:it}},{binding:1,visibility:a.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:2,visibility:a.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:3,visibility:a.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:4,visibility:a.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:5,visibility:a.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:6,visibility:a.FRAGMENT,texture:{sampleType:`unfilterable-float`}},{binding:7,visibility:a.FRAGMENT,texture:{sampleType:`unfilterable-float`}},{binding:8,visibility:a.VERTEX,texture:{sampleType:`unfilterable-float`}},{binding:9,visibility:a.FRAGMENT,sampler:{type:`filtering`}},{binding:10,visibility:a.FRAGMENT,texture:{sampleType:`float`}}]}),this.rasterBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:a.VERTEX,buffer:{type:`uniform`,minBindingSize:it}},{binding:1,visibility:a.VERTEX,buffer:{type:`uniform`,minBindingSize:ut}},{binding:2,visibility:a.FRAGMENT,sampler:{type:`filtering`}},{binding:3,visibility:a.FRAGMENT,texture:{sampleType:`float`}}]}),this.blitBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:a.FRAGMENT,sampler:{type:`filtering`}},{binding:1,visibility:a.FRAGMENT,texture:{sampleType:`float`}},{binding:2,visibility:a.FRAGMENT,buffer:{type:`uniform`,minBindingSize:ot}}]}),this.vectorCompositeBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:a.FRAGMENT,sampler:{type:`filtering`}},{binding:1,visibility:a.FRAGMENT,texture:{sampleType:`float`}},{binding:2,visibility:a.FRAGMENT,buffer:{type:`uniform`,minBindingSize:ct}}]});let o=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.strokeBindGroupLayout]}),s=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.fillBindGroupLayout]}),c=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.textBindGroupLayout]}),l=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.rasterBindGroupLayout]}),u=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.blitBindGroupLayout]}),d=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.vectorCompositeBindGroupLayout]});this.strokePipeline=this.createPipeline(dt,`vsMain`,`fsMain`,o),this.fillPipeline=this.createPipeline(ft,`vsMain`,`fsMain`,s),this.textPipeline=this.createPipeline(pt,`vsMain`,`fsMain`,c),this.rasterPipeline=this.createPipeline(mt,`vsMain`,`fsMain`,l,!0),this.blitPipeline=this.createPipeline(ht,`vsMain`,`fsMain`,u),this.vectorCompositePipeline=this.createPipeline(gt,`vsMain`,`fsMain`,d,!0),this.panCacheSampler=this.gpuDevice.createSampler({magFilter:`linear`,minFilter:`linear`,mipmapFilter:`nearest`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),this.rasterLayerSampler=this.gpuDevice.createSampler({magFilter:`linear`,minFilter:`linear`,mipmapFilter:`linear`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),this.vectorCompositeSampler=this.gpuDevice.createSampler({magFilter:`linear`,minFilter:`linear`,mipmapFilter:`nearest`,addressModeU:`clamp-to-edge`,addressModeV:`clamp-to-edge`}),this.pageBackgroundTexture=this.createRgba8Texture(1,1,new Uint8Array([255,255,255,255])),this.ensureSegmentIdBuffers(1)}static async create(t){let n=navigator;if(!n.gpu)throw Error(`WebGPU is not available in this browser.`);let r=await n.gpu.requestAdapter({powerPreference:`high-performance`})??await n.gpu.requestAdapter();if(!r)throw Error(`Failed to acquire a WebGPU adapter.`);let i=await r.requestDevice();typeof i.addEventListener==`function`&&i.addEventListener(`uncapturederror`,e=>{let t=e?.error?.message||e?.error||e;console.warn(`[WebGPU uncaptured error]`,t)});let a=t.getContext(`webgpu`);if(!a)throw Error(`Failed to acquire a WebGPU canvas context.`);return new e(t,i,a,n.gpu.getPreferredCanvasFormat?.()??`bgra8unorm`)}setFrameListener(e){this.frameListener=e}setExternalFrameDriver(e){let t=!!e;if(this.externalFrameDriver!==t){if(this.externalFrameDriver=t,this.externalFrameDriver){this.externalFramePending=!0,this.rafHandle!==0&&(cancelAnimationFrame(this.rafHandle),this.rafHandle=0);return}this.externalFramePending&&(this.externalFramePending=!1,this.requestFrame())}}renderExternalFrame(e=performance.now()){this.externalFrameDriver&&!this.externalFramePending||(this.externalFramePending=!1,this.render(e))}setPanOptimizationEnabled(e){let t=!!e;this.panOptimizationEnabled!==t&&(this.panOptimizationEnabled=t,this.isPanInteracting=!1,this.panCacheValid=!1,this.panOptimizationEnabled||this.destroyPanCacheResources(),this.needsVisibleSetUpdate=!0,this.requestFrame())}setStrokeCurveEnabled(e){let t=!!e;this.strokeCurveEnabled!==t&&(this.strokeCurveEnabled=t,this.requestFrame())}setRasterRenderingEnabled(e){let t=!!e;this.rasterRenderingEnabled!==t&&(this.rasterRenderingEnabled=t,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setFillRenderingEnabled(e){let t=!!e;this.fillRenderingEnabled!==t&&(this.fillRenderingEnabled=t,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setStrokeRenderingEnabled(e){let t=!!e;this.strokeRenderingEnabled!==t&&(this.strokeRenderingEnabled=t,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setTextRenderingEnabled(e){let t=!!e;this.textRenderingEnabled!==t&&(this.textRenderingEnabled=t,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setTextVectorOnly(e){let t=!!e;this.textVectorOnly!==t&&(this.textVectorOnly=t,this.panCacheValid=!1,this.textVectorOnly&&this.destroyVectorMinifyResources(),this.requestFrame())}setPageBackgroundColor(e,t,n,r){let i=Ot(e,0,1),a=Ot(t,0,1),o=Ot(n,0,1),s=Ot(r,0,1),c=this.pageBackgroundColor;Math.abs(c[0]-i)<=1e-6&&Math.abs(c[1]-a)<=1e-6&&Math.abs(c[2]-o)<=1e-6&&Math.abs(c[3]-s)<=1e-6||(this.pageBackgroundColor=[i,a,o,s],this.uploadPageBackgroundTexture(),this.panCacheValid=!1,this.requestFrame())}setVectorColorOverride(e,t,n,r){let i=Ot(e,0,1),a=Ot(t,0,1),o=Ot(n,0,1),s=Ot(r,0,1),c=this.vectorOverrideColor;Math.abs(c[0]-i)<=1e-6&&Math.abs(c[1]-a)<=1e-6&&Math.abs(c[2]-o)<=1e-6&&Math.abs(this.vectorOverrideOpacity-s)<=1e-6||(this.vectorOverrideColor=[i,a,o],this.vectorOverrideOpacity=s,this.panCacheValid=!1,this.requestFrame())}setInteractionViewportProvider(e){this.interactionViewportProvider=e}beginPanInteraction(){this.hasCameraInteractionSinceSceneLoad=!0,this.syncCameraTargetsToCurrent(),this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameCameraX=this.cameraCenterX,this.lastPanFrameCameraY=this.cameraCenterY,this.lastPanFrameTimeMs=0,this.isPanInteracting=!0,this.markInteraction()}endPanInteraction(){this.isPanInteracting=!1;let e=performance.now(),t=this.lastPanVelocityUpdateTimeMs>0&&e-this.lastPanVelocityUpdateTimeMs<=tt?Math.hypot(this.panVelocityWorldX,this.panVelocityWorldY):0;Number.isFinite(t)&&t>=$e?(this.targetCameraCenterX=this.cameraCenterX+this.panVelocityWorldX/Je,this.targetCameraCenterY=this.cameraCenterY+this.panVelocityWorldY/Je,this.lastCameraAnimationTimeMs=0):(this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY),this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameTimeMs=0,this.markInteraction(),this.needsVisibleSetUpdate=!0,this.requestFrame()}resize(){let e=window.devicePixelRatio||1,t=Math.max(1,Math.round(this.canvas.clientWidth*e)),n=Math.max(1,Math.round(this.canvas.clientHeight*e));this.canvas.width===t&&this.canvas.height===n||(this.canvas.width=t,this.canvas.height=n,this.configureContext(),this.destroyPanCacheResources(),this.destroyVectorMinifyResources(),this.needsVisibleSetUpdate=!0,this.requestFrame())}setScene(e){this.scene=e,this.segmentCount=e.segmentCount,this.fillPathCount=e.fillPathCount,this.textInstanceCount=e.textInstanceCount,this.buildSegmentBounds(e),this.isPanInteracting=!1,this.panCacheValid=!1,this.destroyVectorMinifyResources(),this.grid=this.segmentCount>0?g(e):null;let t=this.maxTextureSize(),n=Tt(e.segmentCount,t),r=Tt(e.fillPathCount,t),i=Tt(e.fillSegmentCount,t),a=Tt(e.textInstanceCount,t),o=Tt(e.textGlyphCount,t),s=Tt(e.textGlyphSegmentCount,t);this.segmentTextureWidth=n.width,this.segmentTextureHeight=n.height,this.fillPathMetaTextureWidth=r.width,this.fillPathMetaTextureHeight=r.height,this.fillSegmentTextureWidth=i.width,this.fillSegmentTextureHeight=i.height,this.textInstanceTextureWidth=a.width,this.textInstanceTextureHeight=a.height,this.textGlyphMetaTextureWidth=o.width,this.textGlyphMetaTextureHeight=o.height,this.textGlyphSegmentTextureWidth=s.width,this.textGlyphSegmentTextureHeight=s.height,this.destroyDataResources(),this.segmentTextureA=this.createFloatTexture(this.segmentTextureWidth,this.segmentTextureHeight,e.endpoints),this.segmentTextureB=this.createFloatTexture(this.segmentTextureWidth,this.segmentTextureHeight,e.primitiveMeta),this.segmentTextureC=this.createFloatTexture(this.segmentTextureWidth,this.segmentTextureHeight,e.styles),this.segmentTextureD=this.createFloatTexture(this.segmentTextureWidth,this.segmentTextureHeight,e.primitiveBounds),this.fillPathMetaTextureA=this.createFloatTexture(this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,e.fillPathMetaA),this.fillPathMetaTextureB=this.createFloatTexture(this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,e.fillPathMetaB),this.fillPathMetaTextureC=this.createFloatTexture(this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,e.fillPathMetaC),this.fillSegmentTextureA=this.createFloatTexture(this.fillSegmentTextureWidth,this.fillSegmentTextureHeight,e.fillSegmentsA),this.fillSegmentTextureB=this.createFloatTexture(this.fillSegmentTextureWidth,this.fillSegmentTextureHeight,e.fillSegmentsB),this.textInstanceTextureA=this.createFloatTexture(this.textInstanceTextureWidth,this.textInstanceTextureHeight,e.textInstanceA),this.textInstanceTextureB=this.createFloatTexture(this.textInstanceTextureWidth,this.textInstanceTextureHeight,e.textInstanceB),this.textInstanceTextureC=this.createRgba8DataTexture(this.textInstanceTextureWidth,this.textInstanceTextureHeight,xt(e.textInstanceC,this.textInstanceTextureWidth*this.textInstanceTextureHeight)),this.textGlyphMetaTextureA=this.createFloatTexture(this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,e.textGlyphMetaA),this.textGlyphMetaTextureB=this.createFloatTexture(this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,e.textGlyphMetaB),this.textGlyphSegmentTextureA=this.createFloatTexture(this.textGlyphSegmentTextureWidth,this.textGlyphSegmentTextureHeight,e.textGlyphSegmentsA),this.textGlyphSegmentTextureB=this.createFloatTexture(this.textGlyphSegmentTextureWidth,this.textGlyphSegmentTextureHeight,e.textGlyphSegmentsB);let c=new Float32Array(this.textGlyphMetaTextureWidth*this.textGlyphMetaTextureHeight*4),l=E(e,t);l&&c.set(l.glyphUvRects),this.textGlyphRasterMetaTexture=this.createFloatTexture(this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,c),this.textRasterAtlasTexture=l?this.createR8Texture(l.width,l.height,l.alpha):this.createR8Texture(1,1,new Uint8Array([0])),this.configurePageBackgroundResources(e),this.configureRasterLayers(e),this.allSegmentIds=new Uint32Array(this.segmentCount);for(let e=0;e<this.segmentCount;e+=1)this.allSegmentIds[e]=e;return this.ensureSegmentIdBuffers(Math.max(1,this.segmentCount)),this.segmentCount>0&&(this.gpuDevice.queue.writeBuffer(this.segmentIdBufferAll,0,this.allSegmentIds),this.gpuDevice.queue.writeBuffer(this.segmentIdBufferVisible,0,this.allSegmentIds)),this.fillBindGroup=this.gpuDevice.createBindGroup({layout:this.fillPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:it}},{binding:1,resource:this.fillPathMetaTextureA.createView()},{binding:2,resource:this.fillPathMetaTextureB.createView()},{binding:3,resource:this.fillPathMetaTextureC.createView()},{binding:4,resource:this.fillSegmentTextureA.createView()},{binding:5,resource:this.fillSegmentTextureB.createView()}]}),this.textBindGroup=this.gpuDevice.createBindGroup({layout:this.textPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:it}},{binding:1,resource:this.textInstanceTextureA.createView()},{binding:2,resource:this.textInstanceTextureB.createView()},{binding:3,resource:this.textInstanceTextureC.createView()},{binding:4,resource:this.textGlyphMetaTextureA.createView()},{binding:5,resource:this.textGlyphMetaTextureB.createView()},{binding:6,resource:this.textGlyphSegmentTextureA.createView()},{binding:7,resource:this.textGlyphSegmentTextureB.createView()},{binding:8,resource:this.textGlyphRasterMetaTexture.createView()},{binding:9,resource:this.rasterLayerSampler},{binding:10,resource:this.textRasterAtlasTexture.createView()}]}),this.strokeBindGroupAll=this.gpuDevice.createBindGroup({layout:this.strokePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:it}},{binding:1,resource:this.segmentTextureA.createView()},{binding:2,resource:this.segmentTextureB.createView()},{binding:3,resource:this.segmentTextureC.createView()},{binding:4,resource:this.segmentTextureD.createView()},{binding:5,resource:{buffer:this.segmentIdBufferAll}}]}),this.strokeBindGroupVisible=this.gpuDevice.createBindGroup({layout:this.strokePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:it}},{binding:1,resource:this.segmentTextureA.createView()},{binding:2,resource:this.segmentTextureB.createView()},{binding:3,resource:this.segmentTextureC.createView()},{binding:4,resource:this.segmentTextureD.createView()},{binding:5,resource:{buffer:this.segmentIdBufferVisible}}]}),this.visibleSegmentIds.length<this.segmentCount&&(this.visibleSegmentIds=new Uint32Array(this.segmentCount)),this.segmentMarks.length<this.segmentCount&&(this.segmentMarks=new Uint32Array(this.segmentCount),this.markToken=1),this.visibleSegmentCount=this.segmentCount,this.usingAllSegments=!0,this.sceneStats={gridWidth:this.grid?.gridWidth??0,gridHeight:this.grid?.gridHeight??0,gridIndexCount:this.grid?.indices.length??0,maxCellPopulation:this.grid?.maxCellPopulation??0,fillPathTextureWidth:this.fillPathMetaTextureWidth,fillPathTextureHeight:this.fillPathMetaTextureHeight,fillSegmentTextureWidth:this.fillSegmentTextureWidth,fillSegmentTextureHeight:this.fillSegmentTextureHeight,textureWidth:this.segmentTextureWidth,textureHeight:this.segmentTextureHeight,maxTextureSize:t,textInstanceTextureWidth:this.textInstanceTextureWidth,textInstanceTextureHeight:this.textInstanceTextureHeight,textGlyphTextureWidth:this.textGlyphMetaTextureWidth,textGlyphTextureHeight:this.textGlyphMetaTextureHeight,textSegmentTextureWidth:this.textGlyphSegmentTextureWidth,textSegmentTextureHeight:this.textGlyphSegmentTextureHeight},this.minZoom=.01,this.maxZoom=8192,this.hasCameraInteractionSinceSceneLoad=!1,this.syncCameraTargetsToCurrent(),this.needsVisibleSetUpdate=!0,this.requestFrame(),this.sceneStats}getSceneStats(){return this.sceneStats}getViewState(){return{cameraCenterX:this.cameraCenterX,cameraCenterY:this.cameraCenterY,zoom:this.zoom}}getPresentedViewState(){return{cameraCenterX:this.presentedCameraCenterX,cameraCenterY:this.presentedCameraCenterY,zoom:this.presentedZoom}}getPresentedFrameSerial(){return this.presentedFrameSerial}setViewState(e){let t=Number(e.cameraCenterX),n=Number(e.cameraCenterY),r=Number(e.zoom);if(!Number.isFinite(t)||!Number.isFinite(n)||!Number.isFinite(r))return;this.cameraCenterX=t,this.cameraCenterY=n;let i=Ot(r,this.minZoom,this.maxZoom);this.zoom=i,this.targetCameraCenterX=t,this.targetCameraCenterY=n,this.targetZoom=i,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1,this.isPanInteracting=!1,this.panCacheValid=!1,this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.needsVisibleSetUpdate=!0,this.requestFrame()}fitToBounds(e,t=64){let n=Math.max(e.maxX-e.minX,1e-4),r=Math.max(e.maxY-e.minY,1e-4),i=Math.max(1,this.canvas.width-t*2),a=Math.max(1,this.canvas.height-t*2),o=Ot(Math.min(i/n,a/r),1e-8,this.maxZoom);this.minZoom=Math.min(this.minZoom,o);let s=(e.minX+e.maxX)*.5,c=(e.minY+e.maxY)*.5;this.zoom=o,this.cameraCenterX=s,this.cameraCenterY=c,this.targetZoom=o,this.targetCameraCenterX=s,this.targetCameraCenterY=c,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1,this.isPanInteracting=!1,this.panCacheValid=!1,this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.needsVisibleSetUpdate=!0,this.requestFrame()}panByPixels(e,t){if(!Number.isFinite(e)||!Number.isFinite(t))return;this.hasCameraInteractionSinceSceneLoad=!0,this.markInteraction(),this.hasZoomAnchor=!1;let n=this.resolveClientToPixelScale(),r=-(e*n.x)/this.zoom,i=t*n.y/this.zoom;this.cameraCenterX+=r,this.cameraCenterY+=i,this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY,this.needsVisibleSetUpdate=!0,this.requestFrame()}zoomAtClientPoint(e,t,n){let r=Ot(n,.1,10);this.hasCameraInteractionSinceSceneLoad=!0,this.markInteraction();let i=this.clientToWorld(e,t),a=Ot(this.targetZoom*r,this.minZoom,this.maxZoom);this.hasZoomAnchor=!0,this.zoomAnchorClientX=e,this.zoomAnchorClientY=t,this.zoomAnchorWorldX=i.x,this.zoomAnchorWorldY=i.y,this.targetZoom=a;let o=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,a);this.targetCameraCenterX=o.x,this.targetCameraCenterY=o.y,this.needsVisibleSetUpdate=!0,this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameTimeMs=0,this.requestFrame()}dispose(){this.rafHandle!==0&&(cancelAnimationFrame(this.rafHandle),this.rafHandle=0),this.frameListener=null,this.destroyPanCacheResources(),this.destroyVectorMinifyResources(),this.destroyDataResources(),this.segmentIdBufferAll&&=(this.segmentIdBufferAll.destroy(),null),this.segmentIdBufferVisible&&=(this.segmentIdBufferVisible.destroy(),null),this.cameraUniformBuffer&&this.cameraUniformBuffer.destroy(),this.blitUniformBuffer&&this.blitUniformBuffer.destroy(),this.vectorCompositeUniformBuffer&&this.vectorCompositeUniformBuffer.destroy(),this.pageBackgroundTexture&&=(this.pageBackgroundTexture.destroy(),null)}configureContext(){this.gpuContext.configure({device:this.gpuDevice,format:this.presentationFormat,alphaMode:`opaque`})}createPipeline(e,t,n,r,i=!1){let a=this.gpuDevice.createShaderModule({code:e}),o=i?`one`:`src-alpha`;return this.gpuDevice.createRenderPipeline({layout:r,vertex:{module:a,entryPoint:t},fragment:{module:a,entryPoint:n,targets:[{format:this.presentationFormat,blend:{color:{srcFactor:o,dstFactor:`one-minus-src-alpha`,operation:`add`},alpha:{srcFactor:`one`,dstFactor:`one-minus-src-alpha`,operation:`add`}}}]},primitive:{topology:`triangle-strip`}})}maxTextureSize(){let e=Number(this.gpuDevice?.limits?.maxTextureDimension2D);return Number.isFinite(e)&&e>=1?Math.floor(e):8192}ensureSegmentIdBuffers(e){let t=globalThis.GPUBufferUsage,n=Math.max(1,e)*4;this.segmentIdBufferAll&&=(this.segmentIdBufferAll.destroy(),null),this.segmentIdBufferVisible&&=(this.segmentIdBufferVisible.destroy(),null),this.segmentIdBufferAll=this.gpuDevice.createBuffer({size:n,usage:t.STORAGE|t.COPY_DST}),this.segmentIdBufferVisible=this.gpuDevice.createBuffer({size:n,usage:t.STORAGE|t.COPY_DST})}requestFrame(){if(this.externalFrameDriver){this.externalFramePending=!0;return}this.rafHandle===0&&(this.rafHandle=requestAnimationFrame(e=>{this.rafHandle=0,this.render(e)}))}render(e=performance.now()){let t=this.updateCameraWithDamping(e);if(this.updatePanReleaseVelocitySample(e),!this.scene||this.segmentCount===0&&this.fillPathCount===0&&this.textInstanceCount===0&&this.rasterLayerResources.length===0&&this.pageBackgroundResources.length===0){this.clearToScreen(),this.capturePresentedFrameState(),this.frameListener?.({renderedSegments:0,totalSegments:0,usedCulling:!1,zoom:this.zoom}),t&&this.requestFrame();return}if(!this.hasNativeRenderingEnabled()){this.capturePresentedFrameState(),this.frameListener?.({renderedSegments:0,totalSegments:this.segmentCount,usedCulling:!1,zoom:this.zoom}),t&&this.requestFrame();return}this.shouldUsePanCache(t)?this.renderWithPanCache():this.renderDirectToScreen(),this.capturePresentedFrameState(),t&&this.requestFrame()}hasNativeRenderingEnabled(){return this.rasterRenderingEnabled||this.fillRenderingEnabled||this.strokeRenderingEnabled||this.textRenderingEnabled}capturePresentedFrameState(){this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.presentedFrameSerial+=1}shouldUsePanCache(e){return!this.panOptimizationEnabled||this.segmentCount<Be?!1:this.isPanInteracting?!0:e}renderDirectToScreen(){let e=this.shouldUseVectorMinifyPath()&&this.ensureVectorMinifyResources();if(this.panOptimizationEnabled&&this.segmentCount>=Be&&(e=!1),this.needsVisibleSetUpdate){if(e){let e=this.computeVectorMinifyZoom(this.vectorMinifyWidth,this.vectorMinifyHeight);this.updateVisibleSet(this.cameraCenterX,this.cameraCenterY,this.vectorMinifyWidth,this.vectorMinifyHeight,e)}else this.updateVisibleSet(this.cameraCenterX,this.cameraCenterY,this.canvas.width,this.canvas.height,this.zoom);this.needsVisibleSetUpdate=!1}if(e){let e=this.renderVectorLayerIntoMinifyTarget(this.vectorMinifyWidth,this.vectorMinifyHeight,this.cameraCenterX,this.cameraCenterY),t=this.gpuContext.getCurrentTexture().createView(),n=this.gpuDevice.createCommandEncoder(),r=n.beginRenderPass({colorAttachments:[{view:t,clearValue:nt,loadOp:`clear`,storeOp:`store`}]});this.updateCameraUniforms(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY),this.drawRasterContentIntoPass(r),this.drawVectorMinifyCompositeIntoPass(r,this.canvas.width,this.canvas.height),r.end(),this.gpuDevice.queue.submit([n.finish()]),this.frameListener?.({renderedSegments:e,totalSegments:this.segmentCount,usedCulling:!this.usingAllSegments,zoom:this.zoom});return}let t=this.gpuContext.getCurrentTexture().createView(),n=this.gpuDevice.createCommandEncoder(),r=n.beginRenderPass({colorAttachments:[{view:t,clearValue:nt,loadOp:`clear`,storeOp:`store`}]}),i=this.drawSceneIntoPass(r,this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY);r.end(),this.gpuDevice.queue.submit([n.finish()]),this.frameListener?.({renderedSegments:i,totalSegments:this.segmentCount,usedCulling:!this.usingAllSegments,zoom:this.zoom})}hasVectorContent(){return this.fillRenderingEnabled&&this.fillPathCount>0||this.strokeRenderingEnabled&&this.segmentCount>0||this.textRenderingEnabled&&this.textInstanceCount>0}shouldUseVectorMinifyPath(){return this.textVectorOnly||!this.hasVectorContent()?!1:this.zoom<=qe}computeVectorMinifyZoom(e,t){let n=Math.min(e/Math.max(1,this.canvas.width),t/Math.max(1,this.canvas.height));return this.zoom*Math.max(1,n)}renderVectorLayerIntoMinifyTarget(e,t,n,r){if(!this.vectorMinifyTexture)return 0;let i=this.computeVectorMinifyZoom(e,t),a=this.gpuDevice.createCommandEncoder(),o=a.beginRenderPass({colorAttachments:[{view:this.vectorMinifyTexture.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:`clear`,storeOp:`store`}]});this.updateCameraUniforms(e,t,n,r,i);let s=this.drawVectorContentIntoPass(o);return o.end(),this.gpuDevice.queue.submit([a.finish()]),s}drawVectorMinifyCompositeIntoPass(e,t,n){!this.vectorCompositeBindGroup||!this.vectorMinifyTexture||(this.updateVectorCompositeUniforms(t,n),e.setPipeline(this.vectorCompositePipeline),e.setBindGroup(0,this.vectorCompositeBindGroup),e.draw(4,1,0,0))}renderWithPanCache(){if(!this.ensurePanCacheResources()){this.renderDirectToScreen();return}let e=this.panCacheZoom/Math.max(this.zoom,1e-6),t=(this.cameraCenterX-this.panCacheCenterX)*this.panCacheZoom,n=(this.cameraCenterY-this.panCacheCenterY)*this.panCacheZoom,r=this.panCacheWidth*.5-2,i=this.panCacheHeight*.5-2,a=this.canvas.width*.5*Math.abs(e),o=this.canvas.height*.5*Math.abs(e),s=r-a,c=i-o,l=this.zoom/Math.max(this.panCacheZoom,1e-6),u=l<We||l>Ge,d=Math.abs(this.targetZoom-this.zoom)<=Ze&&Math.abs(this.panCacheZoom-this.zoom)>Ue,f=s<0||c<0||Math.abs(t)>s||Math.abs(n)>c;if(!this.panCacheValid||u||f||d){this.panCacheCenterX=this.cameraCenterX,this.panCacheCenterY=this.cameraCenterY,this.panCacheZoom=this.zoom,this.updateVisibleSet(this.panCacheCenterX,this.panCacheCenterY,this.panCacheWidth,this.panCacheHeight),this.needsVisibleSetUpdate=!1;let r=this.gpuDevice.createCommandEncoder(),i=r.beginRenderPass({colorAttachments:[{view:this.panCacheTexture.createView(),clearValue:nt,loadOp:`clear`,storeOp:`store`}]});this.panCacheRenderedSegments=this.drawSceneIntoPass(i,this.panCacheWidth,this.panCacheHeight,this.panCacheCenterX,this.panCacheCenterY),i.end(),this.gpuDevice.queue.submit([r.finish()]),this.panCacheUsedCulling=!this.usingAllSegments,this.panCacheValid=!0,e=1,t=0,n=0}this.blitPanCache(t,n,e),this.frameListener?.({renderedSegments:this.panCacheRenderedSegments,totalSegments:this.segmentCount,usedCulling:this.panCacheUsedCulling,zoom:this.zoom})}drawSceneIntoPass(e,t,n,r,i){return this.updateCameraUniforms(t,n,r,i),this.drawRasterContentIntoPass(e),this.drawVectorContentIntoPass(e)}drawRasterContentIntoPass(e){if(this.rasterRenderingEnabled){if(this.pageBackgroundResources.length>0){e.setPipeline(this.rasterPipeline);for(let t of this.pageBackgroundResources)e.setBindGroup(0,t.bindGroup),e.draw(4,1,0,0)}if(this.rasterLayerResources.length>0){e.setPipeline(this.rasterPipeline);for(let t of this.rasterLayerResources)e.setBindGroup(0,t.bindGroup),e.draw(4,1,0,0)}}}drawVectorContentIntoPass(e){this.fillRenderingEnabled&&this.fillPathCount>0&&this.fillBindGroup&&(e.setPipeline(this.fillPipeline),e.setBindGroup(0,this.fillBindGroup),e.draw(4,this.fillPathCount,0,0));let t=this.strokeRenderingEnabled?this.usingAllSegments?this.segmentCount:this.visibleSegmentCount:0;if(t>0){let n=this.usingAllSegments?this.strokeBindGroupAll:this.strokeBindGroupVisible;n&&(e.setPipeline(this.strokePipeline),e.setBindGroup(0,n),e.draw(4,t,0,0))}return this.textRenderingEnabled&&this.textInstanceCount>0&&this.textBindGroup&&(e.setPipeline(this.textPipeline),e.setBindGroup(0,this.textBindGroup),e.draw(4,this.textInstanceCount,0,0)),t}updateCameraUniforms(e,t,n,r,i=this.zoom){let a=new Float32Array(rt);a[0]=e,a[1]=t,a[2]=n,a[3]=r,a[4]=i,a[5]=1,a[6]=+!!this.strokeCurveEnabled,a[7]=1.25,a[8]=+!!this.strokeCurveEnabled,a[9]=1,a[10]=+!!this.textVectorOnly,a[11]=0,a[12]=this.vectorOverrideColor[0],a[13]=this.vectorOverrideColor[1],a[14]=this.vectorOverrideColor[2],a[15]=this.vectorOverrideOpacity,wt(a,it,`camera`),this.gpuDevice.queue.writeBuffer(this.cameraUniformBuffer,0,a)}updateVectorCompositeUniforms(e,t){let n=new Float32Array(st);n[0]=e,n[1]=t,n[2]=0,n[3]=0,wt(n,ct,`vector composite`),this.gpuDevice.queue.writeBuffer(this.vectorCompositeUniformBuffer,0,n)}updateBlitUniforms(e,t,n){let r=new Float32Array(at);r[0]=this.canvas.width,r[1]=this.canvas.height,r[2]=this.panCacheWidth,r[3]=this.panCacheHeight,r[4]=e,r[5]=t,r[6]=n,r[7]=0,r[8]=0,r[9]=0,r[10]=0,r[11]=0,wt(r,ot,`blit`),this.gpuDevice.queue.writeBuffer(this.blitUniformBuffer,0,r)}blitPanCache(e,t,n){if(!this.panCacheTexture||!this.blitBindGroup){this.renderDirectToScreen();return}this.updateBlitUniforms(e,t,n);let r=this.gpuContext.getCurrentTexture().createView(),i=this.gpuDevice.createCommandEncoder(),a=i.beginRenderPass({colorAttachments:[{view:r,clearValue:nt,loadOp:`clear`,storeOp:`store`}]});a.setPipeline(this.blitPipeline),a.setBindGroup(0,this.blitBindGroup),a.draw(4,1,0,0),a.end(),this.gpuDevice.queue.submit([i.finish()])}ensureVectorMinifyResources(){let e=this.maxTextureSize(),t=e/Math.max(1,this.canvas.width),n=e/Math.max(1,this.canvas.height),r=Math.max(1,Math.min(Ke,t,n)),i=Math.max(this.canvas.width,Math.floor(this.canvas.width*r)),a=Math.max(this.canvas.height,Math.floor(this.canvas.height*r));if(i<this.canvas.width||a<this.canvas.height)return!1;if(this.vectorMinifyTexture&&this.vectorMinifyWidth===i&&this.vectorMinifyHeight===a&&this.vectorCompositeBindGroup)return!0;this.destroyVectorMinifyResources();let o=globalThis.GPUTextureUsage;return this.vectorMinifyTexture=this.gpuDevice.createTexture({size:{width:i,height:a,depthOrArrayLayers:1},format:this.presentationFormat,usage:o.RENDER_ATTACHMENT|o.TEXTURE_BINDING}),this.vectorMinifyWidth=i,this.vectorMinifyHeight=a,this.vectorCompositeBindGroup=this.gpuDevice.createBindGroup({layout:this.vectorCompositePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.vectorCompositeSampler},{binding:1,resource:this.vectorMinifyTexture.createView()},{binding:2,resource:{buffer:this.vectorCompositeUniformBuffer,size:ct}}]}),!0}ensurePanCacheResources(){let e=this.maxTextureSize(),t=Math.min(e,Math.max(this.canvas.width+He*2,Math.ceil(this.canvas.width*Ve))),n=Math.min(e,Math.max(this.canvas.height+He*2,Math.ceil(this.canvas.height*Ve)));if(t<this.canvas.width||n<this.canvas.height)return!1;if(this.panCacheTexture&&this.panCacheWidth===t&&this.panCacheHeight===n&&this.blitBindGroup)return!0;this.destroyPanCacheResources();let r=globalThis.GPUTextureUsage;return this.panCacheTexture=this.gpuDevice.createTexture({size:{width:t,height:n,depthOrArrayLayers:1},format:this.presentationFormat,usage:r.RENDER_ATTACHMENT|r.TEXTURE_BINDING}),this.panCacheWidth=t,this.panCacheHeight=n,this.panCacheValid=!1,this.blitBindGroup=this.gpuDevice.createBindGroup({layout:this.blitPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.panCacheSampler},{binding:1,resource:this.panCacheTexture.createView()},{binding:2,resource:{buffer:this.blitUniformBuffer,size:ot}}]}),!0}destroyPanCacheResources(){this.panCacheTexture&&=(this.panCacheTexture.destroy(),null),this.panCacheWidth=0,this.panCacheHeight=0,this.panCacheValid=!1,this.panCacheRenderedSegments=0,this.panCacheUsedCulling=!1,this.blitBindGroup=null}destroyVectorMinifyResources(){this.vectorMinifyTexture&&=(this.vectorMinifyTexture.destroy(),null),this.vectorMinifyWidth=0,this.vectorMinifyHeight=0,this.vectorCompositeBindGroup=null}updateVisibleSet(e=this.cameraCenterX,t=this.cameraCenterY,n=this.canvas.width,r=this.canvas.height,i=this.zoom){if(!this.scene||!this.grid){this.visibleSegmentCount=0,this.usingAllSegments=!0;return}if(!this.hasCameraInteractionSinceSceneLoad){this.usingAllSegments=!0,this.visibleSegmentCount=this.segmentCount;return}let a=this.grid,o=Math.max(i,1e-6),s=n/(2*o),c=r/(2*o),l=Math.max(16/o,this.scene.maxHalfWidth*2),u=e-s-l,d=e+s+l,f=t-c-l,p=t+c+l,m=kt(Math.floor((u-a.minX)/a.cellWidth),a.gridWidth),h=kt(Math.floor((d-a.minX)/a.cellWidth),a.gridWidth),g=kt(Math.floor((f-a.minY)/a.cellHeight),a.gridHeight),_=kt(Math.floor((p-a.minY)/a.cellHeight),a.gridHeight),v=(h-m+1)*(_-g+1),y=a.gridWidth*a.gridHeight;if(!this.isInteractionActive()&&v>=y*ze){this.usingAllSegments=!0,this.visibleSegmentCount=this.segmentCount;return}this.usingAllSegments=!1,this.markToken+=1,this.markToken===4294967295&&(this.segmentMarks.fill(0),this.markToken=1);let b=0;for(let e=g;e<=_;e+=1){let t=e*a.gridWidth+m;for(let e=m;e<=h;e+=1){let e=a.offsets[t],n=a.counts[t];for(let t=0;t<n;t+=1){let n=a.indices[e+t];this.segmentMarks[n]!==this.markToken&&(this.segmentMarks[n]=this.markToken,!(this.segmentMaxX[n]<u||this.segmentMinX[n]>d||this.segmentMaxY[n]<f||this.segmentMinY[n]>p)&&(this.visibleSegmentIds[b]=n,b+=1))}t+=1}}if(this.visibleSegmentCount=b,this.segmentIdBufferVisible&&b>0){let e=this.visibleSegmentIds.subarray(0,b);this.gpuDevice.queue.writeBuffer(this.segmentIdBufferVisible,0,e)}}buildSegmentBounds(e){this.segmentMinX.length<this.segmentCount&&(this.segmentMinX=new Float32Array(this.segmentCount),this.segmentMinY=new Float32Array(this.segmentCount),this.segmentMaxX=new Float32Array(this.segmentCount),this.segmentMaxY=new Float32Array(this.segmentCount));for(let t=0;t<this.segmentCount;t+=1){let n=t*4,r=t*4,i=e.styles[r]+.35;this.segmentMinX[t]=e.primitiveBounds[n]-i,this.segmentMinY[t]=e.primitiveBounds[n+1]-i,this.segmentMaxX[t]=e.primitiveBounds[n+2]+i,this.segmentMaxY[t]=e.primitiveBounds[n+3]+i}}markInteraction(){this.lastInteractionTime=performance.now()}isInteractionActive(){return performance.now()-this.lastInteractionTime<=Re}configureRasterLayers(e){this.destroyRasterLayerResources();for(let t of this.getSceneRasterLayers(e)){let e=new Float32Array(6);t.matrix.length>=6?(e[0]=t.matrix[0],e[1]=t.matrix[1],e[2]=t.matrix[2],e[3]=t.matrix[3],e[4]=t.matrix[4],e[5]=t.matrix[5]):(e[0]=1,e[3]=1);let n=bt(t.data.subarray(0,t.width*t.height*4)),r=this.createRgba8Texture(t.width,t.height,n);this.rasterLayerResources.push(this.createRasterLayerResource(e,r))}}configurePageBackgroundResources(e){if(this.destroyPageBackgroundResources(),this.pageBackgroundTexture||this.uploadPageBackgroundTexture(),!this.pageBackgroundTexture)return;let t=Et(e);for(let e=0;e+3<t.length;e+=4){let n=t[e],r=t[e+1],i=t[e+2],a=t[e+3];if(![n,r,i,a].every(Number.isFinite))continue;let o=Math.max(i-n,1e-6),s=Math.max(a-r,1e-6),c=new Float32Array([o,0,0,s,n,r]);this.pageBackgroundResources.push(this.createRasterLayerResource(c,this.pageBackgroundTexture))}}getSceneRasterLayers(e){let t=[];if(Array.isArray(e.rasterLayers))for(let n of e.rasterLayers){let e=Math.max(0,Math.trunc(n?.width??0)),r=Math.max(0,Math.trunc(n?.height??0));e<=0||r<=0||!(n.data instanceof Uint8Array)||n.data.length<e*r*4||t.push({width:e,height:r,data:n.data,matrix:n.matrix instanceof Float32Array?n.matrix:new Float32Array(n.matrix)})}if(t.length>0)return t;let n=Math.max(0,Math.trunc(e.rasterLayerWidth)),r=Math.max(0,Math.trunc(e.rasterLayerHeight));return n<=0||r<=0||e.rasterLayerData.length<n*r*4||t.push({width:n,height:r,data:e.rasterLayerData,matrix:e.rasterLayerMatrix}),t}destroyRasterLayerResources(){for(let e of this.rasterLayerResources)e.texture&&e.texture.destroy(),e.uniformBuffer&&e.uniformBuffer.destroy();this.rasterLayerResources=[]}destroyPageBackgroundResources(){for(let e of this.pageBackgroundResources)e.uniformBuffer&&e.uniformBuffer.destroy();this.pageBackgroundResources=[]}uploadPageBackgroundTexture(){let e=Math.round(this.pageBackgroundColor[3]*255),t=e/255,n=new Uint8Array([Math.round(this.pageBackgroundColor[0]*t*255),Math.round(this.pageBackgroundColor[1]*t*255),Math.round(this.pageBackgroundColor[2]*t*255),e]);if(!this.pageBackgroundTexture){this.pageBackgroundTexture=this.createRgba8Texture(1,1,n);return}this.writeRgba8Texture(this.pageBackgroundTexture,1,1,n,0)}createRasterLayerResource(e,t){let n=globalThis.GPUBufferUsage,r=new Float32Array(lt);r[0]=e[0],r[1]=e[1],r[2]=e[2],r[3]=e[3],r[4]=e[4],r[5]=e[5],r[6]=0,r[7]=0,wt(r,ut,`raster`);let i=this.gpuDevice.createBuffer({size:ut,usage:n.UNIFORM|n.COPY_DST});return this.gpuDevice.queue.writeBuffer(i,0,r),{texture:t,uniformBuffer:i,bindGroup:this.gpuDevice.createBindGroup({layout:this.rasterPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:it}},{binding:1,resource:{buffer:i,size:ut}},{binding:2,resource:this.rasterLayerSampler},{binding:3,resource:t.createView()}]})}}createFloatTexture(e,t,n){let r=globalThis.GPUTextureUsage,i=this.gpuDevice.createTexture({size:{width:e,height:t,depthOrArrayLayers:1},format:`rgba32float`,usage:r.TEXTURE_BINDING|r.COPY_DST}),a=vt(n,e,t);return this.writeFloatTexture(i,e,t,a),i}createRgba8Texture(e,t,n){let r=globalThis.GPUTextureUsage,i=St(n,e,t),a=this.gpuDevice.createTexture({size:{width:e,height:t,depthOrArrayLayers:1},format:`rgba8unorm`,mipLevelCount:i.length,usage:r.TEXTURE_BINDING|r.COPY_DST});for(let e=0;e<i.length;e+=1){let t=i[e],n=yt(t.data,t.width,t.height);this.writeRgba8Texture(a,t.width,t.height,n,e)}return a}createR8Texture(e,t,n){let r=globalThis.GPUTextureUsage,i=Ct(n,e,t),a=this.gpuDevice.createTexture({size:{width:e,height:t,depthOrArrayLayers:1},format:`r8unorm`,mipLevelCount:i.length,usage:r.TEXTURE_BINDING|r.COPY_DST});for(let e=0;e<i.length;e+=1){let t=i[e],n=yt(t.data,t.width,t.height,1);this.writeR8Texture(a,t.width,t.height,n,e)}return a}createRgba8DataTexture(e,t,n){let r=globalThis.GPUTextureUsage,i=this.gpuDevice.createTexture({size:{width:e,height:t,depthOrArrayLayers:1},format:`rgba8unorm`,usage:r.TEXTURE_BINDING|r.COPY_DST}),a=yt(n,e,t,4);return this.writeRgba8Texture(i,e,t,a),i}writeFloatTexture(e,t,n,r){let i=t*16,a=Dt(i,256);if(n<=1&&i===a){this.gpuDevice.queue.writeTexture({texture:e},r,{offset:0},{width:t,height:n,depthOrArrayLayers:1});return}if(i===a){this.gpuDevice.queue.writeTexture({texture:e},r,{offset:0,bytesPerRow:i,rowsPerImage:n},{width:t,height:n,depthOrArrayLayers:1});return}let o=new Uint8Array(r.buffer,r.byteOffset,r.byteLength),s=new Uint8Array(a*n);for(let e=0;e<n;e+=1){let t=e*i,n=e*a;s.set(o.subarray(t,t+i),n)}this.gpuDevice.queue.writeTexture({texture:e},s,{offset:0,bytesPerRow:a,rowsPerImage:n},{width:t,height:n,depthOrArrayLayers:1})}writeRgba8Texture(e,t,n,r,i=0){let a=t*4,o=Dt(a,256);if(n<=1&&a===o){this.gpuDevice.queue.writeTexture({texture:e,mipLevel:i},r,{offset:0},{width:t,height:n,depthOrArrayLayers:1});return}if(a===o){this.gpuDevice.queue.writeTexture({texture:e,mipLevel:i},r,{offset:0,bytesPerRow:a,rowsPerImage:n},{width:t,height:n,depthOrArrayLayers:1});return}let s=new Uint8Array(o*n);for(let e=0;e<n;e+=1){let t=e*a,n=e*o;s.set(r.subarray(t,t+a),n)}this.gpuDevice.queue.writeTexture({texture:e,mipLevel:i},s,{offset:0,bytesPerRow:o,rowsPerImage:n},{width:t,height:n,depthOrArrayLayers:1})}writeR8Texture(e,t,n,r,i=0){let a=t,o=Dt(a,256);if(n<=1&&a===o){this.gpuDevice.queue.writeTexture({texture:e,mipLevel:i},r,{offset:0},{width:t,height:n,depthOrArrayLayers:1});return}if(a===o){this.gpuDevice.queue.writeTexture({texture:e,mipLevel:i},r,{offset:0,bytesPerRow:a,rowsPerImage:n},{width:t,height:n,depthOrArrayLayers:1});return}let s=new Uint8Array(o*n);for(let e=0;e<n;e+=1){let t=e*a,n=e*o;s.set(r.subarray(t,t+a),n)}this.gpuDevice.queue.writeTexture({texture:e,mipLevel:i},s,{offset:0,bytesPerRow:o,rowsPerImage:n},{width:t,height:n,depthOrArrayLayers:1})}clearToScreen(){let e=this.gpuContext.getCurrentTexture().createView(),t=this.gpuDevice.createCommandEncoder();t.beginRenderPass({colorAttachments:[{view:e,clearValue:nt,loadOp:`clear`,storeOp:`store`}]}).end(),this.gpuDevice.queue.submit([t.finish()])}destroyDataResources(){this.strokeBindGroupAll=null,this.strokeBindGroupVisible=null,this.fillBindGroup=null,this.textBindGroup=null,this.destroyPageBackgroundResources(),this.destroyRasterLayerResources();let e=[this.segmentTextureA,this.segmentTextureB,this.segmentTextureC,this.segmentTextureD,this.fillPathMetaTextureA,this.fillPathMetaTextureB,this.fillPathMetaTextureC,this.fillSegmentTextureA,this.fillSegmentTextureB,this.textInstanceTextureA,this.textInstanceTextureB,this.textInstanceTextureC,this.textGlyphMetaTextureA,this.textGlyphMetaTextureB,this.textGlyphRasterMetaTexture,this.textGlyphSegmentTextureA,this.textGlyphSegmentTextureB,this.textRasterAtlasTexture];for(let t of e)t&&t.destroy();this.segmentTextureA=null,this.segmentTextureB=null,this.segmentTextureC=null,this.segmentTextureD=null,this.fillPathMetaTextureA=null,this.fillPathMetaTextureB=null,this.fillPathMetaTextureC=null,this.fillSegmentTextureA=null,this.fillSegmentTextureB=null,this.textInstanceTextureA=null,this.textInstanceTextureB=null,this.textInstanceTextureC=null,this.textGlyphMetaTextureA=null,this.textGlyphMetaTextureB=null,this.textGlyphRasterMetaTexture=null,this.textGlyphSegmentTextureA=null,this.textGlyphSegmentTextureB=null,this.textRasterAtlasTexture=null}clientToWorld(e,t){return this.clientToWorldAt(e,t,this.cameraCenterX,this.cameraCenterY,this.zoom)}clientToWorldAt(e,t,n,r,i){let a=this.resolveInteractionViewportRect(),o=this.resolveClientToPixelScale(a),s=(e-a.left)*o.x,c=(a.bottom-t)*o.y;return{x:(s-this.canvas.width*.5)/i+n,y:(c-this.canvas.height*.5)/i+r}}syncCameraTargetsToCurrent(){this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY,this.targetZoom=this.zoom,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1}updatePanReleaseVelocitySample(e){if(!this.isPanInteracting){this.lastPanFrameTimeMs=0;return}if(this.lastPanFrameTimeMs>0){let t=e-this.lastPanFrameTimeMs;if(t>.1){let n=this.cameraCenterX-this.lastPanFrameCameraX,r=this.cameraCenterY-this.lastPanFrameCameraY,i=n*1e3/t,a=r*1e3/t,o=Math.hypot(i,a);if(Number.isFinite(o)&&o>=$e){if(o>et){let e=et/o;i*=e,a*=e}this.panVelocityWorldX=i,this.panVelocityWorldY=a,this.lastPanVelocityUpdateTimeMs=e}}}this.lastPanFrameCameraX=this.cameraCenterX,this.lastPanFrameCameraY=this.cameraCenterY,this.lastPanFrameTimeMs=e}updateCameraWithDamping(e){let t=Math.abs(this.targetCameraCenterX-this.cameraCenterX)>Xe||Math.abs(this.targetCameraCenterY-this.cameraCenterY)>Xe,n=Math.abs(this.targetZoom-this.zoom)>Ze;if(!t&&!n)return this.hasZoomAnchor=!1,this.lastCameraAnimationTimeMs=e,!1;this.lastCameraAnimationTimeMs<=0&&(this.lastCameraAnimationTimeMs=e-16);let r=Ot(e-this.lastCameraAnimationTimeMs,0,Qe);this.lastCameraAnimationTimeMs=e;let i=r/1e3,a=1-Math.exp(-Je*i),o=1-Math.exp(-Ye*i);if(n&&(this.zoom+=(this.targetZoom-this.zoom)*o,Math.abs(this.targetZoom-this.zoom)<=Ze&&(this.zoom=this.targetZoom)),this.hasZoomAnchor){let e=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,this.zoom),r=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,this.targetZoom);this.cameraCenterX=e.x,this.cameraCenterY=e.y,this.targetCameraCenterX=r.x,this.targetCameraCenterY=r.y,n||(this.hasZoomAnchor=!1),t=!1}else t&&(this.cameraCenterX+=(this.targetCameraCenterX-this.cameraCenterX)*a,this.cameraCenterY+=(this.targetCameraCenterY-this.cameraCenterY)*a,Math.abs(this.targetCameraCenterX-this.cameraCenterX)<=Xe&&(this.cameraCenterX=this.targetCameraCenterX),Math.abs(this.targetCameraCenterY-this.cameraCenterY)<=Xe&&(this.cameraCenterY=this.targetCameraCenterY));return this.markInteraction(),this.needsVisibleSetUpdate=!0,t=Math.abs(this.targetCameraCenterX-this.cameraCenterX)>Xe||Math.abs(this.targetCameraCenterY-this.cameraCenterY)>Xe,n=Math.abs(this.targetZoom-this.zoom)>Ze,t||n}computeCameraCenterForAnchor(e,t,n,r,i){let a=this.resolveInteractionViewportRect(),o=this.resolveClientToPixelScale(a),s=(e-a.left)*o.x,c=(a.bottom-t)*o.y;return{x:n-(s-this.canvas.width*.5)/i,y:r-(c-this.canvas.height*.5)/i}}resolveInteractionViewportRect(){return this.interactionViewportProvider?.()||this.canvas.getBoundingClientRect()}resolveClientToPixelScale(e){let t=e??this.resolveInteractionViewportRect(),n=Math.max(window.devicePixelRatio||1,1e-6),r=t.width>1e-6?this.canvas.width/t.width:n,i=t.height>1e-6?this.canvas.height/t.height:n;return{x:Math.max(1e-6,r),y:Math.max(1e-6,i)}}};function vt(e,t,n){let r=t*n*4;if(e.length>r)throw Error(`Texture source data exceeds texture size (${e.length} > ${r}).`);let i=new Float32Array(r);return i.set(e),i}function yt(e,t,n,r=4){let i=t*n*r;if(e.length>i)throw Error(`Texture source data exceeds texture size (${e.length} > ${i}).`);let a=new Uint8Array(i);return a.set(e),a}function bt(e){let t=new Uint8Array(e.length);for(let n=0;n+3<e.length;n+=4){let r=e[n+3];if(r<=0){t[n]=0,t[n+1]=0,t[n+2]=0,t[n+3]=0;continue}if(r>=255){t[n]=e[n],t[n+1]=e[n+1],t[n+2]=e[n+2],t[n+3]=255;continue}let i=r/255;t[n]=Math.round(e[n]*i),t[n+1]=Math.round(e[n+1]*i),t[n+2]=Math.round(e[n+2]*i),t[n+3]=r}return t}function xt(e,t){let n=new Uint8Array(t*4),r=Math.min(e.length,n.length);for(let t=0;t<r;t+=1)n[t]=Math.round(Ot(e[t],0,1)*255);return n}function St(e,t,n){let r=[],i=Math.max(1,Math.trunc(t)),a=Math.max(1,Math.trunc(n)),o=e;for(r.push({width:i,height:a,data:o});i>1||a>1;){let e=Math.max(1,i>>1),t=Math.max(1,a>>1),n=new Uint8Array(e*t*4);for(let r=0;r<t;r+=1){let t=Math.min(a-1,r*2),s=Math.min(a-1,t+1);for(let a=0;a<e;a+=1){let c=Math.min(i-1,a*2),l=Math.min(i-1,c+1),u=(t*i+c)*4,d=(t*i+l)*4,f=(s*i+c)*4,p=(s*i+l)*4,m=(r*e+a)*4;n[m]=o[u]+o[d]+o[f]+o[p]+2>>2,n[m+1]=o[u+1]+o[d+1]+o[f+1]+o[p+1]+2>>2,n[m+2]=o[u+2]+o[d+2]+o[f+2]+o[p+2]+2>>2,n[m+3]=o[u+3]+o[d+3]+o[f+3]+o[p+3]+2>>2}}r.push({width:e,height:t,data:n}),i=e,a=t,o=n}return r}function Ct(e,t,n){let r=[],i=Math.max(1,Math.trunc(t)),a=Math.max(1,Math.trunc(n)),o=e;for(r.push({width:i,height:a,data:o});i>1||a>1;){let e=Math.max(1,i>>1),t=Math.max(1,a>>1),n=new Uint8Array(e*t);for(let r=0;r<t;r+=1){let t=Math.min(a-1,r*2),s=Math.min(a-1,t+1);for(let a=0;a<e;a+=1){let c=Math.min(i-1,a*2),l=Math.min(i-1,c+1),u=t*i+c,d=t*i+l,f=s*i+c,p=s*i+l;n[r*e+a]=o[u]+o[d]+o[f]+o[p]+2>>2}}r.push({width:e,height:t,data:n}),i=e,a=t,o=n}return r}function wt(e,t,n){let r=e.byteLength;if(r>t)throw Error(`${n} uniform data (${r} bytes) exceeds buffer size ${t} bytes.`)}function Tt(e,t){let n=Math.max(1,e),r=Ot(Math.ceil(Math.sqrt(n)),1,t),i=Math.max(1,Math.ceil(n/r));if(i>t)throw Error(`Data texture exceeds GPU limits for this browser/GPU.`);return{width:r,height:i}}function Et(e){return e.pageRects instanceof Float32Array&&e.pageRects.length>=4?new Float32Array(e.pageRects):new Float32Array([e.pageBounds.minX,e.pageBounds.minY,e.pageBounds.maxX,e.pageBounds.maxY])}function Dt(e,t){return t<=1?e:Math.ceil(e/t)*t}function Ot(e,t,n){return e<t?t:e>n?n:e}function kt(e,t){return e<0?0:e>=t?t-1:e}var At=class e{enabled;root;start;end;fixedMeta;constructor(e,t={}){this.root=t.root??{callback:e,throttleMs:t.throttleMs??80,minDelta:t.minDelta??.002,lastEmittedValue:-1,lastEmittedAt:0},this.start=Nt(t.start??0),this.end=Nt(t.end??1),this.fixedMeta=t.fixedMeta??{},this.enabled=typeof this.root.callback==`function`}child(t,n,r={}){return new e(void 0,{start:Ft(this.start,this.end,Nt(t)),end:Ft(this.start,this.end,Nt(n)),root:this.root,fixedMeta:{...this.fixedMeta,...r}})}toCallback(){return e=>{this.report(e.value,e)}}report(e,t={}){if(!this.enabled)return;let n={...this.fixedMeta,...t},r=Nt(e),i=Ft(this.start,this.end,r),a=Math.max(this.root.lastEmittedValue,i),o=n.stage??this.fixedMeta.stage??this.root.lastStage??`source`,s=It(),c=a-this.root.lastEmittedValue,l=o!==this.root.lastStage;if(!(this.root.lastEmittedValue<0||a>=1||l||c>=this.root.minDelta||s-this.root.lastEmittedAt>=this.root.throttleMs))return;let u={value:Nt(a),stage:o,executionPath:n.executionPath,sourceType:n.sourceType,unit:n.unit,processed:n.processed,total:n.total,pageIndex:n.pageIndex,pageCount:n.pageCount};this.root.lastEmittedValue=u.value,this.root.lastEmittedAt=s,this.root.lastStage=u.stage,this.root.callback?.(u)}complete(e={}){this.report(1,{stage:`complete`,...e})}async withIndeterminateProgress(e,t){if(!this.enabled)return typeof e==`function`?e():e;let n=Math.max(50,Math.trunc(t.tickMs??90)),r=Pt(t.ceiling??.9,.1,.999),i=It(),a={stage:t.stage,sourceType:t.sourceType,unit:t.unit,processed:t.processed,total:t.total,pageIndex:t.pageIndex,pageCount:t.pageCount};this.report(0,a);let o=globalThis.setInterval(()=>{let e=Math.max(0,It()-i)/800;this.report(Math.min(r,r*(1-1/(1+e))),a)},n);try{let t=await(typeof e==`function`?e():e);return this.report(1,a),t}finally{globalThis.clearInterval(o)}}};function jt(e,t={}){return new At(e,t)}function Mt(e){switch(e){case`source`:return`Reading source`;case`pdf-page`:return`Processing pages`;case`pdf-operators`:return`Scanning operators`;case`pdf-text`:return`Extracting text`;case`pdf-raster`:return`Extracting rasters`;case`compile`:return`Compiling`;case`zip-open`:return`Opening ZIP`;case`zip-manifest`:return`Reading manifest`;case`zip-file`:return`Decoding ZIP`;case`upload`:return`Uploading`;case`complete`:return`Complete`;default:return`Parsing / loading`}}function Nt(e){return Pt(e,0,1)}function Pt(e,t,n){return!Number.isFinite(e)||e<t?t:e>n?n:e}function Ft(e,t,n){return e+(t-e)*n}function It(){return typeof performance<`u`&&typeof performance.now==`function`?performance.now():Date.now()}var{getDocument:Lt,OPS:q,VerbosityLevel:Rt}=typeof window>`u`?await e(()=>import(`./pdf-BtsxYlBu.js`),__vite__mapDeps([0,1]),import.meta.url):await e(()=>import(`./pdf-Bb-_Bid1.js`),__vite__mapDeps([2,3,1]),import.meta.url),zt=0,Bt=1,Vt=2,Ht=3,Ut=4,J=class{data;length=0;constructor(e=32768){this.data=new Float32Array(e*4)}get quadCount(){return this.length>>2}push(e,t,n,r){this.ensureCapacity(4);let i=this.length;this.data[i]=e,this.data[i+1]=t,this.data[i+2]=n,this.data[i+3]=r,this.length+=4}append(e,t,n){n<=0||(this.ensureCapacity(n),this.data.set(e.subarray(t,t+n),this.length),this.length+=n)}toTypedArray(){return this.data.slice(0,this.length)}ensureCapacity(e){if(this.length+e<=this.data.length)return;let t=this.data.length;for(;this.length+e>t;)t*=2;let n=new Float32Array(t);n.set(this.data),this.data=n}},Wt=[1,0,0,1,0,0],Gt=.001,Kt=.999995,qt=.05,Jt=.001,Yt=.999,Xt=1e3,Zt=1e4,Qt=2e3,$t=200,en=.05,tn=1e-4,nn=.015,rn=12,an=1e-4,on=.001,sn=.001,cn=.001,ln=3,un=24,dn=16384,fn=134217728,pn=0,mn=1,hn=0,gn=2,_n=4,vn=6,yn=0,bn=1,xn=0,Sn=1,Cn=0,wn=1,Tn=.08,En=9,Dn=1,On=2,kn=2,An=.08,jn=24,Mn=Rt?.ERRORS??0;function Nn(e,t){return Q(e)+Math.max(0,Math.trunc(t+1e-6))*kn}function Pn(e){let t=Math.max(0,Math.trunc(e/kn+1e-6));return{alpha:Q(e-t*kn),styleFlags:t}}async function Fn(e,t={}){let n=t.enableSegmentMerge!==!1,r=t.enableInvisibleCull!==!1,i=ir(t.maxPages,2**53-1,1,2**53-1),a=lr(),o=jt(t.onProgress);o.report(0,{stage:`source`,sourceType:`pdf`});let s=await Lt({data:new Uint8Array(e),disableFontFace:!0,fontExtraProperties:!0,verbosity:Mn,...a?{standardFontDataUrl:a}:{}}).promise;o.report(.06,{stage:`pdf-page`,sourceType:`pdf`});try{let e=ir(s.numPages,1,1,2**53-1),t=Math.max(1,Math.min(e,i)),a=[],c=.08,l=.84;for(let e=1;e<=t;e+=1){let i=e-1,u=c+i/t*l,d=c+e/t*l;o.report(u,{stage:`pdf-page`,sourceType:`pdf`,unit:`pages`,processed:i,total:t,pageIndex:i,pageCount:t});let f=await s.getPage(e);o.report(wi(u,d,.28),{stage:`pdf-operators`,sourceType:`pdf`,unit:`pages`,processed:i,total:t,pageIndex:i,pageCount:t});let p=await f.getOperatorList();o.report(wi(u,d,.58),{stage:`compile`,sourceType:`pdf`,unit:`operators`,processed:p.fnArray.length,total:p.fnArray.length,pageIndex:i,pageCount:t});let m=await Bn(f,p,{enableSegmentMerge:n,enableInvisibleCull:r});a.push(m),o.report(d,{stage:`pdf-page`,sourceType:`pdf`,unit:`pages`,processed:e,total:t,pageIndex:i,pageCount:t})}return o.report(.94,{stage:`compile`,sourceType:`pdf`}),a}finally{await s.destroy()}}function In(e,t){return Vn(e,t)}async function Ln(e,t={}){let n=ir(t.maxPages,2**53-1,1,2**53-1),r=lr(),i=jt(t.onProgress);i.report(0,{stage:`source`,sourceType:`pdf`});let a=await Lt({data:new Uint8Array(e),disableFontFace:!0,fontExtraProperties:!0,verbosity:Mn,...r?{standardFontDataUrl:r}:{}}).promise;i.report(.06,{stage:`pdf-page`,sourceType:`pdf`});try{let e=ir(a.numPages,1,1,2**53-1),t=Math.max(1,Math.min(e,n)),r=[],o=.08,s=.84;for(let e=1;e<=t;e+=1){let n=e-1,c=o+n/t*s,l=o+e/t*s;i.report(c,{stage:`pdf-page`,sourceType:`pdf`,unit:`pages`,processed:n,total:t,pageIndex:n,pageCount:t});let u=await a.getPage(e),d=await u.getOperatorList();i.report(wi(c,l,.4),{stage:`pdf-raster`,sourceType:`pdf`,unit:`pages`,processed:n,total:t,pageIndex:n,pageCount:t}),r.push(await zn(u,d)),i.report(l,{stage:`pdf-page`,sourceType:`pdf`,unit:`pages`,processed:e,total:t,pageIndex:n,pageCount:t})}return i.report(.94,{stage:`compile`,sourceType:`pdf`}),r}finally{await a.destroy()}}async function Rn(e,t={}){let n=ir(t.maxPagesPerRow,10,1,100),r=await Ln(e,t),i=jt(t.onProgress);i.report(.96,{stage:`compile`,sourceType:`pdf`});let a=Vn(r,n);return i.complete({sourceType:`pdf`}),a}async function zn(e,t){let n=e.view,r=Array.isArray(n)?n:[0,0,1,1],i={minX:Math.min(Number(r[0])||0,Number(r[2])||1),minY:Math.min(Number(r[1])||0,Number(r[3])||1),maxX:Math.max(Number(r[0])||0,Number(r[2])||1),maxY:Math.max(Number(r[1])||0,Number(r[3])||1)},a=or(e),o=sr(i,a),s=zr(t),c=await qr(e,t,a,{allowFullPageFallback:!0}),l=c.width>0&&c.height>0&&c.data.length>=c.width*c.height*4?[{width:c.width,height:c.height,data:c.data,matrix:new Float32Array(c.matrix)}]:[],u=rr(),d=l[0]??null,f=vi(o,c.bounds)??o;return{...u,pageCount:1,pagesPerRow:1,pageRects:new Float32Array([o.minX,o.minY,o.maxX,o.maxY]),pageTextRanges:new Uint32Array([0,0]),rasterLayers:l,rasterLayerWidth:d?.width??0,rasterLayerHeight:d?.height??0,rasterLayerData:d?.data??new Uint8Array,rasterLayerMatrix:d?.matrix??new Float32Array([1,0,0,1,0,0]),bounds:f,pageBounds:o,imagePaintOpCount:s,operatorCount:t.fnArray.length}}async function Bn(e,t,n){let r=e.view,i=Array.isArray(r)?r:[0,0,1,1],a={minX:Math.min(Number(i[0])||0,Number(i[2])||1),minY:Math.min(Number(i[1])||0,Number(i[3])||1),maxX:Math.max(Number(i[0])||0,Number(i[2])||1),maxY:Math.max(Number(i[1])||0,Number(i[3])||1)},o=or(e),s=sr(a,o),c=zr(t),l=new J,u=new J,d=new J,f=new J,p=new J(8192),m=new J(8192),h=new J(8192),g=new J(65536),_=new J(65536),v={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0},y={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0},b=0,x=0,S=0,C=0,w=[],T=[],E=ar(o);for(let e=0;e<t.fnArray.length;e+=1){let r=t.fnArray[e],i=t.argsArray[e];if(r===q.save){w.push(dr(E));continue}if(r===q.restore){let e=w.pop();e&&(E=e);continue}if(r===q.transform){let e=pr(i);e&&(E.matrix=xi(E.matrix,e));continue}if(r===q.paintFormXObjectBegin){T.push(dr(E));let e=pr(i);e&&(E.matrix=xi(E.matrix,e));continue}if(r===q.paintFormXObjectEnd){let e=T.pop();e&&(E=e);continue}if(r===q.setLineWidth){let e=Y(i,0,E.lineWidth);E.lineWidth=Math.max(0,e);continue}if(r===q.setLineCap){let e=Math.trunc(Y(i,0,E.lineCap));E.lineCap=Math.min(2,Math.max(0,e));continue}if(r===q.setStrokeRGBColor||r===q.setStrokeColor){let[e,t,n]=Sr(i,[E.strokeR,E.strokeG,E.strokeB]);E.strokeR=e,E.strokeG=t,E.strokeB=n;continue}if(r===q.setStrokeGray){let[e]=br(gr(i,0),E.strokeR);E.strokeR=e,E.strokeG=e,E.strokeB=e;continue}if(r===q.setStrokeCMYKColor){let[e,t,n]=Cr(i,[E.strokeR,E.strokeG,E.strokeB]);E.strokeR=e,E.strokeG=t,E.strokeB=n;continue}if(r===q.setFillRGBColor||r===q.setFillColor){let[e,t,n]=Sr(i,[E.fillR,E.fillG,E.fillB]);E.fillR=e,E.fillG=t,E.fillB=n;continue}if(r===q.setFillGray){let[e]=br(gr(i,0),E.fillR);E.fillR=e,E.fillG=e,E.fillB=e;continue}if(r===q.setFillCMYKColor){let[e,t,n]=Cr(i,[E.fillR,E.fillG,E.fillB]);E.fillR=e,E.fillG=t,E.fillB=n;continue}if(r===q.setGState){Er(gr(i,0),E);continue}if(r!==q.constructPath)continue;let a=Y(i,0,-1),o=_r(a),s=vr(a);if(!o&&!s)continue;let c=hr(i);if(c){if(b+=1,o){let e=E.lineWidth<=0,t=Ci(E.matrix),r=e?0:E.lineWidth*t,i=Math.max(0,r*.5);S=Math.max(S,i);let a=0;e&&(a|=Dn),E.lineCap===1&&(a|=On);let o=Q(E.strokeR),s=Q(E.strokeG),p=Q(E.strokeB),m=Q(E.strokeAlpha);x+=Dr(c,E.matrix,i,o,s,p,m,a,n.enableSegmentMerge,l,u,f,d,v)}if(s){let e=yr(a)?mn:pn,t=Q(E.fillAlpha),n=o&&Q(E.strokeAlpha)>Jt;t>cn&&Or(c,E.matrix,e,n,Q(E.fillR),Q(E.fillG),Q(E.fillB),t,p,m,h,g,_,y)&&(C+=1)}}}let D=l.quadCount,O=l.toTypedArray(),k=u.toTypedArray(),A=d.toTypedArray(),j=f.toTypedArray(),M=g.quadCount,N=p.toTypedArray(),P=m.toTypedArray(),F=h.toTypedArray(),I=g.toTypedArray(),L=_.toTypedArray(),R=C>0?y:null,z=D,B=O,V=k,H=A,U=j,ee=D>0?v:null,W=D>0?S:0,te=0,ne=0,re=0,ie=0;if(D>0&&n.enableInvisibleCull){let e=kr(O,k,j,A);z=e.segmentCount,B=e.endpoints,V=e.primitiveMeta,H=e.primitiveBounds,U=e.styles,ee=e.segmentCount>0?e.bounds:null,W=e.maxHalfWidth,te=e.discardedTransparentCount,ne=e.discardedDegenerateCount,re=e.discardedDuplicateCount,ie=e.discardedContainedCount}z===0&&(B=new Float32Array,V=new Float32Array,H=new Float32Array,U=new Float32Array,W=0);let G=await Mr(e,t,o,s);if(G.instanceCount===0&&Rr(t)&&(await Br(e),G=await Mr(e,t,o,s)),G.instanceCount>0&&G.inPageCount<G.instanceCount*.2){let n=await Mr(e,t,Wt,s);n.inPageCount>G.inPageCount&&(G=n)}let ae=await qr(e,t,o,{allowFullPageFallback:z===0&&C===0&&G.instanceCount===0}),oe=ae.width>0&&ae.height>0&&ae.data.length>=ae.width*ae.height*4?[{width:ae.width,height:ae.height,data:ae.data,matrix:new Float32Array(ae.matrix)}]:[],se=vi(vi(vi(ee,R),G.bounds),ae.bounds)??{...s};return{pageCount:1,pagesPerRow:1,pageRects:new Float32Array([s.minX,s.minY,s.maxX,s.maxY]),pageTextRanges:new Uint32Array([0,G.instanceCount]),fillPathCount:C,fillSegmentCount:M,fillPathMetaA:N,fillPathMetaB:P,fillPathMetaC:F,fillSegmentsA:I,fillSegmentsB:L,segmentCount:z,sourceSegmentCount:x,mergedSegmentCount:D,sourceTextCount:G.sourceTextCount,textInstanceCount:G.instanceCount,textGlyphCount:G.glyphCount,textGlyphSegmentCount:G.glyphSegmentCount,textInPageCount:G.inPageCount,textOutOfPageCount:G.outOfPageCount,textInstanceA:G.instanceA,textInstanceB:G.instanceB,textInstanceC:G.instanceC,textGlyphMetaA:G.glyphMetaA,textGlyphMetaB:G.glyphMetaB,textGlyphSegmentsA:G.glyphSegmentsA,textGlyphSegmentsB:G.glyphSegmentsB,rasterLayers:oe,rasterLayerWidth:oe[0]?.width??0,rasterLayerHeight:oe[0]?.height??0,rasterLayerData:oe[0]?.data??new Uint8Array,rasterLayerMatrix:oe[0]?.matrix??new Float32Array([1,0,0,1,0,0]),endpoints:B,primitiveMeta:V,primitiveBounds:H,styles:U,bounds:se,pageBounds:s,maxHalfWidth:W,imagePaintOpCount:c,operatorCount:t.fnArray.length,pathCount:b,discardedTransparentCount:te,discardedDegenerateCount:ne,discardedDuplicateCount:re,discardedContainedCount:ie}}function Vn(e,t){if(e.length===0)return rr();if(e.length===1)return{...e[0],pageCount:1,pagesPerRow:1,pageTextRanges:Wn(e[0])};let n=ir(t,10,1,100),r=Qn(e,n),i=0,a=0,o=0,s=0,c=0,l=0,u=0,d=0,f=0,p=0,m=0,h=0,g=0,_=0,v=0,y=0,b=0,x=0,S=0,C=0;for(let t of e){i+=t.fillPathCount,a+=t.fillSegmentCount,o+=t.segmentCount,s+=t.sourceSegmentCount,c+=t.mergedSegmentCount,l+=t.sourceTextCount,u+=t.textInstanceCount,d+=t.textGlyphCount,f+=t.textGlyphSegmentCount,p+=t.textInPageCount,m+=t.textOutOfPageCount,h+=t.operatorCount,g+=t.imagePaintOpCount,_+=t.pathCount,v+=t.discardedTransparentCount,y+=t.discardedDegenerateCount,b+=t.discardedDuplicateCount,x+=t.discardedContainedCount,S=Math.max(S,t.maxHalfWidth);let e=t.pageRects.length>=4?Math.floor(t.pageRects.length/4):1;C+=Math.max(1,e)}let w=new Float32Array(i*4),T=new Float32Array(i*4),E=new Float32Array(i*4),D=new Float32Array(a*4),O=new Float32Array(a*4),k=new Float32Array(o*4),A=new Float32Array(o*4),j=new Float32Array(o*4),M=new Float32Array(o*4),N=new Float32Array(u*4),P=new Float32Array(u*4),F=new Float32Array(u*4),I=new Float32Array(d*4),L=new Float32Array(d*4),R=new Float32Array(f*4),z=new Float32Array(f*4),B=new Float32Array(C*4),V=new Uint32Array(C*2),H=0,U=0,ee=0,W=0,te=0,ne=0,re=0,ie=null,G=null,ae=[];for(let t=0;t<e.length;t+=1){let n=e[t],i=r[t],a=i.translateX,o=i.translateY;for(let e=0;e<n.fillPathCount;e+=1){let t=e*4,r=(H+e)*4;w[r]=n.fillPathMetaA[t]+U,w[r+1]=n.fillPathMetaA[t+1],w[r+2]=n.fillPathMetaA[t+2]+a,w[r+3]=n.fillPathMetaA[t+3]+o,T[r]=n.fillPathMetaB[t]+a,T[r+1]=n.fillPathMetaB[t+1]+o,T[r+2]=n.fillPathMetaB[t+2],T[r+3]=n.fillPathMetaB[t+3],E[r]=n.fillPathMetaC[t],E[r+1]=n.fillPathMetaC[t+1],E[r+2]=n.fillPathMetaC[t+2],E[r+3]=n.fillPathMetaC[t+3]}for(let e=0;e<n.fillSegmentCount;e+=1){let t=e*4,r=(U+e)*4;D[r]=n.fillSegmentsA[t]+a,D[r+1]=n.fillSegmentsA[t+1]+o,D[r+2]=n.fillSegmentsA[t+2]+a,D[r+3]=n.fillSegmentsA[t+3]+o,O[r]=n.fillSegmentsB[t]+a,O[r+1]=n.fillSegmentsB[t+1]+o,O[r+2]=n.fillSegmentsB[t+2],O[r+3]=n.fillSegmentsB[t+3]}for(let e=0;e<n.segmentCount;e+=1){let t=e*4,r=(ee+e)*4;k[r]=n.endpoints[t]+a,k[r+1]=n.endpoints[t+1]+o,k[r+2]=n.endpoints[t+2]+a,k[r+3]=n.endpoints[t+3]+o,A[r]=n.primitiveMeta[t]+a,A[r+1]=n.primitiveMeta[t+1]+o,A[r+2]=n.primitiveMeta[t+2],A[r+3]=n.primitiveMeta[t+3],j[r]=n.primitiveBounds[t]+a,j[r+1]=n.primitiveBounds[t+1]+o,j[r+2]=n.primitiveBounds[t+2]+a,j[r+3]=n.primitiveBounds[t+3]+o,M[r]=n.styles[t],M[r+1]=n.styles[t+1],M[r+2]=n.styles[t+2],M[r+3]=n.styles[t+3]}N.set(n.textInstanceA,W*4),F.set(n.textInstanceC,W*4);for(let e=0;e<n.textInstanceCount;e+=1){let t=e*4,r=(W+e)*4;P[r]=n.textInstanceB[t]+a,P[r+1]=n.textInstanceB[t+1]+o,P[r+2]=n.textInstanceB[t+2]+te,P[r+3]=n.textInstanceB[t+3]}for(let e=0;e<n.textGlyphCount;e+=1){let t=e*4,r=(te+e)*4;I[r]=n.textGlyphMetaA[t]+ne,I[r+1]=n.textGlyphMetaA[t+1],I[r+2]=n.textGlyphMetaA[t+2],I[r+3]=n.textGlyphMetaA[t+3],L[r]=n.textGlyphMetaB[t],L[r+1]=n.textGlyphMetaB[t+1],L[r+2]=n.textGlyphMetaB[t+2],L[r+3]=n.textGlyphMetaB[t+3]}R.set(n.textGlyphSegmentsA,ne*4),z.set(n.textGlyphSegmentsB,ne*4);let s=n.pageRects;if(s.length>=4){let e=Math.floor(s.length/4),t=Wn(n,e);for(let n=0;n<e;n+=1){let e=n*4,r=(re+n)*4;B[r]=s[e]+a,B[r+1]=s[e+1]+o,B[r+2]=s[e+2]+a,B[r+3]=s[e+3]+o;let i=(re+n)*2,c=n*2;V[i]=t[c]+W,V[i+1]=t[c+1]}re+=e}else{let e=re*4;B[e]=n.pageBounds.minX+a,B[e+1]=n.pageBounds.minY+o,B[e+2]=n.pageBounds.maxX+a,B[e+3]=n.pageBounds.maxY+o;let t=re*2;V[t]=W,V[t+1]=n.textInstanceCount,re+=1}ie=vi(ie,tr(n.bounds,a,o)),G=vi(G,tr(n.pageBounds,a,o));for(let e of nr(n)){if(e.matrix.length<6)continue;let t=new Float32Array(6);t[0]=e.matrix[0],t[1]=e.matrix[1],t[2]=e.matrix[2],t[3]=e.matrix[3],t[4]=e.matrix[4]+a,t[5]=e.matrix[5]+o,ae.push({width:e.width,height:e.height,data:e.data,matrix:t})}H+=n.fillPathCount,U+=n.fillSegmentCount,ee+=n.segmentCount,W+=n.textInstanceCount,te+=n.textGlyphCount,ne+=n.textGlyphSegmentCount}let oe=ae[0]??null;return Hn({pageCount:e.length,pagesPerRow:n,pageRects:B,pageTextRanges:V,fillPathCount:i,fillSegmentCount:a,fillPathMetaA:w,fillPathMetaB:T,fillPathMetaC:E,fillSegmentsA:D,fillSegmentsB:O,segmentCount:o,sourceSegmentCount:s,mergedSegmentCount:c,sourceTextCount:l,textInstanceCount:u,textGlyphCount:d,textGlyphSegmentCount:f,textInPageCount:p,textOutOfPageCount:m,textInstanceA:N,textInstanceB:P,textInstanceC:F,textGlyphMetaA:I,textGlyphMetaB:L,textGlyphSegmentsA:R,textGlyphSegmentsB:z,rasterLayers:ae,rasterLayerWidth:oe?.width??0,rasterLayerHeight:oe?.height??0,rasterLayerData:oe?.data??new Uint8Array,rasterLayerMatrix:oe?.matrix??new Float32Array([1,0,0,1,0,0]),endpoints:k,primitiveMeta:A,primitiveBounds:j,styles:M,bounds:ie??{minX:0,minY:0,maxX:1,maxY:1},pageBounds:G??ie??{minX:0,minY:0,maxX:1,maxY:1},maxHalfWidth:S,imagePaintOpCount:g,operatorCount:h,pathCount:_,discardedTransparentCount:v,discardedDegenerateCount:y,discardedDuplicateCount:b,discardedContainedCount:x})}function Hn(e){let t=Math.max(0,e.textGlyphCount|0),n=Math.max(0,e.textGlyphSegmentCount|0);if(t<=1||n<=0||e.textGlyphMetaA.length<t*4||e.textGlyphMetaB.length<t*4)return e;let r=new Uint32Array(e.textGlyphSegmentsA.buffer,e.textGlyphSegmentsA.byteOffset,e.textGlyphSegmentsA.length),i=new Uint32Array(e.textGlyphSegmentsB.buffer,e.textGlyphSegmentsB.byteOffset,e.textGlyphSegmentsB.length),a=new Uint32Array(e.textGlyphMetaA.buffer,e.textGlyphMetaA.byteOffset,e.textGlyphMetaA.length),o=new Uint32Array(e.textGlyphMetaB.buffer,e.textGlyphMetaB.byteOffset,e.textGlyphMetaB.length),s=new Uint32Array(t),c=[],l=new Map,u=new J(Math.min(t,4096)),d=new J(Math.min(t,4096)),f=new J(Math.min(n,65536)),p=new J(Math.min(n,65536));for(let n=0;n<t;n+=1){let t=Gn(e,n,a,o,r,i),m=l.get(t),h=-1;if(m){for(let t of m)if(Kn(e,n,c[t])){h=t;break}}if(h<0){h=c.length,c.push(n),m?m.push(h):l.set(t,[h]);let r=n*4,i=Math.max(0,Math.trunc(e.textGlyphMetaA[r])),a=Math.max(0,Math.trunc(e.textGlyphMetaA[r+1])),o=i*4,s=Math.min(a*4,Math.max(0,e.textGlyphSegmentsA.length-o),Math.max(0,e.textGlyphSegmentsB.length-o)),g=f.quadCount;f.append(e.textGlyphSegmentsA,o,s),p.append(e.textGlyphSegmentsB,o,s),u.push(g,s/4,e.textGlyphMetaA[r+2],e.textGlyphMetaA[r+3]),d.push(e.textGlyphMetaB[r],e.textGlyphMetaB[r+1],e.textGlyphMetaB[r+2],e.textGlyphMetaB[r+3])}s[n]=h}if(c.length===t)return e;let m=e.textInstanceB;for(let t=0;t<e.textInstanceCount;t+=1){let e=t*4+2,n=Math.max(0,Math.trunc(m[e]));n<s.length&&(m[e]=s[n])}return{...e,textInstanceB:m,textGlyphCount:c.length,textGlyphSegmentCount:f.quadCount,textGlyphMetaA:u.toTypedArray(),textGlyphMetaB:d.toTypedArray(),textGlyphSegmentsA:f.toTypedArray(),textGlyphSegmentsB:p.toTypedArray()}}function Un(e,t,n){let r=Math.max(1,Math.floor(e.length/4)),i=new Uint32Array(r*2),a=Math.max(0,Math.min(n|0,Math.floor(t.length/4)));if(r<=1||a<=0)return i[0]=0,i[1]=a,i;let o=Jn(e,r),s=0,c=0;for(let n=0;n<a;n+=1){let a=n*4,l=t[a],u=t[a+1];if(!Number.isFinite(l)||!Number.isFinite(u)||Xn(e,s,l,u,o))continue;let d=Yn(e,r,s+1,l,u,o);if(!(d<=s)){i[s*2]=c,i[s*2+1]=n-c;for(let e=s+1;e<d;e+=1)i[e*2]=n,i[e*2+1]=0;s=d,c=n}}i[s*2]=c,i[s*2+1]=a-c;for(let e=s+1;e<r;e+=1)i[e*2]=a,i[e*2+1]=0;return i}function Wn(e,t){let n=Math.floor(e.pageRects.length/4)||e.pageCount||1,r=Math.max(1,t??n)*2;return e.pageTextRanges instanceof Uint32Array&&e.pageTextRanges.length>=r?e.pageTextRanges.subarray(0,r):Un(e.pageRects,e.textInstanceB,e.textInstanceCount)}function Gn(e,t,n,r,i,a){let o=t*4,s=Math.max(0,Math.trunc(e.textGlyphMetaA[o])),c=Math.max(0,Math.trunc(e.textGlyphMetaA[o+1])),l=s*4,u=Math.min(c*4,Math.max(0,i.length-l),Math.max(0,a.length-l)),d=2166136261;d=qn(d,c),d=qn(d,n[o+2]??0),d=qn(d,n[o+3]??0),d=qn(d,r[o]??0),d=qn(d,r[o+1]??0);for(let e=0;e<u;e+=1)d=qn(d,i[l+e]),d=qn(d,a[l+e]);return`${c}:${d>>>0}`}function Kn(e,t,n){if(t===n)return!0;let r=t*4,i=n*4,a=Math.max(0,Math.trunc(e.textGlyphMetaA[r+1]));if(a!==Math.max(0,Math.trunc(e.textGlyphMetaA[i+1]))||e.textGlyphMetaA[r+2]!==e.textGlyphMetaA[i+2]||e.textGlyphMetaA[r+3]!==e.textGlyphMetaA[i+3]||e.textGlyphMetaB[r]!==e.textGlyphMetaB[i]||e.textGlyphMetaB[r+1]!==e.textGlyphMetaB[i+1]||e.textGlyphMetaB[r+2]!==e.textGlyphMetaB[i+2]||e.textGlyphMetaB[r+3]!==e.textGlyphMetaB[i+3])return!1;let o=Math.max(0,Math.trunc(e.textGlyphMetaA[r])),s=Math.max(0,Math.trunc(e.textGlyphMetaA[i])),c=o*4,l=s*4,u=a*4;for(let t=0;t<u;t+=1)if(e.textGlyphSegmentsA[c+t]!==e.textGlyphSegmentsA[l+t]||e.textGlyphSegmentsB[c+t]!==e.textGlyphSegmentsB[l+t])return!1;return!0}function qn(e,t){return e^=t>>>0,Math.imul(e,16777619)}function Jn(e,t){let n=0,r=0;for(let i=0;i<t;i+=1){let t=i*4,a=Math.abs(e[t+2]-e[t]),o=Math.abs(e[t+3]-e[t+1]),s=Math.max(a,o);Number.isFinite(s)&&s>0&&(n+=s,r+=1)}return r===0?8:Zn(n/r*.025,4,24)}function Yn(e,t,n,r,i,a){for(let o=Math.max(0,n);o<t;o+=1)if(Xn(e,o,r,i,a))return o;return-1}function Xn(e,t,n,r,i){let a=t*4,o=Math.min(e[a],e[a+2])-i,s=Math.max(e[a],e[a+2])+i,c=Math.min(e[a+1],e[a+3])-i,l=Math.max(e[a+1],e[a+3])+i;return n>=o&&n<=s&&r>=c&&r<=l}function Zn(e,t,n){return e<t?t:e>n?n:e}function Qn(e,t){let n=e.map(e=>$n(e.pageBounds,e.bounds)),r=Math.ceil(e.length/t),i=new Float64Array(r),a=0;for(let e=0;e<n.length;e+=1){let r=n[e],o=Math.max(r.maxX-r.minX,.001),s=Math.max(r.maxY-r.minY,.001);a+=Math.max(o,s);let c=Math.floor(e/t);i[c]=Math.max(i[c],s)}let o=a/Math.max(1,n.length),s=Math.max(o*An,jn),c=new Float64Array(r);for(let e=1;e<r;e+=1)c[e]=c[e-1]-i[e-1]-s;let l=new Float64Array(r),u=Array(e.length);for(let e=0;e<n.length;e+=1){let r=n[e],i=Math.max(r.maxX-r.minX,.001),a=Math.floor(e/t);u[e]={translateX:l[a]-r.minX,translateY:c[a]-r.maxY},l[a]+=i+s}return u}function $n(e,t){let n=er(e)?e:t;return er(n)?n:{minX:0,minY:0,maxX:1,maxY:1}}function er(e){return Number.isFinite(e.minX)&&Number.isFinite(e.minY)&&Number.isFinite(e.maxX)&&Number.isFinite(e.maxY)}function tr(e,t,n){return{minX:e.minX+t,minY:e.minY+n,maxX:e.maxX+t,maxY:e.maxY+n}}function nr(e){let t=[];if(Array.isArray(e.rasterLayers))for(let n of e.rasterLayers){let e=Math.max(0,Math.trunc(n?.width??0)),r=Math.max(0,Math.trunc(n?.height??0));if(e<=0||r<=0||!(n.data instanceof Uint8Array)||n.data.length<e*r*4)continue;let i=new Float32Array(6);n.matrix.length>=6?(i[0]=n.matrix[0],i[1]=n.matrix[1],i[2]=n.matrix[2],i[3]=n.matrix[3],i[4]=n.matrix[4],i[5]=n.matrix[5]):(i[0]=1,i[3]=1),t.push({width:e,height:r,data:n.data,matrix:i})}if(t.length>0)return t;let n=Math.max(0,Math.trunc(e.rasterLayerWidth)),r=Math.max(0,Math.trunc(e.rasterLayerHeight));if(n<=0||r<=0||e.rasterLayerData.length<n*r*4)return t;let i=new Float32Array([1,0,0,1,0,0]);return e.rasterLayerMatrix.length>=6&&(i[0]=e.rasterLayerMatrix[0],i[1]=e.rasterLayerMatrix[1],i[2]=e.rasterLayerMatrix[2],i[3]=e.rasterLayerMatrix[3],i[4]=e.rasterLayerMatrix[4],i[5]=e.rasterLayerMatrix[5]),t.push({width:n,height:r,data:e.rasterLayerData,matrix:i}),t}function rr(){return{pageCount:0,pagesPerRow:1,pageRects:new Float32Array,pageTextRanges:new Uint32Array,fillPathCount:0,fillSegmentCount:0,fillPathMetaA:new Float32Array,fillPathMetaB:new Float32Array,fillPathMetaC:new Float32Array,fillSegmentsA:new Float32Array,fillSegmentsB:new Float32Array,segmentCount:0,sourceSegmentCount:0,mergedSegmentCount:0,sourceTextCount:0,textInstanceCount:0,textGlyphCount:0,textGlyphSegmentCount:0,textInPageCount:0,textOutOfPageCount:0,textInstanceA:new Float32Array,textInstanceB:new Float32Array,textInstanceC:new Float32Array,textGlyphMetaA:new Float32Array,textGlyphMetaB:new Float32Array,textGlyphSegmentsA:new Float32Array,textGlyphSegmentsB:new Float32Array,rasterLayers:[],rasterLayerWidth:0,rasterLayerHeight:0,rasterLayerData:new Uint8Array,rasterLayerMatrix:new Float32Array([1,0,0,1,0,0]),endpoints:new Float32Array,primitiveMeta:new Float32Array,primitiveBounds:new Float32Array,styles:new Float32Array,bounds:{minX:0,minY:0,maxX:1,maxY:1},pageBounds:{minX:0,minY:0,maxX:1,maxY:1},maxHalfWidth:0,imagePaintOpCount:0,operatorCount:0,pathCount:0,discardedTransparentCount:0,discardedDegenerateCount:0,discardedDuplicateCount:0,discardedContainedCount:0}}function ir(e,t,n,r){let i=Math.trunc(Number(e)),a=Number.isFinite(i)?i:t;return a<n?n:a>r?r:a}function ar(e=Wt){return{matrix:[...e],lineWidth:1,lineCap:0,strokeR:0,strokeG:0,strokeB:0,strokeAlpha:1,fillR:0,fillG:0,fillB:0,fillAlpha:1}}function or(e){let t=cr(e.rotate),n=e.getViewport({scale:1,rotation:t,dontFlip:!1}),r=n.transform;if(!Array.isArray(r)||r.length<6)return[...Wt];let i=Number(r[0]),a=Number(r[1]),o=Number(r[2]),s=Number(r[3]),c=Number(r[4]),l=Number(r[5]);if(![i,a,o,s,c,l].every(Number.isFinite))return[...Wt];let u=Number(n.height);return Number.isFinite(u)?xi([1,0,0,-1,0,u],[i,a,o,s,c,l]):[i,a,o,s,c,l]}function sr(e,t){let n=Z(t,e.minX,e.minY),r=Z(t,e.minX,e.maxY),i=Z(t,e.maxX,e.minY),a=Z(t,e.maxX,e.maxY);return{minX:Math.min(n[0],r[0],i[0],a[0]),minY:Math.min(n[1],r[1],i[1],a[1]),maxX:Math.max(n[0],r[0],i[0],a[0]),maxY:Math.max(n[1],r[1],i[1],a[1])}}function cr(e){if(!Number.isFinite(e))return 0;let t=e%360;return t<0&&(t+=360),t}function lr(){if(typeof window<`u`&&window.location)return new URL(`pdfjs-standard-fonts/`,window.location.href).toString();if(typeof window>`u`){let e=new URL(`../node_modules/pdfjs-dist/standard_fonts/`,import.meta.url);if(e.protocol===`file:`){let t=decodeURIComponent(e.pathname);return t.endsWith(`/`)?t:`${t}/`}return e.toString()}}function ur(e,t,n=1){if(!Number.isFinite(e)||!Number.isFinite(t)||e<=0||t<=0)return 1;let r=typeof window>`u`?1:Math.max(1,Number(window.devicePixelRatio)||1),i=Math.max(r*ln,Number.isFinite(n)?n:1),a=Math.max(1,Math.min(un,i));for(;a>1;){let n=Math.max(1,Math.ceil(e*a)),r=Math.max(1,Math.ceil(t*a));if(n<=dn&&r<=dn&&n*r<=fn)return a;if(a*=.85,a<1.05)return 1}return 1}function dr(e){return{matrix:[...e.matrix],lineWidth:e.lineWidth,lineCap:e.lineCap,strokeR:e.strokeR,strokeG:e.strokeG,strokeB:e.strokeB,strokeAlpha:e.strokeAlpha,fillR:e.fillR,fillG:e.fillG,fillB:e.fillB,fillAlpha:e.fillAlpha}}var fr;function pr(e){let t=mr(e);if(!t)return null;let n=Array.isArray(e)?mr(e[0]):null,r=t.length>=6?t:n;if(!r||r.length<6)return null;let i=Number(r[0]),a=Number(r[1]),o=Number(r[2]),s=Number(r[3]),c=Number(r[4]),l=Number(r[5]);return[i,a,o,s,c,l].every(Number.isFinite)?[i,a,o,s,c,l]:null}function mr(e){return Array.isArray(e)||ArrayBuffer.isView(e)?e:null}function hr(e){if(!Array.isArray(e)||e.length<2)return null;let t=e[1];if(!Array.isArray(t)||t.length===0)return null;let n=t[0];return n instanceof Float32Array?n:null}function gr(e,t){if(Array.isArray(e))return e[t]}function Y(e,t,n){let r=gr(e,t),i=Number(r);return Number.isFinite(i)?i:n}function _r(e){return e===q.stroke||e===q.closeStroke||e===q.fillStroke||e===q.eoFillStroke||e===q.closeFillStroke||e===q.closeEOFillStroke}function vr(e){return e===q.fill||e===q.eoFill||e===q.fillStroke||e===q.eoFillStroke||e===q.closeFillStroke||e===q.closeEOFillStroke}function yr(e){return e===q.eoFill||e===q.eoFillStroke||e===q.closeEOFillStroke}function br(e,t){let n=Number(e);if(Number.isFinite(n)){let e=Q(n>1?n/255:n);return[e,e,e]}return[t,t,t]}function xr(e,t){if(typeof e==`number`&&Number.isFinite(e)){let t=Q(e>1?e/255:e);return[t,t,t]}if(typeof e==`string`&&e.startsWith(`#`)&&(e.length===7||e.length===4)){let[t,n,r]=Tr(e);return[Q(t/255),Q(n/255),Q(r/255)]}if(Array.isArray(e)&&e.length>=3){let t=Number(e[0]),n=Number(e[1]),r=Number(e[2]);if([t,n,r].every(Number.isFinite))return[Q(t>1?t/255:t),Q(n>1?n/255:n),Q(r>1?r/255:r)]}return[t[0],t[1],t[2]]}function Sr(e,t){return Array.isArray(e)?e.length>=3&&e.slice(0,3).every(e=>Number.isFinite(Number(e)))?xr([e[0],e[1],e[2]],t):e.length>0?xr(e[0],t):[t[0],t[1],t[2]]:xr(e,t)}function Cr(e,t){if(!Array.isArray(e)||e.length<4)return Sr(e,t);let n=wr(e[0]),r=wr(e[1]),i=wr(e[2]),a=wr(e[3]);if([n,r,i,a].some(e=>e===null))return Sr(e,t);let o=n,s=r,c=i,l=a,u=1-Math.min(1,o+l),d=1-Math.min(1,s+l),f=1-Math.min(1,c+l);return[Q(u),Q(d),Q(f)]}function wr(e){let t=Number(e);return Number.isFinite(t)?Q(t>1?t/100:t):null}function Tr(e){return e.length===4?[Number.parseInt(e[1]+e[1],16),Number.parseInt(e[2]+e[2],16),Number.parseInt(e[3]+e[3],16)]:[Number.parseInt(e.slice(1,3),16),Number.parseInt(e.slice(3,5),16),Number.parseInt(e.slice(5,7),16)]}function Er(e,t){if(Array.isArray(e))for(let n of e){if(!Array.isArray(n)||n.length<2)continue;let e=n[0],r=n[1];if(e===`CA`){let e=Number(r);Number.isFinite(e)&&(t.strokeAlpha=Q(e));continue}if(e===`ca`){let e=Number(r);Number.isFinite(e)&&(t.fillAlpha=Q(e));continue}if(e===`LW`){let e=Number(r);Number.isFinite(e)&&(t.lineWidth=Math.max(0,e));continue}if(e===`LC`){let e=Number(r);Number.isFinite(e)&&(t.lineCap=Math.min(2,Math.max(0,Math.trunc(e))))}}}function Dr(e,t,n,r,i,a,o,s,c,l,u,d,f,p){let m=0,h=0,g=0,_=0,v=0,y=!1,b=0,x=0,S=0,C=0,w=!1,T=(e,t,c,m,h,g,_)=>{l.push(e,t,c,m),u.push(h,g,_,Nn(o,s)),d.push(n,r,i,a);let v=Math.min(e,c,h),y=Math.min(t,m,g),b=Math.max(e,c,h),x=Math.max(t,m,g);f.push(v,y,b,x),p.minX=Math.min(p.minX,v),p.minY=Math.min(p.minY,y),p.maxX=Math.max(p.maxX,b),p.maxY=Math.max(p.maxY,x)},E=()=>{w&&=(T(b,x,S,C,S,C,xn),!1)},D=(e,t,n,r)=>{if(!w)return!1;let i=e-S,a=t-C;if(i*i+a*a>Gt*Gt)return!1;let o=S-b,s=C-x,c=n-e,l=r-t,u=o*o+s*s,d=c*c+l*l;if(u<1e-10||d<1e-10)return!1;let f=1/Math.sqrt(u*d);return(o*c+s*l)*f<Kt||bi(n-b,r-x,o,s,u)>qt*qt?!1:(S=n,C=r,!0)},O=(e,t,n,r,i)=>{let a=n-e,o=r-t;if(a*a+o*o<1e-10){if((s&On)===0)return;m+=1,E(),T(e,t,n,r,n,r,xn);return}if(m+=1,!(c&&i&&D(e,t,n,r))){if(c){E(),b=e,x=t,S=n,C=r,w=!0;return}T(e,t,n,r,n,r,xn)}},k=(e,t,n,r,i,a)=>{let o=i-e,s=a-t,c=n-e,l=r-t;o*o+s*s<1e-10&&c*c+l*l<1e-10||(m+=1,E(),T(e,t,n,r,i,a,Sn))};for(let n=0;n<e.length;){let r=e[n++];if(r===zt){E(),h=e[n++],g=e[n++],_=h,v=g,y=!0;continue}if(r===Bt){let r=e[n++],i=e[n++],[a,o]=Z(t,h,g),[s,c]=Z(t,r,i);O(a,o,s,c,!0),h=r,g=i;continue}if(r===Vt){let r=e[n++],i=e[n++],a=e[n++],o=e[n++],s=e[n++],c=e[n++],[l,u]=Z(t,h,g),[d,f]=Z(t,r,i),[p,m]=Z(t,a,o),[_,v]=Z(t,s,c);fi(l,u,d,f,p,m,_,v,k,Tn,En),h=s,g=c;continue}if(r===Ht){let r=e[n++],i=e[n++],a=e[n++],o=e[n++],[s,c]=Z(t,h,g),[l,u]=Z(t,r,i),[d,f]=Z(t,a,o);k(s,c,l,u,d,f),h=a,g=o;continue}if(r===Ut){if(y&&(h!==_||g!==v)){let[e,n]=Z(t,h,g),[r,i]=Z(t,_,v);O(e,n,r,i,!0)}h=_,g=v,E();continue}E();break}return E(),m}function Or(e,t,n,r,i,a,o,s,c,l,u,d,f,p){let m=0,h=0,g=0,_=0,v=!1,y=d.quadCount,b=0,x={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0},S=(e,t,n,r)=>{let i=n-e,a=r-t;i*i+a*a<1e-12||(d.push(e,t,n,r),f.push(n,r,Cn,0),b+=1,x.minX=Math.min(x.minX,e,n),x.minY=Math.min(x.minY,t,r),x.maxX=Math.max(x.maxX,e,n),x.maxY=Math.max(x.maxY,t,r))},C=(e,t,n,r,i,a)=>{let o=i-e,s=a-t,c=n-e,l=r-t;o*o+s*s<1e-12&&c*c+l*l<1e-12||(d.push(e,t,n,r),f.push(i,a,wn,0),b+=1,x.minX=Math.min(x.minX,e,n,i),x.minY=Math.min(x.minY,t,r,a),x.maxX=Math.max(x.maxX,e,n,i),x.maxY=Math.max(x.maxY,t,r,a))},w=()=>{if(v){if(m!==g||h!==_){let[e,n]=Z(t,m,h),[r,i]=Z(t,g,_);S(e,n,r,i)}m=g,h=_}};for(let n=0;n<e.length;){let r=e[n++];if(r===zt){w(),m=e[n++],h=e[n++],g=m,_=h,v=!0;continue}if(r===Bt){let r=e[n++],i=e[n++],[a,o]=Z(t,m,h),[s,c]=Z(t,r,i);S(a,o,s,c),m=r,h=i;continue}if(r===Vt){let r=e[n++],i=e[n++],a=e[n++],o=e[n++],s=e[n++],c=e[n++],[l,u]=Z(t,m,h),[d,f]=Z(t,r,i),[p,g]=Z(t,a,o),[_,v]=Z(t,s,c);fi(l,u,d,f,p,g,_,v,C,Tn,En),m=s,h=c;continue}if(r===Ht){let r=e[n++],i=e[n++],a=e[n++],o=e[n++],[s,c]=Z(t,m,h),[l,u]=Z(t,r,i),[d,f]=Z(t,a,o);C(s,c,l,u,d,f),m=a,h=o;continue}if(r===Ut){w();continue}w();break}return w(),b===0?!1:(c.push(y,b,x.minX,x.minY),l.push(x.maxX,x.maxY,i,a),u.push(n,+!!r,o,s),p.minX=Math.min(p.minX,x.minX),p.minY=Math.min(p.minY,x.minY),p.maxX=Math.max(p.maxX,x.maxX),p.maxY=Math.max(p.maxY,x.maxY),!0)}function kr(e,t,n,r){let i=e.length>>2,a=new Uint8Array(i),o=new Set,s=new Map,c=0,l=0,u=0,d=0;for(let r=0;r<i;r+=1){let i=r*4,d=e[i],f=e[i+1],p=e[i+2],m=e[i+3],h=t[i],g=t[i+1],_=t[i+2],v=_>=Sn-.5,y=n[i],b=n[i+1],x=n[i+2],S=n[i+3],{alpha:C,styleFlags:w}=Pn(t[i+3]);if(C<=Jt){c+=1;continue}let T=v?Math.hypot(p-d,m-f)+Math.hypot(h-p,g-m):Math.hypot(h-d,g-f);if(T<1e-5){let e=!v&&(w&On)!==0,t=(w&Dn)!==0||y>1e-6;if(!e||!t){l+=1;continue}}let E=Ar(d,f,p,m,h,g,_,y,b,x,S,C,w);if(o.has(E)){u+=1;continue}if(o.add(E),a[r]=1,!v&&T>=1e-5){let e=jr(r,d,f,h,g,y,b,x,S,C,w),t=s.get(e.key);t||(t=[],s.set(e.key,t)),t.push({index:e.index,start:e.start,end:e.end,halfWidth:e.halfWidth,alpha:e.alpha,styleFlags:e.styleFlags})}}for(let e of s.values()){e.sort((e,t)=>{if(Math.abs(e.halfWidth-t.halfWidth)>tn)return t.halfWidth-e.halfWidth;let n=e.end-e.start,r=t.end-t.start;return Math.abs(n-r)>en?r-n:e.start-t.start});let t=[];for(let n of e){let e=!1;for(let r of t)if(!(r.halfWidth+tn<n.halfWidth)&&r.start-en<=n.start&&r.end+en>=n.end){e=!0;break}if(e){a[n.index]===1&&(a[n.index]=0,d+=1);continue}n.alpha>=Yt&&t.push(n)}}let f=0;for(let e=0;e<i;e+=1)a[e]===1&&(f+=1);if(f===0)return{segmentCount:0,endpoints:new Float32Array,primitiveMeta:new Float32Array,primitiveBounds:new Float32Array,styles:new Float32Array,bounds:{minX:0,minY:0,maxX:0,maxY:0},maxHalfWidth:0,discardedTransparentCount:c,discardedDegenerateCount:l,discardedDuplicateCount:u,discardedContainedCount:d};let p=new Float32Array(f*4),m=new Float32Array(f*4),h=new Float32Array(f*4),g=new Float32Array(f*4),_={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0},v=0,y=0;for(let o=0;o<i;o+=1){if(a[o]===0)continue;let i=o*4,s=y*4,c=e[i],l=e[i+1],u=r[i],d=r[i+1],f=r[i+2],b=r[i+3],x=n[i];p[s]=c,p[s+1]=l,p[s+2]=e[i+2],p[s+3]=e[i+3],m[s]=t[i],m[s+1]=t[i+1],m[s+2]=t[i+2],m[s+3]=t[i+3],h[s]=u,h[s+1]=d,h[s+2]=f,h[s+3]=b,g[s]=n[i],g[s+1]=n[i+1],g[s+2]=n[i+2],g[s+3]=n[i+3],_.minX=Math.min(_.minX,u),_.minY=Math.min(_.minY,d),_.maxX=Math.max(_.maxX,f),_.maxY=Math.max(_.maxY,b),v=Math.max(v,x),y+=1}return{segmentCount:f,endpoints:p,primitiveMeta:m,primitiveBounds:h,styles:g,bounds:_,maxHalfWidth:v,discardedTransparentCount:c,discardedDegenerateCount:l,discardedDuplicateCount:u,discardedContainedCount:d}}function Ar(e,t,n,r,i,a,o,s,c,l,u,d,f){let p=o>=Sn-.5,m=e,h=t,g=i,_=a,v=n,y=r;return!p&&(m>g||m===g&&h>_)&&(m=i,h=a,g=e,_=t),p||(v=g,y=_),[X(o,10),X(s,Zt),X(c,Zt),X(l,Zt),X(u,Zt),X(d,Zt),X(f,1),X(m,Xt),X(h,Xt),X(v,Xt),X(y,Xt),X(g,Xt),X(_,Xt)].join(`|`)}function jr(e,t,n,r,i,a,o,s,c,l,u){let d=t,f=n,p=r,m=i,h=p-d,g=m-f,_=Math.hypot(h,g),v=h/_,y=g/_;(v<0||Math.abs(v)<1e-10&&y<0)&&(v=-v,y=-y,d=r,f=i,p=t,m=n);let b=-y,x=v,S=b*d+x*f,C=v*d+y*f,w=v*p+y*m,T=Math.min(C,w),E=Math.max(C,w);return{key:[X(v,Qt),X(y,Qt),X(S,$t),X(o,Zt),X(s,Zt),X(c,Zt),X(u,1)].join(`|`),index:e,start:T,end:E,halfWidth:a,alpha:l,styleFlags:u}}async function Mr(e,t,n,r){let i=Lr(e);if(!i)return Ir();let a=new J(4096),o=new J(4096),s=new J(4096),c=new J(2048),l=new J(2048),u=new J(16384),d=new J(16384),f=new Map,p=[],m=0,h=null,g=0,_=0,v=[],y=[],b=[],x=[],S=$r(n),C=null,w=null,T=(e,t,n)=>{if(!n)return null;let r=typeof e?.loadedName==`string`&&e.loadedName.length>0?e.loadedName:t;if(!r)return null;let a=`${r}|${n}`,o=f.get(a);if(o!==void 0)return{index:o,bounds:p[o]};let s=li(i,r,n);if(!s)return null;let m=u.quadCount,h=di(s,u,d);if(h.segmentCount<=0)return null;let g=c.quadCount;return c.push(m,h.segmentCount,h.bounds.minX,h.bounds.minY),l.push(h.bounds.maxX,h.bounds.maxY,0,0),f.set(a,g),p[g]=h.bounds,{index:g,bounds:h.bounds}},E=e=>{if(e.length===0||S.fontSize===0)return;let t=si(i,S.fontRef),n=ci(t),c=S.fontSize*n,l=t?.vertical===!0,u=l?1:-1,d=S.textHScale*S.fontDirection,f=0;for(let n of e){if(typeof n==`number`&&Number.isFinite(n)){f+=u*n*S.fontSize/1e3;continue}let e=n,i=typeof e.fontChar==`string`?e.fontChar:``,d=Number(e.width),p=Number.isFinite(d)?d:0,v=e.isSpace===!0,y=ai(e,i),b=(v?S.wordSpacing:0)+S.charSpacing;if(!l&&!y&&ii(S.renderMode)&&S.fillAlpha>sn){let e=T(t,S.fontRef,i);if(e){let t=_i(S,f,0),n=sr(e.bounds,t);(!C||yi(n,C))&&(a.push(t[0],t[1],t[2],t[3]),o.push(t[4],t[5],e.index,0),s.push(S.fillR,S.fillG,S.fillB,S.fillAlpha),m+=1,r&&(yi(n,r)?g+=1:_+=1),h?(h.minX=Math.min(h.minX,n.minX-an),h.minY=Math.min(h.minY,n.minY-an),h.maxX=Math.max(h.maxX,n.maxX+an),h.maxY=Math.max(h.maxY,n.maxY+an)):h={minX:n.minX-an,minY:n.minY-an,maxX:n.maxX+an,maxY:n.maxY+an})}}let x=l?p*c-b*S.fontDirection:p*c+b*S.fontDirection;f+=x}l?S.textY-=f:S.textX+=f*d};for(let e=0;e<t.fnArray.length;e+=1){let n=t.fnArray[e],r=t.argsArray[e];if(n===q.save){v.push(ei(S)),b.push(Nr(C));continue}if(n===q.restore){let e=v.pop();e&&(S=e),C=b.pop()??null,w=null;continue}if(n===q.transform){let e=pr(r);e&&(S.matrix=xi(S.matrix,e));continue}if(n===q.paintFormXObjectBegin){y.push(ei(S)),x.push(Nr(C));let e=pr(r);e&&(S.matrix=xi(S.matrix,e)),w=null;continue}if(n===q.paintFormXObjectEnd){let e=y.pop();e&&(S=e),C=x.pop()??C,w=null;continue}if(n===q.constructPath){if(Y(r,0,-1)===q.endPath){let e=hr(r);w=e?Fr(e,S.matrix):null}else w=null;continue}if(n===q.clip||n===q.eoClip){w&&(C=Pr(C,w));continue}if(n===q.endPath){w=null;continue}if(n===q.setFillRGBColor||n===q.setFillColor||n===q.setFillGray||n===q.setFillCMYKColor){if(n===q.setFillCMYKColor){let[e,t,n]=Cr(r,[S.fillR,S.fillG,S.fillB]);S.fillR=e,S.fillG=t,S.fillB=n}else if(n===q.setFillGray){let[e]=br(gr(r,0),S.fillR);S.fillR=e,S.fillG=e,S.fillB=e}else{let[e,t,n]=Sr(r,[S.fillR,S.fillG,S.fillB]);S.fillR=e,S.fillG=t,S.fillB=n}continue}if(n===q.setGState){ri(gr(r,0),S);continue}if(n===q.beginText){ti(S);continue}if(n===q.setCharSpacing){S.charSpacing=Y(r,0,S.charSpacing);continue}if(n===q.setWordSpacing){S.wordSpacing=Y(r,0,S.wordSpacing);continue}if(n===q.setHScale){S.textHScale=Y(r,0,S.textHScale*100)/100;continue}if(n===q.setLeading){S.leading=-Y(r,0,-S.leading);continue}if(n===q.setFont){let e=gr(r,0),t=Y(r,1,S.fontSize);typeof e==`string`&&(S.fontRef=e),t<0?(S.fontSize=-t,S.fontDirection=-1):(S.fontSize=t,S.fontDirection=1);continue}if(n===q.setTextRenderingMode){S.renderMode=Math.max(0,Math.trunc(Y(r,0,S.renderMode)));continue}if(n===q.setTextRise){S.textRise=Y(r,0,S.textRise);continue}if(n===q.moveText){let e=Y(r,0,0),t=Y(r,1,0);ni(S,e,t);continue}if(n===q.setLeadingMoveText){let e=Y(r,0,0),t=Y(r,1,0);S.leading=t,ni(S,e,t);continue}if(n===q.setTextMatrix){let e=pr(r);e&&(S.textMatrix=e,S.textX=0,S.textY=0,S.lineX=0,S.lineY=0);continue}if(n===q.nextLine){ni(S,0,S.leading);continue}if(n===q.showText||n===q.showSpacedText){E(oi(gr(r,0))),w=null;continue}if(n===q.nextLineShowText){ni(S,0,S.leading),E(oi(gr(r,0))),w=null;continue}if(n===q.nextLineSetSpacingShowText){S.wordSpacing=Y(r,0,S.wordSpacing),S.charSpacing=Y(r,1,S.charSpacing),ni(S,0,S.leading),E(oi(gr(r,2))),w=null;continue}}return{sourceTextCount:m,instanceCount:a.quadCount,glyphCount:c.quadCount,glyphSegmentCount:u.quadCount,inPageCount:g,outOfPageCount:_,instanceA:a.toTypedArray(),instanceB:o.toTypedArray(),instanceC:s.toTypedArray(),glyphMetaA:c.toTypedArray(),glyphMetaB:l.toTypedArray(),glyphSegmentsA:u.toTypedArray(),glyphSegmentsB:d.toTypedArray(),bounds:h}}function Nr(e){return e?{...e}:null}function Pr(e,t){if(!e&&!t)return null;if(!e&&t)return{...t};if(e&&!t)return{...e};let n=Math.max(e.minX,t.minX),r=Math.max(e.minY,t.minY),i=Math.min(e.maxX,t.maxX),a=Math.min(e.maxY,t.maxY);return n<=i&&r<=a?{minX:n,minY:r,maxX:i,maxY:a}:null}function Fr(e,t){let n=1/0,r=1/0,i=-1/0,a=-1/0,o=!1,s=0,c=0,l=0,u=0,d=!1,f=(e,s)=>{let[c,l]=Z(t,e,s);n=Math.min(n,c),r=Math.min(r,l),i=Math.max(i,c),a=Math.max(a,l),o=!0};for(let t=0;t<e.length;){let n=e[t++];if(n===zt){if(t+1>=e.length)break;s=e[t++],c=e[t++],l=s,u=c,d=!0,f(s,c);continue}if(n===Bt){if(t+1>=e.length)break;let n=e[t++],r=e[t++];f(s,c),f(n,r),s=n,c=r;continue}if(n===Vt){if(t+5>=e.length)break;let n=e[t++],r=e[t++],i=e[t++],a=e[t++],o=e[t++],l=e[t++];f(s,c),f(n,r),f(i,a),f(o,l),s=o,c=l;continue}if(n===Ht){if(t+3>=e.length)break;let n=e[t++],r=e[t++],i=e[t++],a=e[t++];f(s,c),f(n,r),f(i,a),s=i,c=a;continue}if(n===Ut){d&&(f(s,c),f(l,u),s=l,c=u);continue}break}return o?{minX:n,minY:r,maxX:i,maxY:a}:null}function Ir(){return{sourceTextCount:0,instanceCount:0,glyphCount:0,glyphSegmentCount:0,inPageCount:0,outOfPageCount:0,instanceA:new Float32Array,instanceB:new Float32Array,instanceC:new Float32Array,glyphMetaA:new Float32Array,glyphMetaB:new Float32Array,glyphSegmentsA:new Float32Array,glyphSegmentsB:new Float32Array,bounds:null}}function Lr(e){let t=e;return!t.commonObjs||typeof t.commonObjs.get!=`function`?null:t.commonObjs}function Rr(e){for(let t of e.fnArray)if(t===q.showText||t===q.showSpacedText||t===q.nextLineShowText||t===q.nextLineSetSpacingShowText)return!0;return!1}function zr(e){let t=0;for(let n of e.fnArray)Vr(n)&&(t+=1);return t}async function Br(e){if(typeof document>`u`)return;let t=e;if(!Array.isArray(t.view)||typeof t.getViewport!=`function`||typeof t.render!=`function`)return;let n=Math.max(1,Math.abs(t.view[2]-t.view[0])),r=Math.max(1,Math.abs(t.view[3]-t.view[1])),i=Q(1024/Math.max(n,r))*.95+.05,a=t.getViewport({scale:i,rotation:cr(t.rotate),dontFlip:!0}),o=Math.max(1,Math.ceil(a.width)),s=Math.max(1,Math.ceil(a.height)),c=document.createElement(`canvas`);c.width=o,c.height=s;let l=c.getContext(`2d`,{alpha:!1});if(l)try{await t.render({canvasContext:l,viewport:a,intent:`display`}).promise}catch{}finally{c.width=0,c.height=0}}function Vr(e){return e===q.paintImageXObject||e===q.paintInlineImageXObject||e===q.paintInlineImageXObjectGroup||e===q.paintImageXObjectRepeat||e===q.paintImageMaskXObject||e===q.paintImageMaskXObjectGroup||e===q.paintImageMaskXObjectRepeat||e===q.paintSolidColorImageMask||e===q.beginInlineImage||e===q.beginImageData||e===q.endInlineImage}function Hr(e,t){return e===q.dependency||e===q.save||e===q.restore||e===q.transform||e===q.setGState||e===q.beginGroup||e===q.endGroup||e===q.beginCompat||e===q.endCompat||e===q.beginMarkedContent||e===q.beginMarkedContentProps||e===q.endMarkedContent||e===q.paintFormXObjectBegin||e===q.paintFormXObjectEnd||e===q.paintXObject||e===q.clip||e===q.eoClip||e===q.endPath||e===q.setFillRGBColor||e===q.setFillColor||e===q.setFillGray||e===q.setFillCMYKColor||e===q.setFillColorN||e===q.setFillColorSpace||e===q.setFillTransparent||e===q.setStrokeRGBColor||e===q.setStrokeColor||e===q.setStrokeGray||e===q.setStrokeCMYKColor||e===q.setStrokeColorN||e===q.setStrokeColorSpace||e===q.setStrokeTransparent?!0:e===q.constructPath?Y(t,0,-1)===q.endPath:!1}function Ur(e){let t=new Uint8Array(e.fnArray.length),n=!1,r=!1;for(let i=0;i<e.fnArray.length;i+=1){let a=e.fnArray[i],o=e.argsArray[i];if(Vr(a)){n=!0,t[i]=1;continue}(a===q.paintFormXObjectBegin||a===q.paintFormXObjectEnd||a===q.paintXObject)&&(r=!0),Hr(a,o)&&(t[i]=1)}return{hasImagePaintOps:n,hasFormXObjectOps:r,imageOnlyMask:t}}function Wr(e){let t=[],n=[...Wt],r=1;for(let i=0;i<e.fnArray.length;i+=1){let a=e.fnArray[i],o=e.argsArray[i];if(a===q.save){t.push([...n]);continue}if(a===q.restore){let e=t.pop();e&&(n=e);continue}if(a===q.transform){let e=pr(o);e&&(n=xi(n,e));continue}if(!Vr(a))continue;let s=Gr(a,o);if(!s)continue;let c=Math.hypot(n[0],n[1]),l=Math.hypot(n[2],n[3]);if(!Number.isFinite(c)||!Number.isFinite(l)||c<=1e-5||l<=1e-5)continue;let u=s.width/c,d=s.height/l;Number.isFinite(u)&&u>r&&(r=u),Number.isFinite(d)&&d>r&&(r=d)}return Number.isFinite(r)?Math.max(1,r):1}function Gr(e,t){if(e===q.paintImageXObject||e===q.paintImageXObjectRepeat){let e=Y(t,1,NaN),n=Y(t,2,NaN);if(e>0&&n>0)return{width:e,height:n}}if(e===q.paintInlineImageXObject){let e=gr(t,0),n=Number(e?.width),r=Number(e?.height);if(n>0&&r>0)return{width:n,height:r}}if(e===q.paintImageMaskXObject||e===q.paintImageMaskXObjectRepeat){let e=Y(t,1,NaN),n=Y(t,2,NaN);if(e>0&&n>0)return{width:e,height:n}}return null}function Kr(){return{width:0,height:0,data:new Uint8Array,matrix:[...Wt],bounds:null}}async function qr(e,t,n,r){let i=Ur(t);if(!i.hasImagePaintOps&&!(r.allowFullPageFallback&&i.hasFormXObjectOps))return Kr();let a=e;if(!Array.isArray(a.view)||typeof a.getViewport!=`function`||typeof a.render!=`function`)return Kr();let o=a.getViewport({scale:1,rotation:cr(a.rotate),dontFlip:!1}),s=Wr(t),c=ur(Math.max(1,Math.ceil(o.width)),Math.max(1,Math.ceil(o.height)),s),l=c===1?o:a.getViewport({scale:c,rotation:cr(a.rotate),dontFlip:!1}),u=Math.max(1,Math.ceil(l.width)),d=Math.max(1,Math.ceil(l.height));if(!Number.isFinite(u)||!Number.isFinite(d)||u<=0||d<=0)return Kr();let f=null;return i.hasImagePaintOps&&(f=await Xr(a,l,i.imageOnlyMask),f&&Zr(f))?Qr(u,d,f,l,n):!r.allowFullPageFallback||!i.hasFormXObjectOps||(f=await Xr(a,l),!f||!Zr(f))?Kr():Qr(u,d,f,l,n)}async function Jr(){if(fr!==void 0)return fr;if(typeof window<`u`)return fr=null,null;try{let t=await e(()=>import(`@napi-rs/canvas`),[],import.meta.url);return typeof t.createCanvas==`function`?(fr={createCanvas:t.createCanvas},fr):(fr=null,null)}catch{return fr=null,null}}async function Yr(e,t){if(typeof document<`u`){let n=document.createElement(`canvas`);n.width=e,n.height=t;let r=n.getContext(`2d`,{alpha:!0,willReadFrequently:!0});return r?{context:r,dispose:()=>{n.width=0,n.height=0}}:null}let n=await Jr();if(!n)return null;let r=n.createCanvas(e,t),i=r.getContext(`2d`);return!i||typeof i.getImageData!=`function`?null:{context:i,dispose:()=>{r.width=0,r.height=0}}}async function Xr(e,t,n){let r=t,i=Math.max(1,Math.ceil(Number(r.width)||1)),a=Math.max(1,Math.ceil(Number(r.height)||1)),o=await Yr(i,a);if(!o)return null;let s=o.context;try{let r={canvasContext:s,viewport:t,intent:`display`,background:`rgba(0,0,0,0)`};n&&(r.operationsFilter=e=>e>=0&&e<n.length&&n[e]===1),await e.render(r).promise}catch{return o.dispose(),null}let c=s.getImageData(0,0,i,a),l=new Uint8Array(c.data instanceof Uint8ClampedArray?c.data:new Uint8Array(c.data));return o.dispose(),l}function Zr(e){for(let t=3;t<e.length;t+=4)if(e[t]>0)return!0;return!1}function Qr(e,t,n,r,i){let a=xi(i,xi(Si(pr(r.transform)??[...Wt])??[...Wt],[e,0,0,t,0,0]));return{width:e,height:t,data:n,matrix:a,bounds:sr({minX:0,minY:0,maxX:1,maxY:1},a)}}function $r(e){return{matrix:[...e],fillR:0,fillG:0,fillB:0,fillAlpha:1,textMatrix:[...Wt],textX:0,textY:0,lineX:0,lineY:0,charSpacing:0,wordSpacing:0,textHScale:1,leading:0,textRise:0,renderMode:hn,fontRef:``,fontSize:0,fontDirection:1}}function ei(e){return{matrix:[...e.matrix],fillR:e.fillR,fillG:e.fillG,fillB:e.fillB,fillAlpha:e.fillAlpha,textMatrix:[...e.textMatrix],textX:e.textX,textY:e.textY,lineX:e.lineX,lineY:e.lineY,charSpacing:e.charSpacing,wordSpacing:e.wordSpacing,textHScale:e.textHScale,leading:e.leading,textRise:e.textRise,renderMode:e.renderMode,fontRef:e.fontRef,fontSize:e.fontSize,fontDirection:e.fontDirection}}function ti(e){e.textMatrix=[...Wt],e.textX=0,e.textY=0,e.lineX=0,e.lineY=0}function ni(e,t,n){e.lineX+=t,e.lineY+=n,e.textX=e.lineX,e.textY=e.lineY}function ri(e,t){if(Array.isArray(e))for(let n of e){if(!Array.isArray(n)||n.length<2)continue;let e=n[0],r=n[1];if(e===`ca`){let e=Number(r);Number.isFinite(e)&&(t.fillAlpha=Q(e));continue}if(e===`Font`&&Array.isArray(r)){let e=r[0],n=Number(r[1]);typeof e==`string`&&(t.fontRef=e),Number.isFinite(n)&&(n<0?(t.fontSize=-n,t.fontDirection=-1):(t.fontSize=n,t.fontDirection=1))}}}function ii(e){return e===hn||e===gn||e===_n||e===vn}function ai(e,t){if(!t||e.isSpace===!0)return!0;let n=typeof e.unicode==`string`?e.unicode:``;return n.length>0&&n.trim().length===0}function oi(e){return Array.isArray(e)?e:[]}function si(e,t){if(!t)return null;try{let n=e.get(t);return!n||typeof n!=`object`?null:n}catch{return null}}function ci(e){let t=e?.fontMatrix;if(Array.isArray(t)&&t.length>=1){let e=Number(t[0]);if(Number.isFinite(e)&&e!==0)return e}return on}function li(e,t,n){let r=`${t}_path_${n}`,i;try{i=e.get(r)}catch{return null}let a=i?.path;return ui(a)}function ui(e){if(!e)return null;if(e instanceof Float32Array)return e;if(ArrayBuffer.isView(e)){let t=e,n=new Float32Array(t.length);for(let e=0;e<t.length;e+=1){let r=Number(t[e]);n[e]=Number.isFinite(r)?r:0}return n}if(Array.isArray(e)){let t=new Float32Array(e.length);for(let n=0;n<e.length;n+=1){let r=Number(e[n]);t[n]=Number.isFinite(r)?r:0}return t}return null}function di(e,t,n){let r=0,i=0,a=0,o=0,s=0,c=!1,l={minX:1/0,minY:1/0,maxX:-1/0,maxY:-1/0},u=(e,i,a,o)=>{let s=a-e,c=o-i;s*s+c*c<1e-12||(t.push(e,i,a,o),n.push(a,o,yn,0),r+=1,l.minX=Math.min(l.minX,e,a),l.minY=Math.min(l.minY,i,o),l.maxX=Math.max(l.maxX,e,a),l.maxY=Math.max(l.maxY,i,o))},d=(e,i,a,o,s,c)=>{let u=s-e,d=c-i,f=a-e,p=o-i;u*u+d*d<1e-12&&f*f+p*p<1e-12||(t.push(e,i,a,o),n.push(s,c,bn,0),r+=1,l.minX=Math.min(l.minX,e,a,s),l.minY=Math.min(l.minY,i,o,c),l.maxX=Math.max(l.maxX,e,a,s),l.maxY=Math.max(l.maxY,i,o,c))};for(let t=0;t<e.length;){let n=e[t++];if(n===zt){i=e[t++],a=e[t++],o=i,s=a,c=!0;continue}if(n===Bt){let n=e[t++],r=e[t++];u(i,a,n,r),i=n,a=r;continue}if(n===Vt){let n=e[t++],r=e[t++],o=e[t++],s=e[t++],c=e[t++],l=e[t++];fi(i,a,n,r,o,s,c,l,d,nn,rn),i=c,a=l;continue}if(n===Ht){let n=e[t++],r=e[t++],o=e[t++],s=e[t++];d(i,a,n,r,o,s),i=o,a=s;continue}if(n===Ut){c&&(i!==o||a!==s)&&u(i,a,o,s),i=o,a=s;continue}break}return r===0?{segmentCount:0,bounds:{minX:0,minY:0,maxX:0,maxY:0}}:{segmentCount:r,bounds:l}}function fi(e,t,n,r,i,a,o,s,c,l,u){let d=[e,t,n,r,i,a,o,s,0],f=l*l;for(;d.length>0;){let e=d.pop(),t=d.pop(),n=d.pop(),r=d.pop(),i=d.pop(),a=d.pop(),o=d.pop(),s=d.pop(),l=d.pop(),[p,m]=pi(l,s,o,a,i,r,n,t),h=mi(l,s,o,a,i,r,n,t,p,m);if(e>=u||h<=f){c(l,s,p,m,n,t);continue}let g=(l+o)*.5,_=(s+a)*.5,v=(o+i)*.5,y=(a+r)*.5,b=(i+n)*.5,x=(r+t)*.5,S=(g+v)*.5,C=(_+y)*.5,w=(v+b)*.5,T=(y+x)*.5,E=(S+w)*.5,D=(C+T)*.5,O=e+1;d.push(E,D,w,T,b,x,n,t,O),d.push(l,s,g,_,S,C,E,D,O)}}function pi(e,t,n,r,i,a,o,s){return[(3*(n+i)-e-o)*.25,(3*(r+a)-t-s)*.25]}function mi(e,t,n,r,i,a,o,s,c,l){let u=[.25,.5,.75],d=0;for(let f of u){let u=hi(e,t,n,r,i,a,o,s,f),p=gi(e,t,c,l,o,s,f),m=u[0]-p[0],h=u[1]-p[1],g=m*m+h*h;g>d&&(d=g)}return d}function hi(e,t,n,r,i,a,o,s,c){let l=1-c,u=l*l,d=u*l,f=c*c,p=f*c;return[d*e+3*u*c*n+3*l*f*i+p*o,d*t+3*u*c*r+3*l*f*a+p*s]}function gi(e,t,n,r,i,a,o){let s=1-o,c=s*s,l=o*o;return[c*e+2*s*o*n+l*i,c*t+2*s*o*r+l*a]}function _i(e,t,n){let r=e.matrix;return r=xi(r,e.textMatrix),r=xi(r,[1,0,0,1,e.textX,e.textY+e.textRise]),r=xi(r,[e.textHScale*e.fontDirection,0,0,e.fontDirection>0?-1:1,0,0]),r=xi(r,[1,0,0,1,t,n]),r=xi(r,[e.fontSize,0,0,-e.fontSize,0,0]),r}function vi(e,t){if(!e&&!t)return null;if(!e&&t)return{...t};if(e&&!t)return{...e};let n=e,r=t;return{minX:Math.min(n.minX,r.minX),minY:Math.min(n.minY,r.minY),maxX:Math.max(n.maxX,r.maxX),maxY:Math.max(n.maxY,r.maxY)}}function yi(e,t){return!(e.maxX<t.minX||e.minX>t.maxX||e.maxY<t.minY||e.minY>t.maxY)}function bi(e,t,n,r,i){let a=e*r-t*n;return a*a/i}function X(e,t){return Math.round(e*t)}function xi(e,t){return[e[0]*t[0]+e[2]*t[1],e[1]*t[0]+e[3]*t[1],e[0]*t[2]+e[2]*t[3],e[1]*t[2]+e[3]*t[3],e[0]*t[4]+e[2]*t[5]+e[4],e[1]*t[4]+e[3]*t[5]+e[5]]}function Si(e){let t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=t*i-n*r;if(!Number.isFinite(s)||Math.abs(s)<=1e-12)return null;let c=1/s;return[i*c,-n*c,-r*c,t*c,(r*o-i*a)*c,(n*a-t*o)*c]}function Ci(e){let t=(Math.hypot(e[0],e[1])+Math.hypot(e[2],e[3]))*.5;return Number.isFinite(t)&&t>0?t:1}function Z(e,t,n){return[e[0]*t+e[2]*n+e[4],e[1]*t+e[3]*n+e[5]]}function Q(e){return e<=0?0:e>=1?1:e}function wi(e,t,n){return e+(t-e)*n}function Ti(e){let t=null,n=!1,r=0,i=0,a=new Set,o=new Map,s=null,c=!1,l=0,u=0,d=0;function f(){n=!1,r=0,i=0,a.clear(),o.clear(),s=null,c=!1,l=0,u=0,d=0}function p(){o.clear(),s=null,c=!1,l=0,u=0,d=0}function m(t){t&&n&&e().endPanInteraction(),p(),f()}function h(){if(o.size<2)return null;let e=o.values(),t=e.next().value,n=e.next().value;if(!t||!n)return null;let r=n.x-t.x,i=n.y-t.y;return{distance:Math.hypot(r,i),centerX:(t.x+n.x)*.5,centerY:(t.y+n.y)*.5}}function g(e,t){if(e.hasPointerCapture(t))try{e.releasePointerCapture(t)}catch{}}function _(t){if(!o.has(t.pointerId)||!n)return;o.set(t.pointerId,{x:t.clientX,y:t.clientY});let a=e();if(o.size>=2){let e=h();if(!e)return;if(!c){c=!0,s=null,l=Math.max(e.distance,.001),u=e.centerX,d=e.centerY;return}let t=Math.max(l,.001),n=Math.max(e.distance,.001),r=n/t,i=e.centerX-u,o=e.centerY-d;(i!==0||o!==0)&&a.panByPixels(i,o),Number.isFinite(r)&&Math.abs(r-1)>1e-4&&a.zoomAtClientPoint(e.centerX,e.centerY,r),l=n,u=e.centerX,d=e.centerY;return}if(s===null){s=t.pointerId,r=t.clientX,i=t.clientY,c=!1,l=0;return}if(t.pointerId!==s)return;let f=t.clientX-r,p=t.clientY-i;r=t.clientX,i=t.clientY,a.panByPixels(f,p)}function v(e,t){if(o.delete(t.pointerId),a.delete(t.pointerId),g(e,t.pointerId),o.size>=2){let e=h();e&&(c=!0,s=null,l=Math.max(e.distance,.001),u=e.centerX,d=e.centerY);return}if(o.size===1){let e=o.entries().next().value;e?(s=e[0],r=e[1].x,i=e[1].y):s=null,c=!1,l=0,u=0,d=0;return}m(!0)}let y=f=>{let p=t;if(p){if(a.add(f.pointerId),n||(n=!0,e().beginPanInteraction()),f.pointerType===`touch`)if(o.set(f.pointerId,{x:f.clientX,y:f.clientY}),o.size===1)s=f.pointerId,c=!1,l=0,u=f.clientX,d=f.clientY,r=f.clientX,i=f.clientY;else{let e=h();e&&(c=!0,s=null,l=Math.max(e.distance,.001),u=e.centerX,d=e.centerY)}else r=f.clientX,i=f.clientY;p.setPointerCapture(f.pointerId)}},b=t=>{if(t.pointerType===`touch`){_(t);return}if(!n)return;let a=t.clientX-r,o=t.clientY-i;r=t.clientX,i=t.clientY,e().panByPixels(a,o)},x=e=>{let n=t;if(n){if(e.pointerType===`touch`){v(n,e);return}a.delete(e.pointerId),m(!0),g(n,e.pointerId)}},S=e=>{let n=t;if(n){if(e.pointerType===`touch`){v(n,e);return}a.delete(e.pointerId),m(!0),g(n,e.pointerId)}},C=e=>{if(a.delete(e.pointerId),e.pointerType===`touch`){o.has(e.pointerId)&&o.delete(e.pointerId),o.size===0&&m(!0);return}n&&m(!0)},w=t=>{t.preventDefault();let n=Math.exp(-t.deltaY*.0013);e().zoomAtClientPoint(t.clientX,t.clientY,n)};function T(e){t!==e&&(t&&E(),t=e,e.addEventListener(`pointerdown`,y),e.addEventListener(`pointermove`,b),e.addEventListener(`pointerup`,x),e.addEventListener(`pointercancel`,S),e.addEventListener(`lostpointercapture`,C),e.addEventListener(`wheel`,w,{passive:!1}))}function E(){let e=t;if(e){for(let t of a)g(e,t);e.removeEventListener(`pointerdown`,y),e.removeEventListener(`pointermove`,b),e.removeEventListener(`pointerup`,x),e.removeEventListener(`pointercancel`,S),e.removeEventListener(`lostpointercapture`,C),e.removeEventListener(`wheel`,w),t=null,m(!0)}}return{attach:T,detach:E,resetState:f}}var Ei=l(s(((e,t)=>{(function(n){typeof e==`object`&&t!==void 0?t.exports=n():typeof define==`function`&&define.amd?define([],n):(typeof window<`u`?window:typeof global<`u`?global:typeof self<`u`?self:this).JSZip=n()})(function(){return function e(t,n,r){function i(o,s){if(!n[o]){if(!t[o]){var c=typeof u==`function`&&u;if(!s&&c)return c(o,!0);if(a)return a(o,!0);var l=Error(`Cannot find module '`+o+`'`);throw l.code=`MODULE_NOT_FOUND`,l}var d=n[o]={exports:{}};t[o][0].call(d.exports,function(e){var n=t[o][1][e];return i(n||e)},d,d.exports,e,t,n,r)}return n[o].exports}for(var a=typeof u==`function`&&u,o=0;o<r.length;o++)i(r[o]);return i}({1:[function(e,t,n){var r=e(`./utils`),i=e(`./support`),a=`ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=`;n.encode=function(e){for(var t,n,i,o,s,c,l,u=[],d=0,f=e.length,p=f,m=r.getTypeOf(e)!==`string`;d<e.length;)p=f-d,i=m?(t=e[d++],n=d<f?e[d++]:0,d<f?e[d++]:0):(t=e.charCodeAt(d++),n=d<f?e.charCodeAt(d++):0,d<f?e.charCodeAt(d++):0),o=t>>2,s=(3&t)<<4|n>>4,c=1<p?(15&n)<<2|i>>6:64,l=2<p?63&i:64,u.push(a.charAt(o)+a.charAt(s)+a.charAt(c)+a.charAt(l));return u.join(``)},n.decode=function(e){var t,n,r,o,s,c,l=0,u=0,d=`data:`;if(e.substr(0,d.length)===d)throw Error(`Invalid base64 input, it looks like a data url.`);var f,p=3*(e=e.replace(/[^A-Za-z0-9+/=]/g,``)).length/4;if(e.charAt(e.length-1)===a.charAt(64)&&p--,e.charAt(e.length-2)===a.charAt(64)&&p--,p%1!=0)throw Error(`Invalid base64 input, bad content length.`);for(f=i.uint8array?new Uint8Array(0|p):Array(0|p);l<e.length;)t=a.indexOf(e.charAt(l++))<<2|(o=a.indexOf(e.charAt(l++)))>>4,n=(15&o)<<4|(s=a.indexOf(e.charAt(l++)))>>2,r=(3&s)<<6|(c=a.indexOf(e.charAt(l++))),f[u++]=t,s!==64&&(f[u++]=n),c!==64&&(f[u++]=r);return f}},{"./support":30,"./utils":32}],2:[function(e,t,n){var r=e(`./external`),i=e(`./stream/DataWorker`),a=e(`./stream/Crc32Probe`),o=e(`./stream/DataLengthProbe`);function s(e,t,n,r,i){this.compressedSize=e,this.uncompressedSize=t,this.crc32=n,this.compression=r,this.compressedContent=i}s.prototype={getContentWorker:function(){var e=new i(r.Promise.resolve(this.compressedContent)).pipe(this.compression.uncompressWorker()).pipe(new o(`data_length`)),t=this;return e.on(`end`,function(){if(this.streamInfo.data_length!==t.uncompressedSize)throw Error(`Bug : uncompressed data size mismatch`)}),e},getCompressedWorker:function(){return new i(r.Promise.resolve(this.compressedContent)).withStreamInfo(`compressedSize`,this.compressedSize).withStreamInfo(`uncompressedSize`,this.uncompressedSize).withStreamInfo(`crc32`,this.crc32).withStreamInfo(`compression`,this.compression)}},s.createWorkerFrom=function(e,t,n){return e.pipe(new a).pipe(new o(`uncompressedSize`)).pipe(t.compressWorker(n)).pipe(new o(`compressedSize`)).withStreamInfo(`compression`,t)},t.exports=s},{"./external":6,"./stream/Crc32Probe":25,"./stream/DataLengthProbe":26,"./stream/DataWorker":27}],3:[function(e,t,n){var r=e(`./stream/GenericWorker`);n.STORE={magic:`\0\0`,compressWorker:function(){return new r(`STORE compression`)},uncompressWorker:function(){return new r(`STORE decompression`)}},n.DEFLATE=e(`./flate`)},{"./flate":7,"./stream/GenericWorker":28}],4:[function(e,t,n){var r=e(`./utils`),i=function(){for(var e,t=[],n=0;n<256;n++){e=n;for(var r=0;r<8;r++)e=1&e?3988292384^e>>>1:e>>>1;t[n]=e}return t}();t.exports=function(e,t){return e!==void 0&&e.length?r.getTypeOf(e)===`string`?function(e,t,n,r){var a=i,o=r+n;e^=-1;for(var s=r;s<o;s++)e=e>>>8^a[255&(e^t.charCodeAt(s))];return-1^e}(0|t,e,e.length,0):function(e,t,n,r){var a=i,o=r+n;e^=-1;for(var s=r;s<o;s++)e=e>>>8^a[255&(e^t[s])];return-1^e}(0|t,e,e.length,0):0}},{"./utils":32}],5:[function(e,t,n){n.base64=!1,n.binary=!1,n.dir=!1,n.createFolders=!0,n.date=null,n.compression=null,n.compressionOptions=null,n.comment=null,n.unixPermissions=null,n.dosPermissions=null},{}],6:[function(e,t,n){var r=null;r=typeof Promise<`u`?Promise:e(`lie`),t.exports={Promise:r}},{lie:37}],7:[function(e,t,n){var r=typeof Uint8Array<`u`&&typeof Uint16Array<`u`&&typeof Uint32Array<`u`,i=e(`pako`),a=e(`./utils`),o=e(`./stream/GenericWorker`),s=r?`uint8array`:`array`;function c(e,t){o.call(this,`FlateWorker/`+e),this._pako=null,this._pakoAction=e,this._pakoOptions=t,this.meta={}}n.magic=`\b\0`,a.inherits(c,o),c.prototype.processChunk=function(e){this.meta=e.meta,this._pako===null&&this._createPako(),this._pako.push(a.transformTo(s,e.data),!1)},c.prototype.flush=function(){o.prototype.flush.call(this),this._pako===null&&this._createPako(),this._pako.push([],!0)},c.prototype.cleanUp=function(){o.prototype.cleanUp.call(this),this._pako=null},c.prototype._createPako=function(){this._pako=new i[this._pakoAction]({raw:!0,level:this._pakoOptions.level||-1});var e=this;this._pako.onData=function(t){e.push({data:t,meta:e.meta})}},n.compressWorker=function(e){return new c(`Deflate`,e)},n.uncompressWorker=function(){return new c(`Inflate`,{})}},{"./stream/GenericWorker":28,"./utils":32,pako:38}],8:[function(e,t,n){function r(e,t){var n,r=``;for(n=0;n<t;n++)r+=String.fromCharCode(255&e),e>>>=8;return r}function i(e,t,n,i,o,u){var d,f,p=e.file,m=e.compression,h=u!==s.utf8encode,g=a.transformTo(`string`,u(p.name)),_=a.transformTo(`string`,s.utf8encode(p.name)),v=p.comment,y=a.transformTo(`string`,u(v)),b=a.transformTo(`string`,s.utf8encode(v)),x=_.length!==p.name.length,S=b.length!==v.length,C=``,w=``,T=``,E=p.dir,D=p.date,O={crc32:0,compressedSize:0,uncompressedSize:0};t&&!n||(O.crc32=e.crc32,O.compressedSize=e.compressedSize,O.uncompressedSize=e.uncompressedSize);var k=0;t&&(k|=8),h||!x&&!S||(k|=2048);var A=0,j=0;E&&(A|=16),o===`UNIX`?(j=798,A|=function(e,t){var n=e;return e||(n=t?16893:33204),(65535&n)<<16}(p.unixPermissions,E)):(j=20,A|=function(e){return 63&(e||0)}(p.dosPermissions)),d=D.getUTCHours(),d<<=6,d|=D.getUTCMinutes(),d<<=5,d|=D.getUTCSeconds()/2,f=D.getUTCFullYear()-1980,f<<=4,f|=D.getUTCMonth()+1,f<<=5,f|=D.getUTCDate(),x&&(w=r(1,1)+r(c(g),4)+_,C+=`up`+r(w.length,2)+w),S&&(T=r(1,1)+r(c(y),4)+b,C+=`uc`+r(T.length,2)+T);var M=``;return M+=`
\0`,M+=r(k,2),M+=m.magic,M+=r(d,2),M+=r(f,2),M+=r(O.crc32,4),M+=r(O.compressedSize,4),M+=r(O.uncompressedSize,4),M+=r(g.length,2),M+=r(C.length,2),{fileRecord:l.LOCAL_FILE_HEADER+M+g+C,dirRecord:l.CENTRAL_FILE_HEADER+r(j,2)+M+r(y.length,2)+`\0\0\0\0`+r(A,4)+r(i,4)+g+C+y}}var a=e(`../utils`),o=e(`../stream/GenericWorker`),s=e(`../utf8`),c=e(`../crc32`),l=e(`../signature`);function u(e,t,n,r){o.call(this,`ZipFileWorker`),this.bytesWritten=0,this.zipComment=t,this.zipPlatform=n,this.encodeFileName=r,this.streamFiles=e,this.accumulate=!1,this.contentBuffer=[],this.dirRecords=[],this.currentSourceOffset=0,this.entriesCount=0,this.currentFile=null,this._sources=[]}a.inherits(u,o),u.prototype.push=function(e){var t=e.meta.percent||0,n=this.entriesCount,r=this._sources.length;this.accumulate?this.contentBuffer.push(e):(this.bytesWritten+=e.data.length,o.prototype.push.call(this,{data:e.data,meta:{currentFile:this.currentFile,percent:n?(t+100*(n-r-1))/n:100}}))},u.prototype.openedSource=function(e){this.currentSourceOffset=this.bytesWritten,this.currentFile=e.file.name;var t=this.streamFiles&&!e.file.dir;if(t){var n=i(e,t,!1,this.currentSourceOffset,this.zipPlatform,this.encodeFileName);this.push({data:n.fileRecord,meta:{percent:0}})}else this.accumulate=!0},u.prototype.closedSource=function(e){this.accumulate=!1;var t=this.streamFiles&&!e.file.dir,n=i(e,t,!0,this.currentSourceOffset,this.zipPlatform,this.encodeFileName);if(this.dirRecords.push(n.dirRecord),t)this.push({data:function(e){return l.DATA_DESCRIPTOR+r(e.crc32,4)+r(e.compressedSize,4)+r(e.uncompressedSize,4)}(e),meta:{percent:100}});else for(this.push({data:n.fileRecord,meta:{percent:0}});this.contentBuffer.length;)this.push(this.contentBuffer.shift());this.currentFile=null},u.prototype.flush=function(){for(var e=this.bytesWritten,t=0;t<this.dirRecords.length;t++)this.push({data:this.dirRecords[t],meta:{percent:100}});var n=this.bytesWritten-e,i=function(e,t,n,i,o){var s=a.transformTo(`string`,o(i));return l.CENTRAL_DIRECTORY_END+`\0\0\0\0`+r(e,2)+r(e,2)+r(t,4)+r(n,4)+r(s.length,2)+s}(this.dirRecords.length,n,e,this.zipComment,this.encodeFileName);this.push({data:i,meta:{percent:100}})},u.prototype.prepareNextSource=function(){this.previous=this._sources.shift(),this.openedSource(this.previous.streamInfo),this.isPaused?this.previous.pause():this.previous.resume()},u.prototype.registerPrevious=function(e){this._sources.push(e);var t=this;return e.on(`data`,function(e){t.processChunk(e)}),e.on(`end`,function(){t.closedSource(t.previous.streamInfo),t._sources.length?t.prepareNextSource():t.end()}),e.on(`error`,function(e){t.error(e)}),this},u.prototype.resume=function(){return!!o.prototype.resume.call(this)&&(!this.previous&&this._sources.length?(this.prepareNextSource(),!0):this.previous||this._sources.length||this.generatedError?void 0:(this.end(),!0))},u.prototype.error=function(e){var t=this._sources;if(!o.prototype.error.call(this,e))return!1;for(var n=0;n<t.length;n++)try{t[n].error(e)}catch{}return!0},u.prototype.lock=function(){o.prototype.lock.call(this);for(var e=this._sources,t=0;t<e.length;t++)e[t].lock()},t.exports=u},{"../crc32":4,"../signature":23,"../stream/GenericWorker":28,"../utf8":31,"../utils":32}],9:[function(e,t,n){var r=e(`../compressions`),i=e(`./ZipFileWorker`);n.generateWorker=function(e,t,n){var a=new i(t.streamFiles,n,t.platform,t.encodeFileName),o=0;try{e.forEach(function(e,n){o++;var i=function(e,t){var n=e||t,i=r[n];if(!i)throw Error(n+` is not a valid compression method !`);return i}(n.options.compression,t.compression),s=n.options.compressionOptions||t.compressionOptions||{},c=n.dir,l=n.date;n._compressWorker(i,s).withStreamInfo(`file`,{name:e,dir:c,date:l,comment:n.comment||``,unixPermissions:n.unixPermissions,dosPermissions:n.dosPermissions}).pipe(a)}),a.entriesCount=o}catch(e){a.error(e)}return a}},{"../compressions":3,"./ZipFileWorker":8}],10:[function(e,t,n){function r(){if(!(this instanceof r))return new r;if(arguments.length)throw Error(`The constructor with parameters has been removed in JSZip 3.0, please check the upgrade guide.`);this.files=Object.create(null),this.comment=null,this.root=``,this.clone=function(){var e=new r;for(var t in this)typeof this[t]!=`function`&&(e[t]=this[t]);return e}}(r.prototype=e(`./object`)).loadAsync=e(`./load`),r.support=e(`./support`),r.defaults=e(`./defaults`),r.version=`3.10.1`,r.loadAsync=function(e,t){return new r().loadAsync(e,t)},r.external=e(`./external`),t.exports=r},{"./defaults":5,"./external":6,"./load":11,"./object":15,"./support":30}],11:[function(e,t,n){var r=e(`./utils`),i=e(`./external`),a=e(`./utf8`),o=e(`./zipEntries`),s=e(`./stream/Crc32Probe`),c=e(`./nodejsUtils`);function l(e){return new i.Promise(function(t,n){var r=e.decompressed.getContentWorker().pipe(new s);r.on(`error`,function(e){n(e)}).on(`end`,function(){r.streamInfo.crc32===e.decompressed.crc32?t():n(Error(`Corrupted zip : CRC32 mismatch`))}).resume()})}t.exports=function(e,t){var n=this;return t=r.extend(t||{},{base64:!1,checkCRC32:!1,optimizedBinaryString:!1,createFolders:!1,decodeFileName:a.utf8decode}),c.isNode&&c.isStream(e)?i.Promise.reject(Error(`JSZip can't accept a stream when loading a zip file.`)):r.prepareContent(`the loaded zip file`,e,!0,t.optimizedBinaryString,t.base64).then(function(e){var n=new o(t);return n.load(e),n}).then(function(e){var n=[i.Promise.resolve(e)],r=e.files;if(t.checkCRC32)for(var a=0;a<r.length;a++)n.push(l(r[a]));return i.Promise.all(n)}).then(function(e){for(var i=e.shift(),a=i.files,o=0;o<a.length;o++){var s=a[o],c=s.fileNameStr,l=r.resolve(s.fileNameStr);n.file(l,s.decompressed,{binary:!0,optimizedBinaryString:!0,date:s.date,dir:s.dir,comment:s.fileCommentStr.length?s.fileCommentStr:null,unixPermissions:s.unixPermissions,dosPermissions:s.dosPermissions,createFolders:t.createFolders}),s.dir||(n.file(l).unsafeOriginalName=c)}return i.zipComment.length&&(n.comment=i.zipComment),n})}},{"./external":6,"./nodejsUtils":14,"./stream/Crc32Probe":25,"./utf8":31,"./utils":32,"./zipEntries":33}],12:[function(e,t,n){var r=e(`../utils`),i=e(`../stream/GenericWorker`);function a(e,t){i.call(this,`Nodejs stream input adapter for `+e),this._upstreamEnded=!1,this._bindStream(t)}r.inherits(a,i),a.prototype._bindStream=function(e){var t=this;(this._stream=e).pause(),e.on(`data`,function(e){t.push({data:e,meta:{percent:0}})}).on(`error`,function(e){t.isPaused?this.generatedError=e:t.error(e)}).on(`end`,function(){t.isPaused?t._upstreamEnded=!0:t.end()})},a.prototype.pause=function(){return!!i.prototype.pause.call(this)&&(this._stream.pause(),!0)},a.prototype.resume=function(){return!!i.prototype.resume.call(this)&&(this._upstreamEnded?this.end():this._stream.resume(),!0)},t.exports=a},{"../stream/GenericWorker":28,"../utils":32}],13:[function(e,t,n){var r=e(`readable-stream`).Readable;function i(e,t,n){r.call(this,t),this._helper=e;var i=this;e.on(`data`,function(e,t){i.push(e)||i._helper.pause(),n&&n(t)}).on(`error`,function(e){i.emit(`error`,e)}).on(`end`,function(){i.push(null)})}e(`../utils`).inherits(i,r),i.prototype._read=function(){this._helper.resume()},t.exports=i},{"../utils":32,"readable-stream":16}],14:[function(e,t,n){t.exports={isNode:typeof Buffer<`u`,newBufferFrom:function(e,t){if(Buffer.from&&Buffer.from!==Uint8Array.from)return Buffer.from(e,t);if(typeof e==`number`)throw Error(`The "data" argument must not be a number`);return new Buffer(e,t)},allocBuffer:function(e){if(Buffer.alloc)return Buffer.alloc(e);var t=new Buffer(e);return t.fill(0),t},isBuffer:function(e){return Buffer.isBuffer(e)},isStream:function(e){return e&&typeof e.on==`function`&&typeof e.pause==`function`&&typeof e.resume==`function`}}},{}],15:[function(e,t,n){function r(e,t,n){var r,i=a.getTypeOf(t),s=a.extend(n||{},c);s.date=s.date||new Date,s.compression!==null&&(s.compression=s.compression.toUpperCase()),typeof s.unixPermissions==`string`&&(s.unixPermissions=parseInt(s.unixPermissions,8)),s.unixPermissions&&16384&s.unixPermissions&&(s.dir=!0),s.dosPermissions&&16&s.dosPermissions&&(s.dir=!0),s.dir&&(e=h(e)),s.createFolders&&(r=m(e))&&g.call(this,r,!0);var d=i===`string`&&!1===s.binary&&!1===s.base64;n&&n.binary!==void 0||(s.binary=!d),(t instanceof l&&t.uncompressedSize===0||s.dir||!t||t.length===0)&&(s.base64=!1,s.binary=!0,t=``,s.compression=`STORE`,i=`string`);var _=null;_=t instanceof l||t instanceof o?t:f.isNode&&f.isStream(t)?new p(e,t):a.prepareContent(e,t,s.binary,s.optimizedBinaryString,s.base64);var v=new u(e,_,s);this.files[e]=v}var i=e(`./utf8`),a=e(`./utils`),o=e(`./stream/GenericWorker`),s=e(`./stream/StreamHelper`),c=e(`./defaults`),l=e(`./compressedObject`),u=e(`./zipObject`),d=e(`./generate`),f=e(`./nodejsUtils`),p=e(`./nodejs/NodejsStreamInputAdapter`),m=function(e){e.slice(-1)===`/`&&(e=e.substring(0,e.length-1));var t=e.lastIndexOf(`/`);return 0<t?e.substring(0,t):``},h=function(e){return e.slice(-1)!==`/`&&(e+=`/`),e},g=function(e,t){return t=t===void 0?c.createFolders:t,e=h(e),this.files[e]||r.call(this,e,null,{dir:!0,createFolders:t}),this.files[e]};function _(e){return Object.prototype.toString.call(e)===`[object RegExp]`}t.exports={load:function(){throw Error(`This method has been removed in JSZip 3.0, please check the upgrade guide.`)},forEach:function(e){var t,n,r;for(t in this.files)r=this.files[t],(n=t.slice(this.root.length,t.length))&&t.slice(0,this.root.length)===this.root&&e(n,r)},filter:function(e){var t=[];return this.forEach(function(n,r){e(n,r)&&t.push(r)}),t},file:function(e,t,n){if(arguments.length!==1)return e=this.root+e,r.call(this,e,t,n),this;if(_(e)){var i=e;return this.filter(function(e,t){return!t.dir&&i.test(e)})}var a=this.files[this.root+e];return a&&!a.dir?a:null},folder:function(e){if(!e)return this;if(_(e))return this.filter(function(t,n){return n.dir&&e.test(t)});var t=this.root+e,n=g.call(this,t),r=this.clone();return r.root=n.name,r},remove:function(e){e=this.root+e;var t=this.files[e];if(t||=(e.slice(-1)!==`/`&&(e+=`/`),this.files[e]),t&&!t.dir)delete this.files[e];else for(var n=this.filter(function(t,n){return n.name.slice(0,e.length)===e}),r=0;r<n.length;r++)delete this.files[n[r].name];return this},generate:function(){throw Error(`This method has been removed in JSZip 3.0, please check the upgrade guide.`)},generateInternalStream:function(e){var t,n={};try{if((n=a.extend(e||{},{streamFiles:!1,compression:`STORE`,compressionOptions:null,type:``,platform:`DOS`,comment:null,mimeType:`application/zip`,encodeFileName:i.utf8encode})).type=n.type.toLowerCase(),n.compression=n.compression.toUpperCase(),n.type===`binarystring`&&(n.type=`string`),!n.type)throw Error(`No output type specified.`);a.checkSupport(n.type),n.platform!==`darwin`&&n.platform!==`freebsd`&&n.platform!==`linux`&&n.platform!==`sunos`||(n.platform=`UNIX`),n.platform===`win32`&&(n.platform=`DOS`);var r=n.comment||this.comment||``;t=d.generateWorker(this,n,r)}catch(e){(t=new o(`error`)).error(e)}return new s(t,n.type||`string`,n.mimeType)},generateAsync:function(e,t){return this.generateInternalStream(e).accumulate(t)},generateNodeStream:function(e,t){return(e||={}).type||(e.type=`nodebuffer`),this.generateInternalStream(e).toNodejsStream(t)}}},{"./compressedObject":2,"./defaults":5,"./generate":9,"./nodejs/NodejsStreamInputAdapter":12,"./nodejsUtils":14,"./stream/GenericWorker":28,"./stream/StreamHelper":29,"./utf8":31,"./utils":32,"./zipObject":35}],16:[function(e,t,n){t.exports=e(`stream`)},{stream:void 0}],17:[function(e,t,n){var r=e(`./DataReader`);function i(e){r.call(this,e);for(var t=0;t<this.data.length;t++)e[t]=255&e[t]}e(`../utils`).inherits(i,r),i.prototype.byteAt=function(e){return this.data[this.zero+e]},i.prototype.lastIndexOfSignature=function(e){for(var t=e.charCodeAt(0),n=e.charCodeAt(1),r=e.charCodeAt(2),i=e.charCodeAt(3),a=this.length-4;0<=a;--a)if(this.data[a]===t&&this.data[a+1]===n&&this.data[a+2]===r&&this.data[a+3]===i)return a-this.zero;return-1},i.prototype.readAndCheckSignature=function(e){var t=e.charCodeAt(0),n=e.charCodeAt(1),r=e.charCodeAt(2),i=e.charCodeAt(3),a=this.readData(4);return t===a[0]&&n===a[1]&&r===a[2]&&i===a[3]},i.prototype.readData=function(e){if(this.checkOffset(e),e===0)return[];var t=this.data.slice(this.zero+this.index,this.zero+this.index+e);return this.index+=e,t},t.exports=i},{"../utils":32,"./DataReader":18}],18:[function(e,t,n){var r=e(`../utils`);function i(e){this.data=e,this.length=e.length,this.index=0,this.zero=0}i.prototype={checkOffset:function(e){this.checkIndex(this.index+e)},checkIndex:function(e){if(this.length<this.zero+e||e<0)throw Error(`End of data reached (data length = `+this.length+`, asked index = `+e+`). Corrupted zip ?`)},setIndex:function(e){this.checkIndex(e),this.index=e},skip:function(e){this.setIndex(this.index+e)},byteAt:function(){},readInt:function(e){var t,n=0;for(this.checkOffset(e),t=this.index+e-1;t>=this.index;t--)n=(n<<8)+this.byteAt(t);return this.index+=e,n},readString:function(e){return r.transformTo(`string`,this.readData(e))},readData:function(){},lastIndexOfSignature:function(){},readAndCheckSignature:function(){},readDate:function(){var e=this.readInt(4);return new Date(Date.UTC(1980+(e>>25&127),(e>>21&15)-1,e>>16&31,e>>11&31,e>>5&63,(31&e)<<1))}},t.exports=i},{"../utils":32}],19:[function(e,t,n){var r=e(`./Uint8ArrayReader`);function i(e){r.call(this,e)}e(`../utils`).inherits(i,r),i.prototype.readData=function(e){this.checkOffset(e);var t=this.data.slice(this.zero+this.index,this.zero+this.index+e);return this.index+=e,t},t.exports=i},{"../utils":32,"./Uint8ArrayReader":21}],20:[function(e,t,n){var r=e(`./DataReader`);function i(e){r.call(this,e)}e(`../utils`).inherits(i,r),i.prototype.byteAt=function(e){return this.data.charCodeAt(this.zero+e)},i.prototype.lastIndexOfSignature=function(e){return this.data.lastIndexOf(e)-this.zero},i.prototype.readAndCheckSignature=function(e){return e===this.readData(4)},i.prototype.readData=function(e){this.checkOffset(e);var t=this.data.slice(this.zero+this.index,this.zero+this.index+e);return this.index+=e,t},t.exports=i},{"../utils":32,"./DataReader":18}],21:[function(e,t,n){var r=e(`./ArrayReader`);function i(e){r.call(this,e)}e(`../utils`).inherits(i,r),i.prototype.readData=function(e){if(this.checkOffset(e),e===0)return new Uint8Array;var t=this.data.subarray(this.zero+this.index,this.zero+this.index+e);return this.index+=e,t},t.exports=i},{"../utils":32,"./ArrayReader":17}],22:[function(e,t,n){var r=e(`../utils`),i=e(`../support`),a=e(`./ArrayReader`),o=e(`./StringReader`),s=e(`./NodeBufferReader`),c=e(`./Uint8ArrayReader`);t.exports=function(e){var t=r.getTypeOf(e);return r.checkSupport(t),t!==`string`||i.uint8array?t===`nodebuffer`?new s(e):i.uint8array?new c(r.transformTo(`uint8array`,e)):new a(r.transformTo(`array`,e)):new o(e)}},{"../support":30,"../utils":32,"./ArrayReader":17,"./NodeBufferReader":19,"./StringReader":20,"./Uint8ArrayReader":21}],23:[function(e,t,n){n.LOCAL_FILE_HEADER=`PK`,n.CENTRAL_FILE_HEADER=`PK`,n.CENTRAL_DIRECTORY_END=`PK`,n.ZIP64_CENTRAL_DIRECTORY_LOCATOR=`PK\x07`,n.ZIP64_CENTRAL_DIRECTORY_END=`PK`,n.DATA_DESCRIPTOR=`PK\x07\b`},{}],24:[function(e,t,n){var r=e(`./GenericWorker`),i=e(`../utils`);function a(e){r.call(this,`ConvertWorker to `+e),this.destType=e}i.inherits(a,r),a.prototype.processChunk=function(e){this.push({data:i.transformTo(this.destType,e.data),meta:e.meta})},t.exports=a},{"../utils":32,"./GenericWorker":28}],25:[function(e,t,n){var r=e(`./GenericWorker`),i=e(`../crc32`);function a(){r.call(this,`Crc32Probe`),this.withStreamInfo(`crc32`,0)}e(`../utils`).inherits(a,r),a.prototype.processChunk=function(e){this.streamInfo.crc32=i(e.data,this.streamInfo.crc32||0),this.push(e)},t.exports=a},{"../crc32":4,"../utils":32,"./GenericWorker":28}],26:[function(e,t,n){var r=e(`../utils`),i=e(`./GenericWorker`);function a(e){i.call(this,`DataLengthProbe for `+e),this.propName=e,this.withStreamInfo(e,0)}r.inherits(a,i),a.prototype.processChunk=function(e){if(e){var t=this.streamInfo[this.propName]||0;this.streamInfo[this.propName]=t+e.data.length}i.prototype.processChunk.call(this,e)},t.exports=a},{"../utils":32,"./GenericWorker":28}],27:[function(e,t,n){var r=e(`../utils`),i=e(`./GenericWorker`);function a(e){i.call(this,`DataWorker`);var t=this;this.dataIsReady=!1,this.index=0,this.max=0,this.data=null,this.type=``,this._tickScheduled=!1,e.then(function(e){t.dataIsReady=!0,t.data=e,t.max=e&&e.length||0,t.type=r.getTypeOf(e),t.isPaused||t._tickAndRepeat()},function(e){t.error(e)})}r.inherits(a,i),a.prototype.cleanUp=function(){i.prototype.cleanUp.call(this),this.data=null},a.prototype.resume=function(){return!!i.prototype.resume.call(this)&&(!this._tickScheduled&&this.dataIsReady&&(this._tickScheduled=!0,r.delay(this._tickAndRepeat,[],this)),!0)},a.prototype._tickAndRepeat=function(){this._tickScheduled=!1,this.isPaused||this.isFinished||(this._tick(),this.isFinished||(r.delay(this._tickAndRepeat,[],this),this._tickScheduled=!0))},a.prototype._tick=function(){if(this.isPaused||this.isFinished)return!1;var e=null,t=Math.min(this.max,this.index+16384);if(this.index>=this.max)return this.end();switch(this.type){case`string`:e=this.data.substring(this.index,t);break;case`uint8array`:e=this.data.subarray(this.index,t);break;case`array`:case`nodebuffer`:e=this.data.slice(this.index,t)}return this.index=t,this.push({data:e,meta:{percent:this.max?this.index/this.max*100:0}})},t.exports=a},{"../utils":32,"./GenericWorker":28}],28:[function(e,t,n){function r(e){this.name=e||`default`,this.streamInfo={},this.generatedError=null,this.extraStreamInfo={},this.isPaused=!0,this.isFinished=!1,this.isLocked=!1,this._listeners={data:[],end:[],error:[]},this.previous=null}r.prototype={push:function(e){this.emit(`data`,e)},end:function(){if(this.isFinished)return!1;this.flush();try{this.emit(`end`),this.cleanUp(),this.isFinished=!0}catch(e){this.emit(`error`,e)}return!0},error:function(e){return!this.isFinished&&(this.isPaused?this.generatedError=e:(this.isFinished=!0,this.emit(`error`,e),this.previous&&this.previous.error(e),this.cleanUp()),!0)},on:function(e,t){return this._listeners[e].push(t),this},cleanUp:function(){this.streamInfo=this.generatedError=this.extraStreamInfo=null,this._listeners=[]},emit:function(e,t){if(this._listeners[e])for(var n=0;n<this._listeners[e].length;n++)this._listeners[e][n].call(this,t)},pipe:function(e){return e.registerPrevious(this)},registerPrevious:function(e){if(this.isLocked)throw Error(`The stream '`+this+`' has already been used.`);this.streamInfo=e.streamInfo,this.mergeStreamInfo(),this.previous=e;var t=this;return e.on(`data`,function(e){t.processChunk(e)}),e.on(`end`,function(){t.end()}),e.on(`error`,function(e){t.error(e)}),this},pause:function(){return!this.isPaused&&!this.isFinished&&(this.isPaused=!0,this.previous&&this.previous.pause(),!0)},resume:function(){if(!this.isPaused||this.isFinished)return!1;var e=this.isPaused=!1;return this.generatedError&&(this.error(this.generatedError),e=!0),this.previous&&this.previous.resume(),!e},flush:function(){},processChunk:function(e){this.push(e)},withStreamInfo:function(e,t){return this.extraStreamInfo[e]=t,this.mergeStreamInfo(),this},mergeStreamInfo:function(){for(var e in this.extraStreamInfo)Object.prototype.hasOwnProperty.call(this.extraStreamInfo,e)&&(this.streamInfo[e]=this.extraStreamInfo[e])},lock:function(){if(this.isLocked)throw Error(`The stream '`+this+`' has already been used.`);this.isLocked=!0,this.previous&&this.previous.lock()},toString:function(){var e=`Worker `+this.name;return this.previous?this.previous+` -> `+e:e}},t.exports=r},{}],29:[function(e,t,n){var r=e(`../utils`),i=e(`./ConvertWorker`),a=e(`./GenericWorker`),o=e(`../base64`),s=e(`../support`),c=e(`../external`),l=null;if(s.nodestream)try{l=e(`../nodejs/NodejsStreamOutputAdapter`)}catch{}function u(e,t){return new c.Promise(function(n,i){var a=[],s=e._internalType,c=e._outputType,l=e._mimeType;e.on(`data`,function(e,n){a.push(e),t&&t(n)}).on(`error`,function(e){a=[],i(e)}).on(`end`,function(){try{n(function(e,t,n){switch(e){case`blob`:return r.newBlob(r.transformTo(`arraybuffer`,t),n);case`base64`:return o.encode(t);default:return r.transformTo(e,t)}}(c,function(e,t){var n,r=0,i=null,a=0;for(n=0;n<t.length;n++)a+=t[n].length;switch(e){case`string`:return t.join(``);case`array`:return Array.prototype.concat.apply([],t);case`uint8array`:for(i=new Uint8Array(a),n=0;n<t.length;n++)i.set(t[n],r),r+=t[n].length;return i;case`nodebuffer`:return Buffer.concat(t);default:throw Error(`concat : unsupported type '`+e+`'`)}}(s,a),l))}catch(e){i(e)}a=[]}).resume()})}function d(e,t,n){var o=t;switch(t){case`blob`:case`arraybuffer`:o=`uint8array`;break;case`base64`:o=`string`}try{this._internalType=o,this._outputType=t,this._mimeType=n,r.checkSupport(o),this._worker=e.pipe(new i(o)),e.lock()}catch(e){this._worker=new a(`error`),this._worker.error(e)}}d.prototype={accumulate:function(e){return u(this,e)},on:function(e,t){var n=this;return e===`data`?this._worker.on(e,function(e){t.call(n,e.data,e.meta)}):this._worker.on(e,function(){r.delay(t,arguments,n)}),this},resume:function(){return r.delay(this._worker.resume,[],this._worker),this},pause:function(){return this._worker.pause(),this},toNodejsStream:function(e){if(r.checkSupport(`nodestream`),this._outputType!==`nodebuffer`)throw Error(this._outputType+` is not supported by this method`);return new l(this,{objectMode:this._outputType!==`nodebuffer`},e)}},t.exports=d},{"../base64":1,"../external":6,"../nodejs/NodejsStreamOutputAdapter":13,"../support":30,"../utils":32,"./ConvertWorker":24,"./GenericWorker":28}],30:[function(e,t,n){if(n.base64=!0,n.array=!0,n.string=!0,n.arraybuffer=typeof ArrayBuffer<`u`&&typeof Uint8Array<`u`,n.nodebuffer=typeof Buffer<`u`,n.uint8array=typeof Uint8Array<`u`,typeof ArrayBuffer>`u`)n.blob=!1;else{var r=new ArrayBuffer(0);try{n.blob=new Blob([r],{type:`application/zip`}).size===0}catch{try{var i=new(self.BlobBuilder||self.WebKitBlobBuilder||self.MozBlobBuilder||self.MSBlobBuilder);i.append(r),n.blob=i.getBlob(`application/zip`).size===0}catch{n.blob=!1}}}try{n.nodestream=!!e(`readable-stream`).Readable}catch{n.nodestream=!1}},{"readable-stream":16}],31:[function(e,t,n){for(var r=e(`./utils`),i=e(`./support`),a=e(`./nodejsUtils`),o=e(`./stream/GenericWorker`),s=Array(256),c=0;c<256;c++)s[c]=252<=c?6:248<=c?5:240<=c?4:224<=c?3:192<=c?2:1;s[254]=s[254]=1;function l(){o.call(this,`utf-8 decode`),this.leftOver=null}function u(){o.call(this,`utf-8 encode`)}n.utf8encode=function(e){return i.nodebuffer?a.newBufferFrom(e,`utf-8`):function(e){var t,n,r,a,o,s=e.length,c=0;for(a=0;a<s;a++)(64512&(n=e.charCodeAt(a)))==55296&&a+1<s&&(64512&(r=e.charCodeAt(a+1)))==56320&&(n=65536+(n-55296<<10)+(r-56320),a++),c+=n<128?1:n<2048?2:n<65536?3:4;for(t=i.uint8array?new Uint8Array(c):Array(c),a=o=0;o<c;a++)(64512&(n=e.charCodeAt(a)))==55296&&a+1<s&&(64512&(r=e.charCodeAt(a+1)))==56320&&(n=65536+(n-55296<<10)+(r-56320),a++),n<128?t[o++]=n:(n<2048?t[o++]=192|n>>>6:(n<65536?t[o++]=224|n>>>12:(t[o++]=240|n>>>18,t[o++]=128|n>>>12&63),t[o++]=128|n>>>6&63),t[o++]=128|63&n);return t}(e)},n.utf8decode=function(e){return i.nodebuffer?r.transformTo(`nodebuffer`,e).toString(`utf-8`):function(e){var t,n,i,a,o=e.length,c=Array(2*o);for(t=n=0;t<o;)if((i=e[t++])<128)c[n++]=i;else if(4<(a=s[i]))c[n++]=65533,t+=a-1;else{for(i&=a===2?31:a===3?15:7;1<a&&t<o;)i=i<<6|63&e[t++],a--;1<a?c[n++]=65533:i<65536?c[n++]=i:(i-=65536,c[n++]=55296|i>>10&1023,c[n++]=56320|1023&i)}return c.length!==n&&(c.subarray?c=c.subarray(0,n):c.length=n),r.applyFromCharCode(c)}(e=r.transformTo(i.uint8array?`uint8array`:`array`,e))},r.inherits(l,o),l.prototype.processChunk=function(e){var t=r.transformTo(i.uint8array?`uint8array`:`array`,e.data);if(this.leftOver&&this.leftOver.length){if(i.uint8array){var a=t;(t=new Uint8Array(a.length+this.leftOver.length)).set(this.leftOver,0),t.set(a,this.leftOver.length)}else t=this.leftOver.concat(t);this.leftOver=null}var o=function(e,t){var n;for((t||=e.length)>e.length&&(t=e.length),n=t-1;0<=n&&(192&e[n])==128;)n--;return n<0||n===0?t:n+s[e[n]]>t?n:t}(t),c=t;o!==t.length&&(i.uint8array?(c=t.subarray(0,o),this.leftOver=t.subarray(o,t.length)):(c=t.slice(0,o),this.leftOver=t.slice(o,t.length))),this.push({data:n.utf8decode(c),meta:e.meta})},l.prototype.flush=function(){this.leftOver&&this.leftOver.length&&(this.push({data:n.utf8decode(this.leftOver),meta:{}}),this.leftOver=null)},n.Utf8DecodeWorker=l,r.inherits(u,o),u.prototype.processChunk=function(e){this.push({data:n.utf8encode(e.data),meta:e.meta})},n.Utf8EncodeWorker=u},{"./nodejsUtils":14,"./stream/GenericWorker":28,"./support":30,"./utils":32}],32:[function(e,t,n){var r=e(`./support`),i=e(`./base64`),a=e(`./nodejsUtils`),o=e(`./external`);function s(e){return e}function c(e,t){for(var n=0;n<e.length;++n)t[n]=255&e.charCodeAt(n);return t}e(`setimmediate`),n.newBlob=function(e,t){n.checkSupport(`blob`);try{return new Blob([e],{type:t})}catch{try{var r=new(self.BlobBuilder||self.WebKitBlobBuilder||self.MozBlobBuilder||self.MSBlobBuilder);return r.append(e),r.getBlob(t)}catch{throw Error(`Bug : can't construct the Blob.`)}}};var l={stringifyByChunk:function(e,t,n){var r=[],i=0,a=e.length;if(a<=n)return String.fromCharCode.apply(null,e);for(;i<a;)t===`array`||t===`nodebuffer`?r.push(String.fromCharCode.apply(null,e.slice(i,Math.min(i+n,a)))):r.push(String.fromCharCode.apply(null,e.subarray(i,Math.min(i+n,a)))),i+=n;return r.join(``)},stringifyByChar:function(e){for(var t=``,n=0;n<e.length;n++)t+=String.fromCharCode(e[n]);return t},applyCanBeUsed:{uint8array:function(){try{return r.uint8array&&String.fromCharCode.apply(null,new Uint8Array(1)).length===1}catch{return!1}}(),nodebuffer:function(){try{return r.nodebuffer&&String.fromCharCode.apply(null,a.allocBuffer(1)).length===1}catch{return!1}}()}};function u(e){var t=65536,r=n.getTypeOf(e),i=!0;if(r===`uint8array`?i=l.applyCanBeUsed.uint8array:r===`nodebuffer`&&(i=l.applyCanBeUsed.nodebuffer),i)for(;1<t;)try{return l.stringifyByChunk(e,r,t)}catch{t=Math.floor(t/2)}return l.stringifyByChar(e)}function d(e,t){for(var n=0;n<e.length;n++)t[n]=e[n];return t}n.applyFromCharCode=u;var f={};f.string={string:s,array:function(e){return c(e,Array(e.length))},arraybuffer:function(e){return f.string.uint8array(e).buffer},uint8array:function(e){return c(e,new Uint8Array(e.length))},nodebuffer:function(e){return c(e,a.allocBuffer(e.length))}},f.array={string:u,array:s,arraybuffer:function(e){return new Uint8Array(e).buffer},uint8array:function(e){return new Uint8Array(e)},nodebuffer:function(e){return a.newBufferFrom(e)}},f.arraybuffer={string:function(e){return u(new Uint8Array(e))},array:function(e){return d(new Uint8Array(e),Array(e.byteLength))},arraybuffer:s,uint8array:function(e){return new Uint8Array(e)},nodebuffer:function(e){return a.newBufferFrom(new Uint8Array(e))}},f.uint8array={string:u,array:function(e){return d(e,Array(e.length))},arraybuffer:function(e){return e.buffer},uint8array:s,nodebuffer:function(e){return a.newBufferFrom(e)}},f.nodebuffer={string:u,array:function(e){return d(e,Array(e.length))},arraybuffer:function(e){return f.nodebuffer.uint8array(e).buffer},uint8array:function(e){return d(e,new Uint8Array(e.length))},nodebuffer:s},n.transformTo=function(e,t){return t||=``,e?(n.checkSupport(e),f[n.getTypeOf(t)][e](t)):t},n.resolve=function(e){for(var t=e.split(`/`),n=[],r=0;r<t.length;r++){var i=t[r];i===`.`||i===``&&r!==0&&r!==t.length-1||(i===`..`?n.pop():n.push(i))}return n.join(`/`)},n.getTypeOf=function(e){return typeof e==`string`?`string`:Object.prototype.toString.call(e)===`[object Array]`?`array`:r.nodebuffer&&a.isBuffer(e)?`nodebuffer`:r.uint8array&&e instanceof Uint8Array?`uint8array`:r.arraybuffer&&e instanceof ArrayBuffer?`arraybuffer`:void 0},n.checkSupport=function(e){if(!r[e.toLowerCase()])throw Error(e+` is not supported by this platform`)},n.MAX_VALUE_16BITS=65535,n.MAX_VALUE_32BITS=-1,n.pretty=function(e){var t,n,r=``;for(n=0;n<(e||``).length;n++)r+=`\\x`+((t=e.charCodeAt(n))<16?`0`:``)+t.toString(16).toUpperCase();return r},n.delay=function(e,t,n){setImmediate(function(){e.apply(n||null,t||[])})},n.inherits=function(e,t){function n(){}n.prototype=t.prototype,e.prototype=new n},n.extend=function(){var e,t,n={};for(e=0;e<arguments.length;e++)for(t in arguments[e])Object.prototype.hasOwnProperty.call(arguments[e],t)&&n[t]===void 0&&(n[t]=arguments[e][t]);return n},n.prepareContent=function(e,t,a,s,l){return o.Promise.resolve(t).then(function(e){return r.blob&&(e instanceof Blob||[`[object File]`,`[object Blob]`].indexOf(Object.prototype.toString.call(e))!==-1)&&typeof FileReader<`u`?new o.Promise(function(t,n){var r=new FileReader;r.onload=function(e){t(e.target.result)},r.onerror=function(e){n(e.target.error)},r.readAsArrayBuffer(e)}):e}).then(function(t){var u=n.getTypeOf(t);return u?(u===`arraybuffer`?t=n.transformTo(`uint8array`,t):u===`string`&&(l?t=i.decode(t):a&&!0!==s&&(t=function(e){return c(e,r.uint8array?new Uint8Array(e.length):Array(e.length))}(t))),t):o.Promise.reject(Error(`Can't read the data of '`+e+`'. Is it in a supported JavaScript type (String, Blob, ArrayBuffer, etc) ?`))})}},{"./base64":1,"./external":6,"./nodejsUtils":14,"./support":30,setimmediate:54}],33:[function(e,t,n){var r=e(`./reader/readerFor`),i=e(`./utils`),a=e(`./signature`),o=e(`./zipEntry`),s=e(`./support`);function c(e){this.files=[],this.loadOptions=e}c.prototype={checkSignature:function(e){if(!this.reader.readAndCheckSignature(e)){this.reader.index-=4;var t=this.reader.readString(4);throw Error(`Corrupted zip or bug: unexpected signature (`+i.pretty(t)+`, expected `+i.pretty(e)+`)`)}},isSignature:function(e,t){var n=this.reader.index;this.reader.setIndex(e);var r=this.reader.readString(4)===t;return this.reader.setIndex(n),r},readBlockEndOfCentral:function(){this.diskNumber=this.reader.readInt(2),this.diskWithCentralDirStart=this.reader.readInt(2),this.centralDirRecordsOnThisDisk=this.reader.readInt(2),this.centralDirRecords=this.reader.readInt(2),this.centralDirSize=this.reader.readInt(4),this.centralDirOffset=this.reader.readInt(4),this.zipCommentLength=this.reader.readInt(2);var e=this.reader.readData(this.zipCommentLength),t=s.uint8array?`uint8array`:`array`,n=i.transformTo(t,e);this.zipComment=this.loadOptions.decodeFileName(n)},readBlockZip64EndOfCentral:function(){this.zip64EndOfCentralSize=this.reader.readInt(8),this.reader.skip(4),this.diskNumber=this.reader.readInt(4),this.diskWithCentralDirStart=this.reader.readInt(4),this.centralDirRecordsOnThisDisk=this.reader.readInt(8),this.centralDirRecords=this.reader.readInt(8),this.centralDirSize=this.reader.readInt(8),this.centralDirOffset=this.reader.readInt(8),this.zip64ExtensibleData={};for(var e,t,n,r=this.zip64EndOfCentralSize-44;0<r;)e=this.reader.readInt(2),t=this.reader.readInt(4),n=this.reader.readData(t),this.zip64ExtensibleData[e]={id:e,length:t,value:n}},readBlockZip64EndOfCentralLocator:function(){if(this.diskWithZip64CentralDirStart=this.reader.readInt(4),this.relativeOffsetEndOfZip64CentralDir=this.reader.readInt(8),this.disksCount=this.reader.readInt(4),1<this.disksCount)throw Error(`Multi-volumes zip are not supported`)},readLocalFiles:function(){var e,t;for(e=0;e<this.files.length;e++)t=this.files[e],this.reader.setIndex(t.localHeaderOffset),this.checkSignature(a.LOCAL_FILE_HEADER),t.readLocalPart(this.reader),t.handleUTF8(),t.processAttributes()},readCentralDir:function(){var e;for(this.reader.setIndex(this.centralDirOffset);this.reader.readAndCheckSignature(a.CENTRAL_FILE_HEADER);)(e=new o({zip64:this.zip64},this.loadOptions)).readCentralPart(this.reader),this.files.push(e);if(this.centralDirRecords!==this.files.length&&this.centralDirRecords!==0&&this.files.length===0)throw Error(`Corrupted zip or bug: expected `+this.centralDirRecords+` records in central dir, got `+this.files.length)},readEndOfCentral:function(){var e=this.reader.lastIndexOfSignature(a.CENTRAL_DIRECTORY_END);if(e<0)throw this.isSignature(0,a.LOCAL_FILE_HEADER)?Error(`Corrupted zip: can't find end of central directory`):Error(`Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html`);this.reader.setIndex(e);var t=e;if(this.checkSignature(a.CENTRAL_DIRECTORY_END),this.readBlockEndOfCentral(),this.diskNumber===i.MAX_VALUE_16BITS||this.diskWithCentralDirStart===i.MAX_VALUE_16BITS||this.centralDirRecordsOnThisDisk===i.MAX_VALUE_16BITS||this.centralDirRecords===i.MAX_VALUE_16BITS||this.centralDirSize===i.MAX_VALUE_32BITS||this.centralDirOffset===i.MAX_VALUE_32BITS){if(this.zip64=!0,(e=this.reader.lastIndexOfSignature(a.ZIP64_CENTRAL_DIRECTORY_LOCATOR))<0)throw Error(`Corrupted zip: can't find the ZIP64 end of central directory locator`);if(this.reader.setIndex(e),this.checkSignature(a.ZIP64_CENTRAL_DIRECTORY_LOCATOR),this.readBlockZip64EndOfCentralLocator(),!this.isSignature(this.relativeOffsetEndOfZip64CentralDir,a.ZIP64_CENTRAL_DIRECTORY_END)&&(this.relativeOffsetEndOfZip64CentralDir=this.reader.lastIndexOfSignature(a.ZIP64_CENTRAL_DIRECTORY_END),this.relativeOffsetEndOfZip64CentralDir<0))throw Error(`Corrupted zip: can't find the ZIP64 end of central directory`);this.reader.setIndex(this.relativeOffsetEndOfZip64CentralDir),this.checkSignature(a.ZIP64_CENTRAL_DIRECTORY_END),this.readBlockZip64EndOfCentral()}var n=this.centralDirOffset+this.centralDirSize;this.zip64&&(n+=20,n+=12+this.zip64EndOfCentralSize);var r=t-n;if(0<r)this.isSignature(t,a.CENTRAL_FILE_HEADER)||(this.reader.zero=r);else if(r<0)throw Error(`Corrupted zip: missing `+Math.abs(r)+` bytes.`)},prepareReader:function(e){this.reader=r(e)},load:function(e){this.prepareReader(e),this.readEndOfCentral(),this.readCentralDir(),this.readLocalFiles()}},t.exports=c},{"./reader/readerFor":22,"./signature":23,"./support":30,"./utils":32,"./zipEntry":34}],34:[function(e,t,n){var r=e(`./reader/readerFor`),i=e(`./utils`),a=e(`./compressedObject`),o=e(`./crc32`),s=e(`./utf8`),c=e(`./compressions`),l=e(`./support`);function u(e,t){this.options=e,this.loadOptions=t}u.prototype={isEncrypted:function(){return(1&this.bitFlag)==1},useUTF8:function(){return(2048&this.bitFlag)==2048},readLocalPart:function(e){var t,n;if(e.skip(22),this.fileNameLength=e.readInt(2),n=e.readInt(2),this.fileName=e.readData(this.fileNameLength),e.skip(n),this.compressedSize===-1||this.uncompressedSize===-1)throw Error(`Bug or corrupted zip : didn't get enough information from the central directory (compressedSize === -1 || uncompressedSize === -1)`);if((t=function(e){for(var t in c)if(Object.prototype.hasOwnProperty.call(c,t)&&c[t].magic===e)return c[t];return null}(this.compressionMethod))===null)throw Error(`Corrupted zip : compression `+i.pretty(this.compressionMethod)+` unknown (inner file : `+i.transformTo(`string`,this.fileName)+`)`);this.decompressed=new a(this.compressedSize,this.uncompressedSize,this.crc32,t,e.readData(this.compressedSize))},readCentralPart:function(e){this.versionMadeBy=e.readInt(2),e.skip(2),this.bitFlag=e.readInt(2),this.compressionMethod=e.readString(2),this.date=e.readDate(),this.crc32=e.readInt(4),this.compressedSize=e.readInt(4),this.uncompressedSize=e.readInt(4);var t=e.readInt(2);if(this.extraFieldsLength=e.readInt(2),this.fileCommentLength=e.readInt(2),this.diskNumberStart=e.readInt(2),this.internalFileAttributes=e.readInt(2),this.externalFileAttributes=e.readInt(4),this.localHeaderOffset=e.readInt(4),this.isEncrypted())throw Error(`Encrypted zip are not supported`);e.skip(t),this.readExtraFields(e),this.parseZIP64ExtraField(e),this.fileComment=e.readData(this.fileCommentLength)},processAttributes:function(){this.unixPermissions=null,this.dosPermissions=null;var e=this.versionMadeBy>>8;this.dir=!!(16&this.externalFileAttributes),e==0&&(this.dosPermissions=63&this.externalFileAttributes),e==3&&(this.unixPermissions=this.externalFileAttributes>>16&65535),this.dir||this.fileNameStr.slice(-1)!==`/`||(this.dir=!0)},parseZIP64ExtraField:function(){if(this.extraFields[1]){var e=r(this.extraFields[1].value);this.uncompressedSize===i.MAX_VALUE_32BITS&&(this.uncompressedSize=e.readInt(8)),this.compressedSize===i.MAX_VALUE_32BITS&&(this.compressedSize=e.readInt(8)),this.localHeaderOffset===i.MAX_VALUE_32BITS&&(this.localHeaderOffset=e.readInt(8)),this.diskNumberStart===i.MAX_VALUE_32BITS&&(this.diskNumberStart=e.readInt(4))}},readExtraFields:function(e){var t,n,r,i=e.index+this.extraFieldsLength;for(this.extraFields||={};e.index+4<i;)t=e.readInt(2),n=e.readInt(2),r=e.readData(n),this.extraFields[t]={id:t,length:n,value:r};e.setIndex(i)},handleUTF8:function(){var e=l.uint8array?`uint8array`:`array`;if(this.useUTF8())this.fileNameStr=s.utf8decode(this.fileName),this.fileCommentStr=s.utf8decode(this.fileComment);else{var t=this.findExtraFieldUnicodePath();if(t!==null)this.fileNameStr=t;else{var n=i.transformTo(e,this.fileName);this.fileNameStr=this.loadOptions.decodeFileName(n)}var r=this.findExtraFieldUnicodeComment();if(r!==null)this.fileCommentStr=r;else{var a=i.transformTo(e,this.fileComment);this.fileCommentStr=this.loadOptions.decodeFileName(a)}}},findExtraFieldUnicodePath:function(){var e=this.extraFields[28789];if(e){var t=r(e.value);return t.readInt(1)===1&&o(this.fileName)===t.readInt(4)?s.utf8decode(t.readData(e.length-5)):null}return null},findExtraFieldUnicodeComment:function(){var e=this.extraFields[25461];if(e){var t=r(e.value);return t.readInt(1)===1&&o(this.fileComment)===t.readInt(4)?s.utf8decode(t.readData(e.length-5)):null}return null}},t.exports=u},{"./compressedObject":2,"./compressions":3,"./crc32":4,"./reader/readerFor":22,"./support":30,"./utf8":31,"./utils":32}],35:[function(e,t,n){function r(e,t,n){this.name=e,this.dir=n.dir,this.date=n.date,this.comment=n.comment,this.unixPermissions=n.unixPermissions,this.dosPermissions=n.dosPermissions,this._data=t,this._dataBinary=n.binary,this.options={compression:n.compression,compressionOptions:n.compressionOptions}}var i=e(`./stream/StreamHelper`),a=e(`./stream/DataWorker`),o=e(`./utf8`),s=e(`./compressedObject`),c=e(`./stream/GenericWorker`);r.prototype={internalStream:function(e){var t=null,n=`string`;try{if(!e)throw Error(`No output type specified.`);var r=(n=e.toLowerCase())===`string`||n===`text`;n!==`binarystring`&&n!==`text`||(n=`string`),t=this._decompressWorker();var a=!this._dataBinary;a&&!r&&(t=t.pipe(new o.Utf8EncodeWorker)),!a&&r&&(t=t.pipe(new o.Utf8DecodeWorker))}catch(e){(t=new c(`error`)).error(e)}return new i(t,n,``)},async:function(e,t){return this.internalStream(e).accumulate(t)},nodeStream:function(e,t){return this.internalStream(e||`nodebuffer`).toNodejsStream(t)},_compressWorker:function(e,t){if(this._data instanceof s&&this._data.compression.magic===e.magic)return this._data.getCompressedWorker();var n=this._decompressWorker();return this._dataBinary||(n=n.pipe(new o.Utf8EncodeWorker)),s.createWorkerFrom(n,e,t)},_decompressWorker:function(){return this._data instanceof s?this._data.getContentWorker():this._data instanceof c?this._data:new a(this._data)}};for(var l=[`asText`,`asBinary`,`asNodeBuffer`,`asUint8Array`,`asArrayBuffer`],u=function(){throw Error(`This method has been removed in JSZip 3.0, please check the upgrade guide.`)},d=0;d<l.length;d++)r.prototype[l[d]]=u;t.exports=r},{"./compressedObject":2,"./stream/DataWorker":27,"./stream/GenericWorker":28,"./stream/StreamHelper":29,"./utf8":31}],36:[function(e,t,n){(function(e){var n,r,i=e.MutationObserver||e.WebKitMutationObserver;if(i){var a=0,o=new i(u),s=e.document.createTextNode(``);o.observe(s,{characterData:!0}),n=function(){s.data=a=++a%2}}else if(e.setImmediate||e.MessageChannel===void 0)n=`document`in e&&`onreadystatechange`in e.document.createElement(`script`)?function(){var t=e.document.createElement(`script`);t.onreadystatechange=function(){u(),t.onreadystatechange=null,t.parentNode.removeChild(t),t=null},e.document.documentElement.appendChild(t)}:function(){setTimeout(u,0)};else{var c=new e.MessageChannel;c.port1.onmessage=u,n=function(){c.port2.postMessage(0)}}var l=[];function u(){var e,t;r=!0;for(var n=l.length;n;){for(t=l,l=[],e=-1;++e<n;)t[e]();n=l.length}r=!1}t.exports=function(e){l.push(e)!==1||r||n()}}).call(this,typeof global<`u`?global:typeof self<`u`?self:typeof window<`u`?window:{})},{}],37:[function(e,t,n){var r=e(`immediate`);function i(){}var a={},o=[`REJECTED`],s=[`FULFILLED`],c=[`PENDING`];function l(e){if(typeof e!=`function`)throw TypeError(`resolver must be a function`);this.state=c,this.queue=[],this.outcome=void 0,e!==i&&p(this,e)}function u(e,t,n){this.promise=e,typeof t==`function`&&(this.onFulfilled=t,this.callFulfilled=this.otherCallFulfilled),typeof n==`function`&&(this.onRejected=n,this.callRejected=this.otherCallRejected)}function d(e,t,n){r(function(){var r;try{r=t(n)}catch(t){return a.reject(e,t)}r===e?a.reject(e,TypeError(`Cannot resolve promise with itself`)):a.resolve(e,r)})}function f(e){var t=e&&e.then;if(e&&(typeof e==`object`||typeof e==`function`)&&typeof t==`function`)return function(){t.apply(e,arguments)}}function p(e,t){var n=!1;function r(t){n||(n=!0,a.reject(e,t))}function i(t){n||(n=!0,a.resolve(e,t))}var o=m(function(){t(i,r)});o.status===`error`&&r(o.value)}function m(e,t){var n={};try{n.value=e(t),n.status=`success`}catch(e){n.status=`error`,n.value=e}return n}(t.exports=l).prototype.finally=function(e){if(typeof e!=`function`)return this;var t=this.constructor;return this.then(function(n){return t.resolve(e()).then(function(){return n})},function(n){return t.resolve(e()).then(function(){throw n})})},l.prototype.catch=function(e){return this.then(null,e)},l.prototype.then=function(e,t){if(typeof e!=`function`&&this.state===s||typeof t!=`function`&&this.state===o)return this;var n=new this.constructor(i);return this.state===c?this.queue.push(new u(n,e,t)):d(n,this.state===s?e:t,this.outcome),n},u.prototype.callFulfilled=function(e){a.resolve(this.promise,e)},u.prototype.otherCallFulfilled=function(e){d(this.promise,this.onFulfilled,e)},u.prototype.callRejected=function(e){a.reject(this.promise,e)},u.prototype.otherCallRejected=function(e){d(this.promise,this.onRejected,e)},a.resolve=function(e,t){var n=m(f,t);if(n.status===`error`)return a.reject(e,n.value);var r=n.value;if(r)p(e,r);else{e.state=s,e.outcome=t;for(var i=-1,o=e.queue.length;++i<o;)e.queue[i].callFulfilled(t)}return e},a.reject=function(e,t){e.state=o,e.outcome=t;for(var n=-1,r=e.queue.length;++n<r;)e.queue[n].callRejected(t);return e},l.resolve=function(e){return e instanceof this?e:a.resolve(new this(i),e)},l.reject=function(e){var t=new this(i);return a.reject(t,e)},l.all=function(e){var t=this;if(Object.prototype.toString.call(e)!==`[object Array]`)return this.reject(TypeError(`must be an array`));var n=e.length,r=!1;if(!n)return this.resolve([]);for(var o=Array(n),s=0,c=-1,l=new this(i);++c<n;)u(e[c],c);return l;function u(e,i){t.resolve(e).then(function(e){o[i]=e,++s!==n||r||(r=!0,a.resolve(l,o))},function(e){r||(r=!0,a.reject(l,e))})}},l.race=function(e){var t=this;if(Object.prototype.toString.call(e)!==`[object Array]`)return this.reject(TypeError(`must be an array`));var n=e.length,r=!1;if(!n)return this.resolve([]);for(var o=-1,s=new this(i);++o<n;)c=e[o],t.resolve(c).then(function(e){r||(r=!0,a.resolve(s,e))},function(e){r||(r=!0,a.reject(s,e))});var c;return s}},{immediate:36}],38:[function(e,t,n){var r={};(0,e(`./lib/utils/common`).assign)(r,e(`./lib/deflate`),e(`./lib/inflate`),e(`./lib/zlib/constants`)),t.exports=r},{"./lib/deflate":39,"./lib/inflate":40,"./lib/utils/common":41,"./lib/zlib/constants":44}],39:[function(e,t,n){var r=e(`./zlib/deflate`),i=e(`./utils/common`),a=e(`./utils/strings`),o=e(`./zlib/messages`),s=e(`./zlib/zstream`),c=Object.prototype.toString,l=0,u=-1,d=0,f=8;function p(e){if(!(this instanceof p))return new p(e);this.options=i.assign({level:u,method:f,chunkSize:16384,windowBits:15,memLevel:8,strategy:d,to:``},e||{});var t=this.options;t.raw&&0<t.windowBits?t.windowBits=-t.windowBits:t.gzip&&0<t.windowBits&&t.windowBits<16&&(t.windowBits+=16),this.err=0,this.msg=``,this.ended=!1,this.chunks=[],this.strm=new s,this.strm.avail_out=0;var n=r.deflateInit2(this.strm,t.level,t.method,t.windowBits,t.memLevel,t.strategy);if(n!==l)throw Error(o[n]);if(t.header&&r.deflateSetHeader(this.strm,t.header),t.dictionary){var m;if(m=typeof t.dictionary==`string`?a.string2buf(t.dictionary):c.call(t.dictionary)===`[object ArrayBuffer]`?new Uint8Array(t.dictionary):t.dictionary,(n=r.deflateSetDictionary(this.strm,m))!==l)throw Error(o[n]);this._dict_set=!0}}function m(e,t){var n=new p(t);if(n.push(e,!0),n.err)throw n.msg||o[n.err];return n.result}p.prototype.push=function(e,t){var n,o,s=this.strm,u=this.options.chunkSize;if(this.ended)return!1;o=t===~~t?t:!0===t?4:0,typeof e==`string`?s.input=a.string2buf(e):c.call(e)===`[object ArrayBuffer]`?s.input=new Uint8Array(e):s.input=e,s.next_in=0,s.avail_in=s.input.length;do{if(s.avail_out===0&&(s.output=new i.Buf8(u),s.next_out=0,s.avail_out=u),(n=r.deflate(s,o))!==1&&n!==l)return this.onEnd(n),!(this.ended=!0);s.avail_out!==0&&(s.avail_in!==0||o!==4&&o!==2)||(this.options.to===`string`?this.onData(a.buf2binstring(i.shrinkBuf(s.output,s.next_out))):this.onData(i.shrinkBuf(s.output,s.next_out)))}while((0<s.avail_in||s.avail_out===0)&&n!==1);return o===4?(n=r.deflateEnd(this.strm),this.onEnd(n),this.ended=!0,n===l):o!==2||(this.onEnd(l),!(s.avail_out=0))},p.prototype.onData=function(e){this.chunks.push(e)},p.prototype.onEnd=function(e){e===l&&(this.options.to===`string`?this.result=this.chunks.join(``):this.result=i.flattenChunks(this.chunks)),this.chunks=[],this.err=e,this.msg=this.strm.msg},n.Deflate=p,n.deflate=m,n.deflateRaw=function(e,t){return(t||={}).raw=!0,m(e,t)},n.gzip=function(e,t){return(t||={}).gzip=!0,m(e,t)}},{"./utils/common":41,"./utils/strings":42,"./zlib/deflate":46,"./zlib/messages":51,"./zlib/zstream":53}],40:[function(e,t,n){var r=e(`./zlib/inflate`),i=e(`./utils/common`),a=e(`./utils/strings`),o=e(`./zlib/constants`),s=e(`./zlib/messages`),c=e(`./zlib/zstream`),l=e(`./zlib/gzheader`),u=Object.prototype.toString;function d(e){if(!(this instanceof d))return new d(e);this.options=i.assign({chunkSize:16384,windowBits:0,to:``},e||{});var t=this.options;t.raw&&0<=t.windowBits&&t.windowBits<16&&(t.windowBits=-t.windowBits,t.windowBits===0&&(t.windowBits=-15)),!(0<=t.windowBits&&t.windowBits<16)||e&&e.windowBits||(t.windowBits+=32),15<t.windowBits&&t.windowBits<48&&!(15&t.windowBits)&&(t.windowBits|=15),this.err=0,this.msg=``,this.ended=!1,this.chunks=[],this.strm=new c,this.strm.avail_out=0;var n=r.inflateInit2(this.strm,t.windowBits);if(n!==o.Z_OK)throw Error(s[n]);this.header=new l,r.inflateGetHeader(this.strm,this.header)}function f(e,t){var n=new d(t);if(n.push(e,!0),n.err)throw n.msg||s[n.err];return n.result}d.prototype.push=function(e,t){var n,s,c,l,d,f,p=this.strm,m=this.options.chunkSize,h=this.options.dictionary,g=!1;if(this.ended)return!1;s=t===~~t?t:!0===t?o.Z_FINISH:o.Z_NO_FLUSH,typeof e==`string`?p.input=a.binstring2buf(e):u.call(e)===`[object ArrayBuffer]`?p.input=new Uint8Array(e):p.input=e,p.next_in=0,p.avail_in=p.input.length;do{if(p.avail_out===0&&(p.output=new i.Buf8(m),p.next_out=0,p.avail_out=m),(n=r.inflate(p,o.Z_NO_FLUSH))===o.Z_NEED_DICT&&h&&(f=typeof h==`string`?a.string2buf(h):u.call(h)===`[object ArrayBuffer]`?new Uint8Array(h):h,n=r.inflateSetDictionary(this.strm,f)),n===o.Z_BUF_ERROR&&!0===g&&(n=o.Z_OK,g=!1),n!==o.Z_STREAM_END&&n!==o.Z_OK)return this.onEnd(n),!(this.ended=!0);p.next_out&&(p.avail_out!==0&&n!==o.Z_STREAM_END&&(p.avail_in!==0||s!==o.Z_FINISH&&s!==o.Z_SYNC_FLUSH)||(this.options.to===`string`?(c=a.utf8border(p.output,p.next_out),l=p.next_out-c,d=a.buf2string(p.output,c),p.next_out=l,p.avail_out=m-l,l&&i.arraySet(p.output,p.output,c,l,0),this.onData(d)):this.onData(i.shrinkBuf(p.output,p.next_out)))),p.avail_in===0&&p.avail_out===0&&(g=!0)}while((0<p.avail_in||p.avail_out===0)&&n!==o.Z_STREAM_END);return n===o.Z_STREAM_END&&(s=o.Z_FINISH),s===o.Z_FINISH?(n=r.inflateEnd(this.strm),this.onEnd(n),this.ended=!0,n===o.Z_OK):s!==o.Z_SYNC_FLUSH||(this.onEnd(o.Z_OK),!(p.avail_out=0))},d.prototype.onData=function(e){this.chunks.push(e)},d.prototype.onEnd=function(e){e===o.Z_OK&&(this.options.to===`string`?this.result=this.chunks.join(``):this.result=i.flattenChunks(this.chunks)),this.chunks=[],this.err=e,this.msg=this.strm.msg},n.Inflate=d,n.inflate=f,n.inflateRaw=function(e,t){return(t||={}).raw=!0,f(e,t)},n.ungzip=f},{"./utils/common":41,"./utils/strings":42,"./zlib/constants":44,"./zlib/gzheader":47,"./zlib/inflate":49,"./zlib/messages":51,"./zlib/zstream":53}],41:[function(e,t,n){var r=typeof Uint8Array<`u`&&typeof Uint16Array<`u`&&typeof Int32Array<`u`;n.assign=function(e){for(var t=Array.prototype.slice.call(arguments,1);t.length;){var n=t.shift();if(n){if(typeof n!=`object`)throw TypeError(n+`must be non-object`);for(var r in n)n.hasOwnProperty(r)&&(e[r]=n[r])}}return e},n.shrinkBuf=function(e,t){return e.length===t?e:e.subarray?e.subarray(0,t):(e.length=t,e)};var i={arraySet:function(e,t,n,r,i){if(t.subarray&&e.subarray)e.set(t.subarray(n,n+r),i);else for(var a=0;a<r;a++)e[i+a]=t[n+a]},flattenChunks:function(e){var t,n,r,i,a,o;for(t=r=0,n=e.length;t<n;t++)r+=e[t].length;for(o=new Uint8Array(r),t=i=0,n=e.length;t<n;t++)a=e[t],o.set(a,i),i+=a.length;return o}},a={arraySet:function(e,t,n,r,i){for(var a=0;a<r;a++)e[i+a]=t[n+a]},flattenChunks:function(e){return[].concat.apply([],e)}};n.setTyped=function(e){e?(n.Buf8=Uint8Array,n.Buf16=Uint16Array,n.Buf32=Int32Array,n.assign(n,i)):(n.Buf8=Array,n.Buf16=Array,n.Buf32=Array,n.assign(n,a))},n.setTyped(r)},{}],42:[function(e,t,n){var r=e(`./common`),i=!0,a=!0;try{String.fromCharCode.apply(null,[0])}catch{i=!1}try{String.fromCharCode.apply(null,new Uint8Array(1))}catch{a=!1}for(var o=new r.Buf8(256),s=0;s<256;s++)o[s]=252<=s?6:248<=s?5:240<=s?4:224<=s?3:192<=s?2:1;function c(e,t){if(t<65537&&(e.subarray&&a||!e.subarray&&i))return String.fromCharCode.apply(null,r.shrinkBuf(e,t));for(var n=``,o=0;o<t;o++)n+=String.fromCharCode(e[o]);return n}o[254]=o[254]=1,n.string2buf=function(e){var t,n,i,a,o,s=e.length,c=0;for(a=0;a<s;a++)(64512&(n=e.charCodeAt(a)))==55296&&a+1<s&&(64512&(i=e.charCodeAt(a+1)))==56320&&(n=65536+(n-55296<<10)+(i-56320),a++),c+=n<128?1:n<2048?2:n<65536?3:4;for(t=new r.Buf8(c),a=o=0;o<c;a++)(64512&(n=e.charCodeAt(a)))==55296&&a+1<s&&(64512&(i=e.charCodeAt(a+1)))==56320&&(n=65536+(n-55296<<10)+(i-56320),a++),n<128?t[o++]=n:(n<2048?t[o++]=192|n>>>6:(n<65536?t[o++]=224|n>>>12:(t[o++]=240|n>>>18,t[o++]=128|n>>>12&63),t[o++]=128|n>>>6&63),t[o++]=128|63&n);return t},n.buf2binstring=function(e){return c(e,e.length)},n.binstring2buf=function(e){for(var t=new r.Buf8(e.length),n=0,i=t.length;n<i;n++)t[n]=e.charCodeAt(n);return t},n.buf2string=function(e,t){var n,r,i,a,s=t||e.length,l=Array(2*s);for(n=r=0;n<s;)if((i=e[n++])<128)l[r++]=i;else if(4<(a=o[i]))l[r++]=65533,n+=a-1;else{for(i&=a===2?31:a===3?15:7;1<a&&n<s;)i=i<<6|63&e[n++],a--;1<a?l[r++]=65533:i<65536?l[r++]=i:(i-=65536,l[r++]=55296|i>>10&1023,l[r++]=56320|1023&i)}return c(l,r)},n.utf8border=function(e,t){var n;for((t||=e.length)>e.length&&(t=e.length),n=t-1;0<=n&&(192&e[n])==128;)n--;return n<0||n===0?t:n+o[e[n]]>t?n:t}},{"./common":41}],43:[function(e,t,n){t.exports=function(e,t,n,r){for(var i=65535&e|0,a=e>>>16&65535|0,o=0;n!==0;){for(n-=o=2e3<n?2e3:n;a=a+(i=i+t[r++]|0)|0,--o;);i%=65521,a%=65521}return i|a<<16|0}},{}],44:[function(e,t,n){t.exports={Z_NO_FLUSH:0,Z_PARTIAL_FLUSH:1,Z_SYNC_FLUSH:2,Z_FULL_FLUSH:3,Z_FINISH:4,Z_BLOCK:5,Z_TREES:6,Z_OK:0,Z_STREAM_END:1,Z_NEED_DICT:2,Z_ERRNO:-1,Z_STREAM_ERROR:-2,Z_DATA_ERROR:-3,Z_BUF_ERROR:-5,Z_NO_COMPRESSION:0,Z_BEST_SPEED:1,Z_BEST_COMPRESSION:9,Z_DEFAULT_COMPRESSION:-1,Z_FILTERED:1,Z_HUFFMAN_ONLY:2,Z_RLE:3,Z_FIXED:4,Z_DEFAULT_STRATEGY:0,Z_BINARY:0,Z_TEXT:1,Z_UNKNOWN:2,Z_DEFLATED:8}},{}],45:[function(e,t,n){var r=function(){for(var e,t=[],n=0;n<256;n++){e=n;for(var r=0;r<8;r++)e=1&e?3988292384^e>>>1:e>>>1;t[n]=e}return t}();t.exports=function(e,t,n,i){var a=r,o=i+n;e^=-1;for(var s=i;s<o;s++)e=e>>>8^a[255&(e^t[s])];return-1^e}},{}],46:[function(e,t,n){var r,i=e(`../utils/common`),a=e(`./trees`),o=e(`./adler32`),s=e(`./crc32`),c=e(`./messages`),l=0,u=4,d=0,f=-2,p=-1,m=4,h=2,g=8,_=9,v=286,y=30,b=19,x=2*v+1,S=15,C=3,w=258,T=w+C+1,E=42,D=113,O=1,k=2,A=3,j=4;function M(e,t){return e.msg=c[t],t}function N(e){return(e<<1)-(4<e?9:0)}function P(e){for(var t=e.length;0<=--t;)e[t]=0}function F(e){var t=e.state,n=t.pending;n>e.avail_out&&(n=e.avail_out),n!==0&&(i.arraySet(e.output,t.pending_buf,t.pending_out,n,e.next_out),e.next_out+=n,t.pending_out+=n,e.total_out+=n,e.avail_out-=n,t.pending-=n,t.pending===0&&(t.pending_out=0))}function I(e,t){a._tr_flush_block(e,0<=e.block_start?e.block_start:-1,e.strstart-e.block_start,t),e.block_start=e.strstart,F(e.strm)}function L(e,t){e.pending_buf[e.pending++]=t}function R(e,t){e.pending_buf[e.pending++]=t>>>8&255,e.pending_buf[e.pending++]=255&t}function z(e,t){var n,r,i=e.max_chain_length,a=e.strstart,o=e.prev_length,s=e.nice_match,c=e.strstart>e.w_size-T?e.strstart-(e.w_size-T):0,l=e.window,u=e.w_mask,d=e.prev,f=e.strstart+w,p=l[a+o-1],m=l[a+o];e.prev_length>=e.good_match&&(i>>=2),s>e.lookahead&&(s=e.lookahead);do if(l[(n=t)+o]===m&&l[n+o-1]===p&&l[n]===l[a]&&l[++n]===l[a+1]){a+=2,n++;do;while(l[++a]===l[++n]&&l[++a]===l[++n]&&l[++a]===l[++n]&&l[++a]===l[++n]&&l[++a]===l[++n]&&l[++a]===l[++n]&&l[++a]===l[++n]&&l[++a]===l[++n]&&a<f);if(r=w-(f-a),a=f-w,o<r){if(e.match_start=t,s<=(o=r))break;p=l[a+o-1],m=l[a+o]}}while((t=d[t&u])>c&&--i!=0);return o<=e.lookahead?o:e.lookahead}function B(e){var t,n,r,a,c,l,u,d,f,p,m=e.w_size;do{if(a=e.window_size-e.lookahead-e.strstart,e.strstart>=m+(m-T)){for(i.arraySet(e.window,e.window,m,m,0),e.match_start-=m,e.strstart-=m,e.block_start-=m,t=n=e.hash_size;r=e.head[--t],e.head[t]=m<=r?r-m:0,--n;);for(t=n=m;r=e.prev[--t],e.prev[t]=m<=r?r-m:0,--n;);a+=m}if(e.strm.avail_in===0)break;if(l=e.strm,u=e.window,d=e.strstart+e.lookahead,f=a,p=void 0,p=l.avail_in,f<p&&(p=f),n=p===0?0:(l.avail_in-=p,i.arraySet(u,l.input,l.next_in,p,d),l.state.wrap===1?l.adler=o(l.adler,u,p,d):l.state.wrap===2&&(l.adler=s(l.adler,u,p,d)),l.next_in+=p,l.total_in+=p,p),e.lookahead+=n,e.lookahead+e.insert>=C)for(c=e.strstart-e.insert,e.ins_h=e.window[c],e.ins_h=(e.ins_h<<e.hash_shift^e.window[c+1])&e.hash_mask;e.insert&&(e.ins_h=(e.ins_h<<e.hash_shift^e.window[c+C-1])&e.hash_mask,e.prev[c&e.w_mask]=e.head[e.ins_h],e.head[e.ins_h]=c,c++,e.insert--,!(e.lookahead+e.insert<C)););}while(e.lookahead<T&&e.strm.avail_in!==0)}function V(e,t){for(var n,r;;){if(e.lookahead<T){if(B(e),e.lookahead<T&&t===l)return O;if(e.lookahead===0)break}if(n=0,e.lookahead>=C&&(e.ins_h=(e.ins_h<<e.hash_shift^e.window[e.strstart+C-1])&e.hash_mask,n=e.prev[e.strstart&e.w_mask]=e.head[e.ins_h],e.head[e.ins_h]=e.strstart),n!==0&&e.strstart-n<=e.w_size-T&&(e.match_length=z(e,n)),e.match_length>=C)if(r=a._tr_tally(e,e.strstart-e.match_start,e.match_length-C),e.lookahead-=e.match_length,e.match_length<=e.max_lazy_match&&e.lookahead>=C){for(e.match_length--;e.strstart++,e.ins_h=(e.ins_h<<e.hash_shift^e.window[e.strstart+C-1])&e.hash_mask,n=e.prev[e.strstart&e.w_mask]=e.head[e.ins_h],e.head[e.ins_h]=e.strstart,--e.match_length!=0;);e.strstart++}else e.strstart+=e.match_length,e.match_length=0,e.ins_h=e.window[e.strstart],e.ins_h=(e.ins_h<<e.hash_shift^e.window[e.strstart+1])&e.hash_mask;else r=a._tr_tally(e,0,e.window[e.strstart]),e.lookahead--,e.strstart++;if(r&&(I(e,!1),e.strm.avail_out===0))return O}return e.insert=e.strstart<C-1?e.strstart:C-1,t===u?(I(e,!0),e.strm.avail_out===0?A:j):e.last_lit&&(I(e,!1),e.strm.avail_out===0)?O:k}function H(e,t){for(var n,r,i;;){if(e.lookahead<T){if(B(e),e.lookahead<T&&t===l)return O;if(e.lookahead===0)break}if(n=0,e.lookahead>=C&&(e.ins_h=(e.ins_h<<e.hash_shift^e.window[e.strstart+C-1])&e.hash_mask,n=e.prev[e.strstart&e.w_mask]=e.head[e.ins_h],e.head[e.ins_h]=e.strstart),e.prev_length=e.match_length,e.prev_match=e.match_start,e.match_length=C-1,n!==0&&e.prev_length<e.max_lazy_match&&e.strstart-n<=e.w_size-T&&(e.match_length=z(e,n),e.match_length<=5&&(e.strategy===1||e.match_length===C&&4096<e.strstart-e.match_start)&&(e.match_length=C-1)),e.prev_length>=C&&e.match_length<=e.prev_length){for(i=e.strstart+e.lookahead-C,r=a._tr_tally(e,e.strstart-1-e.prev_match,e.prev_length-C),e.lookahead-=e.prev_length-1,e.prev_length-=2;++e.strstart<=i&&(e.ins_h=(e.ins_h<<e.hash_shift^e.window[e.strstart+C-1])&e.hash_mask,n=e.prev[e.strstart&e.w_mask]=e.head[e.ins_h],e.head[e.ins_h]=e.strstart),--e.prev_length!=0;);if(e.match_available=0,e.match_length=C-1,e.strstart++,r&&(I(e,!1),e.strm.avail_out===0))return O}else if(e.match_available){if((r=a._tr_tally(e,0,e.window[e.strstart-1]))&&I(e,!1),e.strstart++,e.lookahead--,e.strm.avail_out===0)return O}else e.match_available=1,e.strstart++,e.lookahead--}return e.match_available&&=(r=a._tr_tally(e,0,e.window[e.strstart-1]),0),e.insert=e.strstart<C-1?e.strstart:C-1,t===u?(I(e,!0),e.strm.avail_out===0?A:j):e.last_lit&&(I(e,!1),e.strm.avail_out===0)?O:k}function U(e,t,n,r,i){this.good_length=e,this.max_lazy=t,this.nice_length=n,this.max_chain=r,this.func=i}function ee(){this.strm=null,this.status=0,this.pending_buf=null,this.pending_buf_size=0,this.pending_out=0,this.pending=0,this.wrap=0,this.gzhead=null,this.gzindex=0,this.method=g,this.last_flush=-1,this.w_size=0,this.w_bits=0,this.w_mask=0,this.window=null,this.window_size=0,this.prev=null,this.head=null,this.ins_h=0,this.hash_size=0,this.hash_bits=0,this.hash_mask=0,this.hash_shift=0,this.block_start=0,this.match_length=0,this.prev_match=0,this.match_available=0,this.strstart=0,this.match_start=0,this.lookahead=0,this.prev_length=0,this.max_chain_length=0,this.max_lazy_match=0,this.level=0,this.strategy=0,this.good_match=0,this.nice_match=0,this.dyn_ltree=new i.Buf16(2*x),this.dyn_dtree=new i.Buf16(2*(2*y+1)),this.bl_tree=new i.Buf16(2*(2*b+1)),P(this.dyn_ltree),P(this.dyn_dtree),P(this.bl_tree),this.l_desc=null,this.d_desc=null,this.bl_desc=null,this.bl_count=new i.Buf16(S+1),this.heap=new i.Buf16(2*v+1),P(this.heap),this.heap_len=0,this.heap_max=0,this.depth=new i.Buf16(2*v+1),P(this.depth),this.l_buf=0,this.lit_bufsize=0,this.last_lit=0,this.d_buf=0,this.opt_len=0,this.static_len=0,this.matches=0,this.insert=0,this.bi_buf=0,this.bi_valid=0}function W(e){var t;return e&&e.state?(e.total_in=e.total_out=0,e.data_type=h,(t=e.state).pending=0,t.pending_out=0,t.wrap<0&&(t.wrap=-t.wrap),t.status=t.wrap?E:D,e.adler=t.wrap===2?0:1,t.last_flush=l,a._tr_init(t),d):M(e,f)}function te(e){var t=W(e);return t===d&&function(e){e.window_size=2*e.w_size,P(e.head),e.max_lazy_match=r[e.level].max_lazy,e.good_match=r[e.level].good_length,e.nice_match=r[e.level].nice_length,e.max_chain_length=r[e.level].max_chain,e.strstart=0,e.block_start=0,e.lookahead=0,e.insert=0,e.match_length=e.prev_length=C-1,e.match_available=0,e.ins_h=0}(e.state),t}function ne(e,t,n,r,a,o){if(!e)return f;var s=1;if(t===p&&(t=6),r<0?(s=0,r=-r):15<r&&(s=2,r-=16),a<1||_<a||n!==g||r<8||15<r||t<0||9<t||o<0||m<o)return M(e,f);r===8&&(r=9);var c=new ee;return(e.state=c).strm=e,c.wrap=s,c.gzhead=null,c.w_bits=r,c.w_size=1<<c.w_bits,c.w_mask=c.w_size-1,c.hash_bits=a+7,c.hash_size=1<<c.hash_bits,c.hash_mask=c.hash_size-1,c.hash_shift=~~((c.hash_bits+C-1)/C),c.window=new i.Buf8(2*c.w_size),c.head=new i.Buf16(c.hash_size),c.prev=new i.Buf16(c.w_size),c.lit_bufsize=1<<a+6,c.pending_buf_size=4*c.lit_bufsize,c.pending_buf=new i.Buf8(c.pending_buf_size),c.d_buf=1*c.lit_bufsize,c.l_buf=3*c.lit_bufsize,c.level=t,c.strategy=o,c.method=n,te(e)}r=[new U(0,0,0,0,function(e,t){var n=65535;for(n>e.pending_buf_size-5&&(n=e.pending_buf_size-5);;){if(e.lookahead<=1){if(B(e),e.lookahead===0&&t===l)return O;if(e.lookahead===0)break}e.strstart+=e.lookahead,e.lookahead=0;var r=e.block_start+n;if((e.strstart===0||e.strstart>=r)&&(e.lookahead=e.strstart-r,e.strstart=r,I(e,!1),e.strm.avail_out===0)||e.strstart-e.block_start>=e.w_size-T&&(I(e,!1),e.strm.avail_out===0))return O}return e.insert=0,t===u?(I(e,!0),e.strm.avail_out===0?A:j):(e.strstart>e.block_start&&(I(e,!1),e.strm.avail_out),O)}),new U(4,4,8,4,V),new U(4,5,16,8,V),new U(4,6,32,32,V),new U(4,4,16,16,H),new U(8,16,32,32,H),new U(8,16,128,128,H),new U(8,32,128,256,H),new U(32,128,258,1024,H),new U(32,258,258,4096,H)],n.deflateInit=function(e,t){return ne(e,t,g,15,8,0)},n.deflateInit2=ne,n.deflateReset=te,n.deflateResetKeep=W,n.deflateSetHeader=function(e,t){return e&&e.state&&e.state.wrap===2?(e.state.gzhead=t,d):f},n.deflate=function(e,t){var n,i,o,c;if(!e||!e.state||5<t||t<0)return e?M(e,f):f;if(i=e.state,!e.output||!e.input&&e.avail_in!==0||i.status===666&&t!==u)return M(e,e.avail_out===0?-5:f);if(i.strm=e,n=i.last_flush,i.last_flush=t,i.status===E)if(i.wrap===2)e.adler=0,L(i,31),L(i,139),L(i,8),i.gzhead?(L(i,+!!i.gzhead.text+(i.gzhead.hcrc?2:0)+(i.gzhead.extra?4:0)+(i.gzhead.name?8:0)+(i.gzhead.comment?16:0)),L(i,255&i.gzhead.time),L(i,i.gzhead.time>>8&255),L(i,i.gzhead.time>>16&255),L(i,i.gzhead.time>>24&255),L(i,i.level===9?2:2<=i.strategy||i.level<2?4:0),L(i,255&i.gzhead.os),i.gzhead.extra&&i.gzhead.extra.length&&(L(i,255&i.gzhead.extra.length),L(i,i.gzhead.extra.length>>8&255)),i.gzhead.hcrc&&(e.adler=s(e.adler,i.pending_buf,i.pending,0)),i.gzindex=0,i.status=69):(L(i,0),L(i,0),L(i,0),L(i,0),L(i,0),L(i,i.level===9?2:2<=i.strategy||i.level<2?4:0),L(i,3),i.status=D);else{var p=g+(i.w_bits-8<<4)<<8;p|=(2<=i.strategy||i.level<2?0:i.level<6?1:i.level===6?2:3)<<6,i.strstart!==0&&(p|=32),p+=31-p%31,i.status=D,R(i,p),i.strstart!==0&&(R(i,e.adler>>>16),R(i,65535&e.adler)),e.adler=1}if(i.status===69)if(i.gzhead.extra){for(o=i.pending;i.gzindex<(65535&i.gzhead.extra.length)&&(i.pending!==i.pending_buf_size||(i.gzhead.hcrc&&i.pending>o&&(e.adler=s(e.adler,i.pending_buf,i.pending-o,o)),F(e),o=i.pending,i.pending!==i.pending_buf_size));)L(i,255&i.gzhead.extra[i.gzindex]),i.gzindex++;i.gzhead.hcrc&&i.pending>o&&(e.adler=s(e.adler,i.pending_buf,i.pending-o,o)),i.gzindex===i.gzhead.extra.length&&(i.gzindex=0,i.status=73)}else i.status=73;if(i.status===73)if(i.gzhead.name){o=i.pending;do{if(i.pending===i.pending_buf_size&&(i.gzhead.hcrc&&i.pending>o&&(e.adler=s(e.adler,i.pending_buf,i.pending-o,o)),F(e),o=i.pending,i.pending===i.pending_buf_size)){c=1;break}c=i.gzindex<i.gzhead.name.length?255&i.gzhead.name.charCodeAt(i.gzindex++):0,L(i,c)}while(c!==0);i.gzhead.hcrc&&i.pending>o&&(e.adler=s(e.adler,i.pending_buf,i.pending-o,o)),c===0&&(i.gzindex=0,i.status=91)}else i.status=91;if(i.status===91)if(i.gzhead.comment){o=i.pending;do{if(i.pending===i.pending_buf_size&&(i.gzhead.hcrc&&i.pending>o&&(e.adler=s(e.adler,i.pending_buf,i.pending-o,o)),F(e),o=i.pending,i.pending===i.pending_buf_size)){c=1;break}c=i.gzindex<i.gzhead.comment.length?255&i.gzhead.comment.charCodeAt(i.gzindex++):0,L(i,c)}while(c!==0);i.gzhead.hcrc&&i.pending>o&&(e.adler=s(e.adler,i.pending_buf,i.pending-o,o)),c===0&&(i.status=103)}else i.status=103;if(i.status===103&&(i.gzhead.hcrc?(i.pending+2>i.pending_buf_size&&F(e),i.pending+2<=i.pending_buf_size&&(L(i,255&e.adler),L(i,e.adler>>8&255),e.adler=0,i.status=D)):i.status=D),i.pending!==0){if(F(e),e.avail_out===0)return i.last_flush=-1,d}else if(e.avail_in===0&&N(t)<=N(n)&&t!==u)return M(e,-5);if(i.status===666&&e.avail_in!==0)return M(e,-5);if(e.avail_in!==0||i.lookahead!==0||t!==l&&i.status!==666){var m=i.strategy===2?function(e,t){for(var n;;){if(e.lookahead===0&&(B(e),e.lookahead===0)){if(t===l)return O;break}if(e.match_length=0,n=a._tr_tally(e,0,e.window[e.strstart]),e.lookahead--,e.strstart++,n&&(I(e,!1),e.strm.avail_out===0))return O}return e.insert=0,t===u?(I(e,!0),e.strm.avail_out===0?A:j):e.last_lit&&(I(e,!1),e.strm.avail_out===0)?O:k}(i,t):i.strategy===3?function(e,t){for(var n,r,i,o,s=e.window;;){if(e.lookahead<=w){if(B(e),e.lookahead<=w&&t===l)return O;if(e.lookahead===0)break}if(e.match_length=0,e.lookahead>=C&&0<e.strstart&&(r=s[i=e.strstart-1])===s[++i]&&r===s[++i]&&r===s[++i]){o=e.strstart+w;do;while(r===s[++i]&&r===s[++i]&&r===s[++i]&&r===s[++i]&&r===s[++i]&&r===s[++i]&&r===s[++i]&&r===s[++i]&&i<o);e.match_length=w-(o-i),e.match_length>e.lookahead&&(e.match_length=e.lookahead)}if(e.match_length>=C?(n=a._tr_tally(e,1,e.match_length-C),e.lookahead-=e.match_length,e.strstart+=e.match_length,e.match_length=0):(n=a._tr_tally(e,0,e.window[e.strstart]),e.lookahead--,e.strstart++),n&&(I(e,!1),e.strm.avail_out===0))return O}return e.insert=0,t===u?(I(e,!0),e.strm.avail_out===0?A:j):e.last_lit&&(I(e,!1),e.strm.avail_out===0)?O:k}(i,t):r[i.level].func(i,t);if(m!==A&&m!==j||(i.status=666),m===O||m===A)return e.avail_out===0&&(i.last_flush=-1),d;if(m===k&&(t===1?a._tr_align(i):t!==5&&(a._tr_stored_block(i,0,0,!1),t===3&&(P(i.head),i.lookahead===0&&(i.strstart=0,i.block_start=0,i.insert=0))),F(e),e.avail_out===0))return i.last_flush=-1,d}return t===u?i.wrap<=0?1:(i.wrap===2?(L(i,255&e.adler),L(i,e.adler>>8&255),L(i,e.adler>>16&255),L(i,e.adler>>24&255),L(i,255&e.total_in),L(i,e.total_in>>8&255),L(i,e.total_in>>16&255),L(i,e.total_in>>24&255)):(R(i,e.adler>>>16),R(i,65535&e.adler)),F(e),0<i.wrap&&(i.wrap=-i.wrap),i.pending===0?1:d):d},n.deflateEnd=function(e){var t;return e&&e.state?(t=e.state.status)!==E&&t!==69&&t!==73&&t!==91&&t!==103&&t!==D&&t!==666?M(e,f):(e.state=null,t===D?M(e,-3):d):f},n.deflateSetDictionary=function(e,t){var n,r,a,s,c,l,u,p,m=t.length;if(!e||!e.state||(s=(n=e.state).wrap)===2||s===1&&n.status!==E||n.lookahead)return f;for(s===1&&(e.adler=o(e.adler,t,m,0)),n.wrap=0,m>=n.w_size&&(s===0&&(P(n.head),n.strstart=0,n.block_start=0,n.insert=0),p=new i.Buf8(n.w_size),i.arraySet(p,t,m-n.w_size,n.w_size,0),t=p,m=n.w_size),c=e.avail_in,l=e.next_in,u=e.input,e.avail_in=m,e.next_in=0,e.input=t,B(n);n.lookahead>=C;){for(r=n.strstart,a=n.lookahead-(C-1);n.ins_h=(n.ins_h<<n.hash_shift^n.window[r+C-1])&n.hash_mask,n.prev[r&n.w_mask]=n.head[n.ins_h],n.head[n.ins_h]=r,r++,--a;);n.strstart=r,n.lookahead=C-1,B(n)}return n.strstart+=n.lookahead,n.block_start=n.strstart,n.insert=n.lookahead,n.lookahead=0,n.match_length=n.prev_length=C-1,n.match_available=0,e.next_in=l,e.input=u,e.avail_in=c,n.wrap=s,d},n.deflateInfo=`pako deflate (from Nodeca project)`},{"../utils/common":41,"./adler32":43,"./crc32":45,"./messages":51,"./trees":52}],47:[function(e,t,n){t.exports=function(){this.text=0,this.time=0,this.xflags=0,this.os=0,this.extra=null,this.extra_len=0,this.name=``,this.comment=``,this.hcrc=0,this.done=!1}},{}],48:[function(e,t,n){t.exports=function(e,t){var n=e.state,r=e.next_in,i,a,o,s,c,l,u,d,f,p,m,h,g,_,v,y,b,x,S,C,w,T=e.input,E;i=r+(e.avail_in-5),a=e.next_out,E=e.output,o=a-(t-e.avail_out),s=a+(e.avail_out-257),c=n.dmax,l=n.wsize,u=n.whave,d=n.wnext,f=n.window,p=n.hold,m=n.bits,h=n.lencode,g=n.distcode,_=(1<<n.lenbits)-1,v=(1<<n.distbits)-1;e:do{m<15&&(p+=T[r++]<<m,m+=8,p+=T[r++]<<m,m+=8),y=h[p&_];t:for(;;){if(p>>>=b=y>>>24,m-=b,(b=y>>>16&255)==0)E[a++]=65535&y;else{if(!(16&b)){if(!(64&b)){y=h[(65535&y)+(p&(1<<b)-1)];continue t}if(32&b){n.mode=12;break e}e.msg=`invalid literal/length code`,n.mode=30;break e}x=65535&y,(b&=15)&&(m<b&&(p+=T[r++]<<m,m+=8),x+=p&(1<<b)-1,p>>>=b,m-=b),m<15&&(p+=T[r++]<<m,m+=8,p+=T[r++]<<m,m+=8),y=g[p&v];r:for(;;){if(p>>>=b=y>>>24,m-=b,!(16&(b=y>>>16&255))){if(!(64&b)){y=g[(65535&y)+(p&(1<<b)-1)];continue r}e.msg=`invalid distance code`,n.mode=30;break e}if(S=65535&y,m<(b&=15)&&(p+=T[r++]<<m,(m+=8)<b&&(p+=T[r++]<<m,m+=8)),c<(S+=p&(1<<b)-1)){e.msg=`invalid distance too far back`,n.mode=30;break e}if(p>>>=b,m-=b,(b=a-o)<S){if(u<(b=S-b)&&n.sane){e.msg=`invalid distance too far back`,n.mode=30;break e}if(w=f,(C=0)===d){if(C+=l-b,b<x){for(x-=b;E[a++]=f[C++],--b;);C=a-S,w=E}}else if(d<b){if(C+=l+d-b,(b-=d)<x){for(x-=b;E[a++]=f[C++],--b;);if(C=0,d<x){for(x-=b=d;E[a++]=f[C++],--b;);C=a-S,w=E}}}else if(C+=d-b,b<x){for(x-=b;E[a++]=f[C++],--b;);C=a-S,w=E}for(;2<x;)E[a++]=w[C++],E[a++]=w[C++],E[a++]=w[C++],x-=3;x&&(E[a++]=w[C++],1<x&&(E[a++]=w[C++]))}else{for(C=a-S;E[a++]=E[C++],E[a++]=E[C++],E[a++]=E[C++],2<(x-=3););x&&(E[a++]=E[C++],1<x&&(E[a++]=E[C++]))}break}}break}}while(r<i&&a<s);r-=x=m>>3,p&=(1<<(m-=x<<3))-1,e.next_in=r,e.next_out=a,e.avail_in=r<i?i-r+5:5-(r-i),e.avail_out=a<s?s-a+257:257-(a-s),n.hold=p,n.bits=m}},{}],49:[function(e,t,n){var r=e(`../utils/common`),i=e(`./adler32`),a=e(`./crc32`),o=e(`./inffast`),s=e(`./inftrees`),c=1,l=2,u=0,d=-2,f=1,p=852,m=592;function h(e){return(e>>>24&255)+(e>>>8&65280)+((65280&e)<<8)+((255&e)<<24)}function g(){this.mode=0,this.last=!1,this.wrap=0,this.havedict=!1,this.flags=0,this.dmax=0,this.check=0,this.total=0,this.head=null,this.wbits=0,this.wsize=0,this.whave=0,this.wnext=0,this.window=null,this.hold=0,this.bits=0,this.length=0,this.offset=0,this.extra=0,this.lencode=null,this.distcode=null,this.lenbits=0,this.distbits=0,this.ncode=0,this.nlen=0,this.ndist=0,this.have=0,this.next=null,this.lens=new r.Buf16(320),this.work=new r.Buf16(288),this.lendyn=null,this.distdyn=null,this.sane=0,this.back=0,this.was=0}function _(e){var t;return e&&e.state?(t=e.state,e.total_in=e.total_out=t.total=0,e.msg=``,t.wrap&&(e.adler=1&t.wrap),t.mode=f,t.last=0,t.havedict=0,t.dmax=32768,t.head=null,t.hold=0,t.bits=0,t.lencode=t.lendyn=new r.Buf32(p),t.distcode=t.distdyn=new r.Buf32(m),t.sane=1,t.back=-1,u):d}function v(e){var t;return e&&e.state?((t=e.state).wsize=0,t.whave=0,t.wnext=0,_(e)):d}function y(e,t){var n,r;return e&&e.state?(r=e.state,t<0?(n=0,t=-t):(n=1+(t>>4),t<48&&(t&=15)),t&&(t<8||15<t)?d:(r.window!==null&&r.wbits!==t&&(r.window=null),r.wrap=n,r.wbits=t,v(e))):d}function b(e,t){var n,r;return e?(r=new g,(e.state=r).window=null,(n=y(e,t))!==u&&(e.state=null),n):d}var x,S,C=!0;function w(e){if(C){var t;for(x=new r.Buf32(512),S=new r.Buf32(32),t=0;t<144;)e.lens[t++]=8;for(;t<256;)e.lens[t++]=9;for(;t<280;)e.lens[t++]=7;for(;t<288;)e.lens[t++]=8;for(s(c,e.lens,0,288,x,0,e.work,{bits:9}),t=0;t<32;)e.lens[t++]=5;s(l,e.lens,0,32,S,0,e.work,{bits:5}),C=!1}e.lencode=x,e.lenbits=9,e.distcode=S,e.distbits=5}function T(e,t,n,i){var a,o=e.state;return o.window===null&&(o.wsize=1<<o.wbits,o.wnext=0,o.whave=0,o.window=new r.Buf8(o.wsize)),i>=o.wsize?(r.arraySet(o.window,t,n-o.wsize,o.wsize,0),o.wnext=0,o.whave=o.wsize):(i<(a=o.wsize-o.wnext)&&(a=i),r.arraySet(o.window,t,n-i,a,o.wnext),(i-=a)?(r.arraySet(o.window,t,n-i,i,0),o.wnext=i,o.whave=o.wsize):(o.wnext+=a,o.wnext===o.wsize&&(o.wnext=0),o.whave<o.wsize&&(o.whave+=a))),0}n.inflateReset=v,n.inflateReset2=y,n.inflateResetKeep=_,n.inflateInit=function(e){return b(e,15)},n.inflateInit2=b,n.inflate=function(e,t){var n,p,m,g,_,v,y,b,x,S,C,E,D,O,k,A,j,M,N,P,F,I,L,R,z=0,B=new r.Buf8(4),V=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];if(!e||!e.state||!e.output||!e.input&&e.avail_in!==0)return d;(n=e.state).mode===12&&(n.mode=13),_=e.next_out,m=e.output,y=e.avail_out,g=e.next_in,p=e.input,v=e.avail_in,b=n.hold,x=n.bits,S=v,C=y,I=u;e:for(;;)switch(n.mode){case f:if(n.wrap===0){n.mode=13;break}for(;x<16;){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}if(2&n.wrap&&b===35615){B[n.check=0]=255&b,B[1]=b>>>8&255,n.check=a(n.check,B,2,0),x=b=0,n.mode=2;break}if(n.flags=0,n.head&&(n.head.done=!1),!(1&n.wrap)||(((255&b)<<8)+(b>>8))%31){e.msg=`incorrect header check`,n.mode=30;break}if((15&b)!=8){e.msg=`unknown compression method`,n.mode=30;break}if(x-=4,F=8+(15&(b>>>=4)),n.wbits===0)n.wbits=F;else if(F>n.wbits){e.msg=`invalid window size`,n.mode=30;break}n.dmax=1<<F,e.adler=n.check=1,n.mode=512&b?10:12,x=b=0;break;case 2:for(;x<16;){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}if(n.flags=b,(255&n.flags)!=8){e.msg=`unknown compression method`,n.mode=30;break}if(57344&n.flags){e.msg=`unknown header flags set`,n.mode=30;break}n.head&&(n.head.text=b>>8&1),512&n.flags&&(B[0]=255&b,B[1]=b>>>8&255,n.check=a(n.check,B,2,0)),x=b=0,n.mode=3;case 3:for(;x<32;){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}n.head&&(n.head.time=b),512&n.flags&&(B[0]=255&b,B[1]=b>>>8&255,B[2]=b>>>16&255,B[3]=b>>>24&255,n.check=a(n.check,B,4,0)),x=b=0,n.mode=4;case 4:for(;x<16;){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}n.head&&(n.head.xflags=255&b,n.head.os=b>>8),512&n.flags&&(B[0]=255&b,B[1]=b>>>8&255,n.check=a(n.check,B,2,0)),x=b=0,n.mode=5;case 5:if(1024&n.flags){for(;x<16;){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}n.length=b,n.head&&(n.head.extra_len=b),512&n.flags&&(B[0]=255&b,B[1]=b>>>8&255,n.check=a(n.check,B,2,0)),x=b=0}else n.head&&(n.head.extra=null);n.mode=6;case 6:if(1024&n.flags&&(v<(E=n.length)&&(E=v),E&&(n.head&&(F=n.head.extra_len-n.length,n.head.extra||(n.head.extra=Array(n.head.extra_len)),r.arraySet(n.head.extra,p,g,E,F)),512&n.flags&&(n.check=a(n.check,p,E,g)),v-=E,g+=E,n.length-=E),n.length))break e;n.length=0,n.mode=7;case 7:if(2048&n.flags){if(v===0)break e;for(E=0;F=p[g+ E++],n.head&&F&&n.length<65536&&(n.head.name+=String.fromCharCode(F)),F&&E<v;);if(512&n.flags&&(n.check=a(n.check,p,E,g)),v-=E,g+=E,F)break e}else n.head&&(n.head.name=null);n.length=0,n.mode=8;case 8:if(4096&n.flags){if(v===0)break e;for(E=0;F=p[g+ E++],n.head&&F&&n.length<65536&&(n.head.comment+=String.fromCharCode(F)),F&&E<v;);if(512&n.flags&&(n.check=a(n.check,p,E,g)),v-=E,g+=E,F)break e}else n.head&&(n.head.comment=null);n.mode=9;case 9:if(512&n.flags){for(;x<16;){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}if(b!==(65535&n.check)){e.msg=`header crc mismatch`,n.mode=30;break}x=b=0}n.head&&(n.head.hcrc=n.flags>>9&1,n.head.done=!0),e.adler=n.check=0,n.mode=12;break;case 10:for(;x<32;){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}e.adler=n.check=h(b),x=b=0,n.mode=11;case 11:if(n.havedict===0)return e.next_out=_,e.avail_out=y,e.next_in=g,e.avail_in=v,n.hold=b,n.bits=x,2;e.adler=n.check=1,n.mode=12;case 12:if(t===5||t===6)break e;case 13:if(n.last){b>>>=7&x,x-=7&x,n.mode=27;break}for(;x<3;){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}switch(n.last=1&b,--x,3&(b>>>=1)){case 0:n.mode=14;break;case 1:if(w(n),n.mode=20,t!==6)break;b>>>=2,x-=2;break e;case 2:n.mode=17;break;case 3:e.msg=`invalid block type`,n.mode=30}b>>>=2,x-=2;break;case 14:for(b>>>=7&x,x-=7&x;x<32;){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}if((65535&b)!=(b>>>16^65535)){e.msg=`invalid stored block lengths`,n.mode=30;break}if(n.length=65535&b,x=b=0,n.mode=15,t===6)break e;case 15:n.mode=16;case 16:if(E=n.length){if(v<E&&(E=v),y<E&&(E=y),E===0)break e;r.arraySet(m,p,g,E,_),v-=E,g+=E,y-=E,_+=E,n.length-=E;break}n.mode=12;break;case 17:for(;x<14;){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}if(n.nlen=257+(31&b),b>>>=5,x-=5,n.ndist=1+(31&b),b>>>=5,x-=5,n.ncode=4+(15&b),b>>>=4,x-=4,286<n.nlen||30<n.ndist){e.msg=`too many length or distance symbols`,n.mode=30;break}n.have=0,n.mode=18;case 18:for(;n.have<n.ncode;){for(;x<3;){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}n.lens[V[n.have++]]=7&b,b>>>=3,x-=3}for(;n.have<19;)n.lens[V[n.have++]]=0;if(n.lencode=n.lendyn,n.lenbits=7,L={bits:n.lenbits},I=s(0,n.lens,0,19,n.lencode,0,n.work,L),n.lenbits=L.bits,I){e.msg=`invalid code lengths set`,n.mode=30;break}n.have=0,n.mode=19;case 19:for(;n.have<n.nlen+n.ndist;){for(;A=(z=n.lencode[b&(1<<n.lenbits)-1])>>>16&255,j=65535&z,!((k=z>>>24)<=x);){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}if(j<16)b>>>=k,x-=k,n.lens[n.have++]=j;else{if(j===16){for(R=k+2;x<R;){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}if(b>>>=k,x-=k,n.have===0){e.msg=`invalid bit length repeat`,n.mode=30;break}F=n.lens[n.have-1],E=3+(3&b),b>>>=2,x-=2}else if(j===17){for(R=k+3;x<R;){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}x-=k,F=0,E=3+(7&(b>>>=k)),b>>>=3,x-=3}else{for(R=k+7;x<R;){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}x-=k,F=0,E=11+(127&(b>>>=k)),b>>>=7,x-=7}if(n.have+E>n.nlen+n.ndist){e.msg=`invalid bit length repeat`,n.mode=30;break}for(;E--;)n.lens[n.have++]=F}}if(n.mode===30)break;if(n.lens[256]===0){e.msg=`invalid code -- missing end-of-block`,n.mode=30;break}if(n.lenbits=9,L={bits:n.lenbits},I=s(c,n.lens,0,n.nlen,n.lencode,0,n.work,L),n.lenbits=L.bits,I){e.msg=`invalid literal/lengths set`,n.mode=30;break}if(n.distbits=6,n.distcode=n.distdyn,L={bits:n.distbits},I=s(l,n.lens,n.nlen,n.ndist,n.distcode,0,n.work,L),n.distbits=L.bits,I){e.msg=`invalid distances set`,n.mode=30;break}if(n.mode=20,t===6)break e;case 20:n.mode=21;case 21:if(6<=v&&258<=y){e.next_out=_,e.avail_out=y,e.next_in=g,e.avail_in=v,n.hold=b,n.bits=x,o(e,C),_=e.next_out,m=e.output,y=e.avail_out,g=e.next_in,p=e.input,v=e.avail_in,b=n.hold,x=n.bits,n.mode===12&&(n.back=-1);break}for(n.back=0;A=(z=n.lencode[b&(1<<n.lenbits)-1])>>>16&255,j=65535&z,!((k=z>>>24)<=x);){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}if(A&&!(240&A)){for(M=k,N=A,P=j;A=(z=n.lencode[P+((b&(1<<M+N)-1)>>M)])>>>16&255,j=65535&z,!(M+(k=z>>>24)<=x);){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}b>>>=M,x-=M,n.back+=M}if(b>>>=k,x-=k,n.back+=k,n.length=j,A===0){n.mode=26;break}if(32&A){n.back=-1,n.mode=12;break}if(64&A){e.msg=`invalid literal/length code`,n.mode=30;break}n.extra=15&A,n.mode=22;case 22:if(n.extra){for(R=n.extra;x<R;){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}n.length+=b&(1<<n.extra)-1,b>>>=n.extra,x-=n.extra,n.back+=n.extra}n.was=n.length,n.mode=23;case 23:for(;A=(z=n.distcode[b&(1<<n.distbits)-1])>>>16&255,j=65535&z,!((k=z>>>24)<=x);){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}if(!(240&A)){for(M=k,N=A,P=j;A=(z=n.distcode[P+((b&(1<<M+N)-1)>>M)])>>>16&255,j=65535&z,!(M+(k=z>>>24)<=x);){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}b>>>=M,x-=M,n.back+=M}if(b>>>=k,x-=k,n.back+=k,64&A){e.msg=`invalid distance code`,n.mode=30;break}n.offset=j,n.extra=15&A,n.mode=24;case 24:if(n.extra){for(R=n.extra;x<R;){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}n.offset+=b&(1<<n.extra)-1,b>>>=n.extra,x-=n.extra,n.back+=n.extra}if(n.offset>n.dmax){e.msg=`invalid distance too far back`,n.mode=30;break}n.mode=25;case 25:if(y===0)break e;if(E=C-y,n.offset>E){if((E=n.offset-E)>n.whave&&n.sane){e.msg=`invalid distance too far back`,n.mode=30;break}D=E>n.wnext?(E-=n.wnext,n.wsize-E):n.wnext-E,E>n.length&&(E=n.length),O=n.window}else O=m,D=_-n.offset,E=n.length;for(y<E&&(E=y),y-=E,n.length-=E;m[_++]=O[D++],--E;);n.length===0&&(n.mode=21);break;case 26:if(y===0)break e;m[_++]=n.length,y--,n.mode=21;break;case 27:if(n.wrap){for(;x<32;){if(v===0)break e;v--,b|=p[g++]<<x,x+=8}if(C-=y,e.total_out+=C,n.total+=C,C&&(e.adler=n.check=n.flags?a(n.check,m,C,_-C):i(n.check,m,C,_-C)),C=y,(n.flags?b:h(b))!==n.check){e.msg=`incorrect data check`,n.mode=30;break}x=b=0}n.mode=28;case 28:if(n.wrap&&n.flags){for(;x<32;){if(v===0)break e;v--,b+=p[g++]<<x,x+=8}if(b!==(4294967295&n.total)){e.msg=`incorrect length check`,n.mode=30;break}x=b=0}n.mode=29;case 29:I=1;break e;case 30:I=-3;break e;case 31:return-4;case 32:default:return d}return e.next_out=_,e.avail_out=y,e.next_in=g,e.avail_in=v,n.hold=b,n.bits=x,(n.wsize||C!==e.avail_out&&n.mode<30&&(n.mode<27||t!==4))&&T(e,e.output,e.next_out,C-e.avail_out)?(n.mode=31,-4):(S-=e.avail_in,C-=e.avail_out,e.total_in+=S,e.total_out+=C,n.total+=C,n.wrap&&C&&(e.adler=n.check=n.flags?a(n.check,m,C,e.next_out-C):i(n.check,m,C,e.next_out-C)),e.data_type=n.bits+(n.last?64:0)+(n.mode===12?128:0)+(n.mode===20||n.mode===15?256:0),(S==0&&C===0||t===4)&&I===u&&(I=-5),I)},n.inflateEnd=function(e){if(!e||!e.state)return d;var t=e.state;return t.window&&=null,e.state=null,u},n.inflateGetHeader=function(e,t){var n;return e&&e.state&&2&(n=e.state).wrap?((n.head=t).done=!1,u):d},n.inflateSetDictionary=function(e,t){var n,r=t.length;return e&&e.state?(n=e.state).wrap!==0&&n.mode!==11?d:n.mode===11&&i(1,t,r,0)!==n.check?-3:T(e,t,r,r)?(n.mode=31,-4):(n.havedict=1,u):d},n.inflateInfo=`pako inflate (from Nodeca project)`},{"../utils/common":41,"./adler32":43,"./crc32":45,"./inffast":48,"./inftrees":50}],50:[function(e,t,n){var r=e(`../utils/common`),i=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258,0,0],a=[16,16,16,16,16,16,16,16,17,17,17,17,18,18,18,18,19,19,19,19,20,20,20,20,21,21,21,21,16,72,78],o=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577,0,0],s=[16,16,16,16,17,17,18,18,19,19,20,20,21,21,22,22,23,23,24,24,25,25,26,26,27,27,28,28,29,29,64,64];t.exports=function(e,t,n,c,l,u,d,f){var p,m,h,g,_,v,y,b,x,S=f.bits,C=0,w=0,T=0,E=0,D=0,O=0,k=0,A=0,j=0,M=0,N=null,P=0,F=new r.Buf16(16),I=new r.Buf16(16),L=null,R=0;for(C=0;C<=15;C++)F[C]=0;for(w=0;w<c;w++)F[t[n+w]]++;for(D=S,E=15;1<=E&&F[E]===0;E--);if(E<D&&(D=E),E===0)return l[u++]=20971520,l[u++]=20971520,f.bits=1,0;for(T=1;T<E&&F[T]===0;T++);for(D<T&&(D=T),C=A=1;C<=15;C++)if(A<<=1,(A-=F[C])<0)return-1;if(0<A&&(e===0||E!==1))return-1;for(I[1]=0,C=1;C<15;C++)I[C+1]=I[C]+F[C];for(w=0;w<c;w++)t[n+w]!==0&&(d[I[t[n+w]]++]=w);if(v=e===0?(N=L=d,19):e===1?(N=i,P-=257,L=a,R-=257,256):(N=o,L=s,-1),C=T,_=u,k=w=M=0,h=-1,g=(j=1<<(O=D))-1,e===1&&852<j||e===2&&592<j)return 1;for(;;){for(y=C-k,x=d[w]<v?(b=0,d[w]):d[w]>v?(b=L[R+d[w]],N[P+d[w]]):(b=96,0),p=1<<C-k,T=m=1<<O;l[_+(M>>k)+(m-=p)]=y<<24|b<<16|x|0,m!==0;);for(p=1<<C-1;M&p;)p>>=1;if(p===0?M=0:(M&=p-1,M+=p),w++,--F[C]==0){if(C===E)break;C=t[n+d[w]]}if(D<C&&(M&g)!==h){for(k===0&&(k=D),_+=T,A=1<<(O=C-k);O+k<E&&!((A-=F[O+k])<=0);)O++,A<<=1;if(j+=1<<O,e===1&&852<j||e===2&&592<j)return 1;l[h=M&g]=D<<24|O<<16|_-u|0}}return M!==0&&(l[_+M]=C-k<<24|4194304),f.bits=D,0}},{"../utils/common":41}],51:[function(e,t,n){t.exports={2:`need dictionary`,1:`stream end`,0:``,"-1":`file error`,"-2":`stream error`,"-3":`data error`,"-4":`insufficient memory`,"-5":`buffer error`,"-6":`incompatible version`}},{}],52:[function(e,t,n){var r=e(`../utils/common`),i=0,a=1;function o(e){for(var t=e.length;0<=--t;)e[t]=0}var s=0,c=29,l=256,u=l+1+c,d=30,f=19,p=2*u+1,m=15,h=16,g=7,_=256,v=16,y=17,b=18,x=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0],S=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13],C=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,3,7],w=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15],T=Array(2*(u+2));o(T);var E=Array(2*d);o(E);var D=Array(512);o(D);var O=Array(256);o(O);var k=Array(c);o(k);var A,j,M,N=Array(d);function P(e,t,n,r,i){this.static_tree=e,this.extra_bits=t,this.extra_base=n,this.elems=r,this.max_length=i,this.has_stree=e&&e.length}function F(e,t){this.dyn_tree=e,this.max_code=0,this.stat_desc=t}function I(e){return e<256?D[e]:D[256+(e>>>7)]}function L(e,t){e.pending_buf[e.pending++]=255&t,e.pending_buf[e.pending++]=t>>>8&255}function R(e,t,n){e.bi_valid>h-n?(e.bi_buf|=t<<e.bi_valid&65535,L(e,e.bi_buf),e.bi_buf=t>>h-e.bi_valid,e.bi_valid+=n-h):(e.bi_buf|=t<<e.bi_valid&65535,e.bi_valid+=n)}function z(e,t,n){R(e,n[2*t],n[2*t+1])}function B(e,t){for(var n=0;n|=1&e,e>>>=1,n<<=1,0<--t;);return n>>>1}function V(e,t,n){var r,i,a=Array(m+1),o=0;for(r=1;r<=m;r++)a[r]=o=o+n[r-1]<<1;for(i=0;i<=t;i++){var s=e[2*i+1];s!==0&&(e[2*i]=B(a[s]++,s))}}function H(e){var t;for(t=0;t<u;t++)e.dyn_ltree[2*t]=0;for(t=0;t<d;t++)e.dyn_dtree[2*t]=0;for(t=0;t<f;t++)e.bl_tree[2*t]=0;e.dyn_ltree[2*_]=1,e.opt_len=e.static_len=0,e.last_lit=e.matches=0}function U(e){8<e.bi_valid?L(e,e.bi_buf):0<e.bi_valid&&(e.pending_buf[e.pending++]=e.bi_buf),e.bi_buf=0,e.bi_valid=0}function ee(e,t,n,r){var i=2*t,a=2*n;return e[i]<e[a]||e[i]===e[a]&&r[t]<=r[n]}function W(e,t,n){for(var r=e.heap[n],i=n<<1;i<=e.heap_len&&(i<e.heap_len&&ee(t,e.heap[i+1],e.heap[i],e.depth)&&i++,!ee(t,r,e.heap[i],e.depth));)e.heap[n]=e.heap[i],n=i,i<<=1;e.heap[n]=r}function te(e,t,n){var r,i,a,o,s=0;if(e.last_lit!==0)for(;r=e.pending_buf[e.d_buf+2*s]<<8|e.pending_buf[e.d_buf+2*s+1],i=e.pending_buf[e.l_buf+s],s++,r===0?z(e,i,t):(z(e,(a=O[i])+l+1,t),(o=x[a])!==0&&R(e,i-=k[a],o),z(e,a=I(--r),n),(o=S[a])!==0&&R(e,r-=N[a],o)),s<e.last_lit;);z(e,_,t)}function ne(e,t){var n,r,i,a=t.dyn_tree,o=t.stat_desc.static_tree,s=t.stat_desc.has_stree,c=t.stat_desc.elems,l=-1;for(e.heap_len=0,e.heap_max=p,n=0;n<c;n++)a[2*n]===0?a[2*n+1]=0:(e.heap[++e.heap_len]=l=n,e.depth[n]=0);for(;e.heap_len<2;)a[2*(i=e.heap[++e.heap_len]=l<2?++l:0)]=1,e.depth[i]=0,e.opt_len--,s&&(e.static_len-=o[2*i+1]);for(t.max_code=l,n=e.heap_len>>1;1<=n;n--)W(e,a,n);for(i=c;n=e.heap[1],e.heap[1]=e.heap[e.heap_len--],W(e,a,1),r=e.heap[1],e.heap[--e.heap_max]=n,e.heap[--e.heap_max]=r,a[2*i]=a[2*n]+a[2*r],e.depth[i]=(e.depth[n]>=e.depth[r]?e.depth[n]:e.depth[r])+1,a[2*n+1]=a[2*r+1]=i,e.heap[1]=i++,W(e,a,1),2<=e.heap_len;);e.heap[--e.heap_max]=e.heap[1],function(e,t){var n,r,i,a,o,s,c=t.dyn_tree,l=t.max_code,u=t.stat_desc.static_tree,d=t.stat_desc.has_stree,f=t.stat_desc.extra_bits,h=t.stat_desc.extra_base,g=t.stat_desc.max_length,_=0;for(a=0;a<=m;a++)e.bl_count[a]=0;for(c[2*e.heap[e.heap_max]+1]=0,n=e.heap_max+1;n<p;n++)g<(a=c[2*c[2*(r=e.heap[n])+1]+1]+1)&&(a=g,_++),c[2*r+1]=a,l<r||(e.bl_count[a]++,o=0,h<=r&&(o=f[r-h]),s=c[2*r],e.opt_len+=s*(a+o),d&&(e.static_len+=s*(u[2*r+1]+o)));if(_!==0){do{for(a=g-1;e.bl_count[a]===0;)a--;e.bl_count[a]--,e.bl_count[a+1]+=2,e.bl_count[g]--,_-=2}while(0<_);for(a=g;a!==0;a--)for(r=e.bl_count[a];r!==0;)l<(i=e.heap[--n])||(c[2*i+1]!==a&&(e.opt_len+=(a-c[2*i+1])*c[2*i],c[2*i+1]=a),r--)}}(e,t),V(a,l,e.bl_count)}function re(e,t,n){var r,i,a=-1,o=t[1],s=0,c=7,l=4;for(o===0&&(c=138,l=3),t[2*(n+1)+1]=65535,r=0;r<=n;r++)i=o,o=t[2*(r+1)+1],++s<c&&i===o||(s<l?e.bl_tree[2*i]+=s:i===0?s<=10?e.bl_tree[2*y]++:e.bl_tree[2*b]++:(i!==a&&e.bl_tree[2*i]++,e.bl_tree[2*v]++),a=i,l=(s=0)===o?(c=138,3):i===o?(c=6,3):(c=7,4))}function ie(e,t,n){var r,i,a=-1,o=t[1],s=0,c=7,l=4;for(o===0&&(c=138,l=3),r=0;r<=n;r++)if(i=o,o=t[2*(r+1)+1],!(++s<c&&i===o)){if(s<l)for(;z(e,i,e.bl_tree),--s!=0;);else i===0?s<=10?(z(e,y,e.bl_tree),R(e,s-3,3)):(z(e,b,e.bl_tree),R(e,s-11,7)):(i!==a&&(z(e,i,e.bl_tree),s--),z(e,v,e.bl_tree),R(e,s-3,2));a=i,l=(s=0)===o?(c=138,3):i===o?(c=6,3):(c=7,4)}}o(N);var G=!1;function ae(e,t,n,i){R(e,(s<<1)+ +!!i,3),function(e,t,n,i){U(e),i&&(L(e,n),L(e,~n)),r.arraySet(e.pending_buf,e.window,t,n,e.pending),e.pending+=n}(e,t,n,!0)}n._tr_init=function(e){G||=(function(){var e,t,n,r,i,a=Array(m+1);for(r=n=0;r<c-1;r++)for(k[r]=n,e=0;e<1<<x[r];e++)O[n++]=r;for(O[n-1]=r,r=i=0;r<16;r++)for(N[r]=i,e=0;e<1<<S[r];e++)D[i++]=r;for(i>>=7;r<d;r++)for(N[r]=i<<7,e=0;e<1<<S[r]-7;e++)D[256+ i++]=r;for(t=0;t<=m;t++)a[t]=0;for(e=0;e<=143;)T[2*e+1]=8,e++,a[8]++;for(;e<=255;)T[2*e+1]=9,e++,a[9]++;for(;e<=279;)T[2*e+1]=7,e++,a[7]++;for(;e<=287;)T[2*e+1]=8,e++,a[8]++;for(V(T,u+1,a),e=0;e<d;e++)E[2*e+1]=5,E[2*e]=B(e,5);A=new P(T,x,l+1,u,m),j=new P(E,S,0,d,m),M=new P([],C,0,f,g)}(),!0),e.l_desc=new F(e.dyn_ltree,A),e.d_desc=new F(e.dyn_dtree,j),e.bl_desc=new F(e.bl_tree,M),e.bi_buf=0,e.bi_valid=0,H(e)},n._tr_stored_block=ae,n._tr_flush_block=function(e,t,n,r){var o,s,c=0;0<e.level?(e.strm.data_type===2&&(e.strm.data_type=function(e){var t,n=4093624447;for(t=0;t<=31;t++,n>>>=1)if(1&n&&e.dyn_ltree[2*t]!==0)return i;if(e.dyn_ltree[18]!==0||e.dyn_ltree[20]!==0||e.dyn_ltree[26]!==0)return a;for(t=32;t<l;t++)if(e.dyn_ltree[2*t]!==0)return a;return i}(e)),ne(e,e.l_desc),ne(e,e.d_desc),c=function(e){var t;for(re(e,e.dyn_ltree,e.l_desc.max_code),re(e,e.dyn_dtree,e.d_desc.max_code),ne(e,e.bl_desc),t=f-1;3<=t&&e.bl_tree[2*w[t]+1]===0;t--);return e.opt_len+=3*(t+1)+5+5+4,t}(e),o=e.opt_len+3+7>>>3,(s=e.static_len+3+7>>>3)<=o&&(o=s)):o=s=n+5,n+4<=o&&t!==-1?ae(e,t,n,r):e.strategy===4||s===o?(R(e,2+ +!!r,3),te(e,T,E)):(R(e,4+ +!!r,3),function(e,t,n,r){var i;for(R(e,t-257,5),R(e,n-1,5),R(e,r-4,4),i=0;i<r;i++)R(e,e.bl_tree[2*w[i]+1],3);ie(e,e.dyn_ltree,t-1),ie(e,e.dyn_dtree,n-1)}(e,e.l_desc.max_code+1,e.d_desc.max_code+1,c+1),te(e,e.dyn_ltree,e.dyn_dtree)),H(e),r&&U(e)},n._tr_tally=function(e,t,n){return e.pending_buf[e.d_buf+2*e.last_lit]=t>>>8&255,e.pending_buf[e.d_buf+2*e.last_lit+1]=255&t,e.pending_buf[e.l_buf+e.last_lit]=255&n,e.last_lit++,t===0?e.dyn_ltree[2*n]++:(e.matches++,t--,e.dyn_ltree[2*(O[n]+l+1)]++,e.dyn_dtree[2*I(t)]++),e.last_lit===e.lit_bufsize-1},n._tr_align=function(e){R(e,2,3),z(e,_,T),function(e){e.bi_valid===16?(L(e,e.bi_buf),e.bi_buf=0,e.bi_valid=0):8<=e.bi_valid&&(e.pending_buf[e.pending++]=255&e.bi_buf,e.bi_buf>>=8,e.bi_valid-=8)}(e)}},{"../utils/common":41}],53:[function(e,t,n){t.exports=function(){this.input=null,this.next_in=0,this.avail_in=0,this.total_in=0,this.output=null,this.next_out=0,this.avail_out=0,this.total_out=0,this.msg=``,this.state=null,this.data_type=2,this.adler=0}},{}],54:[function(e,t,n){(function(e){(function(e,t){if(!e.setImmediate){var n,r,i,a,o=1,s={},c=!1,l=e.document,u=Object.getPrototypeOf&&Object.getPrototypeOf(e);u=u&&u.setTimeout?u:e,n={}.toString.call(e.process)===`[object process]`?function(e){process.nextTick(function(){f(e)})}:function(){if(e.postMessage&&!e.importScripts){var t=!0,n=e.onmessage;return e.onmessage=function(){t=!1},e.postMessage(``,`*`),e.onmessage=n,t}}()?(a=`setImmediate$`+Math.random()+`$`,e.addEventListener?e.addEventListener(`message`,p,!1):e.attachEvent(`onmessage`,p),function(t){e.postMessage(a+t,`*`)}):e.MessageChannel?((i=new MessageChannel).port1.onmessage=function(e){f(e.data)},function(e){i.port2.postMessage(e)}):l&&`onreadystatechange`in l.createElement(`script`)?(r=l.documentElement,function(e){var t=l.createElement(`script`);t.onreadystatechange=function(){f(e),t.onreadystatechange=null,r.removeChild(t),t=null},r.appendChild(t)}):function(e){setTimeout(f,0,e)},u.setImmediate=function(e){typeof e!=`function`&&(e=Function(``+e));for(var t=Array(arguments.length-1),r=0;r<t.length;r++)t[r]=arguments[r+1];return s[o]={callback:e,args:t},n(o),o++},u.clearImmediate=d}function d(e){delete s[e]}function f(e){if(c)setTimeout(f,0,e);else{var n=s[e];if(n){c=!0;try{(function(e){var n=e.callback,r=e.args;switch(r.length){case 0:n();break;case 1:n(r[0]);break;case 2:n(r[0],r[1]);break;case 3:n(r[0],r[1],r[2]);break;default:n.apply(t,r)}})(n)}finally{d(e),c=!1}}}}function p(t){t.source===e&&typeof t.data==`string`&&t.data.indexOf(a)===0&&f(+t.data.slice(a.length))}})(typeof self>`u`?e===void 0?this:e:self)}).call(this,typeof global<`u`?global:typeof self<`u`?self:typeof window<`u`?window:{})},{}]},{},[10])(10)})}))(),1);function Di(e){if(e.length===0)return new Float32Array;if(e.length%4!=0)throw Error(`Byte-shuffled float32 payload has invalid length (${e.length}).`);let t=e.length/4,n=new Uint8Array(e.length);for(let r=0;r<4;r+=1){let i=r*t,a=r;for(let r=0;r<t;r+=1)n[a]=e[i+r],a+=4}return new Float32Array(n.buffer)}function Oi(e){if(e.length===0)return new Float32Array;if(e.length%4!=0)throw Error(`XOR-delta byte-shuffled float32 payload has invalid length (${e.length}).`);let t=e.length/4,n=ji(e,t),r=new Uint32Array(n.buffer),i=new Uint32Array(t),a=0;for(let e=0;e<t;e+=1){let t=r[e]^a;i[e]=t,a=t}return new Float32Array(i.buffer)}function ki(e){if(e.length===0)return new Uint8Array;if(e.length%4!=0)throw Error(`Channel-major float32 source length must be divisible by 4 (${e.length}).`);let t=e.length/4,n=new Float32Array(e.length);for(let r=0;r<4;r+=1){let i=r*t,a=r;for(let r=0;r<t;r+=1)n[i+r]=e[a],a+=4}return new Uint8Array(n.buffer)}function Ai(e){if(e.length===0)return new Float32Array;if(e.length%16!=0)throw Error(`Channel-major float32 payload has invalid length (${e.length}).`);let t=new Float32Array(e.buffer,e.byteOffset,e.byteLength/4),n=t.length/4,r=new Float32Array(t.length);for(let e=0;e<4;e+=1){let i=e*n,a=e;for(let e=0;e<n;e+=1)r[a]=t[i+e],a+=4}return r}function ji(e,t){let n=new Uint8Array(e.length);for(let r=0;r<4;r+=1){let i=r*t,a=r;for(let r=0;r<t;r+=1)n[a]=e[i+r],a+=4}return n}async function Mi(e,t,n,r,i,a,o={}){let s=o.encodeRasterImages??!0,c=o.zipCompression??`DEFLATE`,l=o.zipDeflateLevel??9,u=new Ei.default,d=Ni(e,t,i),f=!!r&&r.length>0&&e.imagePaintOpCount>0&&a.length===0,p=f?[]:a,m=p[0]??null,h=f?`source/source.pdf`:void 0;for(let e of d){let t=ca(e);u.file(e.filePath,t)}h&&r&&u.file(h,r);let g=[];for(let e=0;e<p.length;e+=1){let t=p[e],n=t.width*t.height*4,r=t.data.subarray(0,n),i=`raster/layer-${e}.rgba`,a=`rgba`,o=r;if(s){let n=await Zi(t.width,t.height,r);n&&(i=`raster/layer-${e}.${n.extension}`,a=n.encoding,o=n.bytes)}u.file(i,o,{compression:`STORE`}),g.push({width:t.width,height:t.height,matrix:Array.from(t.matrix),file:i,encoding:a})}let _={formatVersion:3,sourceFile:n,sourcePdfFile:h,sourcePdfSizeBytes:f?r?.length??0:0,generatedAt:new Date().toISOString(),scene:{bounds:e.bounds,pageBounds:e.pageBounds,pageRects:Array.from(e.pageRects),pageTextRanges:Array.from(e.pageTextRanges),pageCount:e.pageCount,pagesPerRow:e.pagesPerRow,maxHalfWidth:e.maxHalfWidth,operatorCount:e.operatorCount,imagePaintOpCount:e.imagePaintOpCount,pathCount:e.pathCount,sourceSegmentCount:e.sourceSegmentCount,mergedSegmentCount:e.mergedSegmentCount,segmentCount:e.segmentCount,fillPathCount:e.fillPathCount,fillSegmentCount:e.fillSegmentCount,textInstanceCount:e.textInstanceCount,textGlyphCount:e.textGlyphCount,textGlyphPrimitiveCount:e.textGlyphSegmentCount,rasterLayers:g,rasterLayerWidth:m?.width??0,rasterLayerHeight:m?.height??0,rasterLayerMatrix:m?Array.from(m.matrix):void 0,rasterLayerFile:g[0]?.file},textures:d.map(e=>({name:e.name,file:e.filePath,width:e.width,height:e.height,channels:4,componentType:e.componentType,layout:e.layout,quantizationMin:e.quantizationMin,quantizationMax:e.quantizationMax,byteShuffle:!1,predictor:`none`,logicalItemCount:e.logicalItemCount,logicalFloatCount:e.logicalFloatCount,byteLength:e.data.byteLength,paddedFloatCount:e.logicalFloatCount}))};u.file(`manifest.json`,JSON.stringify(_,null,2));let v=c===`DEFLATE`?{type:`blob`,compression:`DEFLATE`,compressionOptions:{level:l}}:{type:`blob`,compression:`STORE`},y=await u.generateAsync(v);return{blob:y,byteLength:y.size,textureCount:d.length,rasterLayerCount:p.length,layout:i}}function Ni(e,t,n){return[sa(`fill-path-meta-a`,e.fillPathMetaA,t.fillPathTextureWidth,t.fillPathTextureHeight,e.fillPathCount,n),sa(`fill-path-meta-b`,e.fillPathMetaB,t.fillPathTextureWidth,t.fillPathTextureHeight,e.fillPathCount,n),sa(`fill-path-meta-c`,e.fillPathMetaC,t.fillPathTextureWidth,t.fillPathTextureHeight,e.fillPathCount,n),sa(`fill-primitives-a`,e.fillSegmentsA,t.fillSegmentTextureWidth,t.fillSegmentTextureHeight,e.fillSegmentCount,n),sa(`fill-primitives-b`,e.fillSegmentsB,t.fillSegmentTextureWidth,t.fillSegmentTextureHeight,e.fillSegmentCount,n),sa(`stroke-primitives-a`,e.endpoints,t.textureWidth,t.textureHeight,e.segmentCount,n),sa(`stroke-primitives-b`,e.primitiveMeta,t.textureWidth,t.textureHeight,e.segmentCount,n),sa(`stroke-styles`,e.styles,t.textureWidth,t.textureHeight,e.segmentCount,n),sa(`text-instance-a`,e.textInstanceA,t.textInstanceTextureWidth,t.textInstanceTextureHeight,e.textInstanceCount,n),sa(`text-instance-b`,e.textInstanceB,t.textInstanceTextureWidth,t.textInstanceTextureHeight,e.textInstanceCount,n),sa(`text-instance-c`,e.textInstanceC,t.textInstanceTextureWidth,t.textInstanceTextureHeight,e.textInstanceCount,n),sa(`text-glyph-meta-a`,e.textGlyphMetaA,t.textGlyphTextureWidth,t.textGlyphTextureHeight,e.textGlyphCount,n),sa(`text-glyph-meta-b`,e.textGlyphMetaB,t.textGlyphTextureWidth,t.textGlyphTextureHeight,e.textGlyphCount,n),sa(`text-glyph-primitives-a`,e.textGlyphSegmentsA,t.textSegmentTextureWidth,t.textSegmentTextureHeight,e.textGlyphSegmentCount,n),sa(`text-glyph-primitives-b`,e.textGlyphSegmentsB,t.textSegmentTextureWidth,t.textSegmentTextureHeight,e.textGlyphSegmentCount,n)]}async function Pi(e,t={}){let n=jt(t.onProgress),r=await n.child(0,.16,{sourceType:`zip`}).withIndeterminateProgress(Ei.default.loadAsync(e),{stage:`zip-open`,sourceType:`zip`}),i=r.file(`manifest.json`);if(!i)throw Error(`Parsed data zip is missing manifest.json.`);let a=await n.child(.16,.22,{sourceType:`zip`}).withIndeterminateProgress(i.async(`string`),{stage:`zip-manifest`,sourceType:`zip`}),o;try{o=JSON.parse(a)}catch(e){let t=e instanceof Error?e.message:String(e);throw Error(`Invalid manifest.json: ${t}`)}let s=typeof o.scene==`object`&&o.scene?o.scene:{},c=Array.isArray(o.textures)?o.textures:[],l=new Map,u=0,d=()=>{n.report(.22+u/16*.58,{stage:`zip-file`,sourceType:`zip`,unit:`files`,processed:u,total:16})};for(let e of c){let t=typeof e.name==`string`?e.name:null;t&&l.set(t,e)}let f=async(e,t)=>{try{d();for(let t of e){let e=l.get(t);if(!e)continue;let n=e.componentType===`uint8-normalized`?`.rgba8`:e.componentType===`uint16-normalized-range`?`.q16`:e.componentType===`stroke-primitive-b-u16-packed`?`.spb16`:typeof e.layout==`string`&&e.layout===`channel-major`?`.f32cm`:e.byteShuffle===!0?`.f32bs`:`.f32`,i=typeof e.file==`string`?e.file:`textures/${t}${n}`,a=r.file(i);if(!a)continue;let o=ha(await a.async(`arraybuffer`),e,t),s=$(e.logicalFloatCount,o.length);if(s>o.length)throw Error(`Texture ${t} logical float count exceeds file length.`);let c=$(e.logicalItemCount,Math.floor(s/4));return{data:o.slice(0,s),logicalItemCount:c}}if(t)throw Error(`Parsed data zip is missing required texture: ${e[0]}.`);return null}finally{u+=1,d()}},p=await f([`fill-path-meta-a`],!1),m=await f([`fill-path-meta-b`],!1),h=await f([`fill-path-meta-c`],!1),g=await f([`fill-primitives-a`,`fill-segments`],!1),_=await f([`fill-primitives-b`],!1),v=await f([`stroke-primitives-a`,`stroke-endpoints`],!1),y=await f([`stroke-primitives-b`],!1),b=await f([`stroke-styles`],!1),x=await f([`stroke-primitive-bounds`],!1),S=await f([`text-instance-a`],!1),C=await f([`text-instance-b`],!1),w=await f([`text-instance-c`],!1),T=await f([`text-glyph-meta-a`],!1),E=await f([`text-glyph-meta-b`],!1),D=await f([`text-glyph-primitives-a`],!1),O=await f([`text-glyph-primitives-b`],!1),k=$(s.fillPathCount,p?.logicalItemCount??0),A=$(s.fillSegmentCount,g?.logicalItemCount??0),j=$(s.segmentCount,b?.logicalItemCount??v?.logicalItemCount??0),M=$(s.textInstanceCount,S?.logicalItemCount??0),N=$(s.textGlyphCount,T?.logicalItemCount??0),P=$(s.textGlyphPrimitiveCount,$(s.textGlyphSegmentCount,D?.logicalItemCount??0));if(j>0&&(!v||!b))throw Error(`Parsed data zip is missing stroke geometry textures.`);let F=Ii(p?.data??new Float32Array,k,`fill-path-meta-a`),I=Ii(m?.data??new Float32Array,k,`fill-path-meta-b`),L=Ii(h?.data??new Float32Array,k,`fill-path-meta-c`),R=Ii(g?.data??new Float32Array,A,`fill-primitives-a`),z=_?Ii(_.data,A,`fill-primitives-b`):Li(R,A),B=Ii(v?.data??new Float32Array,j,`stroke-primitives-a`),V=Ii(b?.data??new Float32Array,j,`stroke-styles`),H=y?Ii(y.data,j,`stroke-primitives-b`):Li(B,j),U=x?Ii(x.data,j,`stroke-primitive-bounds`):Hi(B,H,j),ee=Ii(S?.data??new Float32Array,M,`text-instance-a`),W=Ii(C?.data??new Float32Array,M,`text-instance-b`),te=w?Ii(w.data,M,`text-instance-c`):Ri(W,M),ne=Ii(T?.data??new Float32Array,N,`text-glyph-meta-a`),re=Ii(E?.data??new Float32Array,N,`text-glyph-meta-b`),ie=Ii(D?.data??new Float32Array,P,`text-glyph-primitives-a`),G=Ii(O?.data??new Float32Array,P,`text-glyph-primitives-b`);Bi(H,V,j),Vi(I,L,k);let ae=$(s.sourceSegmentCount,j),oe=$(s.mergedSegmentCount,j),se=$(s.sourceTextCount,M),ce=$(s.textInPageCount,M),le=$(s.textOutOfPageCount,Math.max(0,se-ce)),ue=Math.max(1,$(s.pageCount,1)),de=Math.max(1,$(s.pagesPerRow,1));n.report(.82,{stage:`zip-file`,sourceType:`zip`,unit:`files`});let fe=await na(r,s);if(n.report(.88,{stage:`compile`,sourceType:`zip`}),fe.length===0){let e=await Xi(r,o);if(e)try{fe=Fi(await Rn(Ca(e),{maxPages:ue,maxPagesPerRow:de})),fe.length>0&&console.log(`[Parsed data load] Restored ${fe.length.toLocaleString()} raster layer(s) from embedded source PDF.`)}catch(e){let t=e instanceof Error?e.message:String(e);console.warn(`[Parsed data load] Failed to restore raster layers from source PDF: ${t}`)}}let pe=fe[0]??null,me=aa(s.maxHalfWidth,NaN)||ia(V,j),he=Ki(s.bounds),ge=Ki(s.pageBounds),_e=Gi(Ui(U,j),Wi(F,I,k))??{minX:0,minY:0,maxX:1,maxY:1},ve=he??_e,ye=ge??ve,be=qi(s.pageRects,ye),xe=Ji(s.pageTextRanges,Math.max(1,Math.floor(be.length/4)),M)??Un(be,W,M);n.report(.96,{stage:`compile`,sourceType:`zip`});let Se=Hn({pageRects:be,pageTextRanges:xe,fillPathCount:k,fillSegmentCount:A,fillPathMetaA:F,fillPathMetaB:I,fillPathMetaC:L,fillSegmentsA:R,fillSegmentsB:z,segmentCount:j,sourceSegmentCount:ae,mergedSegmentCount:oe,sourceTextCount:se,textInstanceCount:M,textGlyphCount:N,textGlyphSegmentCount:P,textInPageCount:ce,textOutOfPageCount:le,textInstanceA:ee,textInstanceB:W,textInstanceC:te,textGlyphMetaA:ne,textGlyphMetaB:re,textGlyphSegmentsA:ie,textGlyphSegmentsB:G,rasterLayers:fe,rasterLayerWidth:pe?.width??0,rasterLayerHeight:pe?.height??0,rasterLayerData:pe?.data??new Uint8Array,rasterLayerMatrix:pe?.matrix??new Float32Array([1,0,0,1,0,0]),endpoints:B,primitiveMeta:H,primitiveBounds:U,styles:V,bounds:ve,pageBounds:ye,pageCount:ue,pagesPerRow:de,maxHalfWidth:me,imagePaintOpCount:$(s.imagePaintOpCount,0),operatorCount:$(s.operatorCount,0),pathCount:$(s.pathCount,0),discardedTransparentCount:$(s.discardedTransparentCount,0),discardedDegenerateCount:$(s.discardedDegenerateCount,0),discardedDuplicateCount:$(s.discardedDuplicateCount,0),discardedContainedCount:$(s.discardedContainedCount,0)});return n.complete({sourceType:`zip`}),Se}function Fi(e){let t=[];if(Array.isArray(e.rasterLayers))for(let n of e.rasterLayers){let e=Math.max(0,Math.trunc(n?.width??0)),r=Math.max(0,Math.trunc(n?.height??0));if(e<=0||r<=0||!(n.data instanceof Uint8Array)||n.data.length<e*r*4)continue;let i=n.matrix instanceof Float32Array?n.matrix:new Float32Array(n.matrix);t.push({width:e,height:r,data:n.data,matrix:i})}if(t.length>0)return t;let n=Math.max(0,Math.trunc(e.rasterLayerWidth)),r=Math.max(0,Math.trunc(e.rasterLayerHeight));return n<=0||r<=0||e.rasterLayerData.length<n*r*4||t.push({width:n,height:r,data:e.rasterLayerData,matrix:e.rasterLayerMatrix}),t}function Ii(e,t,n){let r=t*4;if(r===0)return new Float32Array;if(e.length<r)throw Error(`Texture ${n} has insufficient data (${e.length} < ${r}).`);return e.length===r?e:e.slice(0,r)}function Li(e,t){let n=new Float32Array(t*4);for(let r=0;r<t;r+=1){let t=r*4;n[t]=e[t+2],n[t+1]=e[t+3],n[t+2]=0,n[t+3]=0}return n}function Ri(e,t){let n=new Float32Array(t*4);for(let r=0;r<t;r+=1){let t=r*4,i=zi(e[t+3]);n[t]=i,n[t+1]=i,n[t+2]=i,n[t+3]=1}return n}function zi(e){return!Number.isFinite(e)||e<0?0:e>1?1:e}function Bi(e,t,n){if(n<=0)return;let r=!1;for(let t=0;t<n;t+=1)if(Math.abs(e[t*4+3])>1e-6){r=!0;break}if(!r)for(let r=0;r<n;r+=1){let n=r*4,i=zi(t[n+1]),a=zi(t[n+2]),o=+(t[n+3]>=.5);t[n+1]=i,t[n+2]=i,t[n+3]=i,e[n+3]=a+o*2}}function Vi(e,t,n){if(n<=0)return;let r=!1;for(let e=0;e<n;e+=1)if(Math.abs(t[e*4+3])>1e-6){r=!0;break}if(!r)for(let r=0;r<n;r+=1){let n=r*4,i=zi(e[n+2]),a=zi(e[n+3]);e[n+2]=i,e[n+3]=i,t[n+2]=i,t[n+3]=a}}function Hi(e,t,n){let r=new Float32Array(n*4);for(let i=0;i<n;i+=1){let n=i*4,a=e[n],o=e[n+1],s=e[n+2],c=e[n+3],l=t[n],u=t[n+1];r[n]=Math.min(a,s,l),r[n+1]=Math.min(o,c,u),r[n+2]=Math.max(a,s,l),r[n+3]=Math.max(o,c,u)}return r}function Ui(e,t){if(t<=0||e.length<t*4)return null;let n=1/0,r=1/0,i=-1/0,a=-1/0;for(let o=0;o<t;o+=1){let t=o*4;n=Math.min(n,e[t]),r=Math.min(r,e[t+1]),i=Math.max(i,e[t+2]),a=Math.max(a,e[t+3])}return{minX:n,minY:r,maxX:i,maxY:a}}function Wi(e,t,n){if(n<=0||e.length<n*4||t.length<n*4)return null;let r=1/0,i=1/0,a=-1/0,o=-1/0;for(let s=0;s<n;s+=1){let n=s*4;r=Math.min(r,e[n+2]),i=Math.min(i,e[n+3]),a=Math.max(a,t[n]),o=Math.max(o,t[n+1])}return{minX:r,minY:i,maxX:a,maxY:o}}function Gi(e,t){return!e&&!t?null:e?t?{minX:Math.min(e.minX,t.minX),minY:Math.min(e.minY,t.minY),maxX:Math.max(e.maxX,t.maxX),maxY:Math.max(e.maxY,t.maxY)}:{...e}:t?{...t}:null}function Ki(e){if(!e||typeof e!=`object`)return null;let t=e,n=aa(t.minX,NaN),r=aa(t.minY,NaN),i=aa(t.maxX,NaN),a=aa(t.maxY,NaN);return[n,r,i,a].every(Number.isFinite)?{minX:n,minY:r,maxX:i,maxY:a}:null}function qi(e,t){if(Array.isArray(e)){let t=Math.floor(e.length/4);if(t>0){let n=new Float32Array(t*4),r=0;for(let i=0;i<t;i+=1){let t=i*4,a=Number(e[t]),o=Number(e[t+1]),s=Number(e[t+2]),c=Number(e[t+3]);[a,o,s,c].every(Number.isFinite)&&(n[r]=a,n[r+1]=o,n[r+2]=s,n[r+3]=c,r+=4)}if(r>0)return n.slice(0,r)}}return new Float32Array([t.minX,t.minY,t.maxX,t.maxY])}function Ji(e,t,n){if(!Array.isArray(e))return null;let r=Math.max(1,t|0);if(e.length<r*2)return null;let i=Math.max(0,n|0),a=new Uint32Array(r*2),o=0;for(let t=0;t<r;t+=1){let n=t*2,r=$(e[n],o),s=$(e[n+1],0),c=Math.min(Math.max(r,o),i),l=Math.min(s,Math.max(0,i-c));a[n]=c,a[n+1]=l,o=c+l}return a}function Yi(e){if(!Array.isArray(e)||e.length<6)return null;let t=new Float32Array(6);for(let n=0;n<6;n+=1){let r=Number(e[n]);if(!Number.isFinite(r))return null;t[n]=r}return t}async function Xi(e,t){let n=oa(t.sourcePdfFile),r=oa(t.sourcePdfUrl),i=[n,`source/source.pdf`,`source.pdf`];for(let t of i){if(!t)continue;let n=e.file(t);if(!n)continue;let r=await n.async(`arraybuffer`);if(!(r.byteLength<=0))return new Uint8Array(r)}if(r)try{let e=await fetch(Sa(r));if(e.ok){let t=await e.arrayBuffer();if(t.byteLength>0)return new Uint8Array(t)}}catch{}return null}async function Zi(e,t,n){let[r,i]=await Promise.all([Qi(e,t,n,`image/webp`),Qi(e,t,n,`image/png`)]);return!r&&!i?null:r&&!i?{bytes:r,encoding:`webp`,extension:`webp`}:i&&!r?{bytes:i,encoding:`png`,extension:`png`}:!r||!i?null:r.byteLength<i.byteLength?{bytes:r,encoding:`webp`,extension:`webp`}:{bytes:i,encoding:`png`,extension:`png`}}async function Qi(e,t,n,r){if(typeof document>`u`)return null;let i=e*t*4;if(e<=0||t<=0||n.length<i)return null;let a=document.createElement(`canvas`);a.width=e,a.height=t;let o=a.getContext(`2d`,{alpha:!0});if(!o)return a.width=0,a.height=0,null;let s=new Uint8ClampedArray(i);s.set(n.subarray(0,i));let c=new ImageData(s,e,t);o.putImageData(c,0,0);let l=await new Promise(e=>{a.toBlob(e,r)});if(a.width=0,a.height=0,!l)return null;let u=await l.arrayBuffer();return new Uint8Array(u)}function $i(e){let t=e.toLowerCase();return t.endsWith(`.png`)?`image/png`:t.endsWith(`.webp`)?`image/webp`:t.endsWith(`.jpg`)||t.endsWith(`.jpeg`)?`image/jpeg`:null}async function ea(e,t){if(typeof document>`u`)return null;let n=$i(e);if(!n)return null;let r=new Uint8Array(t.length);r.set(t);let i=new Blob([r],{type:n}),a=await createImageBitmap(i);try{let e=a.width,t=a.height;if(e<=0||t<=0)return null;let n=document.createElement(`canvas`);n.width=e,n.height=t;let r=n.getContext(`2d`,{alpha:!0,willReadFrequently:!0});if(!r)return n.width=0,n.height=0,null;r.drawImage(a,0,0);let i=r.getImageData(0,0,e,t),o=new Uint8Array(i.data);return n.width=0,n.height=0,{width:e,height:t,data:o}}finally{a.close()}}async function ta(e){try{let t=await Ei.default.loadAsync(e),n=t.file(`manifest.json`),r=null;if(n){let e=await n.async(`string`);try{r=oa(JSON.parse(e).sourcePdfFile)}catch{r=null}}let i=[r,`source/source.pdf`,`source.pdf`];for(let e of i){if(!e)continue;let n=t.file(e);if(!n)continue;let r=await n.async(`arraybuffer`);if(!(r.byteLength<=0))return new Uint8Array(r)}}catch{}return null}async function na(e,t){let n=[],r=Array.isArray(t.rasterLayers)?t.rasterLayers:[];for(let t=0;t<r.length;t+=1){let i=r[t];if(!i||typeof i!=`object`)continue;let a=i,o=$(a.width,0),s=$(a.height,0),c=typeof a.file==`string`?a.file:`raster/layer-${t}.rgba`,l=Yi(a.matrix)??new Float32Array([1,0,0,1,0,0]),u=await ra(e,c,o,s);!u||u.width<=0||u.height<=0||u.data.length<u.width*u.height*4||n.push({width:u.width,height:u.height,matrix:l,data:u.data})}if(n.length>0)return n;let i=$(t.rasterLayerWidth,0),a=$(t.rasterLayerHeight,0),o=Yi(t.rasterLayerMatrix)??new Float32Array([1,0,0,1,0,0]),s=e.file(`raster/layer-0.webp`)?`raster/layer-0.webp`:e.file(`raster/layer-0.png`)?`raster/layer-0.png`:e.file(`raster/layer-0.rgba`)?`raster/layer-0.rgba`:e.file(`raster/layer.webp`)?`raster/layer.webp`:e.file(`raster/layer.png`)?`raster/layer.png`:`raster/layer.rgba`,c=await ra(e,typeof t.rasterLayerFile==`string`?t.rasterLayerFile:s,i,a);return c&&c.width>0&&c.height>0&&c.data.length>=c.width*c.height*4&&n.push({width:c.width,height:c.height,data:c.data,matrix:o}),n}async function ra(e,t,n,r){let i=e.file(t);if(!i)return null;let a=await i.async(`arraybuffer`),o=new Uint8Array(a),s=await ea(t,o);if(s)return s;if(n<=0||r<=0)return null;let c=n*r*4;if(o.length<c)throw Error(`Raster layer data is truncated (${o.length} < ${c}).`);return{width:n,height:r,data:o.length===c?o:o.slice(0,c)}}function ia(e,t){let n=0;for(let r=0;r<t;r+=1)n=Math.max(n,e[r*4]);return n}function aa(e,t){let n=Number(e);return Number.isFinite(n)?n:t}function $(e,t){let n=Number(e);return Number.isFinite(n)?Math.max(0,Math.trunc(n)):Math.max(0,Math.trunc(t))}function oa(e){if(typeof e!=`string`)return null;let t=e.trim();return t.length>0?t:null}function sa(e,t,n,r,i,a){let o=i*4;if(t.length<o)throw Error(`Texture ${e} has insufficient data (${t.length} < ${o}).`);let s=la(e,t.subarray(0,o),a);return{name:e,filePath:`textures/${e}${s.suffix}`,width:n,height:r,logicalItemCount:i,logicalFloatCount:o,data:s.data,componentType:s.componentType,layout:s.layout,quantizationMin:s.quantizationMin,quantizationMax:s.quantizationMax}}function ca(e){return e.data}function la(e,t,n){if(e===`text-instance-c`)return{data:da(t),componentType:`uint8-normalized`,layout:`interleaved`,suffix:`.rgba8`};if(e===`stroke-primitives-b`){let e=pa(t);return{data:e.data,componentType:`stroke-primitive-b-u16-packed`,layout:`interleaved`,suffix:`.spb16`,quantizationMin:Array.from(e.min),quantizationMax:Array.from(e.max)}}if(ua(e)){let e=fa(t);return{data:e.data,componentType:`uint16-normalized-range`,layout:`interleaved`,suffix:`.q16`,quantizationMin:Array.from(e.min),quantizationMax:Array.from(e.max)}}return{data:n===`channel-major`?ki(t):new Uint8Array(t.buffer,t.byteOffset,t.byteLength).slice(),componentType:`float32`,layout:n,suffix:n===`channel-major`?`.f32cm`:`.f32`}}function ua(e){return e===`fill-primitives-a`||e===`fill-primitives-b`||e===`stroke-primitives-a`||e===`text-glyph-primitives-a`||e===`text-glyph-primitives-b`}function da(e){let t=new Uint8Array(e.length);for(let n=0;n<e.length;n+=1){let r=Number.isFinite(e[n])?e[n]:0;t[n]=Math.round(zi(r)*255)}return t}function fa(e){let t=Math.floor(e.length/4),n=new Float32Array([1/0,1/0,1/0,1/0]),r=new Float32Array([-1/0,-1/0,-1/0,-1/0]);for(let i=0;i<t;i+=1){let t=i*4;for(let i=0;i<4;i+=1){let a=e[t+i];Number.isFinite(a)&&(n[i]=Math.min(n[i],a),r[i]=Math.max(r[i],a))}}for(let e=0;e<4;e+=1)(!Number.isFinite(n[e])||!Number.isFinite(r[e]))&&(n[e]=0,r[e]=0);let i=new Uint16Array(e.length);for(let a=0;a<t;a+=1){let t=a*4;for(let a=0;a<4;a+=1){let o=r[a]-n[a];if(Math.abs(o)<=1e-20){i[t+a]=0;continue}let s=((Number.isFinite(e[t+a])?e[t+a]:n[a])-n[a])/o;i[t+a]=Math.round(zi(s)*65535)}}return{data:new Uint8Array(i.buffer),min:n,max:r}}function pa(e){let t=Math.floor(e.length/4),n=new Float32Array([1/0,1/0,0,0]),r=new Float32Array([-1/0,-1/0,1,0]);for(let i=0;i<t;i+=1){let t=i*4,a=e[t],o=e[t+1];Number.isFinite(a)&&(n[0]=Math.min(n[0],a),r[0]=Math.max(r[0],a)),Number.isFinite(o)&&(n[1]=Math.min(n[1],o),r[1]=Math.max(r[1],o))}for(let e=0;e<2;e+=1)(!Number.isFinite(n[e])||!Number.isFinite(r[e]))&&(n[e]=0,r[e]=0);let i=new Uint16Array(e.length);for(let a=0;a<t;a+=1){let t=a*4;i[t]=ma(e[t],n[0],r[0]),i[t+1]=ma(e[t+1],n[1],r[1]),i[t+2]=+(e[t+2]>=.5);let o=Number.isFinite(e[t+3])?e[t+3]:0,s=Math.min(15,Math.max(0,Math.floor(o/2+1e-6))),c=zi(o-s*2),l=Math.round(c*4095);i[t+3]=s<<12|l}return{data:new Uint8Array(i.buffer),min:n,max:r}}function ma(e,t,n){let r=n-t;return Math.abs(r)<=1e-20?0:Math.round(zi(((Number.isFinite(e)?e:t)-t)/r)*65535)}function ha(e,t,n){let r=typeof t.componentType==`string`?t.componentType:`float32`;if(r===`uint8-normalized`)return ga(new Uint8Array(e));if(r===`uint16-normalized-range`)return _a(new Uint8Array(e),t,n);if(r===`stroke-primitive-b-u16-packed`)return va(new Uint8Array(e),t,n);if(r!==`float32`)throw Error(`Texture ${n} has unsupported componentType ${String(r)}.`);let i=typeof t.layout==`string`?t.layout:`interleaved`;if(i!==`interleaved`&&i!==`channel-major`)throw Error(`Texture ${n} has unsupported layout ${String(i)}.`);if(i===`channel-major`)return Ai(new Uint8Array(e));let a=t.byteShuffle===!0,o=typeof t.predictor==`string`?t.predictor:`none`;if(o!==`none`&&o!==`xor-delta-u32`)throw Error(`Texture ${n} has unsupported predictor ${String(o)}.`);if(a)return o===`xor-delta-u32`?Oi(new Uint8Array(e)):Di(new Uint8Array(e));if(o!==`none`)throw Error(`Texture ${n} declares predictor ${o} without byteShuffle.`);if(e.byteLength%4!=0)throw Error(`Texture ${n} has invalid byte length (${e.byteLength}).`);return new Float32Array(e)}function ga(e){let t=new Float32Array(e.length);for(let n=0;n<e.length;n+=1)t[n]=e[n]/255;return t}function _a(e,t,n){if(e.byteLength%2!=0)throw Error(`Texture ${n} has invalid uint16 byte length (${e.byteLength}).`);let r=ya(t.quantizationMin,n,`quantizationMin`),i=ya(t.quantizationMax,n,`quantizationMax`),a=new Uint16Array(e.buffer,e.byteOffset,e.byteLength/2),o=new Float32Array(a.length);for(let e=0;e<a.length;e+=1){let t=e&3,n=i[t]-r[t];o[e]=Math.abs(n)<=1e-20?r[t]:r[t]+a[e]/65535*n}return o}function va(e,t,n){if(e.byteLength%8!=0)throw Error(`Texture ${n} has invalid packed stroke primitive byte length (${e.byteLength}).`);let r=ya(t.quantizationMin,n,`quantizationMin`),i=ya(t.quantizationMax,n,`quantizationMax`),a=new Uint16Array(e.buffer,e.byteOffset,e.byteLength/2),o=new Float32Array(a.length),s=i[0]-r[0],c=i[1]-r[1];for(let e=0;e<a.length;e+=4){o[e]=Math.abs(s)<=1e-20?r[0]:r[0]+a[e]/65535*s,o[e+1]=Math.abs(c)<=1e-20?r[1]:r[1]+a[e+1]/65535*c,o[e+2]=+(a[e+2]>=1);let t=a[e+3],n=t>>>12,i=(t&4095)/4095;o[e+3]=i+n*2}return o}function ya(e,t,n){if(!Array.isArray(e)||e.length<4)throw Error(`Texture ${t} is missing ${n}.`);let r=new Float32Array(4);for(let i=0;i<4;i+=1){let a=Number(e[i]);if(!Number.isFinite(a))throw Error(`Texture ${t} has invalid ${n}[${i}].`);r[i]=a}return r}var ba=/^[a-z][a-z\d+.-]*:/i,xa=new URL(`./`,window.location.href);function Sa(e){let t=e.trim();if(ba.test(t))return t;let n=t.replace(/^\/+/,``);return new URL(n,xa).toString()}function Ca(e){return e.slice().buffer}var wa=/^[a-z][a-z\d+.-]*:/i;function Ta(e){let t=e.trim();if(wa.test(t))return t;let n=t.replace(/^\/+/,``),r=new URL(`./`,window.location.href);return new URL(n,r).toString()}function Ea(e){let t=Array.isArray(e.examples)?e.examples:[],n=[];for(let e=0;e<t.length;e+=1){let r=t[e],i=Oa(r?.name);if(!i)continue;let a=Oa(r?.id)??`example-${e+1}`,o=Oa(r?.pdf?.path),s=Oa(r?.parsedZip?.path),c=o?Ta(o):null,l=s?Ta(s):null;!c||!l||n.push({id:a,name:i,pdfPath:c,pdfSizeBytes:Da(r?.pdf?.sizeBytes,0),zipPath:l,zipSizeBytes:Da(r?.parsedZip?.sizeBytes,0)})}return n}function Da(e,t){let n=Number(e);return Number.isFinite(n)?Math.max(0,Math.trunc(n)):Math.max(0,Math.trunc(t))}function Oa(e){if(typeof e!=`string`)return null;let t=e.trim();return t.length>0?t:null}export{g as C,E as S,ye as _,Pi as a,Se as b,In as c,Mt as d,_t as f,we as g,Te as h,Fi as i,Fn as l,be as m,Ta as n,ta as o,xe as p,Mi as r,Ti as s,Ea as t,jt as u,ve as v,d as w,Ee as x,Ce as y};