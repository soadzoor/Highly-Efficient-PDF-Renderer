(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const a of document.querySelectorAll('link[rel="modulepreload"]'))s(a);new MutationObserver(a=>{for(const r of a)if(r.type==="childList")for(const i of r.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&s(i)}).observe(document,{childList:!0,subtree:!0});function e(a){const r={};return a.integrity&&(r.integrity=a.integrity),a.referrerPolicy&&(r.referrerPolicy=a.referrerPolicy),a.crossOrigin==="use-credentials"?r.credentials="include":a.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function s(a){if(a.ep)return;a.ep=!0;const r=e(a);fetch(a.href,r)}})();const bs=""+new URL("pdf.worker.min-wgc6bjNh.mjs",import.meta.url).href,nn=64,rn=1024,Si=3e4,wi=22e4;function Zn(n){const t=n.segmentCount,e=Math.max(n.bounds.maxX-n.bounds.minX,1e-5),s=Math.max(n.bounds.maxY-n.bounds.minY,1e-5),{gridWidth:a,gridHeight:r}=_i(t,e,s),i=a*r,o=e/a,l=s/r,c=new Uint32Array(i);let p=0;for(let h=0;h<t;h+=1){const x=h*4,T=h*4,w=n.styles[T]+.35,R=n.primitiveBounds[x]-w,A=n.primitiveBounds[x+1]-w,S=n.primitiveBounds[x+2]+w,k=n.primitiveBounds[x+3]+w,G=Gt(Math.floor((R-n.bounds.minX)/o),a),B=Gt(Math.floor((S-n.bounds.minX)/o),a),I=Gt(Math.floor((A-n.bounds.minY)/l),r),P=Gt(Math.floor((k-n.bounds.minY)/l),r);for(let v=I;v<=P;v+=1){let E=v*a+G;for(let u=G;u<=B;u+=1){const F=c[E]+1;c[E]=F,F>p&&(p=F),E+=1}}}const m=new Uint32Array(i+1);for(let h=0;h<i;h+=1)m[h+1]=m[h]+c[h];const g=m[i],f=new Uint32Array(g),y=m.slice(0,i);for(let h=0;h<t;h+=1){const x=h*4,T=h*4,w=n.styles[T]+.35,R=n.primitiveBounds[x]-w,A=n.primitiveBounds[x+1]-w,S=n.primitiveBounds[x+2]+w,k=n.primitiveBounds[x+3]+w,G=Gt(Math.floor((R-n.bounds.minX)/o),a),B=Gt(Math.floor((S-n.bounds.minX)/o),a),I=Gt(Math.floor((A-n.bounds.minY)/l),r),P=Gt(Math.floor((k-n.bounds.minY)/l),r);for(let v=I;v<=P;v+=1){let E=v*a+G;for(let u=G;u<=B;u+=1){const F=y[E];f[F]=h,y[E]=F+1,E+=1}}}return{gridWidth:a,gridHeight:r,minX:n.bounds.minX,minY:n.bounds.minY,maxX:n.bounds.maxX,maxY:n.bounds.maxY,cellWidth:o,cellHeight:l,offsets:m,counts:c,indices:f,maxCellPopulation:p}}function _i(n,t,e){const s=Be(Math.round(n/8),Si,wi),a=t/e;let r=Math.round(Math.sqrt(s*a)),i=Math.round(s/Math.max(r,1));return r=Be(r,nn,rn),i=Be(i,nn,rn),{gridWidth:r,gridHeight:i}}function Gt(n,t){return n<0?0:n>=t?t-1:n}function Be(n,t,e){return n<t?t:n>e?e:n}const Mi=96,Ri=[1,.85,.7,.55,.4,.3],Ye=8,an=256,$t=8,sn=.001;function jn(n,t){if(typeof document>"u"||n.textGlyphCount<=0)return null;const e=new Float32Array(n.textGlyphCount*4),s=ie(Math.trunc(t)||4096,256,8192);let a=null;for(const c of Ri){const p=Math.max(Ye,Math.round(Mi*c)),m=Ei(n,p);if(m.length===0)return null;const g=Ii(m,s);if(g){a=g;break}}if(!a)return null;const r=document.createElement("canvas");r.width=a.width,r.height=a.height;const i=r.getContext("2d",{alpha:!0,willReadFrequently:!0});if(!i)return null;i.setTransform(1,0,0,1,0,0),i.clearRect(0,0,a.width,a.height),i.fillStyle="#ffffff",i.globalCompositeOperation="source-over";for(const c of a.placements){if(!Pi(i,c,n))continue;i.fill("nonzero");const p=c.index*4;e[p]=(c.x+$t)/a.width,e[p+1]=(c.y+$t)/a.height,e[p+2]=c.innerWidth/a.width,e[p+3]=c.innerHeight/a.height}const o=i.getImageData(0,0,a.width,a.height),l=new Uint8Array(o.data);return{width:a.width,height:a.height,rgba:l,glyphUvRects:e}}function Ei(n,t){const e=[];for(let s=0;s<n.textGlyphCount;s+=1){const a=s*4,r=Math.max(0,Math.trunc(n.textGlyphMetaA[a])),i=Math.max(0,Math.trunc(n.textGlyphMetaA[a+1]));if(i<=0)continue;const o=n.textGlyphMetaA[a+2],l=n.textGlyphMetaA[a+3],c=n.textGlyphMetaB[a],p=n.textGlyphMetaB[a+1],m=c-o,g=p-l;if(!Number.isFinite(m)||!Number.isFinite(g)||m<=1e-6||g<=1e-6)continue;const f=t/Math.max(m,g),y=ie(Math.ceil(m*f),Ye,an),h=ie(Math.ceil(g*f),Ye,an);e.push({index:s,segmentStart:r,segmentCount:i,minX:o,minY:l,maxX:c,maxY:p,innerWidth:y,innerHeight:h,tileWidth:y+$t*2,tileHeight:h+$t*2,x:0,y:0})}return e}function Ii(n,t){if(n.length===0)return null;const e=n.slice().sort((i,o)=>i.tileHeight!==o.tileHeight?o.tileHeight-i.tileHeight:o.tileWidth-i.tileWidth),s=e.reduce((i,o)=>i+o.tileWidth*o.tileHeight,0),a=e.reduce((i,o)=>Math.max(i,o.tileWidth),0);let r=ie(ln(Math.ceil(Math.sqrt(s)*1.15)),a,t);for(;r<=t;){let i=0,o=0,l=0,c=!1;for(const p of e){if(p.tileWidth>r){c=!0;break}if(i+p.tileWidth>r&&(i=0,o+=l,l=0),p.x=i,p.y=o,i+=p.tileWidth,l=Math.max(l,p.tileHeight),o+l>t){c=!0;break}}if(!c){const p=o+l,m=ie(ln(Math.max(p,1)),1,t);if(m<=t)return{placements:e,width:r,height:m}}if(r===t)break;r=Math.min(t,r*2)}return null}function Pi(n,t,e){const s=Math.max(t.maxX-t.minX,1e-6),a=Math.max(t.maxY-t.minY,1e-6),r=t.innerWidth/s,i=t.innerHeight/a,o=t.x+$t-t.minX*r,l=t.y+$t+t.maxY*i,c=T=>o+T*r,p=T=>l-T*i;n.beginPath();let m=!1,g=!1,f=0,y=0,h=0,x=0;for(let T=0;T<t.segmentCount;T+=1){const w=(t.segmentStart+T)*4;if(w+3>=e.textGlyphSegmentsA.length||w+3>=e.textGlyphSegmentsB.length)break;const R=e.textGlyphSegmentsA[w],A=e.textGlyphSegmentsA[w+1],S=e.textGlyphSegmentsA[w+2],k=e.textGlyphSegmentsA[w+3],G=e.textGlyphSegmentsB[w],B=e.textGlyphSegmentsB[w+1],I=e.textGlyphSegmentsB[w+2];(!g||!on(R,A,h,x))&&(g&&n.closePath(),n.moveTo(c(R),p(A)),g=!0,f=R,y=A),I>=.5?n.quadraticCurveTo(c(S),p(k),c(G),p(B)):n.lineTo(c(G),p(B)),m=!0,h=G,x=B,on(h,x,f,y)&&(n.closePath(),g=!1)}return g&&n.closePath(),m}function on(n,t,e,s){return Math.abs(n-e)<=sn&&Math.abs(t-s)<=sn}function ln(n){if(n<=1)return 1;let t=1;for(;t<n;)t<<=1;return t}function ie(n,t,e){return n<t?t:n>e?e:n}const $n=`#version 300 es
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
`,Qn=`#version 300 es
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
`,Kn=`#version 300 es
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
`,Jn=`#version 300 es
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
`,ti=`#version 300 es
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
`,ei=`#version 300 es
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
`,cn=`#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;

void main() {
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`,Fi=`#version 300 es
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
`,Bi=`#version 300 es
precision highp float;

uniform sampler2D uVectorLayerTex;
uniform vec2 uViewportPx;

out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / max(uViewportPx, vec2(1.0));
  outColor = texture(uVectorLayerTex, clamp(uv, vec2(0.0), vec2(1.0)));
}
`,ni=`#version 300 es
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
`,ii=`#version 300 es
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
`,ki=140,un=3e5,hn=1.8,dn=96,Li=1e-5,Di=.75,Oi=1.3333333333,Gi=2,Ui=2.25,ke=24,Yt=1e-4,le=1e-5,Xi=64,fn=5,mn=2e4,zi=120,ce=160/255,ue=169/255,he=175/255,As=$n,Ss=Qn,ws=Kn,_s=Jn,Ms=ti,Rs=ei,Es=ni,Is=ii;class Ps{canvas;gl;segmentProgram;fillProgram;textProgram;blitProgram;vectorCompositeProgram;rasterProgram;segmentVao;fillVao;textVao;blitVao;cornerBuffer;allSegmentIdBuffer;visibleSegmentIdBuffer;allFillPathIdBuffer;allTextInstanceIdBuffer;segmentTextureA;segmentTextureB;segmentTextureC;segmentTextureD;fillPathMetaTextureA;fillPathMetaTextureB;fillPathMetaTextureC;fillSegmentTextureA;fillSegmentTextureB;textInstanceTextureA;textInstanceTextureB;textInstanceTextureC;textGlyphMetaTextureA;textGlyphMetaTextureB;textGlyphRasterMetaTexture;textGlyphSegmentTextureA;textGlyphSegmentTextureB;textRasterAtlasTexture;pageBackgroundTexture;uSegmentTexA;uSegmentTexB;uSegmentStyleTex;uSegmentBoundsTex;uSegmentTexSize;uViewport;uCameraCenter;uZoom;uAAScreenPx;uStrokeCurveEnabled;uStrokeVectorOverride;uFillPathMetaTexA;uFillPathMetaTexB;uFillPathMetaTexC;uFillSegmentTexA;uFillSegmentTexB;uFillPathMetaTexSize;uFillSegmentTexSize;uFillViewport;uFillCameraCenter;uFillZoom;uFillAAScreenPx;uFillVectorOverride;uTextInstanceTexA;uTextInstanceTexB;uTextInstanceTexC;uTextGlyphMetaTexA;uTextGlyphMetaTexB;uTextGlyphRasterMetaTex;uTextGlyphSegmentTexA;uTextGlyphSegmentTexB;uTextInstanceTexSize;uTextGlyphMetaTexSize;uTextGlyphSegmentTexSize;uTextViewport;uTextCameraCenter;uTextZoom;uTextAAScreenPx;uTextCurveEnabled;uTextRasterAtlasTex;uTextRasterAtlasSize;uTextVectorOnly;uTextVectorOverride;uCacheTex;uViewportPx;uCacheSizePx;uOffsetPx;uSampleScale;uVectorLayerTex;uVectorLayerViewportPx;uRasterTex;uRasterMatrixABCD;uRasterMatrixEF;uRasterViewport;uRasterCameraCenter;uRasterZoom;scene=null;grid=null;sceneStats=null;allSegmentIds=new Float32Array(0);visibleSegmentIds=new Float32Array(0);allFillPathIds=new Float32Array(0);allTextInstanceIds=new Float32Array(0);segmentMarks=new Uint32Array(0);segmentMinX=new Float32Array(0);segmentMinY=new Float32Array(0);segmentMaxX=new Float32Array(0);segmentMaxY=new Float32Array(0);markToken=1;segmentCount=0;fillPathCount=0;textInstanceCount=0;rasterLayers=[];pageRects=new Float32Array(0);pageTextRanges=new Uint32Array(0);visiblePageRectIndices=new Uint32Array(0);visiblePageRectCount=0;visibleTextRanges=[];visibleSegmentCount=0;usingAllSegments=!0;segmentTextureWidth=1;segmentTextureHeight=1;fillPathMetaTextureWidth=1;fillPathMetaTextureHeight=1;fillSegmentTextureWidth=1;fillSegmentTextureHeight=1;textInstanceTextureWidth=1;textInstanceTextureHeight=1;textGlyphMetaTextureWidth=1;textGlyphMetaTextureHeight=1;textRasterAtlasWidth=1;textRasterAtlasHeight=1;textGlyphSegmentTextureWidth=1;textGlyphSegmentTextureHeight=1;needsVisibleSetUpdate=!1;rafHandle=0;frameListener=null;interactionViewportProvider=null;externalFrameDriver=!1;presentedCameraCenterX=0;presentedCameraCenterY=0;presentedZoom=1;presentedFrameSerial=0;cameraCenterX=0;cameraCenterY=0;zoom=1;targetCameraCenterX=0;targetCameraCenterY=0;targetZoom=1;lastCameraAnimationTimeMs=0;hasZoomAnchor=!1;zoomAnchorClientX=0;zoomAnchorClientY=0;zoomAnchorWorldX=0;zoomAnchorWorldY=0;panVelocityWorldX=0;panVelocityWorldY=0;lastPanVelocityUpdateTimeMs=0;lastPanFrameCameraX=0;lastPanFrameCameraY=0;lastPanFrameTimeMs=0;minZoom=.01;maxZoom=4096;lastInteractionTime=Number.NEGATIVE_INFINITY;isPanInteracting=!1;panCacheTexture=null;panCacheFramebuffer=null;panCacheWidth=0;panCacheHeight=0;panCacheValid=!1;panCacheCenterX=0;panCacheCenterY=0;panCacheZoom=1;panCacheRenderedSegments=0;panCacheUsedCulling=!1;vectorMinifyTexture=null;vectorMinifyFramebuffer=null;vectorMinifyWidth=0;vectorMinifyHeight=0;vectorMinifyWarmupPending=!1;panOptimizationEnabled=!0;rasterRenderingEnabled=!0;fillRenderingEnabled=!0;strokeRenderingEnabled=!0;textRenderingEnabled=!0;strokeCurveEnabled=!0;textVectorOnly=!1;hasCameraInteractionSinceSceneLoad=!1;pageBackgroundColor=[1,1,1,1];vectorOverrideColor=[0,0,0];vectorOverrideOpacity=0;constructor(t){this.canvas=t;const e=t.getContext("webgl2",{antialias:!1,depth:!1,stencil:!1,alpha:!1,premultipliedAlpha:!1});if(!e)throw new Error("WebGL2 is required for this proof-of-concept renderer.");this.gl=e,this.segmentProgram=this.createProgram($n,Qn),this.fillProgram=this.createProgram(Kn,Jn),this.textProgram=this.createProgram(ti,ei),this.blitProgram=this.createProgram(cn,Fi),this.vectorCompositeProgram=this.createProgram(cn,Bi),this.rasterProgram=this.createProgram(ni,ii),this.segmentVao=this.createVertexArray(),this.fillVao=this.createVertexArray(),this.textVao=this.createVertexArray(),this.blitVao=this.createVertexArray(),this.cornerBuffer=this.mustCreateBuffer(),this.allSegmentIdBuffer=this.mustCreateBuffer(),this.visibleSegmentIdBuffer=this.mustCreateBuffer(),this.allFillPathIdBuffer=this.mustCreateBuffer(),this.allTextInstanceIdBuffer=this.mustCreateBuffer(),this.segmentTextureA=this.mustCreateTexture(),this.segmentTextureB=this.mustCreateTexture(),this.segmentTextureC=this.mustCreateTexture(),this.segmentTextureD=this.mustCreateTexture(),this.fillPathMetaTextureA=this.mustCreateTexture(),this.fillPathMetaTextureB=this.mustCreateTexture(),this.fillPathMetaTextureC=this.mustCreateTexture(),this.fillSegmentTextureA=this.mustCreateTexture(),this.fillSegmentTextureB=this.mustCreateTexture(),this.textInstanceTextureA=this.mustCreateTexture(),this.textInstanceTextureB=this.mustCreateTexture(),this.textInstanceTextureC=this.mustCreateTexture(),this.textGlyphMetaTextureA=this.mustCreateTexture(),this.textGlyphMetaTextureB=this.mustCreateTexture(),this.textGlyphRasterMetaTexture=this.mustCreateTexture(),this.textGlyphSegmentTextureA=this.mustCreateTexture(),this.textGlyphSegmentTextureB=this.mustCreateTexture(),this.textRasterAtlasTexture=this.mustCreateTexture(),this.pageBackgroundTexture=this.mustCreateTexture(),this.uSegmentTexA=this.mustGetUniformLocation(this.segmentProgram,"uSegmentTexA"),this.uSegmentTexB=this.mustGetUniformLocation(this.segmentProgram,"uSegmentTexB"),this.uSegmentStyleTex=this.mustGetUniformLocation(this.segmentProgram,"uSegmentStyleTex"),this.uSegmentBoundsTex=this.mustGetUniformLocation(this.segmentProgram,"uSegmentBoundsTex"),this.uSegmentTexSize=this.mustGetUniformLocation(this.segmentProgram,"uSegmentTexSize"),this.uViewport=this.mustGetUniformLocation(this.segmentProgram,"uViewport"),this.uCameraCenter=this.mustGetUniformLocation(this.segmentProgram,"uCameraCenter"),this.uZoom=this.mustGetUniformLocation(this.segmentProgram,"uZoom"),this.uAAScreenPx=this.mustGetUniformLocation(this.segmentProgram,"uAAScreenPx"),this.uStrokeCurveEnabled=this.mustGetUniformLocation(this.segmentProgram,"uStrokeCurveEnabled"),this.uStrokeVectorOverride=this.mustGetUniformLocation(this.segmentProgram,"uVectorOverride"),this.uFillPathMetaTexA=this.mustGetUniformLocation(this.fillProgram,"uFillPathMetaTexA"),this.uFillPathMetaTexB=this.mustGetUniformLocation(this.fillProgram,"uFillPathMetaTexB"),this.uFillPathMetaTexC=this.mustGetUniformLocation(this.fillProgram,"uFillPathMetaTexC"),this.uFillSegmentTexA=this.mustGetUniformLocation(this.fillProgram,"uFillSegmentTexA"),this.uFillSegmentTexB=this.mustGetUniformLocation(this.fillProgram,"uFillSegmentTexB"),this.uFillPathMetaTexSize=this.mustGetUniformLocation(this.fillProgram,"uFillPathMetaTexSize"),this.uFillSegmentTexSize=this.mustGetUniformLocation(this.fillProgram,"uFillSegmentTexSize"),this.uFillViewport=this.mustGetUniformLocation(this.fillProgram,"uViewport"),this.uFillCameraCenter=this.mustGetUniformLocation(this.fillProgram,"uCameraCenter"),this.uFillZoom=this.mustGetUniformLocation(this.fillProgram,"uZoom"),this.uFillAAScreenPx=this.mustGetUniformLocation(this.fillProgram,"uFillAAScreenPx"),this.uFillVectorOverride=this.mustGetUniformLocation(this.fillProgram,"uVectorOverride"),this.uTextInstanceTexA=this.mustGetUniformLocation(this.textProgram,"uTextInstanceTexA"),this.uTextInstanceTexB=this.mustGetUniformLocation(this.textProgram,"uTextInstanceTexB"),this.uTextInstanceTexC=this.mustGetUniformLocation(this.textProgram,"uTextInstanceTexC"),this.uTextGlyphMetaTexA=this.mustGetUniformLocation(this.textProgram,"uTextGlyphMetaTexA"),this.uTextGlyphMetaTexB=this.mustGetUniformLocation(this.textProgram,"uTextGlyphMetaTexB"),this.uTextGlyphRasterMetaTex=this.mustGetUniformLocation(this.textProgram,"uTextGlyphRasterMetaTex"),this.uTextGlyphSegmentTexA=this.mustGetUniformLocation(this.textProgram,"uTextGlyphSegmentTexA"),this.uTextGlyphSegmentTexB=this.mustGetUniformLocation(this.textProgram,"uTextGlyphSegmentTexB"),this.uTextInstanceTexSize=this.mustGetUniformLocation(this.textProgram,"uTextInstanceTexSize"),this.uTextGlyphMetaTexSize=this.mustGetUniformLocation(this.textProgram,"uTextGlyphMetaTexSize"),this.uTextGlyphSegmentTexSize=this.mustGetUniformLocation(this.textProgram,"uTextGlyphSegmentTexSize"),this.uTextViewport=this.mustGetUniformLocation(this.textProgram,"uViewport"),this.uTextCameraCenter=this.mustGetUniformLocation(this.textProgram,"uCameraCenter"),this.uTextZoom=this.mustGetUniformLocation(this.textProgram,"uZoom"),this.uTextAAScreenPx=this.mustGetUniformLocation(this.textProgram,"uTextAAScreenPx"),this.uTextCurveEnabled=this.mustGetUniformLocation(this.textProgram,"uTextCurveEnabled"),this.uTextRasterAtlasTex=this.mustGetUniformLocation(this.textProgram,"uTextRasterAtlasTex"),this.uTextRasterAtlasSize=this.mustGetUniformLocation(this.textProgram,"uTextRasterAtlasSize"),this.uTextVectorOnly=this.mustGetUniformLocation(this.textProgram,"uTextVectorOnly"),this.uTextVectorOverride=this.mustGetUniformLocation(this.textProgram,"uVectorOverride"),this.uCacheTex=this.mustGetUniformLocation(this.blitProgram,"uCacheTex"),this.uViewportPx=this.mustGetUniformLocation(this.blitProgram,"uViewportPx"),this.uCacheSizePx=this.mustGetUniformLocation(this.blitProgram,"uCacheSizePx"),this.uOffsetPx=this.mustGetUniformLocation(this.blitProgram,"uOffsetPx"),this.uSampleScale=this.mustGetUniformLocation(this.blitProgram,"uSampleScale"),this.uVectorLayerTex=this.mustGetUniformLocation(this.vectorCompositeProgram,"uVectorLayerTex"),this.uVectorLayerViewportPx=this.mustGetUniformLocation(this.vectorCompositeProgram,"uViewportPx"),this.uRasterTex=this.mustGetUniformLocation(this.rasterProgram,"uRasterTex"),this.uRasterMatrixABCD=this.mustGetUniformLocation(this.rasterProgram,"uRasterMatrixABCD"),this.uRasterMatrixEF=this.mustGetUniformLocation(this.rasterProgram,"uRasterMatrixEF"),this.uRasterViewport=this.mustGetUniformLocation(this.rasterProgram,"uViewport"),this.uRasterCameraCenter=this.mustGetUniformLocation(this.rasterProgram,"uCameraCenter"),this.uRasterZoom=this.mustGetUniformLocation(this.rasterProgram,"uZoom"),this.initializeGeometry(),this.initializeState(),this.uploadPageBackgroundTexture()}setFrameListener(t){this.frameListener=t}setExternalFrameDriver(t){const e=!!t;this.externalFrameDriver!==e&&(this.externalFrameDriver=e,this.externalFrameDriver&&this.rafHandle!==0&&(cancelAnimationFrame(this.rafHandle),this.rafHandle=0))}renderExternalFrame(t=performance.now()){this.render(t)}setPanOptimizationEnabled(t){const e=!!t;this.panOptimizationEnabled!==e&&(this.panOptimizationEnabled=e,this.isPanInteracting=!1,this.panCacheValid=!1,this.panOptimizationEnabled||this.destroyPanCacheResources(),this.needsVisibleSetUpdate=!0,this.requestFrame())}setStrokeCurveEnabled(t){const e=!!t;this.strokeCurveEnabled!==e&&(this.strokeCurveEnabled=e,this.requestFrame())}setRasterRenderingEnabled(t){const e=!!t;this.rasterRenderingEnabled!==e&&(this.rasterRenderingEnabled=e,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setStrokeRenderingEnabled(t){const e=!!t;this.strokeRenderingEnabled!==e&&(this.strokeRenderingEnabled=e,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setFillRenderingEnabled(t){const e=!!t;this.fillRenderingEnabled!==e&&(this.fillRenderingEnabled=e,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setTextRenderingEnabled(t){const e=!!t;this.textRenderingEnabled!==e&&(this.textRenderingEnabled=e,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setTextVectorOnly(t){const e=!!t;this.textVectorOnly!==e&&(this.textVectorOnly=e,this.panCacheValid=!1,this.textVectorOnly&&this.destroyVectorMinifyResources(),this.requestFrame())}setPageBackgroundColor(t,e,s,a){const r=Ct(t,0,1),i=Ct(e,0,1),o=Ct(s,0,1),l=Ct(a,0,1),c=this.pageBackgroundColor;Math.abs(c[0]-r)<=1e-6&&Math.abs(c[1]-i)<=1e-6&&Math.abs(c[2]-o)<=1e-6&&Math.abs(c[3]-l)<=1e-6||(this.pageBackgroundColor=[r,i,o,l],this.uploadPageBackgroundTexture(),this.panCacheValid=!1,this.requestFrame())}setVectorColorOverride(t,e,s,a){const r=Ct(t,0,1),i=Ct(e,0,1),o=Ct(s,0,1),l=Ct(a,0,1),c=this.vectorOverrideColor;Math.abs(c[0]-r)<=1e-6&&Math.abs(c[1]-i)<=1e-6&&Math.abs(c[2]-o)<=1e-6&&Math.abs(this.vectorOverrideOpacity-l)<=1e-6||(this.vectorOverrideColor=[r,i,o],this.vectorOverrideOpacity=l,this.panCacheValid=!1,this.requestFrame())}setInteractionViewportProvider(t){this.interactionViewportProvider=t}beginPanInteraction(){this.hasCameraInteractionSinceSceneLoad=!0,this.syncCameraTargetsToCurrent(),this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameCameraX=this.cameraCenterX,this.lastPanFrameCameraY=this.cameraCenterY,this.lastPanFrameTimeMs=0,this.isPanInteracting=!0,this.markInteraction()}endPanInteraction(){this.isPanInteracting=!1;const t=performance.now(),s=this.lastPanVelocityUpdateTimeMs>0&&t-this.lastPanVelocityUpdateTimeMs<=zi?Math.hypot(this.panVelocityWorldX,this.panVelocityWorldY):0;Number.isFinite(s)&&s>=fn?(this.targetCameraCenterX=this.cameraCenterX+this.panVelocityWorldX/ke,this.targetCameraCenterY=this.cameraCenterY+this.panVelocityWorldY/ke,this.lastCameraAnimationTimeMs=0):(this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY),this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameTimeMs=0,this.markInteraction(),this.needsVisibleSetUpdate=!0,this.requestFrame()}resize(){const t=window.devicePixelRatio||1,e=Math.max(1,Math.round(this.canvas.clientWidth*t)),s=Math.max(1,Math.round(this.canvas.clientHeight*t));this.canvas.width===e&&this.canvas.height===s||(this.canvas.width=e,this.canvas.height=s,this.destroyPanCacheResources(),this.destroyVectorMinifyResources(),this.needsVisibleSetUpdate=!0,this.requestFrame())}setScene(t){this.scene=t,this.segmentCount=t.segmentCount,this.fillPathCount=t.fillPathCount,this.textInstanceCount=t.textInstanceCount,this.pageRects=Wi(t),this.pageTextRanges=Hi(t,this.pageRects,this.textInstanceCount),this.visiblePageRectIndices.length<Math.floor(this.pageRects.length/4)&&(this.visiblePageRectIndices=new Uint32Array(Math.floor(this.pageRects.length/4))),this.visiblePageRectCount=0,this.visibleTextRanges=[],this.buildSegmentBounds(t),this.isPanInteracting=!1,this.panCacheValid=!1,this.destroyVectorMinifyResources(),this.grid=this.segmentCount>0?Zn(t):null,this.uploadRasterLayers(t);const e=this.uploadFillPaths(t),s=this.uploadSegments(t),a=this.uploadTextData(t);this.sceneStats={gridWidth:this.grid?.gridWidth??0,gridHeight:this.grid?.gridHeight??0,gridIndexCount:this.grid?.indices.length??0,maxCellPopulation:this.grid?.maxCellPopulation??0,fillPathTextureWidth:e.pathMetaTextureWidth,fillPathTextureHeight:e.pathMetaTextureHeight,fillSegmentTextureWidth:e.segmentTextureWidth,fillSegmentTextureHeight:e.segmentTextureHeight,textureWidth:s.textureWidth,textureHeight:s.textureHeight,maxTextureSize:s.maxTextureSize,textInstanceTextureWidth:a.instanceTextureWidth,textInstanceTextureHeight:a.instanceTextureHeight,textGlyphTextureWidth:a.glyphMetaTextureWidth,textGlyphTextureHeight:a.glyphMetaTextureHeight,textSegmentTextureWidth:a.glyphSegmentTextureWidth,textSegmentTextureHeight:a.glyphSegmentTextureHeight},this.allSegmentIds=new Float32Array(this.segmentCount);for(let r=0;r<this.segmentCount;r+=1)this.allSegmentIds[r]=r;this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.allSegmentIdBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,this.allSegmentIds,this.gl.STATIC_DRAW),this.allFillPathIds=new Float32Array(this.fillPathCount);for(let r=0;r<this.fillPathCount;r+=1)this.allFillPathIds[r]=r;this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.allFillPathIdBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,this.allFillPathIds,this.gl.STATIC_DRAW),this.allTextInstanceIds=new Float32Array(this.textInstanceCount);for(let r=0;r<this.textInstanceCount;r+=1)this.allTextInstanceIds[r]=r;return this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.allTextInstanceIdBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,this.allTextInstanceIds,this.gl.STATIC_DRAW),this.visibleSegmentIds.length<this.segmentCount&&(this.visibleSegmentIds=new Float32Array(this.segmentCount)),this.segmentMarks.length<this.segmentCount&&(this.segmentMarks=new Uint32Array(this.segmentCount),this.markToken=1),this.visibleSegmentCount=this.segmentCount,this.usingAllSegments=!0,this.setAllPagesAndTextVisible(),this.minZoom=.01,this.maxZoom=8192,this.hasCameraInteractionSinceSceneLoad=!0,this.syncCameraTargetsToCurrent(),this.needsVisibleSetUpdate=!0,this.requestFrame(),this.sceneStats}getSceneStats(){return this.sceneStats}getViewState(){return{cameraCenterX:this.cameraCenterX,cameraCenterY:this.cameraCenterY,zoom:this.zoom}}getPresentedViewState(){return{cameraCenterX:this.presentedCameraCenterX,cameraCenterY:this.presentedCameraCenterY,zoom:this.presentedZoom}}getPresentedFrameSerial(){return this.presentedFrameSerial}setViewState(t){const e=Number(t.cameraCenterX),s=Number(t.cameraCenterY),a=Number(t.zoom);if(!Number.isFinite(e)||!Number.isFinite(s)||!Number.isFinite(a))return;this.cameraCenterX=e,this.cameraCenterY=s;const r=Ct(a,this.minZoom,this.maxZoom);this.zoom=r,this.targetCameraCenterX=e,this.targetCameraCenterY=s,this.targetZoom=r,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1,this.isPanInteracting=!1,this.panCacheValid=!1,this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.needsVisibleSetUpdate=!0,this.requestFrame()}fitToBounds(t,e=64){const s=Math.max(t.maxX-t.minX,1e-4),a=Math.max(t.maxY-t.minY,1e-4),r=Math.max(1,this.canvas.width-e*2),i=Math.max(1,this.canvas.height-e*2),o=Math.min(r/s,i/a),l=Ct(o,1e-8,this.maxZoom);this.minZoom=Math.min(this.minZoom,l);const c=(t.minX+t.maxX)*.5,p=(t.minY+t.maxY)*.5;this.zoom=l,this.cameraCenterX=c,this.cameraCenterY=p,this.targetZoom=l,this.targetCameraCenterX=c,this.targetCameraCenterY=p,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1,this.isPanInteracting=!1,this.panCacheValid=!1,this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.needsVisibleSetUpdate=!0,this.requestFrame()}dispose(){this.rafHandle!==0&&(cancelAnimationFrame(this.rafHandle),this.rafHandle=0),this.frameListener=null,this.destroyPanCacheResources(),this.destroyVectorMinifyResources();for(const t of this.rasterLayers)this.gl.deleteTexture(t.texture);this.rasterLayers=[]}panByPixels(t,e){if(!Number.isFinite(t)||!Number.isFinite(e))return;this.hasCameraInteractionSinceSceneLoad=!0,this.markInteraction(),this.hasZoomAnchor=!1;const s=this.resolveClientToPixelScale(),a=-(t*s.x)/this.zoom,r=e*s.y/this.zoom;this.cameraCenterX+=a,this.cameraCenterY+=r,this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY,this.needsVisibleSetUpdate=!0,this.requestFrame()}zoomAtClientPoint(t,e,s){const a=Ct(s,.1,10);this.hasCameraInteractionSinceSceneLoad=!0,this.markInteraction();const r=this.clientToWorld(t,e),i=Ct(this.targetZoom*a,this.minZoom,this.maxZoom);this.hasZoomAnchor=!0,this.zoomAnchorClientX=t,this.zoomAnchorClientY=e,this.zoomAnchorWorldX=r.x,this.zoomAnchorWorldY=r.y,this.targetZoom=i;const o=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,i);this.targetCameraCenterX=o.x,this.targetCameraCenterY=o.y,this.needsVisibleSetUpdate=!0,this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameTimeMs=0,this.requestFrame()}requestFrame(){this.externalFrameDriver||this.rafHandle===0&&(this.rafHandle=requestAnimationFrame(t=>{this.rafHandle=0,this.render(t)}))}render(t=performance.now()){const e=this.updateCameraWithDamping(t);this.updatePanReleaseVelocitySample(t);const s=this.gl;if(this.ensureRenderState(),!this.scene||this.fillPathCount===0&&this.segmentCount===0&&this.textInstanceCount===0&&this.rasterLayers.length===0&&this.pageRects.length===0){s.bindFramebuffer(s.FRAMEBUFFER,null),s.viewport(0,0,this.canvas.width,this.canvas.height),s.clearColor(ce,ue,he,1),s.clear(s.COLOR_BUFFER_BIT),this.capturePresentedFrameState(),this.frameListener?.({renderedSegments:0,totalSegments:0,usedCulling:!1,zoom:this.zoom}),e&&this.requestFrame();return}this.shouldUsePanCache(e)?this.renderWithPanCache():this.renderDirectToScreen(),this.capturePresentedFrameState(),e&&this.requestFrame()}capturePresentedFrameState(){this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.presentedFrameSerial+=1}shouldUsePanCache(t){return!this.panOptimizationEnabled||this.segmentCount<un?!1:this.isPanInteracting?!0:t}renderDirectToScreen(){const t=this.gl;let e=this.shouldUseVectorMinifyPath()&&this.ensureVectorMinifyResources();if(this.panOptimizationEnabled&&this.segmentCount>=un&&(e=!1),e&&this.vectorMinifyWarmupPending&&(e=!1,this.vectorMinifyWarmupPending=!1,this.needsVisibleSetUpdate=!0,this.requestFrame()),t.bindFramebuffer(t.FRAMEBUFFER,null),t.viewport(0,0,this.canvas.width,this.canvas.height),t.clearColor(ce,ue,he,1),t.clear(t.COLOR_BUFFER_BIT),this.needsVisibleSetUpdate){if(e){const a=this.computeVectorMinifyZoom(this.vectorMinifyWidth,this.vectorMinifyHeight);this.updateVisibleSet(this.cameraCenterX,this.cameraCenterY,this.vectorMinifyWidth,this.vectorMinifyHeight,a)}else this.updateVisibleSet(this.cameraCenterX,this.cameraCenterY,this.canvas.width,this.canvas.height,this.zoom);this.needsVisibleSetUpdate=!1}this.rasterRenderingEnabled&&this.drawRasterLayer(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY);let s=0;e?(s=this.renderVectorLayerIntoMinifyTarget(this.vectorMinifyWidth,this.vectorMinifyHeight,this.cameraCenterX,this.cameraCenterY),this.compositeVectorMinifyLayer()):(this.fillRenderingEnabled&&this.drawFilledPaths(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY),this.strokeRenderingEnabled&&(s=this.drawVisibleSegments(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY)),this.textRenderingEnabled&&this.drawTextInstances(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY)),this.frameListener?.({renderedSegments:s,totalSegments:this.segmentCount,usedCulling:!this.usingAllSegments,zoom:this.zoom})}hasVectorContent(){return this.fillRenderingEnabled&&this.fillPathCount>0||this.strokeRenderingEnabled&&this.segmentCount>0||this.textRenderingEnabled&&this.textInstanceCount>0}shouldUseVectorMinifyPath(){return this.textVectorOnly||!this.hasVectorContent()||this.textInstanceCount>1e5&&this.segmentCount===0?!1:this.zoom<=Ui}computeVectorMinifyZoom(t,e){const s=Math.min(t/Math.max(1,this.canvas.width),e/Math.max(1,this.canvas.height));return this.zoom*Math.max(1,s)}ensureVectorMinifyResources(){const t=this.gl,e=t.getParameter(t.MAX_TEXTURE_SIZE),s=e/Math.max(1,this.canvas.width),a=e/Math.max(1,this.canvas.height),r=Math.max(1,Math.min(Gi,s,a)),i=Math.max(this.canvas.width,Math.floor(this.canvas.width*r)),o=Math.max(this.canvas.height,Math.floor(this.canvas.height*r));if(i<this.canvas.width||o<this.canvas.height)return!1;if(this.vectorMinifyTexture&&this.vectorMinifyFramebuffer&&this.vectorMinifyWidth===i&&this.vectorMinifyHeight===o)return!0;this.destroyVectorMinifyResources();const l=t.createTexture();if(!l)return!1;t.bindTexture(t.TEXTURE_2D,l),Vi(t),t.texStorage2D(t.TEXTURE_2D,1,t.RGBA8,i,o);const c=t.createFramebuffer();if(!c)return t.deleteTexture(l),!1;t.bindFramebuffer(t.FRAMEBUFFER,c),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,l,0);const p=t.checkFramebufferStatus(t.FRAMEBUFFER);return t.bindFramebuffer(t.FRAMEBUFFER,null),p!==t.FRAMEBUFFER_COMPLETE?(t.deleteFramebuffer(c),t.deleteTexture(l),!1):(this.vectorMinifyTexture=l,this.vectorMinifyFramebuffer=c,this.vectorMinifyWidth=i,this.vectorMinifyHeight=o,this.vectorMinifyWarmupPending=!0,!0)}renderVectorLayerIntoMinifyTarget(t,e,s,a){if(!this.vectorMinifyFramebuffer||!this.vectorMinifyTexture)return 0;const r=this.gl,i=this.computeVectorMinifyZoom(t,e);r.bindFramebuffer(r.FRAMEBUFFER,this.vectorMinifyFramebuffer),r.viewport(0,0,t,e),r.clearColor(0,0,0,0),r.clear(r.COLOR_BUFFER_BIT),r.blendFuncSeparate(r.SRC_ALPHA,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA),this.fillRenderingEnabled&&this.drawFilledPaths(t,e,s,a,i);const o=this.strokeRenderingEnabled?this.drawVisibleSegments(t,e,s,a,i):0;return this.textRenderingEnabled&&this.drawTextInstances(t,e,s,a,i),r.bindTexture(r.TEXTURE_2D,this.vectorMinifyTexture),r.bindFramebuffer(r.FRAMEBUFFER,null),o}compositeVectorMinifyLayer(){if(!this.vectorMinifyTexture)return;const t=this.gl;t.bindFramebuffer(t.FRAMEBUFFER,null),t.viewport(0,0,this.canvas.width,this.canvas.height),t.useProgram(this.vectorCompositeProgram),t.bindVertexArray(this.blitVao),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,this.vectorMinifyTexture),t.uniform1i(this.uVectorLayerTex,0),t.uniform2f(this.uVectorLayerViewportPx,this.canvas.width,this.canvas.height),t.blendFuncSeparate(t.ONE,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA),t.drawArrays(t.TRIANGLE_STRIP,0,4),t.blendFuncSeparate(t.SRC_ALPHA,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA)}renderWithPanCache(){if(!this.ensurePanCacheResources()){this.renderDirectToScreen();return}let t=this.panCacheZoom/Math.max(this.zoom,1e-6),e=(this.cameraCenterX-this.panCacheCenterX)*this.panCacheZoom,s=(this.cameraCenterY-this.panCacheCenterY)*this.panCacheZoom;const a=this.panCacheWidth*.5-2,r=this.panCacheHeight*.5-2,i=this.canvas.width*.5*Math.abs(t),o=this.canvas.height*.5*Math.abs(t),l=a-i,c=r-o,p=this.zoom/Math.max(this.panCacheZoom,1e-6),m=p<Di||p>Oi,f=Math.abs(this.targetZoom-this.zoom)<=le&&Math.abs(this.panCacheZoom-this.zoom)>Li,y=l<0||c<0||Math.abs(e)>l||Math.abs(s)>c;if(!this.panCacheValid||m||y||f){this.panCacheCenterX=this.cameraCenterX,this.panCacheCenterY=this.cameraCenterY,this.panCacheZoom=this.zoom,this.updateVisibleSet(this.panCacheCenterX,this.panCacheCenterY,this.panCacheWidth,this.panCacheHeight),this.needsVisibleSetUpdate=!1;const x=this.gl;x.bindFramebuffer(x.FRAMEBUFFER,this.panCacheFramebuffer),x.viewport(0,0,this.panCacheWidth,this.panCacheHeight),x.clearColor(ce,ue,he,1),x.clear(x.COLOR_BUFFER_BIT),this.rasterRenderingEnabled&&this.drawRasterLayer(this.panCacheWidth,this.panCacheHeight,this.panCacheCenterX,this.panCacheCenterY),this.fillRenderingEnabled&&this.drawFilledPaths(this.panCacheWidth,this.panCacheHeight,this.panCacheCenterX,this.panCacheCenterY),this.panCacheRenderedSegments=this.strokeRenderingEnabled?this.drawVisibleSegments(this.panCacheWidth,this.panCacheHeight,this.panCacheCenterX,this.panCacheCenterY):0,this.textRenderingEnabled&&this.drawTextInstances(this.panCacheWidth,this.panCacheHeight,this.panCacheCenterX,this.panCacheCenterY),this.panCacheUsedCulling=!this.usingAllSegments,this.panCacheValid=!0,t=1,e=0,s=0}this.blitPanCache(e,s,t),this.frameListener?.({renderedSegments:this.panCacheRenderedSegments,totalSegments:this.segmentCount,usedCulling:this.panCacheUsedCulling,zoom:this.zoom})}drawRasterLayer(t,e,s,a){if(this.rasterLayers.length===0&&this.pageRects.length===0)return;const r=this.gl;if(r.useProgram(this.rasterProgram),r.bindVertexArray(this.blitVao),r.uniform2f(this.uRasterViewport,t,e),r.uniform2f(this.uRasterCameraCenter,s,a),r.uniform1f(this.uRasterZoom,this.zoom),this.pageRects.length>0&&this.visiblePageRectCount>0){r.activeTexture(r.TEXTURE12),r.bindTexture(r.TEXTURE_2D,this.pageBackgroundTexture),r.uniform1i(this.uRasterTex,12);for(let i=0;i<this.visiblePageRectCount;i+=1){const o=this.visiblePageRectIndices[i]*4,l=this.pageRects[o],c=this.pageRects[o+1],p=this.pageRects[o+2],m=this.pageRects[o+3],g=Math.max(p-l,1e-6),f=Math.max(m-c,1e-6);r.uniform4f(this.uRasterMatrixABCD,g,0,0,f),r.uniform2f(this.uRasterMatrixEF,l,c),r.drawArrays(r.TRIANGLE_STRIP,0,4)}}if(this.rasterLayers.length!==0){r.blendFuncSeparate(r.ONE,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA);for(const i of this.rasterLayers)r.activeTexture(r.TEXTURE12),r.bindTexture(r.TEXTURE_2D,i.texture),r.uniform1i(this.uRasterTex,12),r.uniform4f(this.uRasterMatrixABCD,i.matrix[0],i.matrix[1],i.matrix[2],i.matrix[3]),r.uniform2f(this.uRasterMatrixEF,i.matrix[4],i.matrix[5]),r.drawArrays(r.TRIANGLE_STRIP,0,4);r.blendFuncSeparate(r.SRC_ALPHA,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA)}}drawFilledPaths(t,e,s,a,r=this.zoom){if(!this.scene||this.fillPathCount<=0)return 0;const i=this.gl;return i.useProgram(this.fillProgram),i.bindVertexArray(this.fillVao),i.activeTexture(i.TEXTURE7),i.bindTexture(i.TEXTURE_2D,this.fillPathMetaTextureA),i.activeTexture(i.TEXTURE8),i.bindTexture(i.TEXTURE_2D,this.fillPathMetaTextureB),i.activeTexture(i.TEXTURE9),i.bindTexture(i.TEXTURE_2D,this.fillPathMetaTextureC),i.activeTexture(i.TEXTURE10),i.bindTexture(i.TEXTURE_2D,this.fillSegmentTextureA),i.activeTexture(i.TEXTURE11),i.bindTexture(i.TEXTURE_2D,this.fillSegmentTextureB),i.uniform1i(this.uFillPathMetaTexA,7),i.uniform1i(this.uFillPathMetaTexB,8),i.uniform1i(this.uFillPathMetaTexC,9),i.uniform1i(this.uFillSegmentTexA,10),i.uniform1i(this.uFillSegmentTexB,11),i.uniform2i(this.uFillPathMetaTexSize,this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight),i.uniform2i(this.uFillSegmentTexSize,this.fillSegmentTextureWidth,this.fillSegmentTextureHeight),i.uniform2f(this.uFillViewport,t,e),i.uniform2f(this.uFillCameraCenter,s,a),i.uniform1f(this.uFillZoom,r),i.uniform1f(this.uFillAAScreenPx,1),i.uniform4f(this.uFillVectorOverride,this.vectorOverrideColor[0],this.vectorOverrideColor[1],this.vectorOverrideColor[2],this.vectorOverrideOpacity),i.drawArraysInstanced(i.TRIANGLE_STRIP,0,4,this.fillPathCount),this.fillPathCount}drawVisibleSegments(t,e,s,a,r=this.zoom){const i=this.usingAllSegments?this.segmentCount:this.visibleSegmentCount;if(i===0)return 0;const o=this.gl;o.useProgram(this.segmentProgram),o.bindVertexArray(this.segmentVao);const l=this.usingAllSegments?this.allSegmentIdBuffer:this.visibleSegmentIdBuffer;return o.bindBuffer(o.ARRAY_BUFFER,l),o.enableVertexAttribArray(1),o.vertexAttribPointer(1,1,o.FLOAT,!1,4,0),o.vertexAttribDivisor(1,1),o.activeTexture(o.TEXTURE0),o.bindTexture(o.TEXTURE_2D,this.segmentTextureA),o.activeTexture(o.TEXTURE1),o.bindTexture(o.TEXTURE_2D,this.segmentTextureB),o.activeTexture(o.TEXTURE2),o.bindTexture(o.TEXTURE_2D,this.segmentTextureC),o.activeTexture(o.TEXTURE3),o.bindTexture(o.TEXTURE_2D,this.segmentTextureD),o.uniform1i(this.uSegmentTexA,0),o.uniform1i(this.uSegmentTexB,1),o.uniform1i(this.uSegmentStyleTex,2),o.uniform1i(this.uSegmentBoundsTex,3),o.uniform2i(this.uSegmentTexSize,this.segmentTextureWidth,this.segmentTextureHeight),o.uniform2f(this.uViewport,t,e),o.uniform2f(this.uCameraCenter,s,a),o.uniform1f(this.uZoom,r),o.uniform1f(this.uAAScreenPx,1),o.uniform1f(this.uStrokeCurveEnabled,this.strokeCurveEnabled?1:0),o.uniform4f(this.uStrokeVectorOverride,this.vectorOverrideColor[0],this.vectorOverrideColor[1],this.vectorOverrideColor[2],this.vectorOverrideOpacity),o.drawArraysInstanced(o.TRIANGLE_STRIP,0,4,i),i}drawTextInstances(t,e,s,a,r=this.zoom){if(!this.scene||this.textInstanceCount<=0||this.visibleTextRanges.length===0)return 0;const i=this.gl;i.useProgram(this.textProgram),i.bindVertexArray(this.textVao),i.bindBuffer(i.ARRAY_BUFFER,this.allTextInstanceIdBuffer),i.enableVertexAttribArray(2),i.vertexAttribDivisor(2,1),i.activeTexture(i.TEXTURE2),i.bindTexture(i.TEXTURE_2D,this.textInstanceTextureA),i.activeTexture(i.TEXTURE3),i.bindTexture(i.TEXTURE_2D,this.textInstanceTextureB),i.activeTexture(i.TEXTURE4),i.bindTexture(i.TEXTURE_2D,this.textInstanceTextureC),i.activeTexture(i.TEXTURE5),i.bindTexture(i.TEXTURE_2D,this.textGlyphMetaTextureA),i.activeTexture(i.TEXTURE6),i.bindTexture(i.TEXTURE_2D,this.textGlyphMetaTextureB),i.activeTexture(i.TEXTURE7),i.bindTexture(i.TEXTURE_2D,this.textGlyphSegmentTextureA),i.activeTexture(i.TEXTURE8),i.bindTexture(i.TEXTURE_2D,this.textGlyphSegmentTextureB),i.activeTexture(i.TEXTURE9),i.bindTexture(i.TEXTURE_2D,this.textGlyphRasterMetaTexture),i.activeTexture(i.TEXTURE13),i.bindTexture(i.TEXTURE_2D,this.textRasterAtlasTexture),i.uniform1i(this.uTextInstanceTexA,2),i.uniform1i(this.uTextInstanceTexB,3),i.uniform1i(this.uTextInstanceTexC,4),i.uniform1i(this.uTextGlyphMetaTexA,5),i.uniform1i(this.uTextGlyphMetaTexB,6),i.uniform1i(this.uTextGlyphSegmentTexA,7),i.uniform1i(this.uTextGlyphSegmentTexB,8),i.uniform1i(this.uTextGlyphRasterMetaTex,9),i.uniform1i(this.uTextRasterAtlasTex,13),i.uniform2i(this.uTextInstanceTexSize,this.textInstanceTextureWidth,this.textInstanceTextureHeight),i.uniform2i(this.uTextGlyphMetaTexSize,this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight),i.uniform2i(this.uTextGlyphSegmentTexSize,this.textGlyphSegmentTextureWidth,this.textGlyphSegmentTextureHeight),i.uniform2f(this.uTextRasterAtlasSize,this.textRasterAtlasWidth,this.textRasterAtlasHeight),i.uniform2f(this.uTextViewport,t,e),i.uniform2f(this.uTextCameraCenter,s,a),i.uniform1f(this.uTextZoom,r),i.uniform1f(this.uTextAAScreenPx,1.25),i.uniform1f(this.uTextCurveEnabled,this.strokeCurveEnabled?1:0),i.uniform1f(this.uTextVectorOnly,this.textVectorOnly?1:0),i.uniform4f(this.uTextVectorOverride,this.vectorOverrideColor[0],this.vectorOverrideColor[1],this.vectorOverrideColor[2],this.vectorOverrideOpacity);let o=0;for(const l of this.visibleTextRanges)l.count<=0||(i.vertexAttribPointer(2,1,i.FLOAT,!1,4,l.start*4),i.drawArraysInstanced(i.TRIANGLE_STRIP,0,4,l.count),o+=l.count);return o}blitPanCache(t,e,s){if(!this.panCacheTexture)return;const a=this.gl;a.bindFramebuffer(a.FRAMEBUFFER,null),a.viewport(0,0,this.canvas.width,this.canvas.height),a.clearColor(ce,ue,he,1),a.clear(a.COLOR_BUFFER_BIT),a.useProgram(this.blitProgram),a.bindVertexArray(this.blitVao),a.activeTexture(a.TEXTURE0),a.bindTexture(a.TEXTURE_2D,this.panCacheTexture),a.uniform1i(this.uCacheTex,0),a.uniform2f(this.uViewportPx,this.canvas.width,this.canvas.height),a.uniform2f(this.uCacheSizePx,this.panCacheWidth,this.panCacheHeight),a.uniform2f(this.uOffsetPx,t,e),a.uniform1f(this.uSampleScale,s),a.disable(a.BLEND),a.drawArrays(a.TRIANGLE_STRIP,0,4),a.enable(a.BLEND)}ensurePanCacheResources(){const t=this.gl,e=t.getParameter(t.MAX_TEXTURE_SIZE),s=Math.min(e,Math.max(this.canvas.width+dn*2,Math.ceil(this.canvas.width*hn))),a=Math.min(e,Math.max(this.canvas.height+dn*2,Math.ceil(this.canvas.height*hn)));if(s<this.canvas.width||a<this.canvas.height)return!1;if(this.panCacheTexture&&this.panCacheFramebuffer&&this.panCacheWidth===s&&this.panCacheHeight===a)return!0;this.destroyPanCacheResources();const r=t.createTexture();if(!r)return!1;t.bindTexture(t.TEXTURE_2D,r),Ni(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA8,s,a,0,t.RGBA,t.UNSIGNED_BYTE,null);const i=t.createFramebuffer();if(!i)return t.deleteTexture(r),!1;t.bindFramebuffer(t.FRAMEBUFFER,i),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,r,0);const o=t.checkFramebufferStatus(t.FRAMEBUFFER);return t.bindFramebuffer(t.FRAMEBUFFER,null),o!==t.FRAMEBUFFER_COMPLETE?(t.deleteFramebuffer(i),t.deleteTexture(r),!1):(this.panCacheTexture=r,this.panCacheFramebuffer=i,this.panCacheWidth=s,this.panCacheHeight=a,this.panCacheValid=!1,!0)}destroyPanCacheResources(){this.panCacheFramebuffer&&(this.gl.deleteFramebuffer(this.panCacheFramebuffer),this.panCacheFramebuffer=null),this.panCacheTexture&&(this.gl.deleteTexture(this.panCacheTexture),this.panCacheTexture=null),this.panCacheWidth=0,this.panCacheHeight=0,this.panCacheValid=!1,this.panCacheRenderedSegments=0,this.panCacheUsedCulling=!1}destroyVectorMinifyResources(){this.vectorMinifyFramebuffer&&(this.gl.deleteFramebuffer(this.vectorMinifyFramebuffer),this.vectorMinifyFramebuffer=null),this.vectorMinifyTexture&&(this.gl.deleteTexture(this.vectorMinifyTexture),this.vectorMinifyTexture=null),this.vectorMinifyWidth=0,this.vectorMinifyHeight=0,this.vectorMinifyWarmupPending=!1}updateVisibleSet(t=this.cameraCenterX,e=this.cameraCenterY,s=this.canvas.width,a=this.canvas.height,r=this.zoom){if(!this.scene){this.visibleSegmentCount=0,this.usingAllSegments=!0,this.visiblePageRectCount=0,this.visibleTextRanges=[];return}if(!this.hasCameraInteractionSinceSceneLoad){this.usingAllSegments=!0,this.visibleSegmentCount=this.segmentCount,this.setAllPagesAndTextVisible();return}const i=Math.max(r,1e-6),o=s/(2*i),l=a/(2*i),c=Math.max(16/i,this.scene.maxHalfWidth*2),p=t-o-c,m=t+o+c,g=e-l-c,f=e+l+c;if(this.updateVisiblePagesAndTextRanges(p,g,m,f),!this.grid){this.visibleSegmentCount=0,this.usingAllSegments=!0;return}const y=this.grid,h=de(Math.floor((p-y.minX)/y.cellWidth),y.gridWidth),x=de(Math.floor((m-y.minX)/y.cellWidth),y.gridWidth),T=de(Math.floor((g-y.minY)/y.cellHeight),y.gridHeight),C=de(Math.floor((f-y.minY)/y.cellHeight),y.gridHeight);this.usingAllSegments=!1,this.markToken+=1,this.markToken===4294967295&&(this.segmentMarks.fill(0),this.markToken=1);let w=0;for(let A=T;A<=C;A+=1){let S=A*y.gridWidth+h;for(let k=h;k<=x;k+=1){const G=y.offsets[S],B=y.counts[S];for(let I=0;I<B;I+=1){const P=y.indices[G+I];this.segmentMarks[P]!==this.markToken&&(this.segmentMarks[P]=this.markToken,!(this.segmentMaxX[P]<p||this.segmentMinX[P]>m||this.segmentMaxY[P]<g||this.segmentMinY[P]>f)&&(this.visibleSegmentIds[w]=P,w+=1))}S+=1}}this.visibleSegmentCount=w;const R=this.visibleSegmentIds.subarray(0,w);this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.visibleSegmentIdBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,R,this.gl.DYNAMIC_DRAW)}setAllPagesAndTextVisible(){const t=Math.floor(this.pageRects.length/4);this.visiblePageRectIndices.length<t&&(this.visiblePageRectIndices=new Uint32Array(t));for(let e=0;e<t;e+=1)this.visiblePageRectIndices[e]=e;this.visiblePageRectCount=t,this.visibleTextRanges=this.textInstanceCount>0?[{start:0,count:this.textInstanceCount}]:[]}updateVisiblePagesAndTextRanges(t,e,s,a){const r=Math.floor(this.pageRects.length/4);if(r<=0){this.visiblePageRectCount=0,this.visibleTextRanges=this.textInstanceCount>0?[{start:0,count:this.textInstanceCount}]:[];return}this.visiblePageRectIndices.length<r&&(this.visiblePageRectIndices=new Uint32Array(r));const i=[];let o=0;for(let l=0;l<r;l+=1){const c=l*4,p=Math.min(this.pageRects[c],this.pageRects[c+2]),m=Math.min(this.pageRects[c+1],this.pageRects[c+3]),g=Math.max(this.pageRects[c],this.pageRects[c+2]),f=Math.max(this.pageRects[c+1],this.pageRects[c+3]);if(g<t||p>s||f<e||m>a)continue;this.visiblePageRectIndices[o]=l,o+=1;const y=l*2,h=this.pageTextRanges[y]??0,x=this.pageTextRanges[y+1]??0;this.appendVisibleTextRange(i,h,x)}this.visiblePageRectCount=o,this.visibleTextRanges=i}appendVisibleTextRange(t,e,s){const a=Ct(Math.trunc(e),0,this.textInstanceCount),r=Ct(Math.trunc(s),0,this.textInstanceCount-a);if(r<=0)return;const i=t[t.length-1];if(i&&a<=i.start+i.count){const o=Math.max(i.start+i.count,a+r);i.count=o-i.start;return}t.push({start:a,count:r})}uploadRasterLayers(t){const e=this.gl;for(const s of this.rasterLayers)e.deleteTexture(s.texture);this.rasterLayers=[];for(const s of this.getSceneRasterLayers(t)){const a=e.createTexture();if(!a)continue;e.bindTexture(e.TEXTURE_2D,a),pn(e);const r=s.data.subarray(0,s.width*s.height*4),i=Yi(r);e.texImage2D(e.TEXTURE_2D,0,e.RGBA,s.width,s.height,0,e.RGBA,e.UNSIGNED_BYTE,i),e.generateMipmap(e.TEXTURE_2D);const o=new Float32Array(6);s.matrix.length>=6?(o[0]=s.matrix[0],o[1]=s.matrix[1],o[2]=s.matrix[2],o[3]=s.matrix[3],o[4]=s.matrix[4],o[5]=s.matrix[5]):(o[0]=1,o[3]=1),this.rasterLayers.push({texture:a,matrix:o})}}getSceneRasterLayers(t){const e=[];if(Array.isArray(t.rasterLayers))for(const r of t.rasterLayers){const i=Math.max(0,Math.trunc(r?.width??0)),o=Math.max(0,Math.trunc(r?.height??0));i<=0||o<=0||!(r.data instanceof Uint8Array)||r.data.length<i*o*4||e.push({width:i,height:o,data:r.data,matrix:r.matrix instanceof Float32Array?r.matrix:new Float32Array(r.matrix)})}if(e.length>0)return e;const s=Math.max(0,Math.trunc(t.rasterLayerWidth)),a=Math.max(0,Math.trunc(t.rasterLayerHeight));return s<=0||a<=0||t.rasterLayerData.length<s*a*4||e.push({width:s,height:a,data:t.rasterLayerData,matrix:t.rasterLayerMatrix}),e}uploadFillPaths(t){const e=this.gl,s=e.getParameter(e.MAX_TEXTURE_SIZE),a=Kt(t.fillPathCount,s),r=Kt(t.fillSegmentCount,s);this.fillPathMetaTextureWidth=a.width,this.fillPathMetaTextureHeight=a.height,this.fillSegmentTextureWidth=r.width,this.fillSegmentTextureHeight=r.height;const i=a.width*a.height,o=r.width*r.height,l=new Float32Array(i*4);l.set(t.fillPathMetaA);const c=new Float32Array(i*4);c.set(t.fillPathMetaB);const p=new Float32Array(i*4);p.set(t.fillPathMetaC);const m=new Float32Array(o*4);m.set(t.fillSegmentsA);const g=new Float32Array(o*4);return g.set(t.fillSegmentsB),e.bindTexture(e.TEXTURE_2D,this.fillPathMetaTextureA),bt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,0,e.RGBA,e.FLOAT,l),e.bindTexture(e.TEXTURE_2D,this.fillPathMetaTextureB),bt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,0,e.RGBA,e.FLOAT,c),e.bindTexture(e.TEXTURE_2D,this.fillPathMetaTextureC),bt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,0,e.RGBA,e.FLOAT,p),e.bindTexture(e.TEXTURE_2D,this.fillSegmentTextureA),bt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.fillSegmentTextureWidth,this.fillSegmentTextureHeight,0,e.RGBA,e.FLOAT,m),e.bindTexture(e.TEXTURE_2D,this.fillSegmentTextureB),bt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.fillSegmentTextureWidth,this.fillSegmentTextureHeight,0,e.RGBA,e.FLOAT,g),{pathMetaTextureWidth:this.fillPathMetaTextureWidth,pathMetaTextureHeight:this.fillPathMetaTextureHeight,segmentTextureWidth:this.fillSegmentTextureWidth,segmentTextureHeight:this.fillSegmentTextureHeight}}uploadSegments(t){const e=this.gl,s=e.getParameter(e.MAX_TEXTURE_SIZE),a=Math.ceil(Math.sqrt(t.segmentCount));if(this.segmentTextureWidth=Ct(a,1,s),this.segmentTextureHeight=Math.max(1,Math.ceil(t.segmentCount/this.segmentTextureWidth)),this.segmentTextureHeight>s)throw new Error("Segment texture exceeds GPU limits for this browser/GPU.");const r=this.segmentTextureWidth*this.segmentTextureHeight,i=new Float32Array(r*4);i.set(t.endpoints);const o=new Float32Array(r*4);o.set(t.primitiveMeta);const l=new Float32Array(r*4);l.set(t.styles);const c=new Float32Array(r*4);return c.set(t.primitiveBounds),e.bindTexture(e.TEXTURE_2D,this.segmentTextureA),bt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.segmentTextureWidth,this.segmentTextureHeight,0,e.RGBA,e.FLOAT,i),e.bindTexture(e.TEXTURE_2D,this.segmentTextureB),bt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.segmentTextureWidth,this.segmentTextureHeight,0,e.RGBA,e.FLOAT,o),e.bindTexture(e.TEXTURE_2D,this.segmentTextureC),bt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.segmentTextureWidth,this.segmentTextureHeight,0,e.RGBA,e.FLOAT,l),e.bindTexture(e.TEXTURE_2D,this.segmentTextureD),bt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.segmentTextureWidth,this.segmentTextureHeight,0,e.RGBA,e.FLOAT,c),{textureWidth:this.segmentTextureWidth,textureHeight:this.segmentTextureHeight,maxTextureSize:s}}uploadTextData(t){const e=this.gl,s=e.getParameter(e.MAX_TEXTURE_SIZE),a=Kt(t.textInstanceCount,s),r=Kt(t.textGlyphCount,s),i=Kt(t.textGlyphSegmentCount,s);this.textInstanceTextureWidth=a.width,this.textInstanceTextureHeight=a.height,this.textGlyphMetaTextureWidth=r.width,this.textGlyphMetaTextureHeight=r.height,this.textGlyphSegmentTextureWidth=i.width,this.textGlyphSegmentTextureHeight=i.height;const o=a.width*a.height,l=r.width*r.height,c=i.width*i.height,p=new Float32Array(o*4);p.set(t.textInstanceA);const m=new Float32Array(o*4);m.set(t.textInstanceB);const g=new Float32Array(o*4);g.set(t.textInstanceC);const f=new Float32Array(l*4);f.set(t.textGlyphMetaA);const y=new Float32Array(l*4);y.set(t.textGlyphMetaB);const h=new Float32Array(l*4),x=jn(t,s);x?(h.set(x.glyphUvRects),this.textRasterAtlasWidth=x.width,this.textRasterAtlasHeight=x.height):(this.textRasterAtlasWidth=1,this.textRasterAtlasHeight=1);const T=new Float32Array(c*4);T.set(t.textGlyphSegmentsA);const C=new Float32Array(c*4);if(C.set(t.textGlyphSegmentsB),e.bindTexture(e.TEXTURE_2D,this.textInstanceTextureA),bt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.textInstanceTextureWidth,this.textInstanceTextureHeight,0,e.RGBA,e.FLOAT,p),e.bindTexture(e.TEXTURE_2D,this.textInstanceTextureB),bt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.textInstanceTextureWidth,this.textInstanceTextureHeight,0,e.RGBA,e.FLOAT,m),e.bindTexture(e.TEXTURE_2D,this.textInstanceTextureC),bt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.textInstanceTextureWidth,this.textInstanceTextureHeight,0,e.RGBA,e.FLOAT,g),e.bindTexture(e.TEXTURE_2D,this.textGlyphMetaTextureA),bt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,0,e.RGBA,e.FLOAT,f),e.bindTexture(e.TEXTURE_2D,this.textGlyphMetaTextureB),bt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,0,e.RGBA,e.FLOAT,y),e.bindTexture(e.TEXTURE_2D,this.textGlyphRasterMetaTexture),bt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,0,e.RGBA,e.FLOAT,h),e.bindTexture(e.TEXTURE_2D,this.textGlyphSegmentTextureA),bt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.textGlyphSegmentTextureWidth,this.textGlyphSegmentTextureHeight,0,e.RGBA,e.FLOAT,T),e.bindTexture(e.TEXTURE_2D,this.textGlyphSegmentTextureB),bt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.textGlyphSegmentTextureWidth,this.textGlyphSegmentTextureHeight,0,e.RGBA,e.FLOAT,C),e.bindTexture(e.TEXTURE_2D,this.textRasterAtlasTexture),pn(e),x)e.texImage2D(e.TEXTURE_2D,0,e.RGBA,this.textRasterAtlasWidth,this.textRasterAtlasHeight,0,e.RGBA,e.UNSIGNED_BYTE,x.rgba);else{const w=new Uint8Array([0,0,0,0]);e.texImage2D(e.TEXTURE_2D,0,e.RGBA,1,1,0,e.RGBA,e.UNSIGNED_BYTE,w)}return e.generateMipmap(e.TEXTURE_2D),{instanceTextureWidth:this.textInstanceTextureWidth,instanceTextureHeight:this.textInstanceTextureHeight,glyphMetaTextureWidth:this.textGlyphMetaTextureWidth,glyphMetaTextureHeight:this.textGlyphMetaTextureHeight,glyphSegmentTextureWidth:this.textGlyphSegmentTextureWidth,glyphSegmentTextureHeight:this.textGlyphSegmentTextureHeight}}buildSegmentBounds(t){this.segmentMinX.length<this.segmentCount&&(this.segmentMinX=new Float32Array(this.segmentCount),this.segmentMinY=new Float32Array(this.segmentCount),this.segmentMaxX=new Float32Array(this.segmentCount),this.segmentMaxY=new Float32Array(this.segmentCount));for(let e=0;e<this.segmentCount;e+=1){const s=e*4,a=e*4,r=t.styles[a]+.35;this.segmentMinX[e]=t.primitiveBounds[s]-r,this.segmentMinY[e]=t.primitiveBounds[s+1]-r,this.segmentMaxX[e]=t.primitiveBounds[s+2]+r,this.segmentMaxY[e]=t.primitiveBounds[s+3]+r}}markInteraction(){this.lastInteractionTime=performance.now()}isInteractionActive(){return performance.now()-this.lastInteractionTime<=ki}initializeGeometry(){const t=this.gl;t.bindBuffer(t.ARRAY_BUFFER,this.cornerBuffer);const e=new Float32Array([-1,-1,1,-1,-1,1,1,1]);t.bufferData(t.ARRAY_BUFFER,e,t.STATIC_DRAW),t.bindVertexArray(this.segmentVao),t.bindBuffer(t.ARRAY_BUFFER,this.cornerBuffer),t.enableVertexAttribArray(0),t.vertexAttribPointer(0,2,t.FLOAT,!1,8,0),t.vertexAttribDivisor(0,0),t.bindBuffer(t.ARRAY_BUFFER,this.allSegmentIdBuffer),t.enableVertexAttribArray(1),t.vertexAttribPointer(1,1,t.FLOAT,!1,4,0),t.vertexAttribDivisor(1,1),t.bindVertexArray(this.fillVao),t.bindBuffer(t.ARRAY_BUFFER,this.cornerBuffer),t.enableVertexAttribArray(0),t.vertexAttribPointer(0,2,t.FLOAT,!1,8,0),t.vertexAttribDivisor(0,0),t.bindBuffer(t.ARRAY_BUFFER,this.allFillPathIdBuffer),t.enableVertexAttribArray(3),t.vertexAttribPointer(3,1,t.FLOAT,!1,4,0),t.vertexAttribDivisor(3,1),t.bindVertexArray(this.textVao),t.bindBuffer(t.ARRAY_BUFFER,this.cornerBuffer),t.enableVertexAttribArray(0),t.vertexAttribPointer(0,2,t.FLOAT,!1,8,0),t.vertexAttribDivisor(0,0),t.bindBuffer(t.ARRAY_BUFFER,this.allTextInstanceIdBuffer),t.enableVertexAttribArray(2),t.vertexAttribPointer(2,1,t.FLOAT,!1,4,0),t.vertexAttribDivisor(2,1),t.bindVertexArray(this.blitVao),t.bindBuffer(t.ARRAY_BUFFER,this.cornerBuffer),t.enableVertexAttribArray(0),t.vertexAttribPointer(0,2,t.FLOAT,!1,8,0),t.vertexAttribDivisor(0,0),t.bindVertexArray(null)}initializeState(){this.ensureRenderState()}ensureRenderState(){const t=this.gl;t.disable(t.DEPTH_TEST),t.disable(t.CULL_FACE),t.disable(t.SCISSOR_TEST),t.colorMask(!0,!0,!0,!0),t.enable(t.BLEND),t.blendEquationSeparate(t.FUNC_ADD,t.FUNC_ADD),t.blendFuncSeparate(t.SRC_ALPHA,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA)}uploadPageBackgroundTexture(){const t=this.gl,e=this.pageBackgroundColor,s=new Uint8Array([Math.round(e[0]*255),Math.round(e[1]*255),Math.round(e[2]*255),Math.round(e[3]*255)]);t.bindTexture(t.TEXTURE_2D,this.pageBackgroundTexture),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),t.texImage2D(t.TEXTURE_2D,0,t.RGBA,1,1,0,t.RGBA,t.UNSIGNED_BYTE,s),t.bindTexture(t.TEXTURE_2D,null)}clientToWorld(t,e){return this.clientToWorldAt(t,e,this.cameraCenterX,this.cameraCenterY,this.zoom)}clientToWorldAt(t,e,s,a,r){const i=this.resolveInteractionViewportRect(),o=this.resolveClientToPixelScale(i),l=(t-i.left)*o.x,c=(i.bottom-e)*o.y;return{x:(l-this.canvas.width*.5)/r+s,y:(c-this.canvas.height*.5)/r+a}}syncCameraTargetsToCurrent(){this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY,this.targetZoom=this.zoom,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1}updatePanReleaseVelocitySample(t){if(!this.isPanInteracting){this.lastPanFrameTimeMs=0;return}if(this.lastPanFrameTimeMs>0){const e=t-this.lastPanFrameTimeMs;if(e>.1){const s=this.cameraCenterX-this.lastPanFrameCameraX,a=this.cameraCenterY-this.lastPanFrameCameraY;let r=s*1e3/e,i=a*1e3/e;const o=Math.hypot(r,i);if(Number.isFinite(o)&&o>=fn){if(o>mn){const l=mn/o;r*=l,i*=l}this.panVelocityWorldX=r,this.panVelocityWorldY=i,this.lastPanVelocityUpdateTimeMs=t}}}this.lastPanFrameCameraX=this.cameraCenterX,this.lastPanFrameCameraY=this.cameraCenterY,this.lastPanFrameTimeMs=t}updateCameraWithDamping(t){let e=Math.abs(this.targetCameraCenterX-this.cameraCenterX)>Yt||Math.abs(this.targetCameraCenterY-this.cameraCenterY)>Yt,s=Math.abs(this.targetZoom-this.zoom)>le;if(!e&&!s)return this.hasZoomAnchor=!1,this.lastCameraAnimationTimeMs=t,!1;this.lastCameraAnimationTimeMs<=0&&(this.lastCameraAnimationTimeMs=t-16);const a=Ct(t-this.lastCameraAnimationTimeMs,0,Xi);this.lastCameraAnimationTimeMs=t;const r=a/1e3,i=1-Math.exp(-ke*r),o=1-Math.exp(-24*r);if(s&&(this.zoom+=(this.targetZoom-this.zoom)*o,Math.abs(this.targetZoom-this.zoom)<=le&&(this.zoom=this.targetZoom)),this.hasZoomAnchor){const l=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,this.zoom),c=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,this.targetZoom);this.cameraCenterX=l.x,this.cameraCenterY=l.y,this.targetCameraCenterX=c.x,this.targetCameraCenterY=c.y,s||(this.hasZoomAnchor=!1),e=!1}else e&&(this.cameraCenterX+=(this.targetCameraCenterX-this.cameraCenterX)*i,this.cameraCenterY+=(this.targetCameraCenterY-this.cameraCenterY)*i,Math.abs(this.targetCameraCenterX-this.cameraCenterX)<=Yt&&(this.cameraCenterX=this.targetCameraCenterX),Math.abs(this.targetCameraCenterY-this.cameraCenterY)<=Yt&&(this.cameraCenterY=this.targetCameraCenterY));return this.markInteraction(),this.needsVisibleSetUpdate=!0,e=Math.abs(this.targetCameraCenterX-this.cameraCenterX)>Yt||Math.abs(this.targetCameraCenterY-this.cameraCenterY)>Yt,s=Math.abs(this.targetZoom-this.zoom)>le,e||s}computeCameraCenterForAnchor(t,e,s,a,r){const i=this.resolveInteractionViewportRect(),o=this.resolveClientToPixelScale(i),l=(t-i.left)*o.x,c=(i.bottom-e)*o.y;return{x:s-(l-this.canvas.width*.5)/r,y:a-(c-this.canvas.height*.5)/r}}resolveInteractionViewportRect(){const t=this.interactionViewportProvider?.();return t||this.canvas.getBoundingClientRect()}resolveClientToPixelScale(t){const e=t??this.resolveInteractionViewportRect(),s=Math.max(window.devicePixelRatio||1,1e-6),a=e.width>1e-6?this.canvas.width/e.width:s,r=e.height>1e-6?this.canvas.height/e.height:s;return{x:Math.max(1e-6,a),y:Math.max(1e-6,r)}}createProgram(t,e){const s=this.gl,a=this.compileShader(s.VERTEX_SHADER,t),r=this.compileShader(s.FRAGMENT_SHADER,e),i=s.createProgram();if(!i)throw new Error("Unable to create WebGL program.");if(s.attachShader(i,a),s.attachShader(i,r),s.linkProgram(i),!s.getProgramParameter(i,s.LINK_STATUS)){const l=s.getProgramInfoLog(i)||"Unknown linker error.";throw s.deleteProgram(i),new Error(`Program link failed: ${l}`)}return s.deleteShader(a),s.deleteShader(r),i}compileShader(t,e){const s=this.gl.createShader(t);if(!s)throw new Error("Unable to create shader.");if(this.gl.shaderSource(s,e),this.gl.compileShader(s),!this.gl.getShaderParameter(s,this.gl.COMPILE_STATUS)){const r=this.gl.getShaderInfoLog(s)||"Unknown shader compiler error.";throw this.gl.deleteShader(s),new Error(`Shader compilation failed: ${r}`)}return s}createVertexArray(){const t=this.gl.createVertexArray();if(!t)throw new Error("Unable to create VAO.");return t}mustCreateBuffer(){const t=this.gl.createBuffer();if(!t)throw new Error("Unable to create WebGL buffer.");return t}mustCreateTexture(){const t=this.gl.createTexture();if(!t)throw new Error("Unable to create WebGL texture.");return t}mustGetUniformLocation(t,e){const s=this.gl.getUniformLocation(t,e);if(!s)throw new Error(`Missing uniform: ${e}`);return s}}function bt(n){n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,n.NEAREST),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAG_FILTER,n.NEAREST),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_S,n.CLAMP_TO_EDGE),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_T,n.CLAMP_TO_EDGE)}function Ni(n){n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,n.LINEAR),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAG_FILTER,n.LINEAR),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_S,n.CLAMP_TO_EDGE),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_T,n.CLAMP_TO_EDGE)}function Vi(n){n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,n.LINEAR),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAG_FILTER,n.LINEAR),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_S,n.CLAMP_TO_EDGE),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_T,n.CLAMP_TO_EDGE)}function pn(n){n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,n.LINEAR_MIPMAP_LINEAR),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAG_FILTER,n.LINEAR),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_S,n.CLAMP_TO_EDGE),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_T,n.CLAMP_TO_EDGE)}function Yi(n){const t=new Uint8Array(n.length);for(let e=0;e+3<n.length;e+=4){const s=n[e+3];if(s<=0){t[e]=0,t[e+1]=0,t[e+2]=0,t[e+3]=0;continue}if(s>=255){t[e]=n[e],t[e+1]=n[e+1],t[e+2]=n[e+2],t[e+3]=255;continue}const a=s/255;t[e]=Math.round(n[e]*a),t[e+1]=Math.round(n[e+1]*a),t[e+2]=Math.round(n[e+2]*a),t[e+3]=s}return t}function Kt(n,t){const e=Math.max(1,n),s=Math.ceil(Math.sqrt(e)),a=Ct(s,1,t),r=Math.max(1,Math.ceil(e/a));if(r>t)throw new Error("Data texture exceeds GPU limits for this browser/GPU.");return{width:a,height:r}}function Wi(n){return n.pageRects instanceof Float32Array&&n.pageRects.length>=4?new Float32Array(n.pageRects):new Float32Array([n.pageBounds.minX,n.pageBounds.minY,n.pageBounds.maxX,n.pageBounds.maxY])}function Hi(n,t,e){const s=Math.max(1,Math.floor(t.length/4)),a=s*2,r=Math.max(0,e|0);if(n.pageTextRanges instanceof Uint32Array&&n.pageTextRanges.length>=a){const o=new Uint32Array(a);let l=0;for(let c=0;c<s;c+=1){const p=c*2,m=Ct(Math.trunc(n.pageTextRanges[p]),l,r),g=Ct(Math.trunc(n.pageTextRanges[p+1]),0,r-m);o[p]=m,o[p+1]=g,l=m+g}return o}const i=new Uint32Array(a);i[0]=0,i[1]=r;for(let o=1;o<s;o+=1){const l=o*2;i[l]=r,i[l+1]=0}return i}function Ct(n,t,e){return n<t?t:n>e?e:n}function de(n,t){return n<0?0:n>=t?t-1:n}const qi=140,Zi=.92,gn=3e5,xn=1.8,yn=96,ji=1e-5,$i=.75,Qi=1.3333333333,Ki=2,Ji=2.25,Le=24,Wt=1e-4,fe=1e-5,tr=64,Tn=5,vn=2e4,er=120,Jt={r:160/255,g:169/255,b:175/255,a:1},nr=16,Ft=64,ir=12,me=48,rr=4,pe=16,ar=8,ge=32,sr=`
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
`,or=`
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
`,lr=`
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
`,cr=`
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
`,ur=`
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
`,hr=`
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
`;class ri{canvas;gpuDevice;gpuContext;presentationFormat;strokePipeline;fillPipeline;textPipeline;rasterPipeline;blitPipeline;vectorCompositePipeline;cameraUniformBuffer;blitUniformBuffer;vectorCompositeUniformBuffer;panCacheSampler;rasterLayerSampler;vectorCompositeSampler;strokeBindGroupLayout;fillBindGroupLayout;textBindGroupLayout;rasterBindGroupLayout;blitBindGroupLayout;vectorCompositeBindGroupLayout;strokeBindGroupAll=null;strokeBindGroupVisible=null;fillBindGroup=null;textBindGroup=null;blitBindGroup=null;vectorCompositeBindGroup=null;segmentTextureA=null;segmentTextureB=null;segmentTextureC=null;segmentTextureD=null;fillPathMetaTextureA=null;fillPathMetaTextureB=null;fillPathMetaTextureC=null;fillSegmentTextureA=null;fillSegmentTextureB=null;textInstanceTextureA=null;textInstanceTextureB=null;textInstanceTextureC=null;rasterLayerResources=[];pageBackgroundResources=[];textGlyphMetaTextureA=null;textGlyphMetaTextureB=null;textGlyphRasterMetaTexture=null;textGlyphSegmentTextureA=null;textGlyphSegmentTextureB=null;textRasterAtlasTexture=null;pageBackgroundTexture=null;segmentIdBufferAll=null;segmentIdBufferVisible=null;panCacheTexture=null;panCacheWidth=0;panCacheHeight=0;panCacheValid=!1;panCacheCenterX=0;panCacheCenterY=0;panCacheZoom=1;panCacheRenderedSegments=0;panCacheUsedCulling=!1;vectorMinifyTexture=null;vectorMinifyWidth=0;vectorMinifyHeight=0;scene=null;sceneStats=null;grid=null;frameListener=null;interactionViewportProvider=null;presentedCameraCenterX=0;presentedCameraCenterY=0;presentedZoom=1;presentedFrameSerial=0;rafHandle=0;externalFrameDriver=!1;externalFramePending=!1;cameraCenterX=0;cameraCenterY=0;zoom=1;targetCameraCenterX=0;targetCameraCenterY=0;targetZoom=1;lastCameraAnimationTimeMs=0;hasZoomAnchor=!1;zoomAnchorClientX=0;zoomAnchorClientY=0;zoomAnchorWorldX=0;zoomAnchorWorldY=0;panVelocityWorldX=0;panVelocityWorldY=0;lastPanVelocityUpdateTimeMs=0;lastPanFrameCameraX=0;lastPanFrameCameraY=0;lastPanFrameTimeMs=0;minZoom=.01;maxZoom=8192;strokeCurveEnabled=!0;rasterRenderingEnabled=!0;fillRenderingEnabled=!0;strokeRenderingEnabled=!0;textRenderingEnabled=!0;textVectorOnly=!1;pageBackgroundColor=[1,1,1,1];vectorOverrideColor=[0,0,0];vectorOverrideOpacity=0;panOptimizationEnabled=!0;isPanInteracting=!1;hasCameraInteractionSinceSceneLoad=!1;lastInteractionTime=Number.NEGATIVE_INFINITY;needsVisibleSetUpdate=!1;segmentCount=0;fillPathCount=0;textInstanceCount=0;visibleSegmentCount=0;usingAllSegments=!0;segmentTextureWidth=1;segmentTextureHeight=1;fillPathMetaTextureWidth=1;fillPathMetaTextureHeight=1;fillSegmentTextureWidth=1;fillSegmentTextureHeight=1;textInstanceTextureWidth=1;textInstanceTextureHeight=1;textGlyphMetaTextureWidth=1;textGlyphMetaTextureHeight=1;textGlyphSegmentTextureWidth=1;textGlyphSegmentTextureHeight=1;allSegmentIds=new Uint32Array(0);visibleSegmentIds=new Uint32Array(0);segmentMarks=new Uint32Array(0);segmentMinX=new Float32Array(0);segmentMinY=new Float32Array(0);segmentMaxX=new Float32Array(0);segmentMaxY=new Float32Array(0);markToken=1;constructor(t,e,s,a){this.canvas=t,this.gpuDevice=e,this.gpuContext=s,this.presentationFormat=a,this.configureContext();const r=globalThis.GPUBufferUsage,i=globalThis.GPUShaderStage;this.cameraUniformBuffer=this.gpuDevice.createBuffer({size:Ft,usage:r.UNIFORM|r.COPY_DST}),this.blitUniformBuffer=this.gpuDevice.createBuffer({size:me,usage:r.UNIFORM|r.COPY_DST}),this.vectorCompositeUniformBuffer=this.gpuDevice.createBuffer({size:pe,usage:r.UNIFORM|r.COPY_DST}),this.strokeBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:i.VERTEX|i.FRAGMENT,buffer:{type:"uniform",minBindingSize:Ft}},{binding:1,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:3,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:4,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:5,visibility:i.VERTEX,buffer:{type:"read-only-storage"}}]}),this.fillBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:i.VERTEX|i.FRAGMENT,buffer:{type:"uniform",minBindingSize:Ft}},{binding:1,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:3,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:4,visibility:i.FRAGMENT,texture:{sampleType:"unfilterable-float"}},{binding:5,visibility:i.FRAGMENT,texture:{sampleType:"unfilterable-float"}}]}),this.textBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:i.VERTEX|i.FRAGMENT,buffer:{type:"uniform",minBindingSize:Ft}},{binding:1,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:3,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:4,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:5,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:6,visibility:i.FRAGMENT,texture:{sampleType:"unfilterable-float"}},{binding:7,visibility:i.FRAGMENT,texture:{sampleType:"unfilterable-float"}},{binding:8,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:9,visibility:i.FRAGMENT,sampler:{type:"filtering"}},{binding:10,visibility:i.FRAGMENT,texture:{sampleType:"float"}}]}),this.rasterBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:i.VERTEX,buffer:{type:"uniform",minBindingSize:Ft}},{binding:1,visibility:i.VERTEX,buffer:{type:"uniform",minBindingSize:ge}},{binding:2,visibility:i.FRAGMENT,sampler:{type:"filtering"}},{binding:3,visibility:i.FRAGMENT,texture:{sampleType:"float"}}]}),this.blitBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:i.FRAGMENT,sampler:{type:"filtering"}},{binding:1,visibility:i.FRAGMENT,texture:{sampleType:"float"}},{binding:2,visibility:i.FRAGMENT,buffer:{type:"uniform",minBindingSize:me}}]}),this.vectorCompositeBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:i.FRAGMENT,sampler:{type:"filtering"}},{binding:1,visibility:i.FRAGMENT,texture:{sampleType:"float"}},{binding:2,visibility:i.FRAGMENT,buffer:{type:"uniform",minBindingSize:pe}}]});const o=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.strokeBindGroupLayout]}),l=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.fillBindGroupLayout]}),c=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.textBindGroupLayout]}),p=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.rasterBindGroupLayout]}),m=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.blitBindGroupLayout]}),g=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.vectorCompositeBindGroupLayout]});this.strokePipeline=this.createPipeline(sr,"vsMain","fsMain",o),this.fillPipeline=this.createPipeline(or,"vsMain","fsMain",l),this.textPipeline=this.createPipeline(lr,"vsMain","fsMain",c),this.rasterPipeline=this.createPipeline(cr,"vsMain","fsMain",p,!0),this.blitPipeline=this.createPipeline(ur,"vsMain","fsMain",m),this.vectorCompositePipeline=this.createPipeline(hr,"vsMain","fsMain",g,!0),this.panCacheSampler=this.gpuDevice.createSampler({magFilter:"linear",minFilter:"linear",mipmapFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),this.rasterLayerSampler=this.gpuDevice.createSampler({magFilter:"linear",minFilter:"linear",mipmapFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),this.vectorCompositeSampler=this.gpuDevice.createSampler({magFilter:"linear",minFilter:"linear",mipmapFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),this.pageBackgroundTexture=this.createRgba8Texture(1,1,new Uint8Array([255,255,255,255])),this.ensureSegmentIdBuffers(1)}static async create(t){const e=navigator;if(!e.gpu)throw new Error("WebGPU is not available in this browser.");const s=await e.gpu.requestAdapter({powerPreference:"high-performance"})??await e.gpu.requestAdapter();if(!s)throw new Error("Failed to acquire a WebGPU adapter.");const a=await s.requestDevice();typeof a.addEventListener=="function"&&a.addEventListener("uncapturederror",o=>{const l=o?.error?.message||o?.error||o;console.warn("[WebGPU uncaptured error]",l)});const r=t.getContext("webgpu");if(!r)throw new Error("Failed to acquire a WebGPU canvas context.");const i=e.gpu.getPreferredCanvasFormat?.()??"bgra8unorm";return new ri(t,a,r,i)}setFrameListener(t){this.frameListener=t}setExternalFrameDriver(t){const e=!!t;if(this.externalFrameDriver!==e){if(this.externalFrameDriver=e,this.externalFrameDriver){this.externalFramePending=!0,this.rafHandle!==0&&(cancelAnimationFrame(this.rafHandle),this.rafHandle=0);return}this.externalFramePending&&(this.externalFramePending=!1,this.requestFrame())}}renderExternalFrame(t=performance.now()){this.externalFrameDriver&&!this.externalFramePending||(this.externalFramePending=!1,this.render(t))}setPanOptimizationEnabled(t){const e=!!t;this.panOptimizationEnabled!==e&&(this.panOptimizationEnabled=e,this.isPanInteracting=!1,this.panCacheValid=!1,this.panOptimizationEnabled||this.destroyPanCacheResources(),this.needsVisibleSetUpdate=!0,this.requestFrame())}setStrokeCurveEnabled(t){const e=!!t;this.strokeCurveEnabled!==e&&(this.strokeCurveEnabled=e,this.requestFrame())}setRasterRenderingEnabled(t){const e=!!t;this.rasterRenderingEnabled!==e&&(this.rasterRenderingEnabled=e,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setFillRenderingEnabled(t){const e=!!t;this.fillRenderingEnabled!==e&&(this.fillRenderingEnabled=e,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setStrokeRenderingEnabled(t){const e=!!t;this.strokeRenderingEnabled!==e&&(this.strokeRenderingEnabled=e,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setTextRenderingEnabled(t){const e=!!t;this.textRenderingEnabled!==e&&(this.textRenderingEnabled=e,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setTextVectorOnly(t){const e=!!t;this.textVectorOnly!==e&&(this.textVectorOnly=e,this.panCacheValid=!1,this.textVectorOnly&&this.destroyVectorMinifyResources(),this.requestFrame())}setPageBackgroundColor(t,e,s,a){const r=Et(t,0,1),i=Et(e,0,1),o=Et(s,0,1),l=Et(a,0,1),c=this.pageBackgroundColor;Math.abs(c[0]-r)<=1e-6&&Math.abs(c[1]-i)<=1e-6&&Math.abs(c[2]-o)<=1e-6&&Math.abs(c[3]-l)<=1e-6||(this.pageBackgroundColor=[r,i,o,l],this.uploadPageBackgroundTexture(),this.panCacheValid=!1,this.requestFrame())}setVectorColorOverride(t,e,s,a){const r=Et(t,0,1),i=Et(e,0,1),o=Et(s,0,1),l=Et(a,0,1),c=this.vectorOverrideColor;Math.abs(c[0]-r)<=1e-6&&Math.abs(c[1]-i)<=1e-6&&Math.abs(c[2]-o)<=1e-6&&Math.abs(this.vectorOverrideOpacity-l)<=1e-6||(this.vectorOverrideColor=[r,i,o],this.vectorOverrideOpacity=l,this.panCacheValid=!1,this.requestFrame())}setInteractionViewportProvider(t){this.interactionViewportProvider=t}beginPanInteraction(){this.hasCameraInteractionSinceSceneLoad=!0,this.syncCameraTargetsToCurrent(),this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameCameraX=this.cameraCenterX,this.lastPanFrameCameraY=this.cameraCenterY,this.lastPanFrameTimeMs=0,this.isPanInteracting=!0,this.markInteraction()}endPanInteraction(){this.isPanInteracting=!1;const t=performance.now(),s=this.lastPanVelocityUpdateTimeMs>0&&t-this.lastPanVelocityUpdateTimeMs<=er?Math.hypot(this.panVelocityWorldX,this.panVelocityWorldY):0;Number.isFinite(s)&&s>=Tn?(this.targetCameraCenterX=this.cameraCenterX+this.panVelocityWorldX/Le,this.targetCameraCenterY=this.cameraCenterY+this.panVelocityWorldY/Le,this.lastCameraAnimationTimeMs=0):(this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY),this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameTimeMs=0,this.markInteraction(),this.needsVisibleSetUpdate=!0,this.requestFrame()}resize(){const t=window.devicePixelRatio||1,e=Math.max(1,Math.round(this.canvas.clientWidth*t)),s=Math.max(1,Math.round(this.canvas.clientHeight*t));this.canvas.width===e&&this.canvas.height===s||(this.canvas.width=e,this.canvas.height=s,this.configureContext(),this.destroyPanCacheResources(),this.destroyVectorMinifyResources(),this.needsVisibleSetUpdate=!0,this.requestFrame())}setScene(t){this.scene=t,this.segmentCount=t.segmentCount,this.fillPathCount=t.fillPathCount,this.textInstanceCount=t.textInstanceCount,this.buildSegmentBounds(t),this.isPanInteracting=!1,this.panCacheValid=!1,this.destroyVectorMinifyResources(),this.grid=this.segmentCount>0?Zn(t):null;const e=this.maxTextureSize(),s=Ht(t.segmentCount,e),a=Ht(t.fillPathCount,e),r=Ht(t.fillSegmentCount,e),i=Ht(t.textInstanceCount,e),o=Ht(t.textGlyphCount,e),l=Ht(t.textGlyphSegmentCount,e);this.segmentTextureWidth=s.width,this.segmentTextureHeight=s.height,this.fillPathMetaTextureWidth=a.width,this.fillPathMetaTextureHeight=a.height,this.fillSegmentTextureWidth=r.width,this.fillSegmentTextureHeight=r.height,this.textInstanceTextureWidth=i.width,this.textInstanceTextureHeight=i.height,this.textGlyphMetaTextureWidth=o.width,this.textGlyphMetaTextureHeight=o.height,this.textGlyphSegmentTextureWidth=l.width,this.textGlyphSegmentTextureHeight=l.height,this.destroyDataResources(),this.segmentTextureA=this.createFloatTexture(this.segmentTextureWidth,this.segmentTextureHeight,t.endpoints),this.segmentTextureB=this.createFloatTexture(this.segmentTextureWidth,this.segmentTextureHeight,t.primitiveMeta),this.segmentTextureC=this.createFloatTexture(this.segmentTextureWidth,this.segmentTextureHeight,t.styles),this.segmentTextureD=this.createFloatTexture(this.segmentTextureWidth,this.segmentTextureHeight,t.primitiveBounds),this.fillPathMetaTextureA=this.createFloatTexture(this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,t.fillPathMetaA),this.fillPathMetaTextureB=this.createFloatTexture(this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,t.fillPathMetaB),this.fillPathMetaTextureC=this.createFloatTexture(this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,t.fillPathMetaC),this.fillSegmentTextureA=this.createFloatTexture(this.fillSegmentTextureWidth,this.fillSegmentTextureHeight,t.fillSegmentsA),this.fillSegmentTextureB=this.createFloatTexture(this.fillSegmentTextureWidth,this.fillSegmentTextureHeight,t.fillSegmentsB),this.textInstanceTextureA=this.createFloatTexture(this.textInstanceTextureWidth,this.textInstanceTextureHeight,t.textInstanceA),this.textInstanceTextureB=this.createFloatTexture(this.textInstanceTextureWidth,this.textInstanceTextureHeight,t.textInstanceB),this.textInstanceTextureC=this.createFloatTexture(this.textInstanceTextureWidth,this.textInstanceTextureHeight,t.textInstanceC),this.textGlyphMetaTextureA=this.createFloatTexture(this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,t.textGlyphMetaA),this.textGlyphMetaTextureB=this.createFloatTexture(this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,t.textGlyphMetaB),this.textGlyphSegmentTextureA=this.createFloatTexture(this.textGlyphSegmentTextureWidth,this.textGlyphSegmentTextureHeight,t.textGlyphSegmentsA),this.textGlyphSegmentTextureB=this.createFloatTexture(this.textGlyphSegmentTextureWidth,this.textGlyphSegmentTextureHeight,t.textGlyphSegmentsB);const c=new Float32Array(this.textGlyphMetaTextureWidth*this.textGlyphMetaTextureHeight*4),p=jn(t,e);p&&c.set(p.glyphUvRects),this.textGlyphRasterMetaTexture=this.createFloatTexture(this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,c),this.textRasterAtlasTexture=p?this.createRgba8Texture(p.width,p.height,p.rgba):this.createRgba8Texture(1,1,new Uint8Array([0,0,0,0])),this.configurePageBackgroundResources(t),this.configureRasterLayers(t),this.allSegmentIds=new Uint32Array(this.segmentCount);for(let m=0;m<this.segmentCount;m+=1)this.allSegmentIds[m]=m;return this.ensureSegmentIdBuffers(Math.max(1,this.segmentCount)),this.segmentCount>0&&(this.gpuDevice.queue.writeBuffer(this.segmentIdBufferAll,0,this.allSegmentIds),this.gpuDevice.queue.writeBuffer(this.segmentIdBufferVisible,0,this.allSegmentIds)),this.fillBindGroup=this.gpuDevice.createBindGroup({layout:this.fillPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:Ft}},{binding:1,resource:this.fillPathMetaTextureA.createView()},{binding:2,resource:this.fillPathMetaTextureB.createView()},{binding:3,resource:this.fillPathMetaTextureC.createView()},{binding:4,resource:this.fillSegmentTextureA.createView()},{binding:5,resource:this.fillSegmentTextureB.createView()}]}),this.textBindGroup=this.gpuDevice.createBindGroup({layout:this.textPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:Ft}},{binding:1,resource:this.textInstanceTextureA.createView()},{binding:2,resource:this.textInstanceTextureB.createView()},{binding:3,resource:this.textInstanceTextureC.createView()},{binding:4,resource:this.textGlyphMetaTextureA.createView()},{binding:5,resource:this.textGlyphMetaTextureB.createView()},{binding:6,resource:this.textGlyphSegmentTextureA.createView()},{binding:7,resource:this.textGlyphSegmentTextureB.createView()},{binding:8,resource:this.textGlyphRasterMetaTexture.createView()},{binding:9,resource:this.rasterLayerSampler},{binding:10,resource:this.textRasterAtlasTexture.createView()}]}),this.strokeBindGroupAll=this.gpuDevice.createBindGroup({layout:this.strokePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:Ft}},{binding:1,resource:this.segmentTextureA.createView()},{binding:2,resource:this.segmentTextureB.createView()},{binding:3,resource:this.segmentTextureC.createView()},{binding:4,resource:this.segmentTextureD.createView()},{binding:5,resource:{buffer:this.segmentIdBufferAll}}]}),this.strokeBindGroupVisible=this.gpuDevice.createBindGroup({layout:this.strokePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:Ft}},{binding:1,resource:this.segmentTextureA.createView()},{binding:2,resource:this.segmentTextureB.createView()},{binding:3,resource:this.segmentTextureC.createView()},{binding:4,resource:this.segmentTextureD.createView()},{binding:5,resource:{buffer:this.segmentIdBufferVisible}}]}),this.visibleSegmentIds.length<this.segmentCount&&(this.visibleSegmentIds=new Uint32Array(this.segmentCount)),this.segmentMarks.length<this.segmentCount&&(this.segmentMarks=new Uint32Array(this.segmentCount),this.markToken=1),this.visibleSegmentCount=this.segmentCount,this.usingAllSegments=!0,this.sceneStats={gridWidth:this.grid?.gridWidth??0,gridHeight:this.grid?.gridHeight??0,gridIndexCount:this.grid?.indices.length??0,maxCellPopulation:this.grid?.maxCellPopulation??0,fillPathTextureWidth:this.fillPathMetaTextureWidth,fillPathTextureHeight:this.fillPathMetaTextureHeight,fillSegmentTextureWidth:this.fillSegmentTextureWidth,fillSegmentTextureHeight:this.fillSegmentTextureHeight,textureWidth:this.segmentTextureWidth,textureHeight:this.segmentTextureHeight,maxTextureSize:e,textInstanceTextureWidth:this.textInstanceTextureWidth,textInstanceTextureHeight:this.textInstanceTextureHeight,textGlyphTextureWidth:this.textGlyphMetaTextureWidth,textGlyphTextureHeight:this.textGlyphMetaTextureHeight,textSegmentTextureWidth:this.textGlyphSegmentTextureWidth,textSegmentTextureHeight:this.textGlyphSegmentTextureHeight},this.minZoom=.01,this.maxZoom=8192,this.hasCameraInteractionSinceSceneLoad=!1,this.syncCameraTargetsToCurrent(),this.needsVisibleSetUpdate=!0,this.requestFrame(),this.sceneStats}getSceneStats(){return this.sceneStats}getViewState(){return{cameraCenterX:this.cameraCenterX,cameraCenterY:this.cameraCenterY,zoom:this.zoom}}getPresentedViewState(){return{cameraCenterX:this.presentedCameraCenterX,cameraCenterY:this.presentedCameraCenterY,zoom:this.presentedZoom}}getPresentedFrameSerial(){return this.presentedFrameSerial}setViewState(t){const e=Number(t.cameraCenterX),s=Number(t.cameraCenterY),a=Number(t.zoom);if(!Number.isFinite(e)||!Number.isFinite(s)||!Number.isFinite(a))return;this.cameraCenterX=e,this.cameraCenterY=s;const r=Et(a,this.minZoom,this.maxZoom);this.zoom=r,this.targetCameraCenterX=e,this.targetCameraCenterY=s,this.targetZoom=r,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1,this.isPanInteracting=!1,this.panCacheValid=!1,this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.needsVisibleSetUpdate=!0,this.requestFrame()}fitToBounds(t,e=64){const s=Math.max(t.maxX-t.minX,1e-4),a=Math.max(t.maxY-t.minY,1e-4),r=Math.max(1,this.canvas.width-e*2),i=Math.max(1,this.canvas.height-e*2),o=Math.min(r/s,i/a),l=Et(o,1e-8,this.maxZoom);this.minZoom=Math.min(this.minZoom,l);const c=(t.minX+t.maxX)*.5,p=(t.minY+t.maxY)*.5;this.zoom=l,this.cameraCenterX=c,this.cameraCenterY=p,this.targetZoom=l,this.targetCameraCenterX=c,this.targetCameraCenterY=p,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1,this.isPanInteracting=!1,this.panCacheValid=!1,this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.needsVisibleSetUpdate=!0,this.requestFrame()}panByPixels(t,e){if(!Number.isFinite(t)||!Number.isFinite(e))return;this.hasCameraInteractionSinceSceneLoad=!0,this.markInteraction(),this.hasZoomAnchor=!1;const s=this.resolveClientToPixelScale(),a=-(t*s.x)/this.zoom,r=e*s.y/this.zoom;this.cameraCenterX+=a,this.cameraCenterY+=r,this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY,this.needsVisibleSetUpdate=!0,this.requestFrame()}zoomAtClientPoint(t,e,s){const a=Et(s,.1,10);this.hasCameraInteractionSinceSceneLoad=!0,this.markInteraction();const r=this.clientToWorld(t,e),i=Et(this.targetZoom*a,this.minZoom,this.maxZoom);this.hasZoomAnchor=!0,this.zoomAnchorClientX=t,this.zoomAnchorClientY=e,this.zoomAnchorWorldX=r.x,this.zoomAnchorWorldY=r.y,this.targetZoom=i;const o=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,i);this.targetCameraCenterX=o.x,this.targetCameraCenterY=o.y,this.needsVisibleSetUpdate=!0,this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameTimeMs=0,this.requestFrame()}dispose(){this.rafHandle!==0&&(cancelAnimationFrame(this.rafHandle),this.rafHandle=0),this.frameListener=null,this.destroyPanCacheResources(),this.destroyVectorMinifyResources(),this.destroyDataResources(),this.segmentIdBufferAll&&(this.segmentIdBufferAll.destroy(),this.segmentIdBufferAll=null),this.segmentIdBufferVisible&&(this.segmentIdBufferVisible.destroy(),this.segmentIdBufferVisible=null),this.cameraUniformBuffer&&this.cameraUniformBuffer.destroy(),this.blitUniformBuffer&&this.blitUniformBuffer.destroy(),this.vectorCompositeUniformBuffer&&this.vectorCompositeUniformBuffer.destroy(),this.pageBackgroundTexture&&(this.pageBackgroundTexture.destroy(),this.pageBackgroundTexture=null)}configureContext(){this.gpuContext.configure({device:this.gpuDevice,format:this.presentationFormat,alphaMode:"opaque"})}createPipeline(t,e,s,a,r=!1){const i=this.gpuDevice.createShaderModule({code:t}),o=r?"one":"src-alpha";return this.gpuDevice.createRenderPipeline({layout:a,vertex:{module:i,entryPoint:e},fragment:{module:i,entryPoint:s,targets:[{format:this.presentationFormat,blend:{color:{srcFactor:o,dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}}}]},primitive:{topology:"triangle-strip"}})}maxTextureSize(){const t=Number(this.gpuDevice?.limits?.maxTextureDimension2D);return Number.isFinite(t)&&t>=1?Math.floor(t):8192}ensureSegmentIdBuffers(t){const e=globalThis.GPUBufferUsage,s=Math.max(1,t)*4;this.segmentIdBufferAll&&(this.segmentIdBufferAll.destroy(),this.segmentIdBufferAll=null),this.segmentIdBufferVisible&&(this.segmentIdBufferVisible.destroy(),this.segmentIdBufferVisible=null),this.segmentIdBufferAll=this.gpuDevice.createBuffer({size:s,usage:e.STORAGE|e.COPY_DST}),this.segmentIdBufferVisible=this.gpuDevice.createBuffer({size:s,usage:e.STORAGE|e.COPY_DST})}requestFrame(){if(this.externalFrameDriver){this.externalFramePending=!0;return}this.rafHandle===0&&(this.rafHandle=requestAnimationFrame(t=>{this.rafHandle=0,this.render(t)}))}render(t=performance.now()){const e=this.updateCameraWithDamping(t);if(this.updatePanReleaseVelocitySample(t),!this.scene||this.segmentCount===0&&this.fillPathCount===0&&this.textInstanceCount===0&&this.rasterLayerResources.length===0&&this.pageBackgroundResources.length===0){this.clearToScreen(),this.capturePresentedFrameState(),this.frameListener?.({renderedSegments:0,totalSegments:0,usedCulling:!1,zoom:this.zoom}),e&&this.requestFrame();return}if(!this.hasNativeRenderingEnabled()){this.capturePresentedFrameState(),this.frameListener?.({renderedSegments:0,totalSegments:this.segmentCount,usedCulling:!1,zoom:this.zoom}),e&&this.requestFrame();return}this.shouldUsePanCache(e)?this.renderWithPanCache():this.renderDirectToScreen(),this.capturePresentedFrameState(),e&&this.requestFrame()}hasNativeRenderingEnabled(){return this.rasterRenderingEnabled||this.fillRenderingEnabled||this.strokeRenderingEnabled||this.textRenderingEnabled}capturePresentedFrameState(){this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.presentedFrameSerial+=1}shouldUsePanCache(t){return!this.panOptimizationEnabled||this.segmentCount<gn?!1:this.isPanInteracting?!0:t}renderDirectToScreen(){let t=this.shouldUseVectorMinifyPath()&&this.ensureVectorMinifyResources();if(this.panOptimizationEnabled&&this.segmentCount>=gn&&(t=!1),this.needsVisibleSetUpdate){if(t){const i=this.computeVectorMinifyZoom(this.vectorMinifyWidth,this.vectorMinifyHeight);this.updateVisibleSet(this.cameraCenterX,this.cameraCenterY,this.vectorMinifyWidth,this.vectorMinifyHeight,i)}else this.updateVisibleSet(this.cameraCenterX,this.cameraCenterY,this.canvas.width,this.canvas.height,this.zoom);this.needsVisibleSetUpdate=!1}if(t){const i=this.renderVectorLayerIntoMinifyTarget(this.vectorMinifyWidth,this.vectorMinifyHeight,this.cameraCenterX,this.cameraCenterY),o=this.gpuContext.getCurrentTexture().createView(),l=this.gpuDevice.createCommandEncoder(),c=l.beginRenderPass({colorAttachments:[{view:o,clearValue:Jt,loadOp:"clear",storeOp:"store"}]});this.updateCameraUniforms(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY),this.drawRasterContentIntoPass(c),this.drawVectorMinifyCompositeIntoPass(c,this.canvas.width,this.canvas.height),c.end(),this.gpuDevice.queue.submit([l.finish()]),this.frameListener?.({renderedSegments:i,totalSegments:this.segmentCount,usedCulling:!this.usingAllSegments,zoom:this.zoom});return}const e=this.gpuContext.getCurrentTexture().createView(),s=this.gpuDevice.createCommandEncoder(),a=s.beginRenderPass({colorAttachments:[{view:e,clearValue:Jt,loadOp:"clear",storeOp:"store"}]}),r=this.drawSceneIntoPass(a,this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY);a.end(),this.gpuDevice.queue.submit([s.finish()]),this.frameListener?.({renderedSegments:r,totalSegments:this.segmentCount,usedCulling:!this.usingAllSegments,zoom:this.zoom})}hasVectorContent(){return this.fillRenderingEnabled&&this.fillPathCount>0||this.strokeRenderingEnabled&&this.segmentCount>0||this.textRenderingEnabled&&this.textInstanceCount>0}shouldUseVectorMinifyPath(){return this.textVectorOnly||!this.hasVectorContent()?!1:this.zoom<=Ji}computeVectorMinifyZoom(t,e){const s=Math.min(t/Math.max(1,this.canvas.width),e/Math.max(1,this.canvas.height));return this.zoom*Math.max(1,s)}renderVectorLayerIntoMinifyTarget(t,e,s,a){if(!this.vectorMinifyTexture)return 0;const r=this.computeVectorMinifyZoom(t,e),i=this.gpuDevice.createCommandEncoder(),o=i.beginRenderPass({colorAttachments:[{view:this.vectorMinifyTexture.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]});this.updateCameraUniforms(t,e,s,a,r);const l=this.drawVectorContentIntoPass(o);return o.end(),this.gpuDevice.queue.submit([i.finish()]),l}drawVectorMinifyCompositeIntoPass(t,e,s){!this.vectorCompositeBindGroup||!this.vectorMinifyTexture||(this.updateVectorCompositeUniforms(e,s),t.setPipeline(this.vectorCompositePipeline),t.setBindGroup(0,this.vectorCompositeBindGroup),t.draw(4,1,0,0))}renderWithPanCache(){if(!this.ensurePanCacheResources()){this.renderDirectToScreen();return}let t=this.panCacheZoom/Math.max(this.zoom,1e-6),e=(this.cameraCenterX-this.panCacheCenterX)*this.panCacheZoom,s=(this.cameraCenterY-this.panCacheCenterY)*this.panCacheZoom;const a=this.panCacheWidth*.5-2,r=this.panCacheHeight*.5-2,i=this.canvas.width*.5*Math.abs(t),o=this.canvas.height*.5*Math.abs(t),l=a-i,c=r-o,p=this.zoom/Math.max(this.panCacheZoom,1e-6),m=p<$i||p>Qi,f=Math.abs(this.targetZoom-this.zoom)<=fe&&Math.abs(this.panCacheZoom-this.zoom)>ji,y=l<0||c<0||Math.abs(e)>l||Math.abs(s)>c;if(!this.panCacheValid||m||y||f){this.panCacheCenterX=this.cameraCenterX,this.panCacheCenterY=this.cameraCenterY,this.panCacheZoom=this.zoom,this.updateVisibleSet(this.panCacheCenterX,this.panCacheCenterY,this.panCacheWidth,this.panCacheHeight),this.needsVisibleSetUpdate=!1;const x=this.gpuDevice.createCommandEncoder(),T=x.beginRenderPass({colorAttachments:[{view:this.panCacheTexture.createView(),clearValue:Jt,loadOp:"clear",storeOp:"store"}]});this.panCacheRenderedSegments=this.drawSceneIntoPass(T,this.panCacheWidth,this.panCacheHeight,this.panCacheCenterX,this.panCacheCenterY),T.end(),this.gpuDevice.queue.submit([x.finish()]),this.panCacheUsedCulling=!this.usingAllSegments,this.panCacheValid=!0,t=1,e=0,s=0}this.blitPanCache(e,s,t),this.frameListener?.({renderedSegments:this.panCacheRenderedSegments,totalSegments:this.segmentCount,usedCulling:this.panCacheUsedCulling,zoom:this.zoom})}drawSceneIntoPass(t,e,s,a,r){return this.updateCameraUniforms(e,s,a,r),this.drawRasterContentIntoPass(t),this.drawVectorContentIntoPass(t)}drawRasterContentIntoPass(t){if(this.rasterRenderingEnabled){if(this.pageBackgroundResources.length>0){t.setPipeline(this.rasterPipeline);for(const e of this.pageBackgroundResources)t.setBindGroup(0,e.bindGroup),t.draw(4,1,0,0)}if(this.rasterLayerResources.length>0){t.setPipeline(this.rasterPipeline);for(const e of this.rasterLayerResources)t.setBindGroup(0,e.bindGroup),t.draw(4,1,0,0)}}}drawVectorContentIntoPass(t){this.fillRenderingEnabled&&this.fillPathCount>0&&this.fillBindGroup&&(t.setPipeline(this.fillPipeline),t.setBindGroup(0,this.fillBindGroup),t.draw(4,this.fillPathCount,0,0));let e=this.strokeRenderingEnabled?this.usingAllSegments?this.segmentCount:this.visibleSegmentCount:0;if(e>0){const s=this.usingAllSegments?this.strokeBindGroupAll:this.strokeBindGroupVisible;s&&(t.setPipeline(this.strokePipeline),t.setBindGroup(0,s),t.draw(4,e,0,0))}return this.textRenderingEnabled&&this.textInstanceCount>0&&this.textBindGroup&&(t.setPipeline(this.textPipeline),t.setBindGroup(0,this.textBindGroup),t.draw(4,this.textInstanceCount,0,0)),e}updateCameraUniforms(t,e,s,a,r=this.zoom){const i=new Float32Array(nr);i[0]=t,i[1]=e,i[2]=s,i[3]=a,i[4]=r,i[5]=1,i[6]=this.strokeCurveEnabled?1:0,i[7]=1.25,i[8]=this.strokeCurveEnabled?1:0,i[9]=1,i[10]=this.textVectorOnly?1:0,i[11]=0,i[12]=this.vectorOverrideColor[0],i[13]=this.vectorOverrideColor[1],i[14]=this.vectorOverrideColor[2],i[15]=this.vectorOverrideOpacity,xe(i,Ft,"camera"),this.gpuDevice.queue.writeBuffer(this.cameraUniformBuffer,0,i)}updateVectorCompositeUniforms(t,e){const s=new Float32Array(rr);s[0]=t,s[1]=e,s[2]=0,s[3]=0,xe(s,pe,"vector composite"),this.gpuDevice.queue.writeBuffer(this.vectorCompositeUniformBuffer,0,s)}updateBlitUniforms(t,e,s){const a=new Float32Array(ir);a[0]=this.canvas.width,a[1]=this.canvas.height,a[2]=this.panCacheWidth,a[3]=this.panCacheHeight,a[4]=t,a[5]=e,a[6]=s,a[7]=0,a[8]=0,a[9]=0,a[10]=0,a[11]=0,xe(a,me,"blit"),this.gpuDevice.queue.writeBuffer(this.blitUniformBuffer,0,a)}blitPanCache(t,e,s){if(!this.panCacheTexture||!this.blitBindGroup){this.renderDirectToScreen();return}this.updateBlitUniforms(t,e,s);const a=this.gpuContext.getCurrentTexture().createView(),r=this.gpuDevice.createCommandEncoder(),i=r.beginRenderPass({colorAttachments:[{view:a,clearValue:Jt,loadOp:"clear",storeOp:"store"}]});i.setPipeline(this.blitPipeline),i.setBindGroup(0,this.blitBindGroup),i.draw(4,1,0,0),i.end(),this.gpuDevice.queue.submit([r.finish()])}ensureVectorMinifyResources(){const t=this.maxTextureSize(),e=t/Math.max(1,this.canvas.width),s=t/Math.max(1,this.canvas.height),a=Math.max(1,Math.min(Ki,e,s)),r=Math.max(this.canvas.width,Math.floor(this.canvas.width*a)),i=Math.max(this.canvas.height,Math.floor(this.canvas.height*a));if(r<this.canvas.width||i<this.canvas.height)return!1;if(this.vectorMinifyTexture&&this.vectorMinifyWidth===r&&this.vectorMinifyHeight===i&&this.vectorCompositeBindGroup)return!0;this.destroyVectorMinifyResources();const o=globalThis.GPUTextureUsage;return this.vectorMinifyTexture=this.gpuDevice.createTexture({size:{width:r,height:i,depthOrArrayLayers:1},format:this.presentationFormat,usage:o.RENDER_ATTACHMENT|o.TEXTURE_BINDING}),this.vectorMinifyWidth=r,this.vectorMinifyHeight=i,this.vectorCompositeBindGroup=this.gpuDevice.createBindGroup({layout:this.vectorCompositePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.vectorCompositeSampler},{binding:1,resource:this.vectorMinifyTexture.createView()},{binding:2,resource:{buffer:this.vectorCompositeUniformBuffer,size:pe}}]}),!0}ensurePanCacheResources(){const t=this.maxTextureSize(),e=Math.min(t,Math.max(this.canvas.width+yn*2,Math.ceil(this.canvas.width*xn))),s=Math.min(t,Math.max(this.canvas.height+yn*2,Math.ceil(this.canvas.height*xn)));if(e<this.canvas.width||s<this.canvas.height)return!1;if(this.panCacheTexture&&this.panCacheWidth===e&&this.panCacheHeight===s&&this.blitBindGroup)return!0;this.destroyPanCacheResources();const a=globalThis.GPUTextureUsage;return this.panCacheTexture=this.gpuDevice.createTexture({size:{width:e,height:s,depthOrArrayLayers:1},format:this.presentationFormat,usage:a.RENDER_ATTACHMENT|a.TEXTURE_BINDING}),this.panCacheWidth=e,this.panCacheHeight=s,this.panCacheValid=!1,this.blitBindGroup=this.gpuDevice.createBindGroup({layout:this.blitPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.panCacheSampler},{binding:1,resource:this.panCacheTexture.createView()},{binding:2,resource:{buffer:this.blitUniformBuffer,size:me}}]}),!0}destroyPanCacheResources(){this.panCacheTexture&&(this.panCacheTexture.destroy(),this.panCacheTexture=null),this.panCacheWidth=0,this.panCacheHeight=0,this.panCacheValid=!1,this.panCacheRenderedSegments=0,this.panCacheUsedCulling=!1,this.blitBindGroup=null}destroyVectorMinifyResources(){this.vectorMinifyTexture&&(this.vectorMinifyTexture.destroy(),this.vectorMinifyTexture=null),this.vectorMinifyWidth=0,this.vectorMinifyHeight=0,this.vectorCompositeBindGroup=null}updateVisibleSet(t=this.cameraCenterX,e=this.cameraCenterY,s=this.canvas.width,a=this.canvas.height,r=this.zoom){if(!this.scene||!this.grid){this.visibleSegmentCount=0,this.usingAllSegments=!0;return}if(!this.hasCameraInteractionSinceSceneLoad){this.usingAllSegments=!0,this.visibleSegmentCount=this.segmentCount;return}const i=this.grid,o=Math.max(r,1e-6),l=s/(2*o),c=a/(2*o),p=Math.max(16/o,this.scene.maxHalfWidth*2),m=t-l-p,g=t+l+p,f=e-c-p,y=e+c+p,h=ye(Math.floor((m-i.minX)/i.cellWidth),i.gridWidth),x=ye(Math.floor((g-i.minX)/i.cellWidth),i.gridWidth),T=ye(Math.floor((f-i.minY)/i.cellHeight),i.gridHeight),C=ye(Math.floor((y-i.minY)/i.cellHeight),i.gridHeight),w=(x-h+1)*(C-T+1),R=i.gridWidth*i.gridHeight;if(!this.isInteractionActive()&&w>=R*Zi){this.usingAllSegments=!0,this.visibleSegmentCount=this.segmentCount;return}this.usingAllSegments=!1,this.markToken+=1,this.markToken===4294967295&&(this.segmentMarks.fill(0),this.markToken=1);let A=0;for(let S=T;S<=C;S+=1){let k=S*i.gridWidth+h;for(let G=h;G<=x;G+=1){const B=i.offsets[k],I=i.counts[k];for(let P=0;P<I;P+=1){const v=i.indices[B+P];this.segmentMarks[v]!==this.markToken&&(this.segmentMarks[v]=this.markToken,!(this.segmentMaxX[v]<m||this.segmentMinX[v]>g||this.segmentMaxY[v]<f||this.segmentMinY[v]>y)&&(this.visibleSegmentIds[A]=v,A+=1))}k+=1}}if(this.visibleSegmentCount=A,this.segmentIdBufferVisible&&A>0){const S=this.visibleSegmentIds.subarray(0,A);this.gpuDevice.queue.writeBuffer(this.segmentIdBufferVisible,0,S)}}buildSegmentBounds(t){this.segmentMinX.length<this.segmentCount&&(this.segmentMinX=new Float32Array(this.segmentCount),this.segmentMinY=new Float32Array(this.segmentCount),this.segmentMaxX=new Float32Array(this.segmentCount),this.segmentMaxY=new Float32Array(this.segmentCount));for(let e=0;e<this.segmentCount;e+=1){const s=e*4,a=e*4,r=t.styles[a]+.35;this.segmentMinX[e]=t.primitiveBounds[s]-r,this.segmentMinY[e]=t.primitiveBounds[s+1]-r,this.segmentMaxX[e]=t.primitiveBounds[s+2]+r,this.segmentMaxY[e]=t.primitiveBounds[s+3]+r}}markInteraction(){this.lastInteractionTime=performance.now()}isInteractionActive(){return performance.now()-this.lastInteractionTime<=qi}configureRasterLayers(t){this.destroyRasterLayerResources();for(const e of this.getSceneRasterLayers(t)){const s=new Float32Array(6);e.matrix.length>=6?(s[0]=e.matrix[0],s[1]=e.matrix[1],s[2]=e.matrix[2],s[3]=e.matrix[3],s[4]=e.matrix[4],s[5]=e.matrix[5]):(s[0]=1,s[3]=1);const a=e.data.subarray(0,e.width*e.height*4),r=mr(a),i=this.createRgba8Texture(e.width,e.height,r);this.rasterLayerResources.push(this.createRasterLayerResource(s,i))}}configurePageBackgroundResources(t){if(this.destroyPageBackgroundResources(),this.pageBackgroundTexture||this.uploadPageBackgroundTexture(),!this.pageBackgroundTexture)return;const e=gr(t);for(let s=0;s+3<e.length;s+=4){const a=e[s],r=e[s+1],i=e[s+2],o=e[s+3];if(![a,r,i,o].every(Number.isFinite))continue;const l=Math.max(i-a,1e-6),c=Math.max(o-r,1e-6),p=new Float32Array([l,0,0,c,a,r]);this.pageBackgroundResources.push(this.createRasterLayerResource(p,this.pageBackgroundTexture))}}getSceneRasterLayers(t){const e=[];if(Array.isArray(t.rasterLayers))for(const r of t.rasterLayers){const i=Math.max(0,Math.trunc(r?.width??0)),o=Math.max(0,Math.trunc(r?.height??0));i<=0||o<=0||!(r.data instanceof Uint8Array)||r.data.length<i*o*4||e.push({width:i,height:o,data:r.data,matrix:r.matrix instanceof Float32Array?r.matrix:new Float32Array(r.matrix)})}if(e.length>0)return e;const s=Math.max(0,Math.trunc(t.rasterLayerWidth)),a=Math.max(0,Math.trunc(t.rasterLayerHeight));return s<=0||a<=0||t.rasterLayerData.length<s*a*4||e.push({width:s,height:a,data:t.rasterLayerData,matrix:t.rasterLayerMatrix}),e}destroyRasterLayerResources(){for(const t of this.rasterLayerResources)t.texture&&t.texture.destroy(),t.uniformBuffer&&t.uniformBuffer.destroy();this.rasterLayerResources=[]}destroyPageBackgroundResources(){for(const t of this.pageBackgroundResources)t.uniformBuffer&&t.uniformBuffer.destroy();this.pageBackgroundResources=[]}uploadPageBackgroundTexture(){const t=Math.round(this.pageBackgroundColor[3]*255),e=t/255,s=new Uint8Array([Math.round(this.pageBackgroundColor[0]*e*255),Math.round(this.pageBackgroundColor[1]*e*255),Math.round(this.pageBackgroundColor[2]*e*255),t]);if(!this.pageBackgroundTexture){this.pageBackgroundTexture=this.createRgba8Texture(1,1,s);return}this.writeRgba8Texture(this.pageBackgroundTexture,1,1,s,0)}createRasterLayerResource(t,e){const s=globalThis.GPUBufferUsage,a=new Float32Array(ar);a[0]=t[0],a[1]=t[1],a[2]=t[2],a[3]=t[3],a[4]=t[4],a[5]=t[5],a[6]=0,a[7]=0,xe(a,ge,"raster");const r=this.gpuDevice.createBuffer({size:ge,usage:s.UNIFORM|s.COPY_DST});this.gpuDevice.queue.writeBuffer(r,0,a);const i=this.gpuDevice.createBindGroup({layout:this.rasterPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:Ft}},{binding:1,resource:{buffer:r,size:ge}},{binding:2,resource:this.rasterLayerSampler},{binding:3,resource:e.createView()}]});return{texture:e,uniformBuffer:r,bindGroup:i}}createFloatTexture(t,e,s){const a=globalThis.GPUTextureUsage,r=this.gpuDevice.createTexture({size:{width:t,height:e,depthOrArrayLayers:1},format:"rgba32float",usage:a.TEXTURE_BINDING|a.COPY_DST}),i=dr(s,t,e);return this.writeFloatTexture(r,t,e,i),r}createRgba8Texture(t,e,s){const a=globalThis.GPUTextureUsage,r=pr(s,t,e),i=this.gpuDevice.createTexture({size:{width:t,height:e,depthOrArrayLayers:1},format:"rgba8unorm",mipLevelCount:r.length,usage:a.TEXTURE_BINDING|a.COPY_DST});for(let o=0;o<r.length;o+=1){const l=r[o],c=fr(l.data,l.width,l.height);this.writeRgba8Texture(i,l.width,l.height,c,o)}return i}writeFloatTexture(t,e,s,a){const r=e*16,i=Cn(r,256);if(s<=1&&r===i){this.gpuDevice.queue.writeTexture({texture:t},a,{offset:0},{width:e,height:s,depthOrArrayLayers:1});return}if(r===i){this.gpuDevice.queue.writeTexture({texture:t},a,{offset:0,bytesPerRow:r,rowsPerImage:s},{width:e,height:s,depthOrArrayLayers:1});return}const o=new Uint8Array(a.buffer,a.byteOffset,a.byteLength),l=new Uint8Array(i*s);for(let c=0;c<s;c+=1){const p=c*r,m=c*i;l.set(o.subarray(p,p+r),m)}this.gpuDevice.queue.writeTexture({texture:t},l,{offset:0,bytesPerRow:i,rowsPerImage:s},{width:e,height:s,depthOrArrayLayers:1})}writeRgba8Texture(t,e,s,a,r=0){const i=e*4,o=Cn(i,256);if(s<=1&&i===o){this.gpuDevice.queue.writeTexture({texture:t,mipLevel:r},a,{offset:0},{width:e,height:s,depthOrArrayLayers:1});return}if(i===o){this.gpuDevice.queue.writeTexture({texture:t,mipLevel:r},a,{offset:0,bytesPerRow:i,rowsPerImage:s},{width:e,height:s,depthOrArrayLayers:1});return}const l=new Uint8Array(o*s);for(let c=0;c<s;c+=1){const p=c*i,m=c*o;l.set(a.subarray(p,p+i),m)}this.gpuDevice.queue.writeTexture({texture:t,mipLevel:r},l,{offset:0,bytesPerRow:o,rowsPerImage:s},{width:e,height:s,depthOrArrayLayers:1})}clearToScreen(){const t=this.gpuContext.getCurrentTexture().createView(),e=this.gpuDevice.createCommandEncoder();e.beginRenderPass({colorAttachments:[{view:t,clearValue:Jt,loadOp:"clear",storeOp:"store"}]}).end(),this.gpuDevice.queue.submit([e.finish()])}destroyDataResources(){this.strokeBindGroupAll=null,this.strokeBindGroupVisible=null,this.fillBindGroup=null,this.textBindGroup=null,this.destroyPageBackgroundResources(),this.destroyRasterLayerResources();const t=[this.segmentTextureA,this.segmentTextureB,this.segmentTextureC,this.segmentTextureD,this.fillPathMetaTextureA,this.fillPathMetaTextureB,this.fillPathMetaTextureC,this.fillSegmentTextureA,this.fillSegmentTextureB,this.textInstanceTextureA,this.textInstanceTextureB,this.textInstanceTextureC,this.textGlyphMetaTextureA,this.textGlyphMetaTextureB,this.textGlyphRasterMetaTexture,this.textGlyphSegmentTextureA,this.textGlyphSegmentTextureB,this.textRasterAtlasTexture];for(const e of t)e&&e.destroy();this.segmentTextureA=null,this.segmentTextureB=null,this.segmentTextureC=null,this.segmentTextureD=null,this.fillPathMetaTextureA=null,this.fillPathMetaTextureB=null,this.fillPathMetaTextureC=null,this.fillSegmentTextureA=null,this.fillSegmentTextureB=null,this.textInstanceTextureA=null,this.textInstanceTextureB=null,this.textInstanceTextureC=null,this.textGlyphMetaTextureA=null,this.textGlyphMetaTextureB=null,this.textGlyphRasterMetaTexture=null,this.textGlyphSegmentTextureA=null,this.textGlyphSegmentTextureB=null,this.textRasterAtlasTexture=null}clientToWorld(t,e){return this.clientToWorldAt(t,e,this.cameraCenterX,this.cameraCenterY,this.zoom)}clientToWorldAt(t,e,s,a,r){const i=this.resolveInteractionViewportRect(),o=this.resolveClientToPixelScale(i),l=(t-i.left)*o.x,c=(i.bottom-e)*o.y;return{x:(l-this.canvas.width*.5)/r+s,y:(c-this.canvas.height*.5)/r+a}}syncCameraTargetsToCurrent(){this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY,this.targetZoom=this.zoom,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1}updatePanReleaseVelocitySample(t){if(!this.isPanInteracting){this.lastPanFrameTimeMs=0;return}if(this.lastPanFrameTimeMs>0){const e=t-this.lastPanFrameTimeMs;if(e>.1){const s=this.cameraCenterX-this.lastPanFrameCameraX,a=this.cameraCenterY-this.lastPanFrameCameraY;let r=s*1e3/e,i=a*1e3/e;const o=Math.hypot(r,i);if(Number.isFinite(o)&&o>=Tn){if(o>vn){const l=vn/o;r*=l,i*=l}this.panVelocityWorldX=r,this.panVelocityWorldY=i,this.lastPanVelocityUpdateTimeMs=t}}}this.lastPanFrameCameraX=this.cameraCenterX,this.lastPanFrameCameraY=this.cameraCenterY,this.lastPanFrameTimeMs=t}updateCameraWithDamping(t){let e=Math.abs(this.targetCameraCenterX-this.cameraCenterX)>Wt||Math.abs(this.targetCameraCenterY-this.cameraCenterY)>Wt,s=Math.abs(this.targetZoom-this.zoom)>fe;if(!e&&!s)return this.hasZoomAnchor=!1,this.lastCameraAnimationTimeMs=t,!1;this.lastCameraAnimationTimeMs<=0&&(this.lastCameraAnimationTimeMs=t-16);const a=Et(t-this.lastCameraAnimationTimeMs,0,tr);this.lastCameraAnimationTimeMs=t;const r=a/1e3,i=1-Math.exp(-Le*r),o=1-Math.exp(-24*r);if(s&&(this.zoom+=(this.targetZoom-this.zoom)*o,Math.abs(this.targetZoom-this.zoom)<=fe&&(this.zoom=this.targetZoom)),this.hasZoomAnchor){const l=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,this.zoom),c=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,this.targetZoom);this.cameraCenterX=l.x,this.cameraCenterY=l.y,this.targetCameraCenterX=c.x,this.targetCameraCenterY=c.y,s||(this.hasZoomAnchor=!1),e=!1}else e&&(this.cameraCenterX+=(this.targetCameraCenterX-this.cameraCenterX)*i,this.cameraCenterY+=(this.targetCameraCenterY-this.cameraCenterY)*i,Math.abs(this.targetCameraCenterX-this.cameraCenterX)<=Wt&&(this.cameraCenterX=this.targetCameraCenterX),Math.abs(this.targetCameraCenterY-this.cameraCenterY)<=Wt&&(this.cameraCenterY=this.targetCameraCenterY));return this.markInteraction(),this.needsVisibleSetUpdate=!0,e=Math.abs(this.targetCameraCenterX-this.cameraCenterX)>Wt||Math.abs(this.targetCameraCenterY-this.cameraCenterY)>Wt,s=Math.abs(this.targetZoom-this.zoom)>fe,e||s}computeCameraCenterForAnchor(t,e,s,a,r){const i=this.resolveInteractionViewportRect(),o=this.resolveClientToPixelScale(i),l=(t-i.left)*o.x,c=(i.bottom-e)*o.y;return{x:s-(l-this.canvas.width*.5)/r,y:a-(c-this.canvas.height*.5)/r}}resolveInteractionViewportRect(){const t=this.interactionViewportProvider?.();return t||this.canvas.getBoundingClientRect()}resolveClientToPixelScale(t){const e=t??this.resolveInteractionViewportRect(),s=Math.max(window.devicePixelRatio||1,1e-6),a=e.width>1e-6?this.canvas.width/e.width:s,r=e.height>1e-6?this.canvas.height/e.height:s;return{x:Math.max(1e-6,a),y:Math.max(1e-6,r)}}}function dr(n,t,e){const s=t*e*4;if(n.length>s)throw new Error(`Texture source data exceeds texture size (${n.length} > ${s}).`);const a=new Float32Array(s);return a.set(n),a}function fr(n,t,e){const s=t*e*4;if(n.length>s)throw new Error(`Texture source data exceeds texture size (${n.length} > ${s}).`);const a=new Uint8Array(s);return a.set(n),a}function mr(n){const t=new Uint8Array(n.length);for(let e=0;e+3<n.length;e+=4){const s=n[e+3];if(s<=0){t[e]=0,t[e+1]=0,t[e+2]=0,t[e+3]=0;continue}if(s>=255){t[e]=n[e],t[e+1]=n[e+1],t[e+2]=n[e+2],t[e+3]=255;continue}const a=s/255;t[e]=Math.round(n[e]*a),t[e+1]=Math.round(n[e+1]*a),t[e+2]=Math.round(n[e+2]*a),t[e+3]=s}return t}function pr(n,t,e){const s=[];let a=Math.max(1,Math.trunc(t)),r=Math.max(1,Math.trunc(e)),i=n;for(s.push({width:a,height:r,data:i});a>1||r>1;){const o=Math.max(1,a>>1),l=Math.max(1,r>>1),c=new Uint8Array(o*l*4);for(let p=0;p<l;p+=1){const m=Math.min(r-1,p*2),g=Math.min(r-1,m+1);for(let f=0;f<o;f+=1){const y=Math.min(a-1,f*2),h=Math.min(a-1,y+1),x=(m*a+y)*4,T=(m*a+h)*4,C=(g*a+y)*4,w=(g*a+h)*4,R=(p*o+f)*4;c[R]=i[x]+i[T]+i[C]+i[w]+2>>2,c[R+1]=i[x+1]+i[T+1]+i[C+1]+i[w+1]+2>>2,c[R+2]=i[x+2]+i[T+2]+i[C+2]+i[w+2]+2>>2,c[R+3]=i[x+3]+i[T+3]+i[C+3]+i[w+3]+2>>2}}s.push({width:o,height:l,data:c}),a=o,r=l,i=c}return s}function xe(n,t,e){const s=n.byteLength;if(s>t)throw new Error(`${e} uniform data (${s} bytes) exceeds buffer size ${t} bytes.`)}function Ht(n,t){const e=Math.max(1,n),s=Math.ceil(Math.sqrt(e)),a=Et(s,1,t),r=Math.max(1,Math.ceil(e/a));if(r>t)throw new Error("Data texture exceeds GPU limits for this browser/GPU.");return{width:a,height:r}}function gr(n){return n.pageRects instanceof Float32Array&&n.pageRects.length>=4?new Float32Array(n.pageRects):new Float32Array([n.pageBounds.minX,n.pageBounds.minY,n.pageBounds.maxX,n.pageBounds.maxY])}function Cn(n,t){return Math.ceil(n/t)*t}function Et(n,t,e){return n<t?t:n>e?e:n}function ye(n,t){return n<0?0:n>=t?t-1:n}const xr="modulepreload",yr=function(n,t){return new URL(n,t).href},bn={},An=function(t,e,s){let a=Promise.resolve();if(e&&e.length>0){let c=function(p){return Promise.all(p.map(m=>Promise.resolve(m).then(g=>({status:"fulfilled",value:g}),g=>({status:"rejected",reason:g}))))};const i=document.getElementsByTagName("link"),o=document.querySelector("meta[property=csp-nonce]"),l=o?.nonce||o?.getAttribute("nonce");a=c(e.map(p=>{if(p=yr(p,s),p in bn)return;bn[p]=!0;const m=p.endsWith(".css"),g=m?'[rel="stylesheet"]':"";if(s)for(let y=i.length-1;y>=0;y--){const h=i[y];if(h.href===p&&(!m||h.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${p}"]${g}`))return;const f=document.createElement("link");if(f.rel=m?"stylesheet":xr,m||(f.as="script"),f.crossOrigin="",f.href=p,l&&f.setAttribute("nonce",l),document.head.appendChild(f),m)return new Promise((y,h)=>{f.addEventListener("load",y),f.addEventListener("error",()=>h(new Error(`Unable to preload CSS for ${p}`)))})}))}function r(i){const o=new Event("vite:preloadError",{cancelable:!0});if(o.payload=i,window.dispatchEvent(o),!o.defaultPrevented)throw i}return a.then(i=>{for(const o of i||[])o.status==="rejected"&&r(o.reason);return t().catch(r)})};class $e{enabled;root;start;end;fixedMeta;constructor(t,e={}){this.root=e.root??{callback:t,throttleMs:e.throttleMs??80,minDelta:e.minDelta??.002,lastEmittedValue:-1,lastEmittedAt:0},this.start=qt(e.start??0),this.end=qt(e.end??1),this.fixedMeta=e.fixedMeta??{},this.enabled=typeof this.root.callback=="function"}child(t,e,s={}){const a=De(this.start,this.end,qt(t)),r=De(this.start,this.end,qt(e));return new $e(void 0,{start:a,end:r,root:this.root,fixedMeta:{...this.fixedMeta,...s}})}toCallback(){return t=>{this.report(t.value,t)}}report(t,e={}){if(!this.enabled)return;const s={...this.fixedMeta,...e},a=qt(t),r=De(this.start,this.end,a),i=Math.max(this.root.lastEmittedValue,r),o=s.stage??this.fixedMeta.stage??this.root.lastStage??"source",l=Oe(),c=i-this.root.lastEmittedValue,p=o!==this.root.lastStage;if(!(this.root.lastEmittedValue<0||i>=1||p||c>=this.root.minDelta||l-this.root.lastEmittedAt>=this.root.throttleMs))return;const g={value:qt(i),stage:o,executionPath:s.executionPath,sourceType:s.sourceType,unit:s.unit,processed:s.processed,total:s.total,pageIndex:s.pageIndex,pageCount:s.pageCount};this.root.lastEmittedValue=g.value,this.root.lastEmittedAt=l,this.root.lastStage=g.stage,this.root.callback?.(g)}complete(t={}){this.report(1,{stage:"complete",...t})}async withIndeterminateProgress(t,e){if(!this.enabled)return typeof t=="function"?t():t;const s=Math.max(50,Math.trunc(e.tickMs??90)),a=ai(e.ceiling??.9,.1,.999),r=Oe(),i={stage:e.stage,sourceType:e.sourceType,unit:e.unit,processed:e.processed,total:e.total,pageIndex:e.pageIndex,pageCount:e.pageCount};this.report(0,i);const o=globalThis.setInterval(()=>{const c=Math.max(0,Oe()-r)/800;this.report(Math.min(a,a*(1-1/(1+c))),i)},s);try{const l=await(typeof t=="function"?t():t);return this.report(1,i),l}finally{globalThis.clearInterval(o)}}}function Se(n,t={}){return new $e(n,t)}function Fs(n){switch(n){case"source":return"Reading source";case"pdf-page":return"Processing pages";case"pdf-operators":return"Scanning operators";case"pdf-text":return"Extracting text";case"pdf-raster":return"Extracting rasters";case"compile":return"Compiling";case"zip-open":return"Opening ZIP";case"zip-manifest":return"Reading manifest";case"zip-file":return"Decoding ZIP";case"upload":return"Uploading";case"complete":return"Complete";default:return"Parsing / loading"}}function qt(n){return ai(n,0,1)}function ai(n,t,e){return!Number.isFinite(n)||n<t?t:n>e?e:n}function De(n,t,e){return n+(t-n)*e}function Oe(){return typeof performance<"u"&&typeof performance.now=="function"?performance.now():Date.now()}const Tr=typeof window>"u"?await An(()=>import("./pdf-CoaqzUNK.js"),[],import.meta.url):await An(()=>import("./pdf-TYrZqVzP.js"),[],import.meta.url),{getDocument:si,OPS:H,VerbosityLevel:vr}=Tr,we=0,_e=1,Me=2,Re=3,Ee=4;class Tt{data;length=0;constructor(t=32768){this.data=new Float32Array(t*4)}get quadCount(){return this.length>>2}push(t,e,s,a){this.ensureCapacity(4);const r=this.length;this.data[r]=t,this.data[r+1]=e,this.data[r+2]=s,this.data[r+3]=a,this.length+=4}append(t,e,s){s<=0||(this.ensureCapacity(s),this.data.set(t.subarray(e,e+s),this.length),this.length+=s)}toTypedArray(){return this.data.slice(0,this.length)}ensureCapacity(t){if(this.length+t<=this.data.length)return;let e=this.data.length;for(;this.length+t>e;)e*=2;const s=new Float32Array(e);s.set(this.data),this.data=s}}const kt=[1,0,0,1,0,0],Sn=.001,Cr=.999995,wn=.05,oi=.001,br=.999,Zt=1e3,Xt=1e4,_n=2e3,Ar=200,Ge=.05,Mn=1e-4,Sr=.015,wr=12,Ut=1e-4,_r=.001,Mr=.001,Rr=.001,Er=3,Ir=24,Rn=16384,Pr=134217728,Fr=0,Br=1,li=0,kr=2,Lr=4,Dr=6,Or=0,Gr=1,Ue=0,Qe=1,Ur=0,Xr=1,ci=.08,ui=9,hi=1,Ke=2,We=2,zr=.08,Nr=24,di=vr?.ERRORS??0;function Vr(n,t){const e=dt(n),s=Math.max(0,Math.trunc(t+1e-6));return e+s*We}function Yr(n){const t=Math.max(0,Math.trunc(n/We+1e-6));return{alpha:dt(n-t*We),styleFlags:t}}async function Bs(n,t={}){const e=t.enableSegmentMerge!==!1,s=t.enableInvisibleCull!==!1,a=Qt(t.maxPages,Number.MAX_SAFE_INTEGER,1,Number.MAX_SAFE_INTEGER),r=Ti(),i=Se(t.onProgress);i.report(0,{stage:"source",sourceType:"pdf"});const l=await si({data:new Uint8Array(n),disableFontFace:!0,fontExtraProperties:!0,verbosity:di,...r?{standardFontDataUrl:r}:{}}).promise;i.report(.06,{stage:"pdf-page",sourceType:"pdf"});try{const c=Qt(l.numPages,1,1,Number.MAX_SAFE_INTEGER),p=Math.max(1,Math.min(c,a)),m=[],g=.08,f=.84;for(let y=1;y<=p;y+=1){const h=y-1,x=g+h/p*f,T=g+y/p*f;i.report(x,{stage:"pdf-page",sourceType:"pdf",unit:"pages",processed:h,total:p,pageIndex:h,pageCount:p});const C=await l.getPage(y);i.report(Ze(x,T,.28),{stage:"pdf-operators",sourceType:"pdf",unit:"pages",processed:h,total:p,pageIndex:h,pageCount:p});const w=await C.getOperatorList();i.report(Ze(x,T,.58),{stage:"compile",sourceType:"pdf",unit:"operators",processed:w.fnArray.length,total:w.fnArray.length,pageIndex:h,pageCount:p});const R=await Zr(C,w,{enableSegmentMerge:e,enableInvisibleCull:s});m.push(R),i.report(T,{stage:"pdf-page",sourceType:"pdf",unit:"pages",processed:y,total:p,pageIndex:h,pageCount:p})}return i.report(.94,{stage:"compile",sourceType:"pdf"}),m}finally{await l.destroy()}}function ks(n,t){return fi(n,t)}async function Wr(n,t={}){const e=Qt(t.maxPages,Number.MAX_SAFE_INTEGER,1,Number.MAX_SAFE_INTEGER),s=Ti(),a=Se(t.onProgress);a.report(0,{stage:"source",sourceType:"pdf"});const i=await si({data:new Uint8Array(n),disableFontFace:!0,fontExtraProperties:!0,verbosity:di,...s?{standardFontDataUrl:s}:{}}).promise;a.report(.06,{stage:"pdf-page",sourceType:"pdf"});try{const o=Qt(i.numPages,1,1,Number.MAX_SAFE_INTEGER),l=Math.max(1,Math.min(o,e)),c=[],p=.08,m=.84;for(let g=1;g<=l;g+=1){const f=g-1,y=p+f/l*m,h=p+g/l*m;a.report(y,{stage:"pdf-page",sourceType:"pdf",unit:"pages",processed:f,total:l,pageIndex:f,pageCount:l});const x=await i.getPage(g),T=await x.getOperatorList();a.report(Ze(y,h,.4),{stage:"pdf-raster",sourceType:"pdf",unit:"pages",processed:f,total:l,pageIndex:f,pageCount:l}),c.push(await qr(x,T)),a.report(h,{stage:"pdf-page",sourceType:"pdf",unit:"pages",processed:g,total:l,pageIndex:f,pageCount:l})}return a.report(.94,{stage:"compile",sourceType:"pdf"}),c}finally{await i.destroy()}}async function Hr(n,t={}){const e=Qt(t.maxPagesPerRow,10,1,100),s=await Wr(n,t),a=Se(t.onProgress);a.report(.96,{stage:"compile",sourceType:"pdf"});const r=fi(s,e);return a.complete({sourceType:"pdf"}),r}async function qr(n,t){const e=n.view,s=Array.isArray(e)?e:[0,0,1,1],a={minX:Math.min(Number(s[0])||0,Number(s[2])||1),minY:Math.min(Number(s[1])||0,Number(s[3])||1),maxX:Math.max(Number(s[0])||0,Number(s[2])||1),maxY:Math.max(Number(s[1])||0,Number(s[3])||1)},r=yi(n),i=Ie(a,r),o=Ci(t),l=await bi(n,t,r,{allowFullPageFallback:!0}),c=l.width>0&&l.height>0&&l.data.length>=l.width*l.height*4?[{width:l.width,height:l.height,data:l.data,matrix:new Float32Array(l.matrix)}]:[],p=xi(),m=c[0]??null,g=jt(i,l.bounds)??i;return{...p,pageCount:1,pagesPerRow:1,pageRects:new Float32Array([i.minX,i.minY,i.maxX,i.maxY]),pageTextRanges:new Uint32Array([0,0]),rasterLayers:c,rasterLayerWidth:m?.width??0,rasterLayerHeight:m?.height??0,rasterLayerData:m?.data??new Uint8Array(0),rasterLayerMatrix:m?.matrix??new Float32Array([1,0,0,1,0,0]),bounds:g,pageBounds:i,imagePaintOpCount:o,operatorCount:t.fnArray.length}}async function Zr(n,t,e){const s=n.view,a=Array.isArray(s)?s:[0,0,1,1],r={minX:Math.min(Number(a[0])||0,Number(a[2])||1),minY:Math.min(Number(a[1])||0,Number(a[3])||1),maxX:Math.max(Number(a[0])||0,Number(a[2])||1),maxY:Math.max(Number(a[1])||0,Number(a[3])||1)},i=yi(n),o=Ie(r,i),l=Ci(t),c=new Tt,p=new Tt,m=new Tt,g=new Tt,f=new Tt(8192),y=new Tt(8192),h=new Tt(8192),x=new Tt(65536),T=new Tt(65536),C={minX:Number.POSITIVE_INFINITY,minY:Number.POSITIVE_INFINITY,maxX:Number.NEGATIVE_INFINITY,maxY:Number.NEGATIVE_INFINITY},w={minX:Number.POSITIVE_INFINITY,minY:Number.POSITIVE_INFINITY,maxX:Number.NEGATIVE_INFINITY,maxY:Number.NEGATIVE_INFINITY};let R=0,A=0,S=0,k=0;const G=[],B=[];let I=ia(i);for(let _=0;_<t.fnArray.length;_+=1){const W=t.fnArray[_],Y=t.argsArray[_];if(W===H.save){G.push(Fn(I));continue}if(W===H.restore){const N=G.pop();N&&(I=N);continue}if(W===H.transform){const N=Vt(Y);N&&(I.matrix=It(I.matrix,N));continue}if(W===H.paintFormXObjectBegin){B.push(Fn(I));const N=Vt(Y);N&&(I.matrix=It(I.matrix,N));continue}if(W===H.paintFormXObjectEnd){const N=B.pop();N&&(I=N);continue}if(W===H.setLineWidth){const N=gt(Y,0,I.lineWidth);I.lineWidth=Math.max(0,N);continue}if(W===H.setLineCap){const N=Math.trunc(gt(Y,0,I.lineCap));I.lineCap=Math.min(2,Math.max(0,N));continue}if(W===H.setStrokeRGBColor||W===H.setStrokeColor){const[N,at,it]=re(Y,[I.strokeR,I.strokeG,I.strokeB]);I.strokeR=N,I.strokeG=at,I.strokeB=it;continue}if(W===H.setStrokeGray){const N=Bt(Y,0),[at]=He(N,I.strokeR);I.strokeR=at,I.strokeG=at,I.strokeB=at;continue}if(W===H.setStrokeCMYKColor){const[N,at,it]=qe(Y,[I.strokeR,I.strokeG,I.strokeB]);I.strokeR=N,I.strokeG=at,I.strokeB=it;continue}if(W===H.setFillRGBColor||W===H.setFillColor){const[N,at,it]=re(Y,[I.fillR,I.fillG,I.fillB]);I.fillR=N,I.fillG=at,I.fillB=it;continue}if(W===H.setFillGray){const[N]=He(Bt(Y,0),I.fillR);I.fillR=N,I.fillG=N,I.fillB=N;continue}if(W===H.setFillCMYKColor){const[N,at,it]=qe(Y,[I.fillR,I.fillG,I.fillB]);I.fillR=N,I.fillG=at,I.fillB=it;continue}if(W===H.setGState){ca(Bt(Y,0),I);continue}if(W!==H.constructPath)continue;const O=gt(Y,0,-1),$=aa(O),j=sa(O);if(!$&&!j)continue;const X=vi(Y);if(X){if(R+=1,$){const N=I.lineWidth<=0,at=Ya(I.matrix),it=N?0:I.lineWidth*at,pt=Math.max(0,it*.5);S=Math.max(S,pt);let Rt=0;N&&(Rt|=hi),I.lineCap===1&&(Rt|=Ke);const At=dt(I.strokeR),Lt=dt(I.strokeG),ft=dt(I.strokeB),vt=dt(I.strokeAlpha);A+=ua(X,I.matrix,pt,At,Lt,ft,vt,Rt,e.enableSegmentMerge,c,p,g,m,C)}if(j){const N=oa(O)?Br:Fr,at=dt(I.fillAlpha),it=$&&dt(I.strokeAlpha)>oi;at>Rr&&ha(X,I.matrix,N,it,dt(I.fillR),dt(I.fillG),dt(I.fillB),at,f,y,h,x,T,w)&&(k+=1)}}}const P=c.quadCount,v=c.toTypedArray(),E=p.toTypedArray(),u=m.toTypedArray(),F=g.toTypedArray(),q=x.quadCount,U=f.toTypedArray(),tt=y.toTypedArray(),V=h.toTypedArray(),Q=x.toTypedArray(),D=T.toTypedArray(),L=k>0?w:null;let et=P,J=v,K=E,ot=u,lt=F,rt=P>0?C:null,nt=P>0?S:0,st=0,ct=0,mt=0,xt=0;if(P>0&&e.enableInvisibleCull){const _=da(v,E,F,u);et=_.segmentCount,J=_.endpoints,K=_.primitiveMeta,ot=_.primitiveBounds,lt=_.styles,rt=_.segmentCount>0?_.bounds:null,nt=_.maxHalfWidth,st=_.discardedTransparentCount,ct=_.discardedDegenerateCount,mt=_.discardedDuplicateCount,xt=_.discardedContainedCount}et===0&&(J=new Float32Array(0),K=new Float32Array(0),ot=new Float32Array(0),lt=new Float32Array(0),nt=0);let d=await ze(n,t,i,o);if(d.instanceCount===0&&Ta(t)&&(await va(n),d=await ze(n,t,i,o)),d.instanceCount>0&&d.inPageCount<d.instanceCount*.2){const _=await ze(n,t,kt,o);_.inPageCount>d.inPageCount&&(d=_)}const Z=et===0&&k===0&&d.instanceCount===0,z=await bi(n,t,i,{allowFullPageFallback:Z}),M=z.width>0&&z.height>0&&z.data.length>=z.width*z.height*4?[{width:z.width,height:z.height,data:z.data,matrix:new Float32Array(z.matrix)}]:[],b=jt(jt(jt(rt,L),d.bounds),z.bounds)??{...o};return{pageCount:1,pagesPerRow:1,pageRects:new Float32Array([o.minX,o.minY,o.maxX,o.maxY]),pageTextRanges:new Uint32Array([0,d.instanceCount]),fillPathCount:k,fillSegmentCount:q,fillPathMetaA:U,fillPathMetaB:tt,fillPathMetaC:V,fillSegmentsA:Q,fillSegmentsB:D,segmentCount:et,sourceSegmentCount:A,mergedSegmentCount:P,sourceTextCount:d.sourceTextCount,textInstanceCount:d.instanceCount,textGlyphCount:d.glyphCount,textGlyphSegmentCount:d.glyphSegmentCount,textInPageCount:d.inPageCount,textOutOfPageCount:d.outOfPageCount,textInstanceA:d.instanceA,textInstanceB:d.instanceB,textInstanceC:d.instanceC,textGlyphMetaA:d.glyphMetaA,textGlyphMetaB:d.glyphMetaB,textGlyphSegmentsA:d.glyphSegmentsA,textGlyphSegmentsB:d.glyphSegmentsB,rasterLayers:M,rasterLayerWidth:M[0]?.width??0,rasterLayerHeight:M[0]?.height??0,rasterLayerData:M[0]?.data??new Uint8Array(0),rasterLayerMatrix:M[0]?.matrix??new Float32Array([1,0,0,1,0,0]),endpoints:J,primitiveMeta:K,primitiveBounds:ot,styles:lt,bounds:b,pageBounds:o,maxHalfWidth:nt,imagePaintOpCount:l,operatorCount:t.fnArray.length,pathCount:R,discardedTransparentCount:st,discardedDegenerateCount:ct,discardedDuplicateCount:mt,discardedContainedCount:xt}}function fi(n,t){if(n.length===0)return xi();if(n.length===1)return{...n[0],pageCount:1,pagesPerRow:1,pageTextRanges:En(n[0])};const e=Qt(t,10,1,100),s=ta(n,e);let a=0,r=0,i=0,o=0,l=0,c=0,p=0,m=0,g=0,f=0,y=0,h=0,x=0,T=0,C=0,w=0,R=0,A=0,S=0,k=0;for(const b of n){a+=b.fillPathCount,r+=b.fillSegmentCount,i+=b.segmentCount,o+=b.sourceSegmentCount,l+=b.mergedSegmentCount,c+=b.sourceTextCount,p+=b.textInstanceCount,m+=b.textGlyphCount,g+=b.textGlyphSegmentCount,f+=b.textInPageCount,y+=b.textOutOfPageCount,h+=b.operatorCount,x+=b.imagePaintOpCount,T+=b.pathCount,C+=b.discardedTransparentCount,w+=b.discardedDegenerateCount,R+=b.discardedDuplicateCount,A+=b.discardedContainedCount,S=Math.max(S,b.maxHalfWidth);const _=b.pageRects.length>=4?Math.floor(b.pageRects.length/4):1;k+=Math.max(1,_)}const G=new Float32Array(a*4),B=new Float32Array(a*4),I=new Float32Array(a*4),P=new Float32Array(r*4),v=new Float32Array(r*4),E=new Float32Array(i*4),u=new Float32Array(i*4),F=new Float32Array(i*4),q=new Float32Array(i*4),U=new Float32Array(p*4),tt=new Float32Array(p*4),V=new Float32Array(p*4),Q=new Float32Array(m*4),D=new Float32Array(m*4),L=new Float32Array(g*4),et=new Float32Array(g*4),J=new Float32Array(k*4),K=new Uint32Array(k*2);let ot=0,lt=0,rt=0,nt=0,st=0,ct=0,mt=0,xt=null,d=null;const Z=[];for(let b=0;b<n.length;b+=1){const _=n[b],W=s[b],Y=W.translateX,O=W.translateY;for(let j=0;j<_.fillPathCount;j+=1){const X=j*4,N=(ot+j)*4;G[N]=_.fillPathMetaA[X]+lt,G[N+1]=_.fillPathMetaA[X+1],G[N+2]=_.fillPathMetaA[X+2]+Y,G[N+3]=_.fillPathMetaA[X+3]+O,B[N]=_.fillPathMetaB[X]+Y,B[N+1]=_.fillPathMetaB[X+1]+O,B[N+2]=_.fillPathMetaB[X+2],B[N+3]=_.fillPathMetaB[X+3],I[N]=_.fillPathMetaC[X],I[N+1]=_.fillPathMetaC[X+1],I[N+2]=_.fillPathMetaC[X+2],I[N+3]=_.fillPathMetaC[X+3]}for(let j=0;j<_.fillSegmentCount;j+=1){const X=j*4,N=(lt+j)*4;P[N]=_.fillSegmentsA[X]+Y,P[N+1]=_.fillSegmentsA[X+1]+O,P[N+2]=_.fillSegmentsA[X+2]+Y,P[N+3]=_.fillSegmentsA[X+3]+O,v[N]=_.fillSegmentsB[X]+Y,v[N+1]=_.fillSegmentsB[X+1]+O,v[N+2]=_.fillSegmentsB[X+2],v[N+3]=_.fillSegmentsB[X+3]}for(let j=0;j<_.segmentCount;j+=1){const X=j*4,N=(rt+j)*4;E[N]=_.endpoints[X]+Y,E[N+1]=_.endpoints[X+1]+O,E[N+2]=_.endpoints[X+2]+Y,E[N+3]=_.endpoints[X+3]+O,u[N]=_.primitiveMeta[X]+Y,u[N+1]=_.primitiveMeta[X+1]+O,u[N+2]=_.primitiveMeta[X+2],u[N+3]=_.primitiveMeta[X+3],F[N]=_.primitiveBounds[X]+Y,F[N+1]=_.primitiveBounds[X+1]+O,F[N+2]=_.primitiveBounds[X+2]+Y,F[N+3]=_.primitiveBounds[X+3]+O,q[N]=_.styles[X],q[N+1]=_.styles[X+1],q[N+2]=_.styles[X+2],q[N+3]=_.styles[X+3]}U.set(_.textInstanceA,nt*4),V.set(_.textInstanceC,nt*4);for(let j=0;j<_.textInstanceCount;j+=1){const X=j*4,N=(nt+j)*4;tt[N]=_.textInstanceB[X]+Y,tt[N+1]=_.textInstanceB[X+1]+O,tt[N+2]=_.textInstanceB[X+2]+st,tt[N+3]=_.textInstanceB[X+3]}for(let j=0;j<_.textGlyphCount;j+=1){const X=j*4,N=(st+j)*4;Q[N]=_.textGlyphMetaA[X]+ct,Q[N+1]=_.textGlyphMetaA[X+1],Q[N+2]=_.textGlyphMetaA[X+2],Q[N+3]=_.textGlyphMetaA[X+3],D[N]=_.textGlyphMetaB[X],D[N+1]=_.textGlyphMetaB[X+1],D[N+2]=_.textGlyphMetaB[X+2],D[N+3]=_.textGlyphMetaB[X+3]}L.set(_.textGlyphSegmentsA,ct*4),et.set(_.textGlyphSegmentsB,ct*4);const $=_.pageRects;if($.length>=4){const j=Math.floor($.length/4),X=En(_,j);for(let N=0;N<j;N+=1){const at=N*4,it=(mt+N)*4;J[it]=$[at]+Y,J[it+1]=$[at+1]+O,J[it+2]=$[at+2]+Y,J[it+3]=$[at+3]+O;const pt=(mt+N)*2,Rt=N*2;K[pt]=X[Rt]+nt,K[pt+1]=X[Rt+1]}mt+=j}else{const j=mt*4;J[j]=_.pageBounds.minX+Y,J[j+1]=_.pageBounds.minY+O,J[j+2]=_.pageBounds.maxX+Y,J[j+3]=_.pageBounds.maxY+O;const X=mt*2;K[X]=nt,K[X+1]=_.textInstanceCount,mt+=1}xt=jt(xt,Pn(_.bounds,Y,O)),d=jt(d,Pn(_.pageBounds,Y,O));for(const j of na(_)){if(j.matrix.length<6)continue;const X=new Float32Array(6);X[0]=j.matrix[0],X[1]=j.matrix[1],X[2]=j.matrix[2],X[3]=j.matrix[3],X[4]=j.matrix[4]+Y,X[5]=j.matrix[5]+O,Z.push({width:j.width,height:j.height,data:j.data,matrix:X})}ot+=_.fillPathCount,lt+=_.fillSegmentCount,rt+=_.segmentCount,nt+=_.textInstanceCount,st+=_.textGlyphCount,ct+=_.textGlyphSegmentCount}const z=Z[0]??null,M={pageCount:n.length,pagesPerRow:e,pageRects:J,pageTextRanges:K,fillPathCount:a,fillSegmentCount:r,fillPathMetaA:G,fillPathMetaB:B,fillPathMetaC:I,fillSegmentsA:P,fillSegmentsB:v,segmentCount:i,sourceSegmentCount:o,mergedSegmentCount:l,sourceTextCount:c,textInstanceCount:p,textGlyphCount:m,textGlyphSegmentCount:g,textInPageCount:f,textOutOfPageCount:y,textInstanceA:U,textInstanceB:tt,textInstanceC:V,textGlyphMetaA:Q,textGlyphMetaB:D,textGlyphSegmentsA:L,textGlyphSegmentsB:et,rasterLayers:Z,rasterLayerWidth:z?.width??0,rasterLayerHeight:z?.height??0,rasterLayerData:z?.data??new Uint8Array(0),rasterLayerMatrix:z?.matrix??new Float32Array([1,0,0,1,0,0]),endpoints:E,primitiveMeta:u,primitiveBounds:F,styles:q,bounds:xt??{minX:0,minY:0,maxX:1,maxY:1},pageBounds:d??xt??{minX:0,minY:0,maxX:1,maxY:1},maxHalfWidth:S,imagePaintOpCount:x,operatorCount:h,pathCount:T,discardedTransparentCount:C,discardedDegenerateCount:w,discardedDuplicateCount:R,discardedContainedCount:A};return mi(M)}function mi(n){const t=Math.max(0,n.textGlyphCount|0),e=Math.max(0,n.textGlyphSegmentCount|0);if(t<=1||e<=0||n.textGlyphMetaA.length<t*4||n.textGlyphMetaB.length<t*4)return n;const s=new Uint32Array(n.textGlyphSegmentsA.buffer,n.textGlyphSegmentsA.byteOffset,n.textGlyphSegmentsA.length),a=new Uint32Array(n.textGlyphSegmentsB.buffer,n.textGlyphSegmentsB.byteOffset,n.textGlyphSegmentsB.length),r=new Uint32Array(n.textGlyphMetaA.buffer,n.textGlyphMetaA.byteOffset,n.textGlyphMetaA.length),i=new Uint32Array(n.textGlyphMetaB.buffer,n.textGlyphMetaB.byteOffset,n.textGlyphMetaB.length),o=new Uint32Array(t),l=[],c=new Map,p=new Tt(Math.min(t,4096)),m=new Tt(Math.min(t,4096)),g=new Tt(Math.min(e,65536)),f=new Tt(Math.min(e,65536));for(let h=0;h<t;h+=1){const x=jr(n,h,r,i,s,a),T=c.get(x);let C=-1;if(T){for(const w of T)if($r(n,h,l[w])){C=w;break}}if(C<0){C=l.length,l.push(h),T?T.push(C):c.set(x,[C]);const w=h*4,R=Math.max(0,Math.trunc(n.textGlyphMetaA[w])),A=Math.max(0,Math.trunc(n.textGlyphMetaA[w+1])),S=R*4,k=Math.min(A*4,Math.max(0,n.textGlyphSegmentsA.length-S),Math.max(0,n.textGlyphSegmentsB.length-S)),G=g.quadCount;g.append(n.textGlyphSegmentsA,S,k),f.append(n.textGlyphSegmentsB,S,k),p.push(G,k/4,n.textGlyphMetaA[w+2],n.textGlyphMetaA[w+3]),m.push(n.textGlyphMetaB[w],n.textGlyphMetaB[w+1],n.textGlyphMetaB[w+2],n.textGlyphMetaB[w+3])}o[h]=C}if(l.length===t)return n;const y=n.textInstanceB;for(let h=0;h<n.textInstanceCount;h+=1){const x=h*4+2,T=Math.max(0,Math.trunc(y[x]));T<o.length&&(y[x]=o[T])}return{...n,textInstanceB:y,textGlyphCount:l.length,textGlyphSegmentCount:g.quadCount,textGlyphMetaA:p.toTypedArray(),textGlyphMetaB:m.toTypedArray(),textGlyphSegmentsA:g.toTypedArray(),textGlyphSegmentsB:f.toTypedArray()}}function pi(n,t,e){const s=Math.max(1,Math.floor(n.length/4)),a=new Uint32Array(s*2),r=Math.max(0,Math.min(e|0,Math.floor(t.length/4)));if(s<=1||r<=0)return a[0]=0,a[1]=r,a;const i=Qr(n,s);let o=0,l=0;for(let c=0;c<r;c+=1){const p=c*4,m=t[p],g=t[p+1];if(!Number.isFinite(m)||!Number.isFinite(g)||gi(n,o,m,g,i))continue;const f=Kr(n,s,o+1,m,g,i);if(!(f<=o)){a[o*2]=l,a[o*2+1]=c-l;for(let y=o+1;y<f;y+=1)a[y*2]=c,a[y*2+1]=0;o=f,l=c}}a[o*2]=l,a[o*2+1]=r-l;for(let c=o+1;c<s;c+=1)a[c*2]=r,a[c*2+1]=0;return a}function En(n,t){const e=Math.floor(n.pageRects.length/4)||n.pageCount||1,a=Math.max(1,t??e)*2;return n.pageTextRanges instanceof Uint32Array&&n.pageTextRanges.length>=a?n.pageTextRanges.subarray(0,a):pi(n.pageRects,n.textInstanceB,n.textInstanceCount)}function jr(n,t,e,s,a,r){const i=t*4,o=Math.max(0,Math.trunc(n.textGlyphMetaA[i])),l=Math.max(0,Math.trunc(n.textGlyphMetaA[i+1])),c=o*4,p=Math.min(l*4,Math.max(0,a.length-c),Math.max(0,r.length-c));let m=2166136261;m=zt(m,l),m=zt(m,e[i+2]??0),m=zt(m,e[i+3]??0),m=zt(m,s[i]??0),m=zt(m,s[i+1]??0);for(let g=0;g<p;g+=1)m=zt(m,a[c+g]),m=zt(m,r[c+g]);return`${l}:${m>>>0}`}function $r(n,t,e){if(t===e)return!0;const s=t*4,a=e*4,r=Math.max(0,Math.trunc(n.textGlyphMetaA[s+1])),i=Math.max(0,Math.trunc(n.textGlyphMetaA[a+1]));if(r!==i||n.textGlyphMetaA[s+2]!==n.textGlyphMetaA[a+2]||n.textGlyphMetaA[s+3]!==n.textGlyphMetaA[a+3]||n.textGlyphMetaB[s]!==n.textGlyphMetaB[a]||n.textGlyphMetaB[s+1]!==n.textGlyphMetaB[a+1]||n.textGlyphMetaB[s+2]!==n.textGlyphMetaB[a+2]||n.textGlyphMetaB[s+3]!==n.textGlyphMetaB[a+3])return!1;const o=Math.max(0,Math.trunc(n.textGlyphMetaA[s])),l=Math.max(0,Math.trunc(n.textGlyphMetaA[a])),c=o*4,p=l*4,m=r*4;for(let g=0;g<m;g+=1)if(n.textGlyphSegmentsA[c+g]!==n.textGlyphSegmentsA[p+g]||n.textGlyphSegmentsB[c+g]!==n.textGlyphSegmentsB[p+g])return!1;return!0}function zt(n,t){return n^=t>>>0,Math.imul(n,16777619)}function Qr(n,t){let e=0,s=0;for(let a=0;a<t;a+=1){const r=a*4,i=Math.abs(n[r+2]-n[r]),o=Math.abs(n[r+3]-n[r+1]),l=Math.max(i,o);Number.isFinite(l)&&l>0&&(e+=l,s+=1)}return s===0?8:Jr(e/s*.025,4,24)}function Kr(n,t,e,s,a,r){for(let i=Math.max(0,e);i<t;i+=1)if(gi(n,i,s,a,r))return i;return-1}function gi(n,t,e,s,a){const r=t*4,i=Math.min(n[r],n[r+2])-a,o=Math.max(n[r],n[r+2])+a,l=Math.min(n[r+1],n[r+3])-a,c=Math.max(n[r+1],n[r+3])+a;return e>=i&&e<=o&&s>=l&&s<=c}function Jr(n,t,e){return n<t?t:n>e?e:n}function ta(n,t){const e=n.map(m=>ea(m.pageBounds,m.bounds)),s=Math.ceil(n.length/t),a=new Float64Array(s);let r=0;for(let m=0;m<e.length;m+=1){const g=e[m],f=Math.max(g.maxX-g.minX,.001),y=Math.max(g.maxY-g.minY,.001);r+=Math.max(f,y);const h=Math.floor(m/t);a[h]=Math.max(a[h],y)}const i=r/Math.max(1,e.length),o=Math.max(i*zr,Nr),l=new Float64Array(s);for(let m=1;m<s;m+=1)l[m]=l[m-1]-a[m-1]-o;const c=new Float64Array(s),p=new Array(n.length);for(let m=0;m<e.length;m+=1){const g=e[m],f=Math.max(g.maxX-g.minX,.001),y=Math.floor(m/t),h=c[y]-g.minX,x=l[y]-g.maxY;p[m]={translateX:h,translateY:x},c[y]+=f+o}return p}function ea(n,t){const e=In(n)?n:t;return In(e)?e:{minX:0,minY:0,maxX:1,maxY:1}}function In(n){return Number.isFinite(n.minX)&&Number.isFinite(n.minY)&&Number.isFinite(n.maxX)&&Number.isFinite(n.maxY)}function Pn(n,t,e){return{minX:n.minX+t,minY:n.minY+e,maxX:n.maxX+t,maxY:n.maxY+e}}function na(n){const t=[];if(Array.isArray(n.rasterLayers))for(const r of n.rasterLayers){const i=Math.max(0,Math.trunc(r?.width??0)),o=Math.max(0,Math.trunc(r?.height??0));if(i<=0||o<=0||!(r.data instanceof Uint8Array)||r.data.length<i*o*4)continue;const l=new Float32Array(6);r.matrix.length>=6?(l[0]=r.matrix[0],l[1]=r.matrix[1],l[2]=r.matrix[2],l[3]=r.matrix[3],l[4]=r.matrix[4],l[5]=r.matrix[5]):(l[0]=1,l[3]=1),t.push({width:i,height:o,data:r.data,matrix:l})}if(t.length>0)return t;const e=Math.max(0,Math.trunc(n.rasterLayerWidth)),s=Math.max(0,Math.trunc(n.rasterLayerHeight));if(e<=0||s<=0||n.rasterLayerData.length<e*s*4)return t;const a=new Float32Array([1,0,0,1,0,0]);return n.rasterLayerMatrix.length>=6&&(a[0]=n.rasterLayerMatrix[0],a[1]=n.rasterLayerMatrix[1],a[2]=n.rasterLayerMatrix[2],a[3]=n.rasterLayerMatrix[3],a[4]=n.rasterLayerMatrix[4],a[5]=n.rasterLayerMatrix[5]),t.push({width:e,height:s,data:n.rasterLayerData,matrix:a}),t}function xi(){return{pageCount:0,pagesPerRow:1,pageRects:new Float32Array(0),pageTextRanges:new Uint32Array(0),fillPathCount:0,fillSegmentCount:0,fillPathMetaA:new Float32Array(0),fillPathMetaB:new Float32Array(0),fillPathMetaC:new Float32Array(0),fillSegmentsA:new Float32Array(0),fillSegmentsB:new Float32Array(0),segmentCount:0,sourceSegmentCount:0,mergedSegmentCount:0,sourceTextCount:0,textInstanceCount:0,textGlyphCount:0,textGlyphSegmentCount:0,textInPageCount:0,textOutOfPageCount:0,textInstanceA:new Float32Array(0),textInstanceB:new Float32Array(0),textInstanceC:new Float32Array(0),textGlyphMetaA:new Float32Array(0),textGlyphMetaB:new Float32Array(0),textGlyphSegmentsA:new Float32Array(0),textGlyphSegmentsB:new Float32Array(0),rasterLayers:[],rasterLayerWidth:0,rasterLayerHeight:0,rasterLayerData:new Uint8Array(0),rasterLayerMatrix:new Float32Array([1,0,0,1,0,0]),endpoints:new Float32Array(0),primitiveMeta:new Float32Array(0),primitiveBounds:new Float32Array(0),styles:new Float32Array(0),bounds:{minX:0,minY:0,maxX:1,maxY:1},pageBounds:{minX:0,minY:0,maxX:1,maxY:1},maxHalfWidth:0,imagePaintOpCount:0,operatorCount:0,pathCount:0,discardedTransparentCount:0,discardedDegenerateCount:0,discardedDuplicateCount:0,discardedContainedCount:0}}function Qt(n,t,e,s){const a=Math.trunc(Number(n)),r=Number.isFinite(a)?a:t;return r<e?e:r>s?s:r}function ia(n=kt){return{matrix:[...n],lineWidth:1,lineCap:0,strokeR:0,strokeG:0,strokeB:0,strokeAlpha:1,fillR:0,fillG:0,fillB:0,fillAlpha:1}}function yi(n){const t=Ae(n.rotate),e=n.getViewport({scale:1,rotation:t,dontFlip:!1}),s=e.transform;if(!Array.isArray(s)||s.length<6)return[...kt];const a=Number(s[0]),r=Number(s[1]),i=Number(s[2]),o=Number(s[3]),l=Number(s[4]),c=Number(s[5]);if(![a,r,i,o,l,c].every(Number.isFinite))return[...kt];const p=Number(e.height);return Number.isFinite(p)?It([1,0,0,-1,0,p],[a,r,i,o,l,c]):[a,r,i,o,l,c]}function Ie(n,t){const e=ht(t,n.minX,n.minY),s=ht(t,n.minX,n.maxY),a=ht(t,n.maxX,n.minY),r=ht(t,n.maxX,n.maxY);return{minX:Math.min(e[0],s[0],a[0],r[0]),minY:Math.min(e[1],s[1],a[1],r[1]),maxX:Math.max(e[0],s[0],a[0],r[0]),maxY:Math.max(e[1],s[1],a[1],r[1])}}function Ae(n){if(!Number.isFinite(n))return 0;let t=n%360;return t<0&&(t+=360),t}function Ti(){if(typeof window<"u"&&window.location)return new URL("pdfjs-standard-fonts/",window.location.href).toString();if(typeof window>"u"){const n=new URL("../node_modules/pdfjs-dist/standard_fonts/",import.meta.url);if(n.protocol==="file:"){const t=decodeURIComponent(n.pathname);return t.endsWith("/")?t:`${t}/`}return n.toString()}}function ra(n,t,e=1){if(!Number.isFinite(n)||!Number.isFinite(t)||n<=0||t<=0)return 1;const s=typeof window>"u"?1:Math.max(1,Number(window.devicePixelRatio)||1),a=Math.max(s*Er,Number.isFinite(e)?e:1);let r=Math.max(1,Math.min(Ir,a));for(;r>1;){const i=Math.max(1,Math.ceil(n*r)),o=Math.max(1,Math.ceil(t*r));if(i<=Rn&&o<=Rn&&i*o<=Pr)return r;if(r*=.85,r<1.05)return 1}return 1}function Fn(n){return{matrix:[...n.matrix],lineWidth:n.lineWidth,lineCap:n.lineCap,strokeR:n.strokeR,strokeG:n.strokeG,strokeB:n.strokeB,strokeAlpha:n.strokeAlpha,fillR:n.fillR,fillG:n.fillG,fillB:n.fillB,fillAlpha:n.fillAlpha}}let Nt;function Vt(n){const t=Bn(n);if(!t)return null;const e=Array.isArray(n)?Bn(n[0]):null,s=t.length>=6?t:e;if(!s||s.length<6)return null;const a=Number(s[0]),r=Number(s[1]),i=Number(s[2]),o=Number(s[3]),l=Number(s[4]),c=Number(s[5]);return[a,r,i,o,l,c].every(Number.isFinite)?[a,r,i,o,l,c]:null}function Bn(n){return Array.isArray(n)||ArrayBuffer.isView(n)?n:null}function vi(n){if(!Array.isArray(n)||n.length<2)return null;const t=n[1];if(!Array.isArray(t)||t.length===0)return null;const e=t[0];return e instanceof Float32Array?e:null}function Bt(n,t){if(Array.isArray(n))return n[t]}function gt(n,t,e){const s=Bt(n,t),a=Number(s);return Number.isFinite(a)?a:e}function aa(n){return n===H.stroke||n===H.closeStroke||n===H.fillStroke||n===H.eoFillStroke||n===H.closeFillStroke||n===H.closeEOFillStroke}function sa(n){return n===H.fill||n===H.eoFill||n===H.fillStroke||n===H.eoFillStroke||n===H.closeFillStroke||n===H.closeEOFillStroke}function oa(n){return n===H.eoFill||n===H.eoFillStroke||n===H.closeEOFillStroke}function He(n,t){const e=Number(n);if(Number.isFinite(e)){const s=dt(e>1?e/255:e);return[s,s,s]}return[t,t,t]}function Xe(n,t){if(typeof n=="number"&&Number.isFinite(n)){const e=dt(n>1?n/255:n);return[e,e,e]}if(typeof n=="string"&&n.startsWith("#")&&(n.length===7||n.length===4)){const[e,s,a]=la(n);return[dt(e/255),dt(s/255),dt(a/255)]}if(Array.isArray(n)&&n.length>=3){const e=Number(n[0]),s=Number(n[1]),a=Number(n[2]);if([e,s,a].every(Number.isFinite))return[dt(e>1?e/255:e),dt(s>1?s/255:s),dt(a>1?a/255:a)]}return[t[0],t[1],t[2]]}function re(n,t){return Array.isArray(n)?n.length>=3&&n.slice(0,3).every(e=>Number.isFinite(Number(e)))?Xe([n[0],n[1],n[2]],t):n.length>0?Xe(n[0],t):[t[0],t[1],t[2]]:Xe(n,t)}function qe(n,t){if(!Array.isArray(n)||n.length<4)return re(n,t);const e=Te(n[0]),s=Te(n[1]),a=Te(n[2]),r=Te(n[3]);if([e,s,a,r].some(f=>f===null))return re(n,t);const i=e,o=s,l=a,c=r,p=1-Math.min(1,i+c),m=1-Math.min(1,o+c),g=1-Math.min(1,l+c);return[dt(p),dt(m),dt(g)]}function Te(n){const t=Number(n);if(!Number.isFinite(t))return null;const e=t>1?t/100:t;return dt(e)}function la(n){if(n.length===4){const a=Number.parseInt(n[1]+n[1],16),r=Number.parseInt(n[2]+n[2],16),i=Number.parseInt(n[3]+n[3],16);return[a,r,i]}const t=Number.parseInt(n.slice(1,3),16),e=Number.parseInt(n.slice(3,5),16),s=Number.parseInt(n.slice(5,7),16);return[t,e,s]}function ca(n,t){if(Array.isArray(n))for(const e of n){if(!Array.isArray(e)||e.length<2)continue;const s=e[0],a=e[1];if(s==="CA"){const r=Number(a);Number.isFinite(r)&&(t.strokeAlpha=dt(r));continue}if(s==="ca"){const r=Number(a);Number.isFinite(r)&&(t.fillAlpha=dt(r));continue}if(s==="LW"){const r=Number(a);Number.isFinite(r)&&(t.lineWidth=Math.max(0,r));continue}if(s==="LC"){const r=Number(a);Number.isFinite(r)&&(t.lineCap=Math.min(2,Math.max(0,Math.trunc(r))))}}}function ua(n,t,e,s,a,r,i,o,l,c,p,m,g,f){let y=0,h=0,x=0,T=0,C=0,w=!1,R=0,A=0,S=0,k=0,G=!1;const B=(u,F,q,U,tt,V,Q)=>{c.push(u,F,q,U),p.push(tt,V,Q,Vr(i,o)),m.push(e,s,a,r);const D=Math.min(u,q,tt),L=Math.min(F,U,V),et=Math.max(u,q,tt),J=Math.max(F,U,V);g.push(D,L,et,J),f.minX=Math.min(f.minX,D),f.minY=Math.min(f.minY,L),f.maxX=Math.max(f.maxX,et),f.maxY=Math.max(f.maxY,J)},I=()=>{G&&(B(R,A,S,k,S,k,Ue),G=!1)},P=(u,F,q,U)=>{if(!G)return!1;const tt=u-S,V=F-k;if(tt*tt+V*V>Sn*Sn)return!1;const Q=S-R,D=k-A,L=q-u,et=U-F,J=Q*Q+D*D,K=L*L+et*et;if(J<1e-10||K<1e-10)return!1;const ot=1/Math.sqrt(J*K);if((Q*L+D*et)*ot<Cr)return!1;const rt=q-R,nt=U-A;return Na(rt,nt,Q,D,J)>wn*wn?!1:(S=q,k=U,!0)},v=(u,F,q,U,tt)=>{const V=q-u,Q=U-F;if(V*V+Q*Q<1e-10){if((o&Ke)===0)return;y+=1,I(),B(u,F,q,U,q,U,Ue);return}if(y+=1,!(l&&tt&&P(u,F,q,U))){if(l){I(),R=u,A=F,S=q,k=U,G=!0;return}B(u,F,q,U,q,U,Ue)}},E=(u,F,q,U,tt,V)=>{const Q=tt-u,D=V-F,L=q-u,et=U-F;Q*Q+D*D<1e-10&&L*L+et*et<1e-10||(y+=1,I(),B(u,F,q,U,tt,V,Qe))};for(let u=0;u<n.length;){const F=n[u++];if(F===we){I(),h=n[u++],x=n[u++],T=h,C=x,w=!0;continue}if(F===_e){const q=n[u++],U=n[u++],[tt,V]=ht(t,h,x),[Q,D]=ht(t,q,U);v(tt,V,Q,D,!0),h=q,x=U;continue}if(F===Me){const q=n[u++],U=n[u++],tt=n[u++],V=n[u++],Q=n[u++],D=n[u++],[L,et]=ht(t,h,x),[J,K]=ht(t,q,U),[ot,lt]=ht(t,tt,V),[rt,nt]=ht(t,Q,D);tn(L,et,J,K,ot,lt,rt,nt,E,ci,ui),h=Q,x=D;continue}if(F===Re){const q=n[u++],U=n[u++],tt=n[u++],V=n[u++],[Q,D]=ht(t,h,x),[L,et]=ht(t,q,U),[J,K]=ht(t,tt,V);E(Q,D,L,et,J,K),h=tt,x=V;continue}if(F===Ee){if(w&&(h!==T||x!==C)){const[q,U]=ht(t,h,x),[tt,V]=ht(t,T,C);v(q,U,tt,V,!0)}h=T,x=C,I();continue}I();break}return I(),y}function ha(n,t,e,s,a,r,i,o,l,c,p,m,g,f){let y=0,h=0,x=0,T=0,C=!1;const w=m.quadCount;let R=0;const A={minX:Number.POSITIVE_INFINITY,minY:Number.POSITIVE_INFINITY,maxX:Number.NEGATIVE_INFINITY,maxY:Number.NEGATIVE_INFINITY},S=(B,I,P,v)=>{const E=P-B,u=v-I;E*E+u*u<1e-12||(m.push(B,I,P,v),g.push(P,v,Ur,0),R+=1,A.minX=Math.min(A.minX,B,P),A.minY=Math.min(A.minY,I,v),A.maxX=Math.max(A.maxX,B,P),A.maxY=Math.max(A.maxY,I,v))},k=(B,I,P,v,E,u)=>{const F=E-B,q=u-I,U=P-B,tt=v-I;F*F+q*q<1e-12&&U*U+tt*tt<1e-12||(m.push(B,I,P,v),g.push(E,u,Xr,0),R+=1,A.minX=Math.min(A.minX,B,P,E),A.minY=Math.min(A.minY,I,v,u),A.maxX=Math.max(A.maxX,B,P,E),A.maxY=Math.max(A.maxY,I,v,u))},G=()=>{if(C){if(y!==x||h!==T){const[B,I]=ht(t,y,h),[P,v]=ht(t,x,T);S(B,I,P,v)}y=x,h=T}};for(let B=0;B<n.length;){const I=n[B++];if(I===we){G(),y=n[B++],h=n[B++],x=y,T=h,C=!0;continue}if(I===_e){const P=n[B++],v=n[B++],[E,u]=ht(t,y,h),[F,q]=ht(t,P,v);S(E,u,F,q),y=P,h=v;continue}if(I===Me){const P=n[B++],v=n[B++],E=n[B++],u=n[B++],F=n[B++],q=n[B++],[U,tt]=ht(t,y,h),[V,Q]=ht(t,P,v),[D,L]=ht(t,E,u),[et,J]=ht(t,F,q);tn(U,tt,V,Q,D,L,et,J,k,ci,ui),y=F,h=q;continue}if(I===Re){const P=n[B++],v=n[B++],E=n[B++],u=n[B++],[F,q]=ht(t,y,h),[U,tt]=ht(t,P,v),[V,Q]=ht(t,E,u);k(F,q,U,tt,V,Q),y=E,h=u;continue}if(I===Ee){G();continue}G();break}return G(),R===0?!1:(l.push(w,R,A.minX,A.minY),c.push(A.maxX,A.maxY,a,r),p.push(e,s?1:0,i,o),f.minX=Math.min(f.minX,A.minX),f.minY=Math.min(f.minY,A.minY),f.maxX=Math.max(f.maxX,A.maxX),f.maxY=Math.max(f.maxY,A.maxY),!0)}function da(n,t,e,s){const a=n.length>>2,r=new Uint8Array(a),i=new Set,o=new Map;let l=0,c=0,p=0,m=0;for(let R=0;R<a;R+=1){const A=R*4,S=n[A],k=n[A+1],G=n[A+2],B=n[A+3],I=t[A],P=t[A+1],v=t[A+2],E=v>=Qe-.5,u=e[A],F=e[A+1],q=e[A+2],U=e[A+3],{alpha:tt,styleFlags:V}=Yr(t[A+3]);if(tt<=oi){l+=1;continue}const Q=E?Math.hypot(G-S,B-k)+Math.hypot(I-G,P-B):Math.hypot(I-S,P-k);if(Q<1e-5){const L=!E&&(V&Ke)!==0,J=(V&hi)!==0||u>1e-6;if(!L||!J){c+=1;continue}}const D=fa(S,k,G,B,I,P,v,u,F,q,U,tt,V);if(i.has(D)){p+=1;continue}if(i.add(D),r[R]=1,!E&&Q>=1e-5){const L=ma(R,S,k,I,P,u,F,q,U,tt,V);let et=o.get(L.key);et||(et=[],o.set(L.key,et)),et.push({index:L.index,start:L.start,end:L.end,halfWidth:L.halfWidth,alpha:L.alpha,styleFlags:L.styleFlags})}}for(const R of o.values()){R.sort((S,k)=>{if(Math.abs(S.halfWidth-k.halfWidth)>Mn)return k.halfWidth-S.halfWidth;const G=S.end-S.start,B=k.end-k.start;return Math.abs(G-B)>Ge?B-G:S.start-k.start});const A=[];for(const S of R){let k=!1;for(const G of A)if(!(G.halfWidth+Mn<S.halfWidth)&&G.start-Ge<=S.start&&G.end+Ge>=S.end){k=!0;break}if(k){r[S.index]===1&&(r[S.index]=0,m+=1);continue}S.alpha>=br&&A.push(S)}}let g=0;for(let R=0;R<a;R+=1)r[R]===1&&(g+=1);if(g===0)return{segmentCount:0,endpoints:new Float32Array(0),primitiveMeta:new Float32Array(0),primitiveBounds:new Float32Array(0),styles:new Float32Array(0),bounds:{minX:0,minY:0,maxX:0,maxY:0},maxHalfWidth:0,discardedTransparentCount:l,discardedDegenerateCount:c,discardedDuplicateCount:p,discardedContainedCount:m};const f=new Float32Array(g*4),y=new Float32Array(g*4),h=new Float32Array(g*4),x=new Float32Array(g*4),T={minX:Number.POSITIVE_INFINITY,minY:Number.POSITIVE_INFINITY,maxX:Number.NEGATIVE_INFINITY,maxY:Number.NEGATIVE_INFINITY};let C=0,w=0;for(let R=0;R<a;R+=1){if(r[R]===0)continue;const A=R*4,S=w*4,k=n[A],G=n[A+1],B=s[A],I=s[A+1],P=s[A+2],v=s[A+3],E=e[A];f[S]=k,f[S+1]=G,f[S+2]=n[A+2],f[S+3]=n[A+3],y[S]=t[A],y[S+1]=t[A+1],y[S+2]=t[A+2],y[S+3]=t[A+3],h[S]=B,h[S+1]=I,h[S+2]=P,h[S+3]=v,x[S]=e[A],x[S+1]=e[A+1],x[S+2]=e[A+2],x[S+3]=e[A+3],T.minX=Math.min(T.minX,B),T.minY=Math.min(T.minY,I),T.maxX=Math.max(T.maxX,P),T.maxY=Math.max(T.maxY,v),C=Math.max(C,E),w+=1}return{segmentCount:g,endpoints:f,primitiveMeta:y,primitiveBounds:h,styles:x,bounds:T,maxHalfWidth:C,discardedTransparentCount:l,discardedDegenerateCount:c,discardedDuplicateCount:p,discardedContainedCount:m}}function fa(n,t,e,s,a,r,i,o,l,c,p,m,g){const f=i>=Qe-.5;let y=n,h=t,x=a,T=r,C=e,w=s;return!f&&(y>x||y===x&&h>T)&&(y=a,h=r,x=n,T=t),f||(C=x,w=T),[yt(i,10),yt(o,Xt),yt(l,Xt),yt(c,Xt),yt(p,Xt),yt(m,Xt),yt(g,1),yt(y,Zt),yt(h,Zt),yt(C,Zt),yt(w,Zt),yt(x,Zt),yt(T,Zt)].join("|")}function ma(n,t,e,s,a,r,i,o,l,c,p){let m=t,g=e,f=s,y=a,h=f-m,x=y-g;const T=Math.hypot(h,x);let C=h/T,w=x/T;(C<0||Math.abs(C)<1e-10&&w<0)&&(C=-C,w=-w,m=s,g=a,f=t,y=e);const R=-w,A=C,S=R*m+A*g,k=C*m+w*g,G=C*f+w*y,B=Math.min(k,G),I=Math.max(k,G);return{key:[yt(C,_n),yt(w,_n),yt(S,Ar),yt(i,Xt),yt(o,Xt),yt(l,Xt),yt(p,1)].join("|"),index:n,start:B,end:I,halfWidth:r,alpha:c,styleFlags:p}}async function ze(n,t,e,s){const a=ya(n);if(!a)return xa();const r=new Tt(4096),i=new Tt(4096),o=new Tt(4096),l=new Tt(2048),c=new Tt(2048),p=new Tt(16384),m=new Tt(16384),g=new Map,f=[];let y=0,h=null,x=0,T=0;const C=[],w=[],R=[],A=[];let S=Ma(e),k=null,G=null;const B=(P,v,E)=>{if(!E)return null;const u=typeof P?.loadedName=="string"&&P.loadedName.length>0?P.loadedName:v;if(!u)return null;const F=`${u}|${E}`,q=g.get(F);if(q!==void 0)return{index:q,bounds:f[q]};const U=ka(a,u,E);if(!U)return null;const tt=p.quadCount,V=Da(U,p,m);if(V.segmentCount<=0)return null;const Q=l.quadCount;return l.push(tt,V.segmentCount,V.bounds.minX,V.bounds.minY),c.push(V.bounds.maxX,V.bounds.maxY,0,0),g.set(F,Q),f[Q]=V.bounds,{index:Q,bounds:V.bounds}},I=P=>{if(P.length===0||S.fontSize===0)return;const v=Fa(a,S.fontRef),E=Ba(v),u=S.fontSize*E,F=v?.vertical===!0,q=F?1:-1,U=S.textHScale*S.fontDirection;let tt=0;for(const V of P){if(typeof V=="number"&&Number.isFinite(V)){tt+=q*V*S.fontSize/1e3;continue}const Q=V,D=typeof Q.fontChar=="string"?Q.fontChar:"",L=Number(Q.width),et=Number.isFinite(L)?L:0,J=Q.isSpace===!0,K=Pa(Q,D),ot=(J?S.wordSpacing:0)+S.charSpacing;if(!F&&!K&&Ia(S.renderMode)&&S.fillAlpha>Mr){const rt=B(v,S.fontRef,D);if(rt){const nt=za(S,tt,0),st=Ie(rt.bounds,nt);(!k||Un(st,k))&&(r.push(nt[0],nt[1],nt[2],nt[3]),i.push(nt[4],nt[5],rt.index,0),o.push(S.fillR,S.fillG,S.fillB,S.fillAlpha),y+=1,s&&(Un(st,s)?x+=1:T+=1),h?(h.minX=Math.min(h.minX,st.minX-Ut),h.minY=Math.min(h.minY,st.minY-Ut),h.maxX=Math.max(h.maxX,st.maxX+Ut),h.maxY=Math.max(h.maxY,st.maxY+Ut)):h={minX:st.minX-Ut,minY:st.minY-Ut,maxX:st.maxX+Ut,maxY:st.maxY+Ut})}}const lt=F?et*u-ot*S.fontDirection:et*u+ot*S.fontDirection;tt+=lt}F?S.textY-=tt:S.textX+=tt*U};for(let P=0;P<t.fnArray.length;P+=1){const v=t.fnArray[P],E=t.argsArray[P];if(v===H.save){C.push(Gn(S)),R.push(kn(k));continue}if(v===H.restore){const u=C.pop();u&&(S=u),k=R.pop()??null,G=null;continue}if(v===H.transform){const u=Vt(E);u&&(S.matrix=It(S.matrix,u));continue}if(v===H.paintFormXObjectBegin){w.push(Gn(S)),A.push(kn(k));const u=Vt(E);u&&(S.matrix=It(S.matrix,u)),G=null;continue}if(v===H.paintFormXObjectEnd){const u=w.pop();u&&(S=u),k=A.pop()??k,G=null;continue}if(v===H.constructPath){if(gt(E,0,-1)===H.endPath){const F=vi(E);G=F?ga(F,S.matrix):null}else G=null;continue}if(v===H.clip||v===H.eoClip){G&&(k=pa(k,G));continue}if(v===H.endPath){G=null;continue}if(v===H.setFillRGBColor||v===H.setFillColor||v===H.setFillGray||v===H.setFillCMYKColor){if(v===H.setFillCMYKColor){const[u,F,q]=qe(E,[S.fillR,S.fillG,S.fillB]);S.fillR=u,S.fillG=F,S.fillB=q}else if(v===H.setFillGray){const[u]=He(Bt(E,0),S.fillR);S.fillR=u,S.fillG=u,S.fillB=u}else{const[u,F,q]=re(E,[S.fillR,S.fillG,S.fillB]);S.fillR=u,S.fillG=F,S.fillB=q}continue}if(v===H.setGState){Ea(Bt(E,0),S);continue}if(v===H.beginText){Ra(S);continue}if(v===H.setCharSpacing){S.charSpacing=gt(E,0,S.charSpacing);continue}if(v===H.setWordSpacing){S.wordSpacing=gt(E,0,S.wordSpacing);continue}if(v===H.setHScale){S.textHScale=gt(E,0,S.textHScale*100)/100;continue}if(v===H.setLeading){S.leading=-gt(E,0,-S.leading);continue}if(v===H.setFont){const u=Bt(E,0),F=gt(E,1,S.fontSize);typeof u=="string"&&(S.fontRef=u),F<0?(S.fontSize=-F,S.fontDirection=-1):(S.fontSize=F,S.fontDirection=1);continue}if(v===H.setTextRenderingMode){S.renderMode=Math.max(0,Math.trunc(gt(E,0,S.renderMode)));continue}if(v===H.setTextRise){S.textRise=gt(E,0,S.textRise);continue}if(v===H.moveText){const u=gt(E,0,0),F=gt(E,1,0);ee(S,u,F);continue}if(v===H.setLeadingMoveText){const u=gt(E,0,0),F=gt(E,1,0);S.leading=F,ee(S,u,F);continue}if(v===H.setTextMatrix){const u=Vt(E);u&&(S.textMatrix=u,S.textX=0,S.textY=0,S.lineX=0,S.lineY=0);continue}if(v===H.nextLine){ee(S,0,S.leading);continue}if(v===H.showText||v===H.showSpacedText){I(Ne(Bt(E,0))),G=null;continue}if(v===H.nextLineShowText){ee(S,0,S.leading),I(Ne(Bt(E,0))),G=null;continue}if(v===H.nextLineSetSpacingShowText){S.wordSpacing=gt(E,0,S.wordSpacing),S.charSpacing=gt(E,1,S.charSpacing),ee(S,0,S.leading),I(Ne(Bt(E,2))),G=null;continue}}return{sourceTextCount:y,instanceCount:r.quadCount,glyphCount:l.quadCount,glyphSegmentCount:p.quadCount,inPageCount:x,outOfPageCount:T,instanceA:r.toTypedArray(),instanceB:i.toTypedArray(),instanceC:o.toTypedArray(),glyphMetaA:l.toTypedArray(),glyphMetaB:c.toTypedArray(),glyphSegmentsA:p.toTypedArray(),glyphSegmentsB:m.toTypedArray(),bounds:h}}function kn(n){return n?{...n}:null}function pa(n,t){if(!n&&!t)return null;if(!n&&t)return{...t};if(n&&!t)return{...n};const e=Math.max(n.minX,t.minX),s=Math.max(n.minY,t.minY),a=Math.min(n.maxX,t.maxX),r=Math.min(n.maxY,t.maxY);return e<=a&&s<=r?{minX:e,minY:s,maxX:a,maxY:r}:null}function ga(n,t){let e=Number.POSITIVE_INFINITY,s=Number.POSITIVE_INFINITY,a=Number.NEGATIVE_INFINITY,r=Number.NEGATIVE_INFINITY,i=!1,o=0,l=0,c=0,p=0,m=!1;const g=(f,y)=>{const[h,x]=ht(t,f,y);e=Math.min(e,h),s=Math.min(s,x),a=Math.max(a,h),r=Math.max(r,x),i=!0};for(let f=0;f<n.length;){const y=n[f++];if(y===we){if(f+1>=n.length)break;o=n[f++],l=n[f++],c=o,p=l,m=!0,g(o,l);continue}if(y===_e){if(f+1>=n.length)break;const h=n[f++],x=n[f++];g(o,l),g(h,x),o=h,l=x;continue}if(y===Me){if(f+5>=n.length)break;const h=n[f++],x=n[f++],T=n[f++],C=n[f++],w=n[f++],R=n[f++];g(o,l),g(h,x),g(T,C),g(w,R),o=w,l=R;continue}if(y===Re){if(f+3>=n.length)break;const h=n[f++],x=n[f++],T=n[f++],C=n[f++];g(o,l),g(h,x),g(T,C),o=T,l=C;continue}if(y===Ee){m&&(g(o,l),g(c,p),o=c,l=p);continue}break}return i?{minX:e,minY:s,maxX:a,maxY:r}:null}function xa(){return{sourceTextCount:0,instanceCount:0,glyphCount:0,glyphSegmentCount:0,inPageCount:0,outOfPageCount:0,instanceA:new Float32Array(0),instanceB:new Float32Array(0),instanceC:new Float32Array(0),glyphMetaA:new Float32Array(0),glyphMetaB:new Float32Array(0),glyphSegmentsA:new Float32Array(0),glyphSegmentsB:new Float32Array(0),bounds:null}}function ya(n){const t=n;return!t.commonObjs||typeof t.commonObjs.get!="function"?null:t.commonObjs}function Ta(n){for(const t of n.fnArray)if(t===H.showText||t===H.showSpacedText||t===H.nextLineShowText||t===H.nextLineSetSpacingShowText)return!0;return!1}function Ci(n){let t=0;for(const e of n.fnArray)Je(e)&&(t+=1);return t}async function va(n){if(typeof document>"u")return;const t=n;if(!Array.isArray(t.view)||typeof t.getViewport!="function"||typeof t.render!="function")return;const e=Math.max(1,Math.abs(t.view[2]-t.view[0])),s=Math.max(1,Math.abs(t.view[3]-t.view[1])),a=Math.max(e,s),i=dt(1024/a)*.95+.05,o=t.getViewport({scale:i,rotation:Ae(t.rotate),dontFlip:!0}),l=Math.max(1,Math.ceil(o.width)),c=Math.max(1,Math.ceil(o.height)),p=document.createElement("canvas");p.width=l,p.height=c;const m=p.getContext("2d",{alpha:!1});if(m)try{await t.render({canvasContext:m,viewport:o,intent:"display"}).promise}catch{}finally{p.width=0,p.height=0}}function Je(n){return n===H.paintImageXObject||n===H.paintInlineImageXObject||n===H.paintInlineImageXObjectGroup||n===H.paintImageXObjectRepeat||n===H.paintImageMaskXObject||n===H.paintImageMaskXObjectGroup||n===H.paintImageMaskXObjectRepeat||n===H.paintSolidColorImageMask||n===H.beginInlineImage||n===H.beginImageData||n===H.endInlineImage}function Ca(n,t){return n===H.dependency||n===H.save||n===H.restore||n===H.transform||n===H.setGState||n===H.beginGroup||n===H.endGroup||n===H.beginCompat||n===H.endCompat||n===H.beginMarkedContent||n===H.beginMarkedContentProps||n===H.endMarkedContent||n===H.paintFormXObjectBegin||n===H.paintFormXObjectEnd||n===H.paintXObject||n===H.clip||n===H.eoClip||n===H.endPath||n===H.setFillRGBColor||n===H.setFillColor||n===H.setFillGray||n===H.setFillCMYKColor||n===H.setFillColorN||n===H.setFillColorSpace||n===H.setFillTransparent||n===H.setStrokeRGBColor||n===H.setStrokeColor||n===H.setStrokeGray||n===H.setStrokeCMYKColor||n===H.setStrokeColorN||n===H.setStrokeColorSpace||n===H.setStrokeTransparent?!0:n===H.constructPath?gt(t,0,-1)===H.endPath:!1}function ba(n){const t=new Uint8Array(n.fnArray.length);let e=!1,s=!1;for(let a=0;a<n.fnArray.length;a+=1){const r=n.fnArray[a],i=n.argsArray[a];if(Je(r)){e=!0,t[a]=1;continue}(r===H.paintFormXObjectBegin||r===H.paintFormXObjectEnd||r===H.paintXObject)&&(s=!0),Ca(r,i)&&(t[a]=1)}return{hasImagePaintOps:e,hasFormXObjectOps:s,imageOnlyMask:t}}function Aa(n){const t=[];let e=[...kt],s=1;for(let a=0;a<n.fnArray.length;a+=1){const r=n.fnArray[a],i=n.argsArray[a];if(r===H.save){t.push([...e]);continue}if(r===H.restore){const g=t.pop();g&&(e=g);continue}if(r===H.transform){const g=Vt(i);g&&(e=It(e,g));continue}if(!Je(r))continue;const o=Sa(r,i);if(!o)continue;const l=Math.hypot(e[0],e[1]),c=Math.hypot(e[2],e[3]);if(!Number.isFinite(l)||!Number.isFinite(c)||l<=1e-5||c<=1e-5)continue;const p=o.width/l,m=o.height/c;Number.isFinite(p)&&p>s&&(s=p),Number.isFinite(m)&&m>s&&(s=m)}return Number.isFinite(s)?Math.max(1,s):1}function Sa(n,t){if(n===H.paintImageXObject||n===H.paintImageXObjectRepeat){const e=gt(t,1,Number.NaN),s=gt(t,2,Number.NaN);if(e>0&&s>0)return{width:e,height:s}}if(n===H.paintInlineImageXObject){const e=Bt(t,0),s=Number(e?.width),a=Number(e?.height);if(s>0&&a>0)return{width:s,height:a}}if(n===H.paintImageMaskXObject||n===H.paintImageMaskXObjectRepeat){const e=gt(t,1,Number.NaN),s=gt(t,2,Number.NaN);if(e>0&&s>0)return{width:e,height:s}}return null}function te(){return{width:0,height:0,data:new Uint8Array(0),matrix:[...kt],bounds:null}}async function bi(n,t,e,s){const a=ba(t);if(!a.hasImagePaintOps&&!(s.allowFullPageFallback&&a.hasFormXObjectOps))return te();const r=n;if(!Array.isArray(r.view)||typeof r.getViewport!="function"||typeof r.render!="function")return te();const i=r.getViewport({scale:1,rotation:Ae(r.rotate),dontFlip:!1}),o=Aa(t),l=ra(Math.max(1,Math.ceil(i.width)),Math.max(1,Math.ceil(i.height)),o),c=l===1?i:r.getViewport({scale:l,rotation:Ae(r.rotate),dontFlip:!1}),p=Math.max(1,Math.ceil(c.width)),m=Math.max(1,Math.ceil(c.height));if(!Number.isFinite(p)||!Number.isFinite(m)||p<=0||m<=0)return te();let g=null;return a.hasImagePaintOps&&(g=await Ln(r,c,a.imageOnlyMask),g&&Dn(g))?On(p,m,g,c,e):!s.allowFullPageFallback||!a.hasFormXObjectOps||(g=await Ln(r,c),!g||!Dn(g))?te():On(p,m,g,c,e)}async function wa(){if(Nt!==void 0)return Nt;if(typeof window<"u")return Nt=null,null;try{const t=await import("@napi-rs/canvas");return typeof t.createCanvas!="function"?(Nt=null,null):(Nt={createCanvas:t.createCanvas},Nt)}catch{return Nt=null,null}}async function _a(n,t){if(typeof document<"u"){const r=document.createElement("canvas");r.width=n,r.height=t;const i=r.getContext("2d",{alpha:!0,willReadFrequently:!0});return i?{context:i,dispose:()=>{r.width=0,r.height=0}}:null}const e=await wa();if(!e)return null;const s=e.createCanvas(n,t),a=s.getContext("2d");return!a||typeof a.getImageData!="function"?null:{context:a,dispose:()=>{s.width=0,s.height=0}}}async function Ln(n,t,e){const s=t,a=Math.max(1,Math.ceil(Number(s.width)||1)),r=Math.max(1,Math.ceil(Number(s.height)||1)),i=await _a(a,r);if(!i)return null;const o=i.context;try{const p={canvasContext:o,viewport:t,intent:"display",background:"rgba(0,0,0,0)"};e&&(p.operationsFilter=m=>m>=0&&m<e.length&&e[m]===1),await n.render(p).promise}catch{return i.dispose(),null}const l=o.getImageData(0,0,a,r),c=new Uint8Array(l.data instanceof Uint8ClampedArray?l.data:new Uint8Array(l.data));return i.dispose(),c}function Dn(n){for(let t=3;t<n.length;t+=4)if(n[t]>0)return!0;return!1}function On(n,t,e,s,a){const r=Vt(s.transform)??[...kt],i=Va(r)??[...kt],l=It(a,It(i,[n,0,0,t,0,0])),c=Ie({minX:0,minY:0,maxX:1,maxY:1},l);return{width:n,height:t,data:e,matrix:l,bounds:c}}function Ma(n){return{matrix:[...n],fillR:0,fillG:0,fillB:0,fillAlpha:1,textMatrix:[...kt],textX:0,textY:0,lineX:0,lineY:0,charSpacing:0,wordSpacing:0,textHScale:1,leading:0,textRise:0,renderMode:li,fontRef:"",fontSize:0,fontDirection:1}}function Gn(n){return{matrix:[...n.matrix],fillR:n.fillR,fillG:n.fillG,fillB:n.fillB,fillAlpha:n.fillAlpha,textMatrix:[...n.textMatrix],textX:n.textX,textY:n.textY,lineX:n.lineX,lineY:n.lineY,charSpacing:n.charSpacing,wordSpacing:n.wordSpacing,textHScale:n.textHScale,leading:n.leading,textRise:n.textRise,renderMode:n.renderMode,fontRef:n.fontRef,fontSize:n.fontSize,fontDirection:n.fontDirection}}function Ra(n){n.textMatrix=[...kt],n.textX=0,n.textY=0,n.lineX=0,n.lineY=0}function ee(n,t,e){n.lineX+=t,n.lineY+=e,n.textX=n.lineX,n.textY=n.lineY}function Ea(n,t){if(Array.isArray(n))for(const e of n){if(!Array.isArray(e)||e.length<2)continue;const s=e[0],a=e[1];if(s==="ca"){const r=Number(a);Number.isFinite(r)&&(t.fillAlpha=dt(r));continue}if(s==="Font"&&Array.isArray(a)){const r=a[0],i=Number(a[1]);typeof r=="string"&&(t.fontRef=r),Number.isFinite(i)&&(i<0?(t.fontSize=-i,t.fontDirection=-1):(t.fontSize=i,t.fontDirection=1))}}}function Ia(n){return n===li||n===kr||n===Lr||n===Dr}function Pa(n,t){if(!t||n.isSpace===!0)return!0;const e=typeof n.unicode=="string"?n.unicode:"";return e.length>0&&e.trim().length===0}function Ne(n){return Array.isArray(n)?n:[]}function Fa(n,t){if(!t)return null;try{const e=n.get(t);return!e||typeof e!="object"?null:e}catch{return null}}function Ba(n){const t=n?.fontMatrix;if(Array.isArray(t)&&t.length>=1){const e=Number(t[0]);if(Number.isFinite(e)&&e!==0)return e}return _r}function ka(n,t,e){const s=`${t}_path_${e}`;let a;try{a=n.get(s)}catch{return null}const r=a?.path;return La(r)}function La(n){if(!n)return null;if(n instanceof Float32Array)return n;if(ArrayBuffer.isView(n)){const t=n,e=new Float32Array(t.length);for(let s=0;s<t.length;s+=1){const a=Number(t[s]);e[s]=Number.isFinite(a)?a:0}return e}if(Array.isArray(n)){const t=new Float32Array(n.length);for(let e=0;e<n.length;e+=1){const s=Number(n[e]);t[e]=Number.isFinite(s)?s:0}return t}return null}function Da(n,t,e){let s=0,a=0,r=0,i=0,o=0,l=!1;const c={minX:Number.POSITIVE_INFINITY,minY:Number.POSITIVE_INFINITY,maxX:Number.NEGATIVE_INFINITY,maxY:Number.NEGATIVE_INFINITY},p=(g,f,y,h)=>{const x=y-g,T=h-f;x*x+T*T<1e-12||(t.push(g,f,y,h),e.push(y,h,Or,0),s+=1,c.minX=Math.min(c.minX,g,y),c.minY=Math.min(c.minY,f,h),c.maxX=Math.max(c.maxX,g,y),c.maxY=Math.max(c.maxY,f,h))},m=(g,f,y,h,x,T)=>{const C=x-g,w=T-f,R=y-g,A=h-f;C*C+w*w<1e-12&&R*R+A*A<1e-12||(t.push(g,f,y,h),e.push(x,T,Gr,0),s+=1,c.minX=Math.min(c.minX,g,y,x),c.minY=Math.min(c.minY,f,h,T),c.maxX=Math.max(c.maxX,g,y,x),c.maxY=Math.max(c.maxY,f,h,T))};for(let g=0;g<n.length;){const f=n[g++];if(f===we){a=n[g++],r=n[g++],i=a,o=r,l=!0;continue}if(f===_e){const y=n[g++],h=n[g++];p(a,r,y,h),a=y,r=h;continue}if(f===Me){const y=n[g++],h=n[g++],x=n[g++],T=n[g++],C=n[g++],w=n[g++];tn(a,r,y,h,x,T,C,w,m,Sr,wr),a=C,r=w;continue}if(f===Re){const y=n[g++],h=n[g++],x=n[g++],T=n[g++];m(a,r,y,h,x,T),a=x,r=T;continue}if(f===Ee){l&&(a!==i||r!==o)&&p(a,r,i,o),a=i,r=o;continue}break}return s===0?{segmentCount:0,bounds:{minX:0,minY:0,maxX:0,maxY:0}}:{segmentCount:s,bounds:c}}function tn(n,t,e,s,a,r,i,o,l,c,p){const m=[n,t,e,s,a,r,i,o,0],g=c*c;for(;m.length>0;){const f=m.pop(),y=m.pop(),h=m.pop(),x=m.pop(),T=m.pop(),C=m.pop(),w=m.pop(),R=m.pop(),A=m.pop(),[S,k]=Oa(A,R,w,C,T,x,h,y),G=Ga(A,R,w,C,T,x,h,y,S,k);if(f>=p||G<=g){l(A,R,S,k,h,y);continue}const B=(A+w)*.5,I=(R+C)*.5,P=(w+T)*.5,v=(C+x)*.5,E=(T+h)*.5,u=(x+y)*.5,F=(B+P)*.5,q=(I+v)*.5,U=(P+E)*.5,tt=(v+u)*.5,V=(F+U)*.5,Q=(q+tt)*.5,D=f+1;m.push(V,Q,U,tt,E,u,h,y,D),m.push(A,R,B,I,F,q,V,Q,D)}}function Oa(n,t,e,s,a,r,i,o){return[(3*(e+a)-n-i)*.25,(3*(s+r)-t-o)*.25]}function Ga(n,t,e,s,a,r,i,o,l,c){const p=[.25,.5,.75];let m=0;for(const g of p){const f=Ua(n,t,e,s,a,r,i,o,g),y=Xa(n,t,l,c,i,o,g),h=f[0]-y[0],x=f[1]-y[1],T=h*h+x*x;T>m&&(m=T)}return m}function Ua(n,t,e,s,a,r,i,o,l){const c=1-l,p=c*c,m=p*c,g=l*l,f=g*l,y=m*n+3*p*l*e+3*c*g*a+f*i,h=m*t+3*p*l*s+3*c*g*r+f*o;return[y,h]}function Xa(n,t,e,s,a,r,i){const o=1-i,l=o*o,c=i*i,p=l*n+2*o*i*e+c*a,m=l*t+2*o*i*s+c*r;return[p,m]}function za(n,t,e){let s=n.matrix;return s=It(s,n.textMatrix),s=It(s,[1,0,0,1,n.textX,n.textY+n.textRise]),s=It(s,[n.textHScale*n.fontDirection,0,0,n.fontDirection>0?-1:1,0,0]),s=It(s,[1,0,0,1,t,e]),s=It(s,[n.fontSize,0,0,-n.fontSize,0,0]),s}function jt(n,t){if(!n&&!t)return null;if(!n&&t)return{...t};if(n&&!t)return{...n};const e=n,s=t;return{minX:Math.min(e.minX,s.minX),minY:Math.min(e.minY,s.minY),maxX:Math.max(e.maxX,s.maxX),maxY:Math.max(e.maxY,s.maxY)}}function Un(n,t){return!(n.maxX<t.minX||n.minX>t.maxX||n.maxY<t.minY||n.minY>t.maxY)}function Na(n,t,e,s,a){const r=n*s-t*e;return r*r/a}function yt(n,t){return Math.round(n*t)}function It(n,t){return[n[0]*t[0]+n[2]*t[1],n[1]*t[0]+n[3]*t[1],n[0]*t[2]+n[2]*t[3],n[1]*t[2]+n[3]*t[3],n[0]*t[4]+n[2]*t[5]+n[4],n[1]*t[4]+n[3]*t[5]+n[5]]}function Va(n){const t=n[0],e=n[1],s=n[2],a=n[3],r=n[4],i=n[5],o=t*a-e*s;if(!Number.isFinite(o)||Math.abs(o)<=1e-12)return null;const l=1/o;return[a*l,-e*l,-s*l,t*l,(s*i-a*r)*l,(e*r-t*i)*l]}function Ya(n){const t=Math.hypot(n[0],n[1]),e=Math.hypot(n[2],n[3]),s=(t+e)*.5;return Number.isFinite(s)&&s>0?s:1}function ht(n,t,e){return[n[0]*t+n[2]*e+n[4],n[1]*t+n[3]*e+n[5]]}function dt(n){return n<=0?0:n>=1?1:n}function Ze(n,t,e){return n+(t-n)*e}function Ls(n){let t=null,e=!1,s=0,a=0;const r=new Set,i=new Map;let o=null,l=!1,c=0,p=0,m=0;function g(){e=!1,s=0,a=0,r.clear(),i.clear(),o=null,l=!1,c=0,p=0,m=0}function f(){i.clear(),o=null,l=!1,c=0,p=0,m=0}function y(P){e&&n().endPanInteraction(),f(),g()}function h(){if(i.size<2)return null;const P=i.values(),v=P.next().value,E=P.next().value;if(!v||!E)return null;const u=E.x-v.x,F=E.y-v.y;return{distance:Math.hypot(u,F),centerX:(v.x+E.x)*.5,centerY:(v.y+E.y)*.5}}function x(P,v){if(P.hasPointerCapture(v))try{P.releasePointerCapture(v)}catch{}}function T(P){if(!i.has(P.pointerId)||!e)return;i.set(P.pointerId,{x:P.clientX,y:P.clientY});const v=n();if(i.size>=2){const F=h();if(!F)return;if(!l){l=!0,o=null,c=Math.max(F.distance,.001),p=F.centerX,m=F.centerY;return}const q=Math.max(c,.001),U=Math.max(F.distance,.001),tt=U/q,V=F.centerX-p,Q=F.centerY-m;(V!==0||Q!==0)&&v.panByPixels(V,Q),Number.isFinite(tt)&&Math.abs(tt-1)>1e-4&&v.zoomAtClientPoint(F.centerX,F.centerY,tt),c=U,p=F.centerX,m=F.centerY;return}if(o===null){o=P.pointerId,s=P.clientX,a=P.clientY,l=!1,c=0;return}if(P.pointerId!==o)return;const E=P.clientX-s,u=P.clientY-a;s=P.clientX,a=P.clientY,v.panByPixels(E,u)}function C(P,v){if(i.delete(v.pointerId),r.delete(v.pointerId),x(P,v.pointerId),i.size>=2){const E=h();E&&(l=!0,o=null,c=Math.max(E.distance,.001),p=E.centerX,m=E.centerY);return}if(i.size===1){const E=i.entries().next().value;E?(o=E[0],s=E[1].x,a=E[1].y):o=null,l=!1,c=0,p=0,m=0;return}y()}const w=P=>{const v=t;if(v){if(r.add(P.pointerId),e||(e=!0,n().beginPanInteraction()),P.pointerType==="touch")if(i.set(P.pointerId,{x:P.clientX,y:P.clientY}),i.size===1)o=P.pointerId,l=!1,c=0,p=P.clientX,m=P.clientY,s=P.clientX,a=P.clientY;else{const E=h();E&&(l=!0,o=null,c=Math.max(E.distance,.001),p=E.centerX,m=E.centerY)}else s=P.clientX,a=P.clientY;v.setPointerCapture(P.pointerId)}},R=P=>{if(P.pointerType==="touch"){T(P);return}if(!e)return;const v=P.clientX-s,E=P.clientY-a;s=P.clientX,a=P.clientY,n().panByPixels(v,E)},A=P=>{const v=t;if(v){if(P.pointerType==="touch"){C(v,P);return}r.delete(P.pointerId),y(),x(v,P.pointerId)}},S=P=>{const v=t;if(v){if(P.pointerType==="touch"){C(v,P);return}r.delete(P.pointerId),y(),x(v,P.pointerId)}},k=P=>{if(r.delete(P.pointerId),P.pointerType==="touch"){i.has(P.pointerId)&&i.delete(P.pointerId),i.size===0&&y();return}e&&y()},G=P=>{P.preventDefault();const v=Math.exp(-P.deltaY*.0013);n().zoomAtClientPoint(P.clientX,P.clientY,v)};function B(P){t!==P&&(t&&I(),t=P,P.addEventListener("pointerdown",w),P.addEventListener("pointermove",R),P.addEventListener("pointerup",A),P.addEventListener("pointercancel",S),P.addEventListener("lostpointercapture",k),P.addEventListener("wheel",G,{passive:!1}))}function I(){const P=t;if(P){for(const v of r)x(P,v);P.removeEventListener("pointerdown",w),P.removeEventListener("pointermove",R),P.removeEventListener("pointerup",A),P.removeEventListener("pointercancel",S),P.removeEventListener("lostpointercapture",k),P.removeEventListener("wheel",G),t=null,y()}}return{attach:B,detach:I,resetState:g}}var ve=typeof globalThis<"u"?globalThis:typeof window<"u"?window:typeof global<"u"?global:typeof self<"u"?self:{};function Wa(n){return n&&n.__esModule&&Object.prototype.hasOwnProperty.call(n,"default")?n.default:n}function Ce(n){throw new Error('Could not dynamically require "'+n+'". Please configure the dynamicRequireTargets or/and ignoreDynamicRequires option of @rollup/plugin-commonjs appropriately for this require call to work.')}var Ve={exports:{}};var Xn;function Ha(){return Xn||(Xn=1,(function(n,t){(function(e){n.exports=e()})(function(){return(function e(s,a,r){function i(c,p){if(!a[c]){if(!s[c]){var m=typeof Ce=="function"&&Ce;if(!p&&m)return m(c,!0);if(o)return o(c,!0);var g=new Error("Cannot find module '"+c+"'");throw g.code="MODULE_NOT_FOUND",g}var f=a[c]={exports:{}};s[c][0].call(f.exports,function(y){var h=s[c][1][y];return i(h||y)},f,f.exports,e,s,a,r)}return a[c].exports}for(var o=typeof Ce=="function"&&Ce,l=0;l<r.length;l++)i(r[l]);return i})({1:[function(e,s,a){var r=e("./utils"),i=e("./support"),o="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";a.encode=function(l){for(var c,p,m,g,f,y,h,x=[],T=0,C=l.length,w=C,R=r.getTypeOf(l)!=="string";T<l.length;)w=C-T,m=R?(c=l[T++],p=T<C?l[T++]:0,T<C?l[T++]:0):(c=l.charCodeAt(T++),p=T<C?l.charCodeAt(T++):0,T<C?l.charCodeAt(T++):0),g=c>>2,f=(3&c)<<4|p>>4,y=1<w?(15&p)<<2|m>>6:64,h=2<w?63&m:64,x.push(o.charAt(g)+o.charAt(f)+o.charAt(y)+o.charAt(h));return x.join("")},a.decode=function(l){var c,p,m,g,f,y,h=0,x=0,T="data:";if(l.substr(0,T.length)===T)throw new Error("Invalid base64 input, it looks like a data url.");var C,w=3*(l=l.replace(/[^A-Za-z0-9+/=]/g,"")).length/4;if(l.charAt(l.length-1)===o.charAt(64)&&w--,l.charAt(l.length-2)===o.charAt(64)&&w--,w%1!=0)throw new Error("Invalid base64 input, bad content length.");for(C=i.uint8array?new Uint8Array(0|w):new Array(0|w);h<l.length;)c=o.indexOf(l.charAt(h++))<<2|(g=o.indexOf(l.charAt(h++)))>>4,p=(15&g)<<4|(f=o.indexOf(l.charAt(h++)))>>2,m=(3&f)<<6|(y=o.indexOf(l.charAt(h++))),C[x++]=c,f!==64&&(C[x++]=p),y!==64&&(C[x++]=m);return C}},{"./support":30,"./utils":32}],2:[function(e,s,a){var r=e("./external"),i=e("./stream/DataWorker"),o=e("./stream/Crc32Probe"),l=e("./stream/DataLengthProbe");function c(p,m,g,f,y){this.compressedSize=p,this.uncompressedSize=m,this.crc32=g,this.compression=f,this.compressedContent=y}c.prototype={getContentWorker:function(){var p=new i(r.Promise.resolve(this.compressedContent)).pipe(this.compression.uncompressWorker()).pipe(new l("data_length")),m=this;return p.on("end",function(){if(this.streamInfo.data_length!==m.uncompressedSize)throw new Error("Bug : uncompressed data size mismatch")}),p},getCompressedWorker:function(){return new i(r.Promise.resolve(this.compressedContent)).withStreamInfo("compressedSize",this.compressedSize).withStreamInfo("uncompressedSize",this.uncompressedSize).withStreamInfo("crc32",this.crc32).withStreamInfo("compression",this.compression)}},c.createWorkerFrom=function(p,m,g){return p.pipe(new o).pipe(new l("uncompressedSize")).pipe(m.compressWorker(g)).pipe(new l("compressedSize")).withStreamInfo("compression",m)},s.exports=c},{"./external":6,"./stream/Crc32Probe":25,"./stream/DataLengthProbe":26,"./stream/DataWorker":27}],3:[function(e,s,a){var r=e("./stream/GenericWorker");a.STORE={magic:"\0\0",compressWorker:function(){return new r("STORE compression")},uncompressWorker:function(){return new r("STORE decompression")}},a.DEFLATE=e("./flate")},{"./flate":7,"./stream/GenericWorker":28}],4:[function(e,s,a){var r=e("./utils"),i=(function(){for(var o,l=[],c=0;c<256;c++){o=c;for(var p=0;p<8;p++)o=1&o?3988292384^o>>>1:o>>>1;l[c]=o}return l})();s.exports=function(o,l){return o!==void 0&&o.length?r.getTypeOf(o)!=="string"?(function(c,p,m,g){var f=i,y=g+m;c^=-1;for(var h=g;h<y;h++)c=c>>>8^f[255&(c^p[h])];return-1^c})(0|l,o,o.length,0):(function(c,p,m,g){var f=i,y=g+m;c^=-1;for(var h=g;h<y;h++)c=c>>>8^f[255&(c^p.charCodeAt(h))];return-1^c})(0|l,o,o.length,0):0}},{"./utils":32}],5:[function(e,s,a){a.base64=!1,a.binary=!1,a.dir=!1,a.createFolders=!0,a.date=null,a.compression=null,a.compressionOptions=null,a.comment=null,a.unixPermissions=null,a.dosPermissions=null},{}],6:[function(e,s,a){var r=null;r=typeof Promise<"u"?Promise:e("lie"),s.exports={Promise:r}},{lie:37}],7:[function(e,s,a){var r=typeof Uint8Array<"u"&&typeof Uint16Array<"u"&&typeof Uint32Array<"u",i=e("pako"),o=e("./utils"),l=e("./stream/GenericWorker"),c=r?"uint8array":"array";function p(m,g){l.call(this,"FlateWorker/"+m),this._pako=null,this._pakoAction=m,this._pakoOptions=g,this.meta={}}a.magic="\b\0",o.inherits(p,l),p.prototype.processChunk=function(m){this.meta=m.meta,this._pako===null&&this._createPako(),this._pako.push(o.transformTo(c,m.data),!1)},p.prototype.flush=function(){l.prototype.flush.call(this),this._pako===null&&this._createPako(),this._pako.push([],!0)},p.prototype.cleanUp=function(){l.prototype.cleanUp.call(this),this._pako=null},p.prototype._createPako=function(){this._pako=new i[this._pakoAction]({raw:!0,level:this._pakoOptions.level||-1});var m=this;this._pako.onData=function(g){m.push({data:g,meta:m.meta})}},a.compressWorker=function(m){return new p("Deflate",m)},a.uncompressWorker=function(){return new p("Inflate",{})}},{"./stream/GenericWorker":28,"./utils":32,pako:38}],8:[function(e,s,a){function r(f,y){var h,x="";for(h=0;h<y;h++)x+=String.fromCharCode(255&f),f>>>=8;return x}function i(f,y,h,x,T,C){var w,R,A=f.file,S=f.compression,k=C!==c.utf8encode,G=o.transformTo("string",C(A.name)),B=o.transformTo("string",c.utf8encode(A.name)),I=A.comment,P=o.transformTo("string",C(I)),v=o.transformTo("string",c.utf8encode(I)),E=B.length!==A.name.length,u=v.length!==I.length,F="",q="",U="",tt=A.dir,V=A.date,Q={crc32:0,compressedSize:0,uncompressedSize:0};y&&!h||(Q.crc32=f.crc32,Q.compressedSize=f.compressedSize,Q.uncompressedSize=f.uncompressedSize);var D=0;y&&(D|=8),k||!E&&!u||(D|=2048);var L=0,et=0;tt&&(L|=16),T==="UNIX"?(et=798,L|=(function(K,ot){var lt=K;return K||(lt=ot?16893:33204),(65535&lt)<<16})(A.unixPermissions,tt)):(et=20,L|=(function(K){return 63&(K||0)})(A.dosPermissions)),w=V.getUTCHours(),w<<=6,w|=V.getUTCMinutes(),w<<=5,w|=V.getUTCSeconds()/2,R=V.getUTCFullYear()-1980,R<<=4,R|=V.getUTCMonth()+1,R<<=5,R|=V.getUTCDate(),E&&(q=r(1,1)+r(p(G),4)+B,F+="up"+r(q.length,2)+q),u&&(U=r(1,1)+r(p(P),4)+v,F+="uc"+r(U.length,2)+U);var J="";return J+=`
\0`,J+=r(D,2),J+=S.magic,J+=r(w,2),J+=r(R,2),J+=r(Q.crc32,4),J+=r(Q.compressedSize,4),J+=r(Q.uncompressedSize,4),J+=r(G.length,2),J+=r(F.length,2),{fileRecord:m.LOCAL_FILE_HEADER+J+G+F,dirRecord:m.CENTRAL_FILE_HEADER+r(et,2)+J+r(P.length,2)+"\0\0\0\0"+r(L,4)+r(x,4)+G+F+P}}var o=e("../utils"),l=e("../stream/GenericWorker"),c=e("../utf8"),p=e("../crc32"),m=e("../signature");function g(f,y,h,x){l.call(this,"ZipFileWorker"),this.bytesWritten=0,this.zipComment=y,this.zipPlatform=h,this.encodeFileName=x,this.streamFiles=f,this.accumulate=!1,this.contentBuffer=[],this.dirRecords=[],this.currentSourceOffset=0,this.entriesCount=0,this.currentFile=null,this._sources=[]}o.inherits(g,l),g.prototype.push=function(f){var y=f.meta.percent||0,h=this.entriesCount,x=this._sources.length;this.accumulate?this.contentBuffer.push(f):(this.bytesWritten+=f.data.length,l.prototype.push.call(this,{data:f.data,meta:{currentFile:this.currentFile,percent:h?(y+100*(h-x-1))/h:100}}))},g.prototype.openedSource=function(f){this.currentSourceOffset=this.bytesWritten,this.currentFile=f.file.name;var y=this.streamFiles&&!f.file.dir;if(y){var h=i(f,y,!1,this.currentSourceOffset,this.zipPlatform,this.encodeFileName);this.push({data:h.fileRecord,meta:{percent:0}})}else this.accumulate=!0},g.prototype.closedSource=function(f){this.accumulate=!1;var y=this.streamFiles&&!f.file.dir,h=i(f,y,!0,this.currentSourceOffset,this.zipPlatform,this.encodeFileName);if(this.dirRecords.push(h.dirRecord),y)this.push({data:(function(x){return m.DATA_DESCRIPTOR+r(x.crc32,4)+r(x.compressedSize,4)+r(x.uncompressedSize,4)})(f),meta:{percent:100}});else for(this.push({data:h.fileRecord,meta:{percent:0}});this.contentBuffer.length;)this.push(this.contentBuffer.shift());this.currentFile=null},g.prototype.flush=function(){for(var f=this.bytesWritten,y=0;y<this.dirRecords.length;y++)this.push({data:this.dirRecords[y],meta:{percent:100}});var h=this.bytesWritten-f,x=(function(T,C,w,R,A){var S=o.transformTo("string",A(R));return m.CENTRAL_DIRECTORY_END+"\0\0\0\0"+r(T,2)+r(T,2)+r(C,4)+r(w,4)+r(S.length,2)+S})(this.dirRecords.length,h,f,this.zipComment,this.encodeFileName);this.push({data:x,meta:{percent:100}})},g.prototype.prepareNextSource=function(){this.previous=this._sources.shift(),this.openedSource(this.previous.streamInfo),this.isPaused?this.previous.pause():this.previous.resume()},g.prototype.registerPrevious=function(f){this._sources.push(f);var y=this;return f.on("data",function(h){y.processChunk(h)}),f.on("end",function(){y.closedSource(y.previous.streamInfo),y._sources.length?y.prepareNextSource():y.end()}),f.on("error",function(h){y.error(h)}),this},g.prototype.resume=function(){return!!l.prototype.resume.call(this)&&(!this.previous&&this._sources.length?(this.prepareNextSource(),!0):this.previous||this._sources.length||this.generatedError?void 0:(this.end(),!0))},g.prototype.error=function(f){var y=this._sources;if(!l.prototype.error.call(this,f))return!1;for(var h=0;h<y.length;h++)try{y[h].error(f)}catch{}return!0},g.prototype.lock=function(){l.prototype.lock.call(this);for(var f=this._sources,y=0;y<f.length;y++)f[y].lock()},s.exports=g},{"../crc32":4,"../signature":23,"../stream/GenericWorker":28,"../utf8":31,"../utils":32}],9:[function(e,s,a){var r=e("../compressions"),i=e("./ZipFileWorker");a.generateWorker=function(o,l,c){var p=new i(l.streamFiles,c,l.platform,l.encodeFileName),m=0;try{o.forEach(function(g,f){m++;var y=(function(C,w){var R=C||w,A=r[R];if(!A)throw new Error(R+" is not a valid compression method !");return A})(f.options.compression,l.compression),h=f.options.compressionOptions||l.compressionOptions||{},x=f.dir,T=f.date;f._compressWorker(y,h).withStreamInfo("file",{name:g,dir:x,date:T,comment:f.comment||"",unixPermissions:f.unixPermissions,dosPermissions:f.dosPermissions}).pipe(p)}),p.entriesCount=m}catch(g){p.error(g)}return p}},{"../compressions":3,"./ZipFileWorker":8}],10:[function(e,s,a){function r(){if(!(this instanceof r))return new r;if(arguments.length)throw new Error("The constructor with parameters has been removed in JSZip 3.0, please check the upgrade guide.");this.files=Object.create(null),this.comment=null,this.root="",this.clone=function(){var i=new r;for(var o in this)typeof this[o]!="function"&&(i[o]=this[o]);return i}}(r.prototype=e("./object")).loadAsync=e("./load"),r.support=e("./support"),r.defaults=e("./defaults"),r.version="3.10.1",r.loadAsync=function(i,o){return new r().loadAsync(i,o)},r.external=e("./external"),s.exports=r},{"./defaults":5,"./external":6,"./load":11,"./object":15,"./support":30}],11:[function(e,s,a){var r=e("./utils"),i=e("./external"),o=e("./utf8"),l=e("./zipEntries"),c=e("./stream/Crc32Probe"),p=e("./nodejsUtils");function m(g){return new i.Promise(function(f,y){var h=g.decompressed.getContentWorker().pipe(new c);h.on("error",function(x){y(x)}).on("end",function(){h.streamInfo.crc32!==g.decompressed.crc32?y(new Error("Corrupted zip : CRC32 mismatch")):f()}).resume()})}s.exports=function(g,f){var y=this;return f=r.extend(f||{},{base64:!1,checkCRC32:!1,optimizedBinaryString:!1,createFolders:!1,decodeFileName:o.utf8decode}),p.isNode&&p.isStream(g)?i.Promise.reject(new Error("JSZip can't accept a stream when loading a zip file.")):r.prepareContent("the loaded zip file",g,!0,f.optimizedBinaryString,f.base64).then(function(h){var x=new l(f);return x.load(h),x}).then(function(h){var x=[i.Promise.resolve(h)],T=h.files;if(f.checkCRC32)for(var C=0;C<T.length;C++)x.push(m(T[C]));return i.Promise.all(x)}).then(function(h){for(var x=h.shift(),T=x.files,C=0;C<T.length;C++){var w=T[C],R=w.fileNameStr,A=r.resolve(w.fileNameStr);y.file(A,w.decompressed,{binary:!0,optimizedBinaryString:!0,date:w.date,dir:w.dir,comment:w.fileCommentStr.length?w.fileCommentStr:null,unixPermissions:w.unixPermissions,dosPermissions:w.dosPermissions,createFolders:f.createFolders}),w.dir||(y.file(A).unsafeOriginalName=R)}return x.zipComment.length&&(y.comment=x.zipComment),y})}},{"./external":6,"./nodejsUtils":14,"./stream/Crc32Probe":25,"./utf8":31,"./utils":32,"./zipEntries":33}],12:[function(e,s,a){var r=e("../utils"),i=e("../stream/GenericWorker");function o(l,c){i.call(this,"Nodejs stream input adapter for "+l),this._upstreamEnded=!1,this._bindStream(c)}r.inherits(o,i),o.prototype._bindStream=function(l){var c=this;(this._stream=l).pause(),l.on("data",function(p){c.push({data:p,meta:{percent:0}})}).on("error",function(p){c.isPaused?this.generatedError=p:c.error(p)}).on("end",function(){c.isPaused?c._upstreamEnded=!0:c.end()})},o.prototype.pause=function(){return!!i.prototype.pause.call(this)&&(this._stream.pause(),!0)},o.prototype.resume=function(){return!!i.prototype.resume.call(this)&&(this._upstreamEnded?this.end():this._stream.resume(),!0)},s.exports=o},{"../stream/GenericWorker":28,"../utils":32}],13:[function(e,s,a){var r=e("readable-stream").Readable;function i(o,l,c){r.call(this,l),this._helper=o;var p=this;o.on("data",function(m,g){p.push(m)||p._helper.pause(),c&&c(g)}).on("error",function(m){p.emit("error",m)}).on("end",function(){p.push(null)})}e("../utils").inherits(i,r),i.prototype._read=function(){this._helper.resume()},s.exports=i},{"../utils":32,"readable-stream":16}],14:[function(e,s,a){s.exports={isNode:typeof Buffer<"u",newBufferFrom:function(r,i){if(Buffer.from&&Buffer.from!==Uint8Array.from)return Buffer.from(r,i);if(typeof r=="number")throw new Error('The "data" argument must not be a number');return new Buffer(r,i)},allocBuffer:function(r){if(Buffer.alloc)return Buffer.alloc(r);var i=new Buffer(r);return i.fill(0),i},isBuffer:function(r){return Buffer.isBuffer(r)},isStream:function(r){return r&&typeof r.on=="function"&&typeof r.pause=="function"&&typeof r.resume=="function"}}},{}],15:[function(e,s,a){function r(A,S,k){var G,B=o.getTypeOf(S),I=o.extend(k||{},p);I.date=I.date||new Date,I.compression!==null&&(I.compression=I.compression.toUpperCase()),typeof I.unixPermissions=="string"&&(I.unixPermissions=parseInt(I.unixPermissions,8)),I.unixPermissions&&16384&I.unixPermissions&&(I.dir=!0),I.dosPermissions&&16&I.dosPermissions&&(I.dir=!0),I.dir&&(A=T(A)),I.createFolders&&(G=x(A))&&C.call(this,G,!0);var P=B==="string"&&I.binary===!1&&I.base64===!1;k&&k.binary!==void 0||(I.binary=!P),(S instanceof m&&S.uncompressedSize===0||I.dir||!S||S.length===0)&&(I.base64=!1,I.binary=!0,S="",I.compression="STORE",B="string");var v=null;v=S instanceof m||S instanceof l?S:y.isNode&&y.isStream(S)?new h(A,S):o.prepareContent(A,S,I.binary,I.optimizedBinaryString,I.base64);var E=new g(A,v,I);this.files[A]=E}var i=e("./utf8"),o=e("./utils"),l=e("./stream/GenericWorker"),c=e("./stream/StreamHelper"),p=e("./defaults"),m=e("./compressedObject"),g=e("./zipObject"),f=e("./generate"),y=e("./nodejsUtils"),h=e("./nodejs/NodejsStreamInputAdapter"),x=function(A){A.slice(-1)==="/"&&(A=A.substring(0,A.length-1));var S=A.lastIndexOf("/");return 0<S?A.substring(0,S):""},T=function(A){return A.slice(-1)!=="/"&&(A+="/"),A},C=function(A,S){return S=S!==void 0?S:p.createFolders,A=T(A),this.files[A]||r.call(this,A,null,{dir:!0,createFolders:S}),this.files[A]};function w(A){return Object.prototype.toString.call(A)==="[object RegExp]"}var R={load:function(){throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.")},forEach:function(A){var S,k,G;for(S in this.files)G=this.files[S],(k=S.slice(this.root.length,S.length))&&S.slice(0,this.root.length)===this.root&&A(k,G)},filter:function(A){var S=[];return this.forEach(function(k,G){A(k,G)&&S.push(G)}),S},file:function(A,S,k){if(arguments.length!==1)return A=this.root+A,r.call(this,A,S,k),this;if(w(A)){var G=A;return this.filter(function(I,P){return!P.dir&&G.test(I)})}var B=this.files[this.root+A];return B&&!B.dir?B:null},folder:function(A){if(!A)return this;if(w(A))return this.filter(function(B,I){return I.dir&&A.test(B)});var S=this.root+A,k=C.call(this,S),G=this.clone();return G.root=k.name,G},remove:function(A){A=this.root+A;var S=this.files[A];if(S||(A.slice(-1)!=="/"&&(A+="/"),S=this.files[A]),S&&!S.dir)delete this.files[A];else for(var k=this.filter(function(B,I){return I.name.slice(0,A.length)===A}),G=0;G<k.length;G++)delete this.files[k[G].name];return this},generate:function(){throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.")},generateInternalStream:function(A){var S,k={};try{if((k=o.extend(A||{},{streamFiles:!1,compression:"STORE",compressionOptions:null,type:"",platform:"DOS",comment:null,mimeType:"application/zip",encodeFileName:i.utf8encode})).type=k.type.toLowerCase(),k.compression=k.compression.toUpperCase(),k.type==="binarystring"&&(k.type="string"),!k.type)throw new Error("No output type specified.");o.checkSupport(k.type),k.platform!=="darwin"&&k.platform!=="freebsd"&&k.platform!=="linux"&&k.platform!=="sunos"||(k.platform="UNIX"),k.platform==="win32"&&(k.platform="DOS");var G=k.comment||this.comment||"";S=f.generateWorker(this,k,G)}catch(B){(S=new l("error")).error(B)}return new c(S,k.type||"string",k.mimeType)},generateAsync:function(A,S){return this.generateInternalStream(A).accumulate(S)},generateNodeStream:function(A,S){return(A=A||{}).type||(A.type="nodebuffer"),this.generateInternalStream(A).toNodejsStream(S)}};s.exports=R},{"./compressedObject":2,"./defaults":5,"./generate":9,"./nodejs/NodejsStreamInputAdapter":12,"./nodejsUtils":14,"./stream/GenericWorker":28,"./stream/StreamHelper":29,"./utf8":31,"./utils":32,"./zipObject":35}],16:[function(e,s,a){s.exports=e("stream")},{stream:void 0}],17:[function(e,s,a){var r=e("./DataReader");function i(o){r.call(this,o);for(var l=0;l<this.data.length;l++)o[l]=255&o[l]}e("../utils").inherits(i,r),i.prototype.byteAt=function(o){return this.data[this.zero+o]},i.prototype.lastIndexOfSignature=function(o){for(var l=o.charCodeAt(0),c=o.charCodeAt(1),p=o.charCodeAt(2),m=o.charCodeAt(3),g=this.length-4;0<=g;--g)if(this.data[g]===l&&this.data[g+1]===c&&this.data[g+2]===p&&this.data[g+3]===m)return g-this.zero;return-1},i.prototype.readAndCheckSignature=function(o){var l=o.charCodeAt(0),c=o.charCodeAt(1),p=o.charCodeAt(2),m=o.charCodeAt(3),g=this.readData(4);return l===g[0]&&c===g[1]&&p===g[2]&&m===g[3]},i.prototype.readData=function(o){if(this.checkOffset(o),o===0)return[];var l=this.data.slice(this.zero+this.index,this.zero+this.index+o);return this.index+=o,l},s.exports=i},{"../utils":32,"./DataReader":18}],18:[function(e,s,a){var r=e("../utils");function i(o){this.data=o,this.length=o.length,this.index=0,this.zero=0}i.prototype={checkOffset:function(o){this.checkIndex(this.index+o)},checkIndex:function(o){if(this.length<this.zero+o||o<0)throw new Error("End of data reached (data length = "+this.length+", asked index = "+o+"). Corrupted zip ?")},setIndex:function(o){this.checkIndex(o),this.index=o},skip:function(o){this.setIndex(this.index+o)},byteAt:function(){},readInt:function(o){var l,c=0;for(this.checkOffset(o),l=this.index+o-1;l>=this.index;l--)c=(c<<8)+this.byteAt(l);return this.index+=o,c},readString:function(o){return r.transformTo("string",this.readData(o))},readData:function(){},lastIndexOfSignature:function(){},readAndCheckSignature:function(){},readDate:function(){var o=this.readInt(4);return new Date(Date.UTC(1980+(o>>25&127),(o>>21&15)-1,o>>16&31,o>>11&31,o>>5&63,(31&o)<<1))}},s.exports=i},{"../utils":32}],19:[function(e,s,a){var r=e("./Uint8ArrayReader");function i(o){r.call(this,o)}e("../utils").inherits(i,r),i.prototype.readData=function(o){this.checkOffset(o);var l=this.data.slice(this.zero+this.index,this.zero+this.index+o);return this.index+=o,l},s.exports=i},{"../utils":32,"./Uint8ArrayReader":21}],20:[function(e,s,a){var r=e("./DataReader");function i(o){r.call(this,o)}e("../utils").inherits(i,r),i.prototype.byteAt=function(o){return this.data.charCodeAt(this.zero+o)},i.prototype.lastIndexOfSignature=function(o){return this.data.lastIndexOf(o)-this.zero},i.prototype.readAndCheckSignature=function(o){return o===this.readData(4)},i.prototype.readData=function(o){this.checkOffset(o);var l=this.data.slice(this.zero+this.index,this.zero+this.index+o);return this.index+=o,l},s.exports=i},{"../utils":32,"./DataReader":18}],21:[function(e,s,a){var r=e("./ArrayReader");function i(o){r.call(this,o)}e("../utils").inherits(i,r),i.prototype.readData=function(o){if(this.checkOffset(o),o===0)return new Uint8Array(0);var l=this.data.subarray(this.zero+this.index,this.zero+this.index+o);return this.index+=o,l},s.exports=i},{"../utils":32,"./ArrayReader":17}],22:[function(e,s,a){var r=e("../utils"),i=e("../support"),o=e("./ArrayReader"),l=e("./StringReader"),c=e("./NodeBufferReader"),p=e("./Uint8ArrayReader");s.exports=function(m){var g=r.getTypeOf(m);return r.checkSupport(g),g!=="string"||i.uint8array?g==="nodebuffer"?new c(m):i.uint8array?new p(r.transformTo("uint8array",m)):new o(r.transformTo("array",m)):new l(m)}},{"../support":30,"../utils":32,"./ArrayReader":17,"./NodeBufferReader":19,"./StringReader":20,"./Uint8ArrayReader":21}],23:[function(e,s,a){a.LOCAL_FILE_HEADER="PK",a.CENTRAL_FILE_HEADER="PK",a.CENTRAL_DIRECTORY_END="PK",a.ZIP64_CENTRAL_DIRECTORY_LOCATOR="PK\x07",a.ZIP64_CENTRAL_DIRECTORY_END="PK",a.DATA_DESCRIPTOR="PK\x07\b"},{}],24:[function(e,s,a){var r=e("./GenericWorker"),i=e("../utils");function o(l){r.call(this,"ConvertWorker to "+l),this.destType=l}i.inherits(o,r),o.prototype.processChunk=function(l){this.push({data:i.transformTo(this.destType,l.data),meta:l.meta})},s.exports=o},{"../utils":32,"./GenericWorker":28}],25:[function(e,s,a){var r=e("./GenericWorker"),i=e("../crc32");function o(){r.call(this,"Crc32Probe"),this.withStreamInfo("crc32",0)}e("../utils").inherits(o,r),o.prototype.processChunk=function(l){this.streamInfo.crc32=i(l.data,this.streamInfo.crc32||0),this.push(l)},s.exports=o},{"../crc32":4,"../utils":32,"./GenericWorker":28}],26:[function(e,s,a){var r=e("../utils"),i=e("./GenericWorker");function o(l){i.call(this,"DataLengthProbe for "+l),this.propName=l,this.withStreamInfo(l,0)}r.inherits(o,i),o.prototype.processChunk=function(l){if(l){var c=this.streamInfo[this.propName]||0;this.streamInfo[this.propName]=c+l.data.length}i.prototype.processChunk.call(this,l)},s.exports=o},{"../utils":32,"./GenericWorker":28}],27:[function(e,s,a){var r=e("../utils"),i=e("./GenericWorker");function o(l){i.call(this,"DataWorker");var c=this;this.dataIsReady=!1,this.index=0,this.max=0,this.data=null,this.type="",this._tickScheduled=!1,l.then(function(p){c.dataIsReady=!0,c.data=p,c.max=p&&p.length||0,c.type=r.getTypeOf(p),c.isPaused||c._tickAndRepeat()},function(p){c.error(p)})}r.inherits(o,i),o.prototype.cleanUp=function(){i.prototype.cleanUp.call(this),this.data=null},o.prototype.resume=function(){return!!i.prototype.resume.call(this)&&(!this._tickScheduled&&this.dataIsReady&&(this._tickScheduled=!0,r.delay(this._tickAndRepeat,[],this)),!0)},o.prototype._tickAndRepeat=function(){this._tickScheduled=!1,this.isPaused||this.isFinished||(this._tick(),this.isFinished||(r.delay(this._tickAndRepeat,[],this),this._tickScheduled=!0))},o.prototype._tick=function(){if(this.isPaused||this.isFinished)return!1;var l=null,c=Math.min(this.max,this.index+16384);if(this.index>=this.max)return this.end();switch(this.type){case"string":l=this.data.substring(this.index,c);break;case"uint8array":l=this.data.subarray(this.index,c);break;case"array":case"nodebuffer":l=this.data.slice(this.index,c)}return this.index=c,this.push({data:l,meta:{percent:this.max?this.index/this.max*100:0}})},s.exports=o},{"../utils":32,"./GenericWorker":28}],28:[function(e,s,a){function r(i){this.name=i||"default",this.streamInfo={},this.generatedError=null,this.extraStreamInfo={},this.isPaused=!0,this.isFinished=!1,this.isLocked=!1,this._listeners={data:[],end:[],error:[]},this.previous=null}r.prototype={push:function(i){this.emit("data",i)},end:function(){if(this.isFinished)return!1;this.flush();try{this.emit("end"),this.cleanUp(),this.isFinished=!0}catch(i){this.emit("error",i)}return!0},error:function(i){return!this.isFinished&&(this.isPaused?this.generatedError=i:(this.isFinished=!0,this.emit("error",i),this.previous&&this.previous.error(i),this.cleanUp()),!0)},on:function(i,o){return this._listeners[i].push(o),this},cleanUp:function(){this.streamInfo=this.generatedError=this.extraStreamInfo=null,this._listeners=[]},emit:function(i,o){if(this._listeners[i])for(var l=0;l<this._listeners[i].length;l++)this._listeners[i][l].call(this,o)},pipe:function(i){return i.registerPrevious(this)},registerPrevious:function(i){if(this.isLocked)throw new Error("The stream '"+this+"' has already been used.");this.streamInfo=i.streamInfo,this.mergeStreamInfo(),this.previous=i;var o=this;return i.on("data",function(l){o.processChunk(l)}),i.on("end",function(){o.end()}),i.on("error",function(l){o.error(l)}),this},pause:function(){return!this.isPaused&&!this.isFinished&&(this.isPaused=!0,this.previous&&this.previous.pause(),!0)},resume:function(){if(!this.isPaused||this.isFinished)return!1;var i=this.isPaused=!1;return this.generatedError&&(this.error(this.generatedError),i=!0),this.previous&&this.previous.resume(),!i},flush:function(){},processChunk:function(i){this.push(i)},withStreamInfo:function(i,o){return this.extraStreamInfo[i]=o,this.mergeStreamInfo(),this},mergeStreamInfo:function(){for(var i in this.extraStreamInfo)Object.prototype.hasOwnProperty.call(this.extraStreamInfo,i)&&(this.streamInfo[i]=this.extraStreamInfo[i])},lock:function(){if(this.isLocked)throw new Error("The stream '"+this+"' has already been used.");this.isLocked=!0,this.previous&&this.previous.lock()},toString:function(){var i="Worker "+this.name;return this.previous?this.previous+" -> "+i:i}},s.exports=r},{}],29:[function(e,s,a){var r=e("../utils"),i=e("./ConvertWorker"),o=e("./GenericWorker"),l=e("../base64"),c=e("../support"),p=e("../external"),m=null;if(c.nodestream)try{m=e("../nodejs/NodejsStreamOutputAdapter")}catch{}function g(y,h){return new p.Promise(function(x,T){var C=[],w=y._internalType,R=y._outputType,A=y._mimeType;y.on("data",function(S,k){C.push(S),h&&h(k)}).on("error",function(S){C=[],T(S)}).on("end",function(){try{var S=(function(k,G,B){switch(k){case"blob":return r.newBlob(r.transformTo("arraybuffer",G),B);case"base64":return l.encode(G);default:return r.transformTo(k,G)}})(R,(function(k,G){var B,I=0,P=null,v=0;for(B=0;B<G.length;B++)v+=G[B].length;switch(k){case"string":return G.join("");case"array":return Array.prototype.concat.apply([],G);case"uint8array":for(P=new Uint8Array(v),B=0;B<G.length;B++)P.set(G[B],I),I+=G[B].length;return P;case"nodebuffer":return Buffer.concat(G);default:throw new Error("concat : unsupported type '"+k+"'")}})(w,C),A);x(S)}catch(k){T(k)}C=[]}).resume()})}function f(y,h,x){var T=h;switch(h){case"blob":case"arraybuffer":T="uint8array";break;case"base64":T="string"}try{this._internalType=T,this._outputType=h,this._mimeType=x,r.checkSupport(T),this._worker=y.pipe(new i(T)),y.lock()}catch(C){this._worker=new o("error"),this._worker.error(C)}}f.prototype={accumulate:function(y){return g(this,y)},on:function(y,h){var x=this;return y==="data"?this._worker.on(y,function(T){h.call(x,T.data,T.meta)}):this._worker.on(y,function(){r.delay(h,arguments,x)}),this},resume:function(){return r.delay(this._worker.resume,[],this._worker),this},pause:function(){return this._worker.pause(),this},toNodejsStream:function(y){if(r.checkSupport("nodestream"),this._outputType!=="nodebuffer")throw new Error(this._outputType+" is not supported by this method");return new m(this,{objectMode:this._outputType!=="nodebuffer"},y)}},s.exports=f},{"../base64":1,"../external":6,"../nodejs/NodejsStreamOutputAdapter":13,"../support":30,"../utils":32,"./ConvertWorker":24,"./GenericWorker":28}],30:[function(e,s,a){if(a.base64=!0,a.array=!0,a.string=!0,a.arraybuffer=typeof ArrayBuffer<"u"&&typeof Uint8Array<"u",a.nodebuffer=typeof Buffer<"u",a.uint8array=typeof Uint8Array<"u",typeof ArrayBuffer>"u")a.blob=!1;else{var r=new ArrayBuffer(0);try{a.blob=new Blob([r],{type:"application/zip"}).size===0}catch{try{var i=new(self.BlobBuilder||self.WebKitBlobBuilder||self.MozBlobBuilder||self.MSBlobBuilder);i.append(r),a.blob=i.getBlob("application/zip").size===0}catch{a.blob=!1}}}try{a.nodestream=!!e("readable-stream").Readable}catch{a.nodestream=!1}},{"readable-stream":16}],31:[function(e,s,a){for(var r=e("./utils"),i=e("./support"),o=e("./nodejsUtils"),l=e("./stream/GenericWorker"),c=new Array(256),p=0;p<256;p++)c[p]=252<=p?6:248<=p?5:240<=p?4:224<=p?3:192<=p?2:1;c[254]=c[254]=1;function m(){l.call(this,"utf-8 decode"),this.leftOver=null}function g(){l.call(this,"utf-8 encode")}a.utf8encode=function(f){return i.nodebuffer?o.newBufferFrom(f,"utf-8"):(function(y){var h,x,T,C,w,R=y.length,A=0;for(C=0;C<R;C++)(64512&(x=y.charCodeAt(C)))==55296&&C+1<R&&(64512&(T=y.charCodeAt(C+1)))==56320&&(x=65536+(x-55296<<10)+(T-56320),C++),A+=x<128?1:x<2048?2:x<65536?3:4;for(h=i.uint8array?new Uint8Array(A):new Array(A),C=w=0;w<A;C++)(64512&(x=y.charCodeAt(C)))==55296&&C+1<R&&(64512&(T=y.charCodeAt(C+1)))==56320&&(x=65536+(x-55296<<10)+(T-56320),C++),x<128?h[w++]=x:(x<2048?h[w++]=192|x>>>6:(x<65536?h[w++]=224|x>>>12:(h[w++]=240|x>>>18,h[w++]=128|x>>>12&63),h[w++]=128|x>>>6&63),h[w++]=128|63&x);return h})(f)},a.utf8decode=function(f){return i.nodebuffer?r.transformTo("nodebuffer",f).toString("utf-8"):(function(y){var h,x,T,C,w=y.length,R=new Array(2*w);for(h=x=0;h<w;)if((T=y[h++])<128)R[x++]=T;else if(4<(C=c[T]))R[x++]=65533,h+=C-1;else{for(T&=C===2?31:C===3?15:7;1<C&&h<w;)T=T<<6|63&y[h++],C--;1<C?R[x++]=65533:T<65536?R[x++]=T:(T-=65536,R[x++]=55296|T>>10&1023,R[x++]=56320|1023&T)}return R.length!==x&&(R.subarray?R=R.subarray(0,x):R.length=x),r.applyFromCharCode(R)})(f=r.transformTo(i.uint8array?"uint8array":"array",f))},r.inherits(m,l),m.prototype.processChunk=function(f){var y=r.transformTo(i.uint8array?"uint8array":"array",f.data);if(this.leftOver&&this.leftOver.length){if(i.uint8array){var h=y;(y=new Uint8Array(h.length+this.leftOver.length)).set(this.leftOver,0),y.set(h,this.leftOver.length)}else y=this.leftOver.concat(y);this.leftOver=null}var x=(function(C,w){var R;for((w=w||C.length)>C.length&&(w=C.length),R=w-1;0<=R&&(192&C[R])==128;)R--;return R<0||R===0?w:R+c[C[R]]>w?R:w})(y),T=y;x!==y.length&&(i.uint8array?(T=y.subarray(0,x),this.leftOver=y.subarray(x,y.length)):(T=y.slice(0,x),this.leftOver=y.slice(x,y.length))),this.push({data:a.utf8decode(T),meta:f.meta})},m.prototype.flush=function(){this.leftOver&&this.leftOver.length&&(this.push({data:a.utf8decode(this.leftOver),meta:{}}),this.leftOver=null)},a.Utf8DecodeWorker=m,r.inherits(g,l),g.prototype.processChunk=function(f){this.push({data:a.utf8encode(f.data),meta:f.meta})},a.Utf8EncodeWorker=g},{"./nodejsUtils":14,"./stream/GenericWorker":28,"./support":30,"./utils":32}],32:[function(e,s,a){var r=e("./support"),i=e("./base64"),o=e("./nodejsUtils"),l=e("./external");function c(h){return h}function p(h,x){for(var T=0;T<h.length;++T)x[T]=255&h.charCodeAt(T);return x}e("setimmediate"),a.newBlob=function(h,x){a.checkSupport("blob");try{return new Blob([h],{type:x})}catch{try{var T=new(self.BlobBuilder||self.WebKitBlobBuilder||self.MozBlobBuilder||self.MSBlobBuilder);return T.append(h),T.getBlob(x)}catch{throw new Error("Bug : can't construct the Blob.")}}};var m={stringifyByChunk:function(h,x,T){var C=[],w=0,R=h.length;if(R<=T)return String.fromCharCode.apply(null,h);for(;w<R;)x==="array"||x==="nodebuffer"?C.push(String.fromCharCode.apply(null,h.slice(w,Math.min(w+T,R)))):C.push(String.fromCharCode.apply(null,h.subarray(w,Math.min(w+T,R)))),w+=T;return C.join("")},stringifyByChar:function(h){for(var x="",T=0;T<h.length;T++)x+=String.fromCharCode(h[T]);return x},applyCanBeUsed:{uint8array:(function(){try{return r.uint8array&&String.fromCharCode.apply(null,new Uint8Array(1)).length===1}catch{return!1}})(),nodebuffer:(function(){try{return r.nodebuffer&&String.fromCharCode.apply(null,o.allocBuffer(1)).length===1}catch{return!1}})()}};function g(h){var x=65536,T=a.getTypeOf(h),C=!0;if(T==="uint8array"?C=m.applyCanBeUsed.uint8array:T==="nodebuffer"&&(C=m.applyCanBeUsed.nodebuffer),C)for(;1<x;)try{return m.stringifyByChunk(h,T,x)}catch{x=Math.floor(x/2)}return m.stringifyByChar(h)}function f(h,x){for(var T=0;T<h.length;T++)x[T]=h[T];return x}a.applyFromCharCode=g;var y={};y.string={string:c,array:function(h){return p(h,new Array(h.length))},arraybuffer:function(h){return y.string.uint8array(h).buffer},uint8array:function(h){return p(h,new Uint8Array(h.length))},nodebuffer:function(h){return p(h,o.allocBuffer(h.length))}},y.array={string:g,array:c,arraybuffer:function(h){return new Uint8Array(h).buffer},uint8array:function(h){return new Uint8Array(h)},nodebuffer:function(h){return o.newBufferFrom(h)}},y.arraybuffer={string:function(h){return g(new Uint8Array(h))},array:function(h){return f(new Uint8Array(h),new Array(h.byteLength))},arraybuffer:c,uint8array:function(h){return new Uint8Array(h)},nodebuffer:function(h){return o.newBufferFrom(new Uint8Array(h))}},y.uint8array={string:g,array:function(h){return f(h,new Array(h.length))},arraybuffer:function(h){return h.buffer},uint8array:c,nodebuffer:function(h){return o.newBufferFrom(h)}},y.nodebuffer={string:g,array:function(h){return f(h,new Array(h.length))},arraybuffer:function(h){return y.nodebuffer.uint8array(h).buffer},uint8array:function(h){return f(h,new Uint8Array(h.length))},nodebuffer:c},a.transformTo=function(h,x){if(x=x||"",!h)return x;a.checkSupport(h);var T=a.getTypeOf(x);return y[T][h](x)},a.resolve=function(h){for(var x=h.split("/"),T=[],C=0;C<x.length;C++){var w=x[C];w==="."||w===""&&C!==0&&C!==x.length-1||(w===".."?T.pop():T.push(w))}return T.join("/")},a.getTypeOf=function(h){return typeof h=="string"?"string":Object.prototype.toString.call(h)==="[object Array]"?"array":r.nodebuffer&&o.isBuffer(h)?"nodebuffer":r.uint8array&&h instanceof Uint8Array?"uint8array":r.arraybuffer&&h instanceof ArrayBuffer?"arraybuffer":void 0},a.checkSupport=function(h){if(!r[h.toLowerCase()])throw new Error(h+" is not supported by this platform")},a.MAX_VALUE_16BITS=65535,a.MAX_VALUE_32BITS=-1,a.pretty=function(h){var x,T,C="";for(T=0;T<(h||"").length;T++)C+="\\x"+((x=h.charCodeAt(T))<16?"0":"")+x.toString(16).toUpperCase();return C},a.delay=function(h,x,T){setImmediate(function(){h.apply(T||null,x||[])})},a.inherits=function(h,x){function T(){}T.prototype=x.prototype,h.prototype=new T},a.extend=function(){var h,x,T={};for(h=0;h<arguments.length;h++)for(x in arguments[h])Object.prototype.hasOwnProperty.call(arguments[h],x)&&T[x]===void 0&&(T[x]=arguments[h][x]);return T},a.prepareContent=function(h,x,T,C,w){return l.Promise.resolve(x).then(function(R){return r.blob&&(R instanceof Blob||["[object File]","[object Blob]"].indexOf(Object.prototype.toString.call(R))!==-1)&&typeof FileReader<"u"?new l.Promise(function(A,S){var k=new FileReader;k.onload=function(G){A(G.target.result)},k.onerror=function(G){S(G.target.error)},k.readAsArrayBuffer(R)}):R}).then(function(R){var A=a.getTypeOf(R);return A?(A==="arraybuffer"?R=a.transformTo("uint8array",R):A==="string"&&(w?R=i.decode(R):T&&C!==!0&&(R=(function(S){return p(S,r.uint8array?new Uint8Array(S.length):new Array(S.length))})(R))),R):l.Promise.reject(new Error("Can't read the data of '"+h+"'. Is it in a supported JavaScript type (String, Blob, ArrayBuffer, etc) ?"))})}},{"./base64":1,"./external":6,"./nodejsUtils":14,"./support":30,setimmediate:54}],33:[function(e,s,a){var r=e("./reader/readerFor"),i=e("./utils"),o=e("./signature"),l=e("./zipEntry"),c=e("./support");function p(m){this.files=[],this.loadOptions=m}p.prototype={checkSignature:function(m){if(!this.reader.readAndCheckSignature(m)){this.reader.index-=4;var g=this.reader.readString(4);throw new Error("Corrupted zip or bug: unexpected signature ("+i.pretty(g)+", expected "+i.pretty(m)+")")}},isSignature:function(m,g){var f=this.reader.index;this.reader.setIndex(m);var y=this.reader.readString(4)===g;return this.reader.setIndex(f),y},readBlockEndOfCentral:function(){this.diskNumber=this.reader.readInt(2),this.diskWithCentralDirStart=this.reader.readInt(2),this.centralDirRecordsOnThisDisk=this.reader.readInt(2),this.centralDirRecords=this.reader.readInt(2),this.centralDirSize=this.reader.readInt(4),this.centralDirOffset=this.reader.readInt(4),this.zipCommentLength=this.reader.readInt(2);var m=this.reader.readData(this.zipCommentLength),g=c.uint8array?"uint8array":"array",f=i.transformTo(g,m);this.zipComment=this.loadOptions.decodeFileName(f)},readBlockZip64EndOfCentral:function(){this.zip64EndOfCentralSize=this.reader.readInt(8),this.reader.skip(4),this.diskNumber=this.reader.readInt(4),this.diskWithCentralDirStart=this.reader.readInt(4),this.centralDirRecordsOnThisDisk=this.reader.readInt(8),this.centralDirRecords=this.reader.readInt(8),this.centralDirSize=this.reader.readInt(8),this.centralDirOffset=this.reader.readInt(8),this.zip64ExtensibleData={};for(var m,g,f,y=this.zip64EndOfCentralSize-44;0<y;)m=this.reader.readInt(2),g=this.reader.readInt(4),f=this.reader.readData(g),this.zip64ExtensibleData[m]={id:m,length:g,value:f}},readBlockZip64EndOfCentralLocator:function(){if(this.diskWithZip64CentralDirStart=this.reader.readInt(4),this.relativeOffsetEndOfZip64CentralDir=this.reader.readInt(8),this.disksCount=this.reader.readInt(4),1<this.disksCount)throw new Error("Multi-volumes zip are not supported")},readLocalFiles:function(){var m,g;for(m=0;m<this.files.length;m++)g=this.files[m],this.reader.setIndex(g.localHeaderOffset),this.checkSignature(o.LOCAL_FILE_HEADER),g.readLocalPart(this.reader),g.handleUTF8(),g.processAttributes()},readCentralDir:function(){var m;for(this.reader.setIndex(this.centralDirOffset);this.reader.readAndCheckSignature(o.CENTRAL_FILE_HEADER);)(m=new l({zip64:this.zip64},this.loadOptions)).readCentralPart(this.reader),this.files.push(m);if(this.centralDirRecords!==this.files.length&&this.centralDirRecords!==0&&this.files.length===0)throw new Error("Corrupted zip or bug: expected "+this.centralDirRecords+" records in central dir, got "+this.files.length)},readEndOfCentral:function(){var m=this.reader.lastIndexOfSignature(o.CENTRAL_DIRECTORY_END);if(m<0)throw this.isSignature(0,o.LOCAL_FILE_HEADER)?new Error("Corrupted zip: can't find end of central directory"):new Error("Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html");this.reader.setIndex(m);var g=m;if(this.checkSignature(o.CENTRAL_DIRECTORY_END),this.readBlockEndOfCentral(),this.diskNumber===i.MAX_VALUE_16BITS||this.diskWithCentralDirStart===i.MAX_VALUE_16BITS||this.centralDirRecordsOnThisDisk===i.MAX_VALUE_16BITS||this.centralDirRecords===i.MAX_VALUE_16BITS||this.centralDirSize===i.MAX_VALUE_32BITS||this.centralDirOffset===i.MAX_VALUE_32BITS){if(this.zip64=!0,(m=this.reader.lastIndexOfSignature(o.ZIP64_CENTRAL_DIRECTORY_LOCATOR))<0)throw new Error("Corrupted zip: can't find the ZIP64 end of central directory locator");if(this.reader.setIndex(m),this.checkSignature(o.ZIP64_CENTRAL_DIRECTORY_LOCATOR),this.readBlockZip64EndOfCentralLocator(),!this.isSignature(this.relativeOffsetEndOfZip64CentralDir,o.ZIP64_CENTRAL_DIRECTORY_END)&&(this.relativeOffsetEndOfZip64CentralDir=this.reader.lastIndexOfSignature(o.ZIP64_CENTRAL_DIRECTORY_END),this.relativeOffsetEndOfZip64CentralDir<0))throw new Error("Corrupted zip: can't find the ZIP64 end of central directory");this.reader.setIndex(this.relativeOffsetEndOfZip64CentralDir),this.checkSignature(o.ZIP64_CENTRAL_DIRECTORY_END),this.readBlockZip64EndOfCentral()}var f=this.centralDirOffset+this.centralDirSize;this.zip64&&(f+=20,f+=12+this.zip64EndOfCentralSize);var y=g-f;if(0<y)this.isSignature(g,o.CENTRAL_FILE_HEADER)||(this.reader.zero=y);else if(y<0)throw new Error("Corrupted zip: missing "+Math.abs(y)+" bytes.")},prepareReader:function(m){this.reader=r(m)},load:function(m){this.prepareReader(m),this.readEndOfCentral(),this.readCentralDir(),this.readLocalFiles()}},s.exports=p},{"./reader/readerFor":22,"./signature":23,"./support":30,"./utils":32,"./zipEntry":34}],34:[function(e,s,a){var r=e("./reader/readerFor"),i=e("./utils"),o=e("./compressedObject"),l=e("./crc32"),c=e("./utf8"),p=e("./compressions"),m=e("./support");function g(f,y){this.options=f,this.loadOptions=y}g.prototype={isEncrypted:function(){return(1&this.bitFlag)==1},useUTF8:function(){return(2048&this.bitFlag)==2048},readLocalPart:function(f){var y,h;if(f.skip(22),this.fileNameLength=f.readInt(2),h=f.readInt(2),this.fileName=f.readData(this.fileNameLength),f.skip(h),this.compressedSize===-1||this.uncompressedSize===-1)throw new Error("Bug or corrupted zip : didn't get enough information from the central directory (compressedSize === -1 || uncompressedSize === -1)");if((y=(function(x){for(var T in p)if(Object.prototype.hasOwnProperty.call(p,T)&&p[T].magic===x)return p[T];return null})(this.compressionMethod))===null)throw new Error("Corrupted zip : compression "+i.pretty(this.compressionMethod)+" unknown (inner file : "+i.transformTo("string",this.fileName)+")");this.decompressed=new o(this.compressedSize,this.uncompressedSize,this.crc32,y,f.readData(this.compressedSize))},readCentralPart:function(f){this.versionMadeBy=f.readInt(2),f.skip(2),this.bitFlag=f.readInt(2),this.compressionMethod=f.readString(2),this.date=f.readDate(),this.crc32=f.readInt(4),this.compressedSize=f.readInt(4),this.uncompressedSize=f.readInt(4);var y=f.readInt(2);if(this.extraFieldsLength=f.readInt(2),this.fileCommentLength=f.readInt(2),this.diskNumberStart=f.readInt(2),this.internalFileAttributes=f.readInt(2),this.externalFileAttributes=f.readInt(4),this.localHeaderOffset=f.readInt(4),this.isEncrypted())throw new Error("Encrypted zip are not supported");f.skip(y),this.readExtraFields(f),this.parseZIP64ExtraField(f),this.fileComment=f.readData(this.fileCommentLength)},processAttributes:function(){this.unixPermissions=null,this.dosPermissions=null;var f=this.versionMadeBy>>8;this.dir=!!(16&this.externalFileAttributes),f==0&&(this.dosPermissions=63&this.externalFileAttributes),f==3&&(this.unixPermissions=this.externalFileAttributes>>16&65535),this.dir||this.fileNameStr.slice(-1)!=="/"||(this.dir=!0)},parseZIP64ExtraField:function(){if(this.extraFields[1]){var f=r(this.extraFields[1].value);this.uncompressedSize===i.MAX_VALUE_32BITS&&(this.uncompressedSize=f.readInt(8)),this.compressedSize===i.MAX_VALUE_32BITS&&(this.compressedSize=f.readInt(8)),this.localHeaderOffset===i.MAX_VALUE_32BITS&&(this.localHeaderOffset=f.readInt(8)),this.diskNumberStart===i.MAX_VALUE_32BITS&&(this.diskNumberStart=f.readInt(4))}},readExtraFields:function(f){var y,h,x,T=f.index+this.extraFieldsLength;for(this.extraFields||(this.extraFields={});f.index+4<T;)y=f.readInt(2),h=f.readInt(2),x=f.readData(h),this.extraFields[y]={id:y,length:h,value:x};f.setIndex(T)},handleUTF8:function(){var f=m.uint8array?"uint8array":"array";if(this.useUTF8())this.fileNameStr=c.utf8decode(this.fileName),this.fileCommentStr=c.utf8decode(this.fileComment);else{var y=this.findExtraFieldUnicodePath();if(y!==null)this.fileNameStr=y;else{var h=i.transformTo(f,this.fileName);this.fileNameStr=this.loadOptions.decodeFileName(h)}var x=this.findExtraFieldUnicodeComment();if(x!==null)this.fileCommentStr=x;else{var T=i.transformTo(f,this.fileComment);this.fileCommentStr=this.loadOptions.decodeFileName(T)}}},findExtraFieldUnicodePath:function(){var f=this.extraFields[28789];if(f){var y=r(f.value);return y.readInt(1)!==1||l(this.fileName)!==y.readInt(4)?null:c.utf8decode(y.readData(f.length-5))}return null},findExtraFieldUnicodeComment:function(){var f=this.extraFields[25461];if(f){var y=r(f.value);return y.readInt(1)!==1||l(this.fileComment)!==y.readInt(4)?null:c.utf8decode(y.readData(f.length-5))}return null}},s.exports=g},{"./compressedObject":2,"./compressions":3,"./crc32":4,"./reader/readerFor":22,"./support":30,"./utf8":31,"./utils":32}],35:[function(e,s,a){function r(y,h,x){this.name=y,this.dir=x.dir,this.date=x.date,this.comment=x.comment,this.unixPermissions=x.unixPermissions,this.dosPermissions=x.dosPermissions,this._data=h,this._dataBinary=x.binary,this.options={compression:x.compression,compressionOptions:x.compressionOptions}}var i=e("./stream/StreamHelper"),o=e("./stream/DataWorker"),l=e("./utf8"),c=e("./compressedObject"),p=e("./stream/GenericWorker");r.prototype={internalStream:function(y){var h=null,x="string";try{if(!y)throw new Error("No output type specified.");var T=(x=y.toLowerCase())==="string"||x==="text";x!=="binarystring"&&x!=="text"||(x="string"),h=this._decompressWorker();var C=!this._dataBinary;C&&!T&&(h=h.pipe(new l.Utf8EncodeWorker)),!C&&T&&(h=h.pipe(new l.Utf8DecodeWorker))}catch(w){(h=new p("error")).error(w)}return new i(h,x,"")},async:function(y,h){return this.internalStream(y).accumulate(h)},nodeStream:function(y,h){return this.internalStream(y||"nodebuffer").toNodejsStream(h)},_compressWorker:function(y,h){if(this._data instanceof c&&this._data.compression.magic===y.magic)return this._data.getCompressedWorker();var x=this._decompressWorker();return this._dataBinary||(x=x.pipe(new l.Utf8EncodeWorker)),c.createWorkerFrom(x,y,h)},_decompressWorker:function(){return this._data instanceof c?this._data.getContentWorker():this._data instanceof p?this._data:new o(this._data)}};for(var m=["asText","asBinary","asNodeBuffer","asUint8Array","asArrayBuffer"],g=function(){throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.")},f=0;f<m.length;f++)r.prototype[m[f]]=g;s.exports=r},{"./compressedObject":2,"./stream/DataWorker":27,"./stream/GenericWorker":28,"./stream/StreamHelper":29,"./utf8":31}],36:[function(e,s,a){(function(r){var i,o,l=r.MutationObserver||r.WebKitMutationObserver;if(l){var c=0,p=new l(y),m=r.document.createTextNode("");p.observe(m,{characterData:!0}),i=function(){m.data=c=++c%2}}else if(r.setImmediate||r.MessageChannel===void 0)i="document"in r&&"onreadystatechange"in r.document.createElement("script")?function(){var h=r.document.createElement("script");h.onreadystatechange=function(){y(),h.onreadystatechange=null,h.parentNode.removeChild(h),h=null},r.document.documentElement.appendChild(h)}:function(){setTimeout(y,0)};else{var g=new r.MessageChannel;g.port1.onmessage=y,i=function(){g.port2.postMessage(0)}}var f=[];function y(){var h,x;o=!0;for(var T=f.length;T;){for(x=f,f=[],h=-1;++h<T;)x[h]();T=f.length}o=!1}s.exports=function(h){f.push(h)!==1||o||i()}}).call(this,typeof ve<"u"?ve:typeof self<"u"?self:typeof window<"u"?window:{})},{}],37:[function(e,s,a){var r=e("immediate");function i(){}var o={},l=["REJECTED"],c=["FULFILLED"],p=["PENDING"];function m(T){if(typeof T!="function")throw new TypeError("resolver must be a function");this.state=p,this.queue=[],this.outcome=void 0,T!==i&&h(this,T)}function g(T,C,w){this.promise=T,typeof C=="function"&&(this.onFulfilled=C,this.callFulfilled=this.otherCallFulfilled),typeof w=="function"&&(this.onRejected=w,this.callRejected=this.otherCallRejected)}function f(T,C,w){r(function(){var R;try{R=C(w)}catch(A){return o.reject(T,A)}R===T?o.reject(T,new TypeError("Cannot resolve promise with itself")):o.resolve(T,R)})}function y(T){var C=T&&T.then;if(T&&(typeof T=="object"||typeof T=="function")&&typeof C=="function")return function(){C.apply(T,arguments)}}function h(T,C){var w=!1;function R(k){w||(w=!0,o.reject(T,k))}function A(k){w||(w=!0,o.resolve(T,k))}var S=x(function(){C(A,R)});S.status==="error"&&R(S.value)}function x(T,C){var w={};try{w.value=T(C),w.status="success"}catch(R){w.status="error",w.value=R}return w}(s.exports=m).prototype.finally=function(T){if(typeof T!="function")return this;var C=this.constructor;return this.then(function(w){return C.resolve(T()).then(function(){return w})},function(w){return C.resolve(T()).then(function(){throw w})})},m.prototype.catch=function(T){return this.then(null,T)},m.prototype.then=function(T,C){if(typeof T!="function"&&this.state===c||typeof C!="function"&&this.state===l)return this;var w=new this.constructor(i);return this.state!==p?f(w,this.state===c?T:C,this.outcome):this.queue.push(new g(w,T,C)),w},g.prototype.callFulfilled=function(T){o.resolve(this.promise,T)},g.prototype.otherCallFulfilled=function(T){f(this.promise,this.onFulfilled,T)},g.prototype.callRejected=function(T){o.reject(this.promise,T)},g.prototype.otherCallRejected=function(T){f(this.promise,this.onRejected,T)},o.resolve=function(T,C){var w=x(y,C);if(w.status==="error")return o.reject(T,w.value);var R=w.value;if(R)h(T,R);else{T.state=c,T.outcome=C;for(var A=-1,S=T.queue.length;++A<S;)T.queue[A].callFulfilled(C)}return T},o.reject=function(T,C){T.state=l,T.outcome=C;for(var w=-1,R=T.queue.length;++w<R;)T.queue[w].callRejected(C);return T},m.resolve=function(T){return T instanceof this?T:o.resolve(new this(i),T)},m.reject=function(T){var C=new this(i);return o.reject(C,T)},m.all=function(T){var C=this;if(Object.prototype.toString.call(T)!=="[object Array]")return this.reject(new TypeError("must be an array"));var w=T.length,R=!1;if(!w)return this.resolve([]);for(var A=new Array(w),S=0,k=-1,G=new this(i);++k<w;)B(T[k],k);return G;function B(I,P){C.resolve(I).then(function(v){A[P]=v,++S!==w||R||(R=!0,o.resolve(G,A))},function(v){R||(R=!0,o.reject(G,v))})}},m.race=function(T){var C=this;if(Object.prototype.toString.call(T)!=="[object Array]")return this.reject(new TypeError("must be an array"));var w=T.length,R=!1;if(!w)return this.resolve([]);for(var A=-1,S=new this(i);++A<w;)k=T[A],C.resolve(k).then(function(G){R||(R=!0,o.resolve(S,G))},function(G){R||(R=!0,o.reject(S,G))});var k;return S}},{immediate:36}],38:[function(e,s,a){var r={};(0,e("./lib/utils/common").assign)(r,e("./lib/deflate"),e("./lib/inflate"),e("./lib/zlib/constants")),s.exports=r},{"./lib/deflate":39,"./lib/inflate":40,"./lib/utils/common":41,"./lib/zlib/constants":44}],39:[function(e,s,a){var r=e("./zlib/deflate"),i=e("./utils/common"),o=e("./utils/strings"),l=e("./zlib/messages"),c=e("./zlib/zstream"),p=Object.prototype.toString,m=0,g=-1,f=0,y=8;function h(T){if(!(this instanceof h))return new h(T);this.options=i.assign({level:g,method:y,chunkSize:16384,windowBits:15,memLevel:8,strategy:f,to:""},T||{});var C=this.options;C.raw&&0<C.windowBits?C.windowBits=-C.windowBits:C.gzip&&0<C.windowBits&&C.windowBits<16&&(C.windowBits+=16),this.err=0,this.msg="",this.ended=!1,this.chunks=[],this.strm=new c,this.strm.avail_out=0;var w=r.deflateInit2(this.strm,C.level,C.method,C.windowBits,C.memLevel,C.strategy);if(w!==m)throw new Error(l[w]);if(C.header&&r.deflateSetHeader(this.strm,C.header),C.dictionary){var R;if(R=typeof C.dictionary=="string"?o.string2buf(C.dictionary):p.call(C.dictionary)==="[object ArrayBuffer]"?new Uint8Array(C.dictionary):C.dictionary,(w=r.deflateSetDictionary(this.strm,R))!==m)throw new Error(l[w]);this._dict_set=!0}}function x(T,C){var w=new h(C);if(w.push(T,!0),w.err)throw w.msg||l[w.err];return w.result}h.prototype.push=function(T,C){var w,R,A=this.strm,S=this.options.chunkSize;if(this.ended)return!1;R=C===~~C?C:C===!0?4:0,typeof T=="string"?A.input=o.string2buf(T):p.call(T)==="[object ArrayBuffer]"?A.input=new Uint8Array(T):A.input=T,A.next_in=0,A.avail_in=A.input.length;do{if(A.avail_out===0&&(A.output=new i.Buf8(S),A.next_out=0,A.avail_out=S),(w=r.deflate(A,R))!==1&&w!==m)return this.onEnd(w),!(this.ended=!0);A.avail_out!==0&&(A.avail_in!==0||R!==4&&R!==2)||(this.options.to==="string"?this.onData(o.buf2binstring(i.shrinkBuf(A.output,A.next_out))):this.onData(i.shrinkBuf(A.output,A.next_out)))}while((0<A.avail_in||A.avail_out===0)&&w!==1);return R===4?(w=r.deflateEnd(this.strm),this.onEnd(w),this.ended=!0,w===m):R!==2||(this.onEnd(m),!(A.avail_out=0))},h.prototype.onData=function(T){this.chunks.push(T)},h.prototype.onEnd=function(T){T===m&&(this.options.to==="string"?this.result=this.chunks.join(""):this.result=i.flattenChunks(this.chunks)),this.chunks=[],this.err=T,this.msg=this.strm.msg},a.Deflate=h,a.deflate=x,a.deflateRaw=function(T,C){return(C=C||{}).raw=!0,x(T,C)},a.gzip=function(T,C){return(C=C||{}).gzip=!0,x(T,C)}},{"./utils/common":41,"./utils/strings":42,"./zlib/deflate":46,"./zlib/messages":51,"./zlib/zstream":53}],40:[function(e,s,a){var r=e("./zlib/inflate"),i=e("./utils/common"),o=e("./utils/strings"),l=e("./zlib/constants"),c=e("./zlib/messages"),p=e("./zlib/zstream"),m=e("./zlib/gzheader"),g=Object.prototype.toString;function f(h){if(!(this instanceof f))return new f(h);this.options=i.assign({chunkSize:16384,windowBits:0,to:""},h||{});var x=this.options;x.raw&&0<=x.windowBits&&x.windowBits<16&&(x.windowBits=-x.windowBits,x.windowBits===0&&(x.windowBits=-15)),!(0<=x.windowBits&&x.windowBits<16)||h&&h.windowBits||(x.windowBits+=32),15<x.windowBits&&x.windowBits<48&&(15&x.windowBits)==0&&(x.windowBits|=15),this.err=0,this.msg="",this.ended=!1,this.chunks=[],this.strm=new p,this.strm.avail_out=0;var T=r.inflateInit2(this.strm,x.windowBits);if(T!==l.Z_OK)throw new Error(c[T]);this.header=new m,r.inflateGetHeader(this.strm,this.header)}function y(h,x){var T=new f(x);if(T.push(h,!0),T.err)throw T.msg||c[T.err];return T.result}f.prototype.push=function(h,x){var T,C,w,R,A,S,k=this.strm,G=this.options.chunkSize,B=this.options.dictionary,I=!1;if(this.ended)return!1;C=x===~~x?x:x===!0?l.Z_FINISH:l.Z_NO_FLUSH,typeof h=="string"?k.input=o.binstring2buf(h):g.call(h)==="[object ArrayBuffer]"?k.input=new Uint8Array(h):k.input=h,k.next_in=0,k.avail_in=k.input.length;do{if(k.avail_out===0&&(k.output=new i.Buf8(G),k.next_out=0,k.avail_out=G),(T=r.inflate(k,l.Z_NO_FLUSH))===l.Z_NEED_DICT&&B&&(S=typeof B=="string"?o.string2buf(B):g.call(B)==="[object ArrayBuffer]"?new Uint8Array(B):B,T=r.inflateSetDictionary(this.strm,S)),T===l.Z_BUF_ERROR&&I===!0&&(T=l.Z_OK,I=!1),T!==l.Z_STREAM_END&&T!==l.Z_OK)return this.onEnd(T),!(this.ended=!0);k.next_out&&(k.avail_out!==0&&T!==l.Z_STREAM_END&&(k.avail_in!==0||C!==l.Z_FINISH&&C!==l.Z_SYNC_FLUSH)||(this.options.to==="string"?(w=o.utf8border(k.output,k.next_out),R=k.next_out-w,A=o.buf2string(k.output,w),k.next_out=R,k.avail_out=G-R,R&&i.arraySet(k.output,k.output,w,R,0),this.onData(A)):this.onData(i.shrinkBuf(k.output,k.next_out)))),k.avail_in===0&&k.avail_out===0&&(I=!0)}while((0<k.avail_in||k.avail_out===0)&&T!==l.Z_STREAM_END);return T===l.Z_STREAM_END&&(C=l.Z_FINISH),C===l.Z_FINISH?(T=r.inflateEnd(this.strm),this.onEnd(T),this.ended=!0,T===l.Z_OK):C!==l.Z_SYNC_FLUSH||(this.onEnd(l.Z_OK),!(k.avail_out=0))},f.prototype.onData=function(h){this.chunks.push(h)},f.prototype.onEnd=function(h){h===l.Z_OK&&(this.options.to==="string"?this.result=this.chunks.join(""):this.result=i.flattenChunks(this.chunks)),this.chunks=[],this.err=h,this.msg=this.strm.msg},a.Inflate=f,a.inflate=y,a.inflateRaw=function(h,x){return(x=x||{}).raw=!0,y(h,x)},a.ungzip=y},{"./utils/common":41,"./utils/strings":42,"./zlib/constants":44,"./zlib/gzheader":47,"./zlib/inflate":49,"./zlib/messages":51,"./zlib/zstream":53}],41:[function(e,s,a){var r=typeof Uint8Array<"u"&&typeof Uint16Array<"u"&&typeof Int32Array<"u";a.assign=function(l){for(var c=Array.prototype.slice.call(arguments,1);c.length;){var p=c.shift();if(p){if(typeof p!="object")throw new TypeError(p+"must be non-object");for(var m in p)p.hasOwnProperty(m)&&(l[m]=p[m])}}return l},a.shrinkBuf=function(l,c){return l.length===c?l:l.subarray?l.subarray(0,c):(l.length=c,l)};var i={arraySet:function(l,c,p,m,g){if(c.subarray&&l.subarray)l.set(c.subarray(p,p+m),g);else for(var f=0;f<m;f++)l[g+f]=c[p+f]},flattenChunks:function(l){var c,p,m,g,f,y;for(c=m=0,p=l.length;c<p;c++)m+=l[c].length;for(y=new Uint8Array(m),c=g=0,p=l.length;c<p;c++)f=l[c],y.set(f,g),g+=f.length;return y}},o={arraySet:function(l,c,p,m,g){for(var f=0;f<m;f++)l[g+f]=c[p+f]},flattenChunks:function(l){return[].concat.apply([],l)}};a.setTyped=function(l){l?(a.Buf8=Uint8Array,a.Buf16=Uint16Array,a.Buf32=Int32Array,a.assign(a,i)):(a.Buf8=Array,a.Buf16=Array,a.Buf32=Array,a.assign(a,o))},a.setTyped(r)},{}],42:[function(e,s,a){var r=e("./common"),i=!0,o=!0;try{String.fromCharCode.apply(null,[0])}catch{i=!1}try{String.fromCharCode.apply(null,new Uint8Array(1))}catch{o=!1}for(var l=new r.Buf8(256),c=0;c<256;c++)l[c]=252<=c?6:248<=c?5:240<=c?4:224<=c?3:192<=c?2:1;function p(m,g){if(g<65537&&(m.subarray&&o||!m.subarray&&i))return String.fromCharCode.apply(null,r.shrinkBuf(m,g));for(var f="",y=0;y<g;y++)f+=String.fromCharCode(m[y]);return f}l[254]=l[254]=1,a.string2buf=function(m){var g,f,y,h,x,T=m.length,C=0;for(h=0;h<T;h++)(64512&(f=m.charCodeAt(h)))==55296&&h+1<T&&(64512&(y=m.charCodeAt(h+1)))==56320&&(f=65536+(f-55296<<10)+(y-56320),h++),C+=f<128?1:f<2048?2:f<65536?3:4;for(g=new r.Buf8(C),h=x=0;x<C;h++)(64512&(f=m.charCodeAt(h)))==55296&&h+1<T&&(64512&(y=m.charCodeAt(h+1)))==56320&&(f=65536+(f-55296<<10)+(y-56320),h++),f<128?g[x++]=f:(f<2048?g[x++]=192|f>>>6:(f<65536?g[x++]=224|f>>>12:(g[x++]=240|f>>>18,g[x++]=128|f>>>12&63),g[x++]=128|f>>>6&63),g[x++]=128|63&f);return g},a.buf2binstring=function(m){return p(m,m.length)},a.binstring2buf=function(m){for(var g=new r.Buf8(m.length),f=0,y=g.length;f<y;f++)g[f]=m.charCodeAt(f);return g},a.buf2string=function(m,g){var f,y,h,x,T=g||m.length,C=new Array(2*T);for(f=y=0;f<T;)if((h=m[f++])<128)C[y++]=h;else if(4<(x=l[h]))C[y++]=65533,f+=x-1;else{for(h&=x===2?31:x===3?15:7;1<x&&f<T;)h=h<<6|63&m[f++],x--;1<x?C[y++]=65533:h<65536?C[y++]=h:(h-=65536,C[y++]=55296|h>>10&1023,C[y++]=56320|1023&h)}return p(C,y)},a.utf8border=function(m,g){var f;for((g=g||m.length)>m.length&&(g=m.length),f=g-1;0<=f&&(192&m[f])==128;)f--;return f<0||f===0?g:f+l[m[f]]>g?f:g}},{"./common":41}],43:[function(e,s,a){s.exports=function(r,i,o,l){for(var c=65535&r|0,p=r>>>16&65535|0,m=0;o!==0;){for(o-=m=2e3<o?2e3:o;p=p+(c=c+i[l++]|0)|0,--m;);c%=65521,p%=65521}return c|p<<16|0}},{}],44:[function(e,s,a){s.exports={Z_NO_FLUSH:0,Z_PARTIAL_FLUSH:1,Z_SYNC_FLUSH:2,Z_FULL_FLUSH:3,Z_FINISH:4,Z_BLOCK:5,Z_TREES:6,Z_OK:0,Z_STREAM_END:1,Z_NEED_DICT:2,Z_ERRNO:-1,Z_STREAM_ERROR:-2,Z_DATA_ERROR:-3,Z_BUF_ERROR:-5,Z_NO_COMPRESSION:0,Z_BEST_SPEED:1,Z_BEST_COMPRESSION:9,Z_DEFAULT_COMPRESSION:-1,Z_FILTERED:1,Z_HUFFMAN_ONLY:2,Z_RLE:3,Z_FIXED:4,Z_DEFAULT_STRATEGY:0,Z_BINARY:0,Z_TEXT:1,Z_UNKNOWN:2,Z_DEFLATED:8}},{}],45:[function(e,s,a){var r=(function(){for(var i,o=[],l=0;l<256;l++){i=l;for(var c=0;c<8;c++)i=1&i?3988292384^i>>>1:i>>>1;o[l]=i}return o})();s.exports=function(i,o,l,c){var p=r,m=c+l;i^=-1;for(var g=c;g<m;g++)i=i>>>8^p[255&(i^o[g])];return-1^i}},{}],46:[function(e,s,a){var r,i=e("../utils/common"),o=e("./trees"),l=e("./adler32"),c=e("./crc32"),p=e("./messages"),m=0,g=4,f=0,y=-2,h=-1,x=4,T=2,C=8,w=9,R=286,A=30,S=19,k=2*R+1,G=15,B=3,I=258,P=I+B+1,v=42,E=113,u=1,F=2,q=3,U=4;function tt(d,Z){return d.msg=p[Z],Z}function V(d){return(d<<1)-(4<d?9:0)}function Q(d){for(var Z=d.length;0<=--Z;)d[Z]=0}function D(d){var Z=d.state,z=Z.pending;z>d.avail_out&&(z=d.avail_out),z!==0&&(i.arraySet(d.output,Z.pending_buf,Z.pending_out,z,d.next_out),d.next_out+=z,Z.pending_out+=z,d.total_out+=z,d.avail_out-=z,Z.pending-=z,Z.pending===0&&(Z.pending_out=0))}function L(d,Z){o._tr_flush_block(d,0<=d.block_start?d.block_start:-1,d.strstart-d.block_start,Z),d.block_start=d.strstart,D(d.strm)}function et(d,Z){d.pending_buf[d.pending++]=Z}function J(d,Z){d.pending_buf[d.pending++]=Z>>>8&255,d.pending_buf[d.pending++]=255&Z}function K(d,Z){var z,M,b=d.max_chain_length,_=d.strstart,W=d.prev_length,Y=d.nice_match,O=d.strstart>d.w_size-P?d.strstart-(d.w_size-P):0,$=d.window,j=d.w_mask,X=d.prev,N=d.strstart+I,at=$[_+W-1],it=$[_+W];d.prev_length>=d.good_match&&(b>>=2),Y>d.lookahead&&(Y=d.lookahead);do if($[(z=Z)+W]===it&&$[z+W-1]===at&&$[z]===$[_]&&$[++z]===$[_+1]){_+=2,z++;do;while($[++_]===$[++z]&&$[++_]===$[++z]&&$[++_]===$[++z]&&$[++_]===$[++z]&&$[++_]===$[++z]&&$[++_]===$[++z]&&$[++_]===$[++z]&&$[++_]===$[++z]&&_<N);if(M=I-(N-_),_=N-I,W<M){if(d.match_start=Z,Y<=(W=M))break;at=$[_+W-1],it=$[_+W]}}while((Z=X[Z&j])>O&&--b!=0);return W<=d.lookahead?W:d.lookahead}function ot(d){var Z,z,M,b,_,W,Y,O,$,j,X=d.w_size;do{if(b=d.window_size-d.lookahead-d.strstart,d.strstart>=X+(X-P)){for(i.arraySet(d.window,d.window,X,X,0),d.match_start-=X,d.strstart-=X,d.block_start-=X,Z=z=d.hash_size;M=d.head[--Z],d.head[Z]=X<=M?M-X:0,--z;);for(Z=z=X;M=d.prev[--Z],d.prev[Z]=X<=M?M-X:0,--z;);b+=X}if(d.strm.avail_in===0)break;if(W=d.strm,Y=d.window,O=d.strstart+d.lookahead,$=b,j=void 0,j=W.avail_in,$<j&&(j=$),z=j===0?0:(W.avail_in-=j,i.arraySet(Y,W.input,W.next_in,j,O),W.state.wrap===1?W.adler=l(W.adler,Y,j,O):W.state.wrap===2&&(W.adler=c(W.adler,Y,j,O)),W.next_in+=j,W.total_in+=j,j),d.lookahead+=z,d.lookahead+d.insert>=B)for(_=d.strstart-d.insert,d.ins_h=d.window[_],d.ins_h=(d.ins_h<<d.hash_shift^d.window[_+1])&d.hash_mask;d.insert&&(d.ins_h=(d.ins_h<<d.hash_shift^d.window[_+B-1])&d.hash_mask,d.prev[_&d.w_mask]=d.head[d.ins_h],d.head[d.ins_h]=_,_++,d.insert--,!(d.lookahead+d.insert<B)););}while(d.lookahead<P&&d.strm.avail_in!==0)}function lt(d,Z){for(var z,M;;){if(d.lookahead<P){if(ot(d),d.lookahead<P&&Z===m)return u;if(d.lookahead===0)break}if(z=0,d.lookahead>=B&&(d.ins_h=(d.ins_h<<d.hash_shift^d.window[d.strstart+B-1])&d.hash_mask,z=d.prev[d.strstart&d.w_mask]=d.head[d.ins_h],d.head[d.ins_h]=d.strstart),z!==0&&d.strstart-z<=d.w_size-P&&(d.match_length=K(d,z)),d.match_length>=B)if(M=o._tr_tally(d,d.strstart-d.match_start,d.match_length-B),d.lookahead-=d.match_length,d.match_length<=d.max_lazy_match&&d.lookahead>=B){for(d.match_length--;d.strstart++,d.ins_h=(d.ins_h<<d.hash_shift^d.window[d.strstart+B-1])&d.hash_mask,z=d.prev[d.strstart&d.w_mask]=d.head[d.ins_h],d.head[d.ins_h]=d.strstart,--d.match_length!=0;);d.strstart++}else d.strstart+=d.match_length,d.match_length=0,d.ins_h=d.window[d.strstart],d.ins_h=(d.ins_h<<d.hash_shift^d.window[d.strstart+1])&d.hash_mask;else M=o._tr_tally(d,0,d.window[d.strstart]),d.lookahead--,d.strstart++;if(M&&(L(d,!1),d.strm.avail_out===0))return u}return d.insert=d.strstart<B-1?d.strstart:B-1,Z===g?(L(d,!0),d.strm.avail_out===0?q:U):d.last_lit&&(L(d,!1),d.strm.avail_out===0)?u:F}function rt(d,Z){for(var z,M,b;;){if(d.lookahead<P){if(ot(d),d.lookahead<P&&Z===m)return u;if(d.lookahead===0)break}if(z=0,d.lookahead>=B&&(d.ins_h=(d.ins_h<<d.hash_shift^d.window[d.strstart+B-1])&d.hash_mask,z=d.prev[d.strstart&d.w_mask]=d.head[d.ins_h],d.head[d.ins_h]=d.strstart),d.prev_length=d.match_length,d.prev_match=d.match_start,d.match_length=B-1,z!==0&&d.prev_length<d.max_lazy_match&&d.strstart-z<=d.w_size-P&&(d.match_length=K(d,z),d.match_length<=5&&(d.strategy===1||d.match_length===B&&4096<d.strstart-d.match_start)&&(d.match_length=B-1)),d.prev_length>=B&&d.match_length<=d.prev_length){for(b=d.strstart+d.lookahead-B,M=o._tr_tally(d,d.strstart-1-d.prev_match,d.prev_length-B),d.lookahead-=d.prev_length-1,d.prev_length-=2;++d.strstart<=b&&(d.ins_h=(d.ins_h<<d.hash_shift^d.window[d.strstart+B-1])&d.hash_mask,z=d.prev[d.strstart&d.w_mask]=d.head[d.ins_h],d.head[d.ins_h]=d.strstart),--d.prev_length!=0;);if(d.match_available=0,d.match_length=B-1,d.strstart++,M&&(L(d,!1),d.strm.avail_out===0))return u}else if(d.match_available){if((M=o._tr_tally(d,0,d.window[d.strstart-1]))&&L(d,!1),d.strstart++,d.lookahead--,d.strm.avail_out===0)return u}else d.match_available=1,d.strstart++,d.lookahead--}return d.match_available&&(M=o._tr_tally(d,0,d.window[d.strstart-1]),d.match_available=0),d.insert=d.strstart<B-1?d.strstart:B-1,Z===g?(L(d,!0),d.strm.avail_out===0?q:U):d.last_lit&&(L(d,!1),d.strm.avail_out===0)?u:F}function nt(d,Z,z,M,b){this.good_length=d,this.max_lazy=Z,this.nice_length=z,this.max_chain=M,this.func=b}function st(){this.strm=null,this.status=0,this.pending_buf=null,this.pending_buf_size=0,this.pending_out=0,this.pending=0,this.wrap=0,this.gzhead=null,this.gzindex=0,this.method=C,this.last_flush=-1,this.w_size=0,this.w_bits=0,this.w_mask=0,this.window=null,this.window_size=0,this.prev=null,this.head=null,this.ins_h=0,this.hash_size=0,this.hash_bits=0,this.hash_mask=0,this.hash_shift=0,this.block_start=0,this.match_length=0,this.prev_match=0,this.match_available=0,this.strstart=0,this.match_start=0,this.lookahead=0,this.prev_length=0,this.max_chain_length=0,this.max_lazy_match=0,this.level=0,this.strategy=0,this.good_match=0,this.nice_match=0,this.dyn_ltree=new i.Buf16(2*k),this.dyn_dtree=new i.Buf16(2*(2*A+1)),this.bl_tree=new i.Buf16(2*(2*S+1)),Q(this.dyn_ltree),Q(this.dyn_dtree),Q(this.bl_tree),this.l_desc=null,this.d_desc=null,this.bl_desc=null,this.bl_count=new i.Buf16(G+1),this.heap=new i.Buf16(2*R+1),Q(this.heap),this.heap_len=0,this.heap_max=0,this.depth=new i.Buf16(2*R+1),Q(this.depth),this.l_buf=0,this.lit_bufsize=0,this.last_lit=0,this.d_buf=0,this.opt_len=0,this.static_len=0,this.matches=0,this.insert=0,this.bi_buf=0,this.bi_valid=0}function ct(d){var Z;return d&&d.state?(d.total_in=d.total_out=0,d.data_type=T,(Z=d.state).pending=0,Z.pending_out=0,Z.wrap<0&&(Z.wrap=-Z.wrap),Z.status=Z.wrap?v:E,d.adler=Z.wrap===2?0:1,Z.last_flush=m,o._tr_init(Z),f):tt(d,y)}function mt(d){var Z=ct(d);return Z===f&&(function(z){z.window_size=2*z.w_size,Q(z.head),z.max_lazy_match=r[z.level].max_lazy,z.good_match=r[z.level].good_length,z.nice_match=r[z.level].nice_length,z.max_chain_length=r[z.level].max_chain,z.strstart=0,z.block_start=0,z.lookahead=0,z.insert=0,z.match_length=z.prev_length=B-1,z.match_available=0,z.ins_h=0})(d.state),Z}function xt(d,Z,z,M,b,_){if(!d)return y;var W=1;if(Z===h&&(Z=6),M<0?(W=0,M=-M):15<M&&(W=2,M-=16),b<1||w<b||z!==C||M<8||15<M||Z<0||9<Z||_<0||x<_)return tt(d,y);M===8&&(M=9);var Y=new st;return(d.state=Y).strm=d,Y.wrap=W,Y.gzhead=null,Y.w_bits=M,Y.w_size=1<<Y.w_bits,Y.w_mask=Y.w_size-1,Y.hash_bits=b+7,Y.hash_size=1<<Y.hash_bits,Y.hash_mask=Y.hash_size-1,Y.hash_shift=~~((Y.hash_bits+B-1)/B),Y.window=new i.Buf8(2*Y.w_size),Y.head=new i.Buf16(Y.hash_size),Y.prev=new i.Buf16(Y.w_size),Y.lit_bufsize=1<<b+6,Y.pending_buf_size=4*Y.lit_bufsize,Y.pending_buf=new i.Buf8(Y.pending_buf_size),Y.d_buf=1*Y.lit_bufsize,Y.l_buf=3*Y.lit_bufsize,Y.level=Z,Y.strategy=_,Y.method=z,mt(d)}r=[new nt(0,0,0,0,function(d,Z){var z=65535;for(z>d.pending_buf_size-5&&(z=d.pending_buf_size-5);;){if(d.lookahead<=1){if(ot(d),d.lookahead===0&&Z===m)return u;if(d.lookahead===0)break}d.strstart+=d.lookahead,d.lookahead=0;var M=d.block_start+z;if((d.strstart===0||d.strstart>=M)&&(d.lookahead=d.strstart-M,d.strstart=M,L(d,!1),d.strm.avail_out===0)||d.strstart-d.block_start>=d.w_size-P&&(L(d,!1),d.strm.avail_out===0))return u}return d.insert=0,Z===g?(L(d,!0),d.strm.avail_out===0?q:U):(d.strstart>d.block_start&&(L(d,!1),d.strm.avail_out),u)}),new nt(4,4,8,4,lt),new nt(4,5,16,8,lt),new nt(4,6,32,32,lt),new nt(4,4,16,16,rt),new nt(8,16,32,32,rt),new nt(8,16,128,128,rt),new nt(8,32,128,256,rt),new nt(32,128,258,1024,rt),new nt(32,258,258,4096,rt)],a.deflateInit=function(d,Z){return xt(d,Z,C,15,8,0)},a.deflateInit2=xt,a.deflateReset=mt,a.deflateResetKeep=ct,a.deflateSetHeader=function(d,Z){return d&&d.state?d.state.wrap!==2?y:(d.state.gzhead=Z,f):y},a.deflate=function(d,Z){var z,M,b,_;if(!d||!d.state||5<Z||Z<0)return d?tt(d,y):y;if(M=d.state,!d.output||!d.input&&d.avail_in!==0||M.status===666&&Z!==g)return tt(d,d.avail_out===0?-5:y);if(M.strm=d,z=M.last_flush,M.last_flush=Z,M.status===v)if(M.wrap===2)d.adler=0,et(M,31),et(M,139),et(M,8),M.gzhead?(et(M,(M.gzhead.text?1:0)+(M.gzhead.hcrc?2:0)+(M.gzhead.extra?4:0)+(M.gzhead.name?8:0)+(M.gzhead.comment?16:0)),et(M,255&M.gzhead.time),et(M,M.gzhead.time>>8&255),et(M,M.gzhead.time>>16&255),et(M,M.gzhead.time>>24&255),et(M,M.level===9?2:2<=M.strategy||M.level<2?4:0),et(M,255&M.gzhead.os),M.gzhead.extra&&M.gzhead.extra.length&&(et(M,255&M.gzhead.extra.length),et(M,M.gzhead.extra.length>>8&255)),M.gzhead.hcrc&&(d.adler=c(d.adler,M.pending_buf,M.pending,0)),M.gzindex=0,M.status=69):(et(M,0),et(M,0),et(M,0),et(M,0),et(M,0),et(M,M.level===9?2:2<=M.strategy||M.level<2?4:0),et(M,3),M.status=E);else{var W=C+(M.w_bits-8<<4)<<8;W|=(2<=M.strategy||M.level<2?0:M.level<6?1:M.level===6?2:3)<<6,M.strstart!==0&&(W|=32),W+=31-W%31,M.status=E,J(M,W),M.strstart!==0&&(J(M,d.adler>>>16),J(M,65535&d.adler)),d.adler=1}if(M.status===69)if(M.gzhead.extra){for(b=M.pending;M.gzindex<(65535&M.gzhead.extra.length)&&(M.pending!==M.pending_buf_size||(M.gzhead.hcrc&&M.pending>b&&(d.adler=c(d.adler,M.pending_buf,M.pending-b,b)),D(d),b=M.pending,M.pending!==M.pending_buf_size));)et(M,255&M.gzhead.extra[M.gzindex]),M.gzindex++;M.gzhead.hcrc&&M.pending>b&&(d.adler=c(d.adler,M.pending_buf,M.pending-b,b)),M.gzindex===M.gzhead.extra.length&&(M.gzindex=0,M.status=73)}else M.status=73;if(M.status===73)if(M.gzhead.name){b=M.pending;do{if(M.pending===M.pending_buf_size&&(M.gzhead.hcrc&&M.pending>b&&(d.adler=c(d.adler,M.pending_buf,M.pending-b,b)),D(d),b=M.pending,M.pending===M.pending_buf_size)){_=1;break}_=M.gzindex<M.gzhead.name.length?255&M.gzhead.name.charCodeAt(M.gzindex++):0,et(M,_)}while(_!==0);M.gzhead.hcrc&&M.pending>b&&(d.adler=c(d.adler,M.pending_buf,M.pending-b,b)),_===0&&(M.gzindex=0,M.status=91)}else M.status=91;if(M.status===91)if(M.gzhead.comment){b=M.pending;do{if(M.pending===M.pending_buf_size&&(M.gzhead.hcrc&&M.pending>b&&(d.adler=c(d.adler,M.pending_buf,M.pending-b,b)),D(d),b=M.pending,M.pending===M.pending_buf_size)){_=1;break}_=M.gzindex<M.gzhead.comment.length?255&M.gzhead.comment.charCodeAt(M.gzindex++):0,et(M,_)}while(_!==0);M.gzhead.hcrc&&M.pending>b&&(d.adler=c(d.adler,M.pending_buf,M.pending-b,b)),_===0&&(M.status=103)}else M.status=103;if(M.status===103&&(M.gzhead.hcrc?(M.pending+2>M.pending_buf_size&&D(d),M.pending+2<=M.pending_buf_size&&(et(M,255&d.adler),et(M,d.adler>>8&255),d.adler=0,M.status=E)):M.status=E),M.pending!==0){if(D(d),d.avail_out===0)return M.last_flush=-1,f}else if(d.avail_in===0&&V(Z)<=V(z)&&Z!==g)return tt(d,-5);if(M.status===666&&d.avail_in!==0)return tt(d,-5);if(d.avail_in!==0||M.lookahead!==0||Z!==m&&M.status!==666){var Y=M.strategy===2?(function(O,$){for(var j;;){if(O.lookahead===0&&(ot(O),O.lookahead===0)){if($===m)return u;break}if(O.match_length=0,j=o._tr_tally(O,0,O.window[O.strstart]),O.lookahead--,O.strstart++,j&&(L(O,!1),O.strm.avail_out===0))return u}return O.insert=0,$===g?(L(O,!0),O.strm.avail_out===0?q:U):O.last_lit&&(L(O,!1),O.strm.avail_out===0)?u:F})(M,Z):M.strategy===3?(function(O,$){for(var j,X,N,at,it=O.window;;){if(O.lookahead<=I){if(ot(O),O.lookahead<=I&&$===m)return u;if(O.lookahead===0)break}if(O.match_length=0,O.lookahead>=B&&0<O.strstart&&(X=it[N=O.strstart-1])===it[++N]&&X===it[++N]&&X===it[++N]){at=O.strstart+I;do;while(X===it[++N]&&X===it[++N]&&X===it[++N]&&X===it[++N]&&X===it[++N]&&X===it[++N]&&X===it[++N]&&X===it[++N]&&N<at);O.match_length=I-(at-N),O.match_length>O.lookahead&&(O.match_length=O.lookahead)}if(O.match_length>=B?(j=o._tr_tally(O,1,O.match_length-B),O.lookahead-=O.match_length,O.strstart+=O.match_length,O.match_length=0):(j=o._tr_tally(O,0,O.window[O.strstart]),O.lookahead--,O.strstart++),j&&(L(O,!1),O.strm.avail_out===0))return u}return O.insert=0,$===g?(L(O,!0),O.strm.avail_out===0?q:U):O.last_lit&&(L(O,!1),O.strm.avail_out===0)?u:F})(M,Z):r[M.level].func(M,Z);if(Y!==q&&Y!==U||(M.status=666),Y===u||Y===q)return d.avail_out===0&&(M.last_flush=-1),f;if(Y===F&&(Z===1?o._tr_align(M):Z!==5&&(o._tr_stored_block(M,0,0,!1),Z===3&&(Q(M.head),M.lookahead===0&&(M.strstart=0,M.block_start=0,M.insert=0))),D(d),d.avail_out===0))return M.last_flush=-1,f}return Z!==g?f:M.wrap<=0?1:(M.wrap===2?(et(M,255&d.adler),et(M,d.adler>>8&255),et(M,d.adler>>16&255),et(M,d.adler>>24&255),et(M,255&d.total_in),et(M,d.total_in>>8&255),et(M,d.total_in>>16&255),et(M,d.total_in>>24&255)):(J(M,d.adler>>>16),J(M,65535&d.adler)),D(d),0<M.wrap&&(M.wrap=-M.wrap),M.pending!==0?f:1)},a.deflateEnd=function(d){var Z;return d&&d.state?(Z=d.state.status)!==v&&Z!==69&&Z!==73&&Z!==91&&Z!==103&&Z!==E&&Z!==666?tt(d,y):(d.state=null,Z===E?tt(d,-3):f):y},a.deflateSetDictionary=function(d,Z){var z,M,b,_,W,Y,O,$,j=Z.length;if(!d||!d.state||(_=(z=d.state).wrap)===2||_===1&&z.status!==v||z.lookahead)return y;for(_===1&&(d.adler=l(d.adler,Z,j,0)),z.wrap=0,j>=z.w_size&&(_===0&&(Q(z.head),z.strstart=0,z.block_start=0,z.insert=0),$=new i.Buf8(z.w_size),i.arraySet($,Z,j-z.w_size,z.w_size,0),Z=$,j=z.w_size),W=d.avail_in,Y=d.next_in,O=d.input,d.avail_in=j,d.next_in=0,d.input=Z,ot(z);z.lookahead>=B;){for(M=z.strstart,b=z.lookahead-(B-1);z.ins_h=(z.ins_h<<z.hash_shift^z.window[M+B-1])&z.hash_mask,z.prev[M&z.w_mask]=z.head[z.ins_h],z.head[z.ins_h]=M,M++,--b;);z.strstart=M,z.lookahead=B-1,ot(z)}return z.strstart+=z.lookahead,z.block_start=z.strstart,z.insert=z.lookahead,z.lookahead=0,z.match_length=z.prev_length=B-1,z.match_available=0,d.next_in=Y,d.input=O,d.avail_in=W,z.wrap=_,f},a.deflateInfo="pako deflate (from Nodeca project)"},{"../utils/common":41,"./adler32":43,"./crc32":45,"./messages":51,"./trees":52}],47:[function(e,s,a){s.exports=function(){this.text=0,this.time=0,this.xflags=0,this.os=0,this.extra=null,this.extra_len=0,this.name="",this.comment="",this.hcrc=0,this.done=!1}},{}],48:[function(e,s,a){s.exports=function(r,i){var o,l,c,p,m,g,f,y,h,x,T,C,w,R,A,S,k,G,B,I,P,v,E,u,F;o=r.state,l=r.next_in,u=r.input,c=l+(r.avail_in-5),p=r.next_out,F=r.output,m=p-(i-r.avail_out),g=p+(r.avail_out-257),f=o.dmax,y=o.wsize,h=o.whave,x=o.wnext,T=o.window,C=o.hold,w=o.bits,R=o.lencode,A=o.distcode,S=(1<<o.lenbits)-1,k=(1<<o.distbits)-1;t:do{w<15&&(C+=u[l++]<<w,w+=8,C+=u[l++]<<w,w+=8),G=R[C&S];e:for(;;){if(C>>>=B=G>>>24,w-=B,(B=G>>>16&255)===0)F[p++]=65535&G;else{if(!(16&B)){if((64&B)==0){G=R[(65535&G)+(C&(1<<B)-1)];continue e}if(32&B){o.mode=12;break t}r.msg="invalid literal/length code",o.mode=30;break t}I=65535&G,(B&=15)&&(w<B&&(C+=u[l++]<<w,w+=8),I+=C&(1<<B)-1,C>>>=B,w-=B),w<15&&(C+=u[l++]<<w,w+=8,C+=u[l++]<<w,w+=8),G=A[C&k];n:for(;;){if(C>>>=B=G>>>24,w-=B,!(16&(B=G>>>16&255))){if((64&B)==0){G=A[(65535&G)+(C&(1<<B)-1)];continue n}r.msg="invalid distance code",o.mode=30;break t}if(P=65535&G,w<(B&=15)&&(C+=u[l++]<<w,(w+=8)<B&&(C+=u[l++]<<w,w+=8)),f<(P+=C&(1<<B)-1)){r.msg="invalid distance too far back",o.mode=30;break t}if(C>>>=B,w-=B,(B=p-m)<P){if(h<(B=P-B)&&o.sane){r.msg="invalid distance too far back",o.mode=30;break t}if(E=T,(v=0)===x){if(v+=y-B,B<I){for(I-=B;F[p++]=T[v++],--B;);v=p-P,E=F}}else if(x<B){if(v+=y+x-B,(B-=x)<I){for(I-=B;F[p++]=T[v++],--B;);if(v=0,x<I){for(I-=B=x;F[p++]=T[v++],--B;);v=p-P,E=F}}}else if(v+=x-B,B<I){for(I-=B;F[p++]=T[v++],--B;);v=p-P,E=F}for(;2<I;)F[p++]=E[v++],F[p++]=E[v++],F[p++]=E[v++],I-=3;I&&(F[p++]=E[v++],1<I&&(F[p++]=E[v++]))}else{for(v=p-P;F[p++]=F[v++],F[p++]=F[v++],F[p++]=F[v++],2<(I-=3););I&&(F[p++]=F[v++],1<I&&(F[p++]=F[v++]))}break}}break}}while(l<c&&p<g);l-=I=w>>3,C&=(1<<(w-=I<<3))-1,r.next_in=l,r.next_out=p,r.avail_in=l<c?c-l+5:5-(l-c),r.avail_out=p<g?g-p+257:257-(p-g),o.hold=C,o.bits=w}},{}],49:[function(e,s,a){var r=e("../utils/common"),i=e("./adler32"),o=e("./crc32"),l=e("./inffast"),c=e("./inftrees"),p=1,m=2,g=0,f=-2,y=1,h=852,x=592;function T(v){return(v>>>24&255)+(v>>>8&65280)+((65280&v)<<8)+((255&v)<<24)}function C(){this.mode=0,this.last=!1,this.wrap=0,this.havedict=!1,this.flags=0,this.dmax=0,this.check=0,this.total=0,this.head=null,this.wbits=0,this.wsize=0,this.whave=0,this.wnext=0,this.window=null,this.hold=0,this.bits=0,this.length=0,this.offset=0,this.extra=0,this.lencode=null,this.distcode=null,this.lenbits=0,this.distbits=0,this.ncode=0,this.nlen=0,this.ndist=0,this.have=0,this.next=null,this.lens=new r.Buf16(320),this.work=new r.Buf16(288),this.lendyn=null,this.distdyn=null,this.sane=0,this.back=0,this.was=0}function w(v){var E;return v&&v.state?(E=v.state,v.total_in=v.total_out=E.total=0,v.msg="",E.wrap&&(v.adler=1&E.wrap),E.mode=y,E.last=0,E.havedict=0,E.dmax=32768,E.head=null,E.hold=0,E.bits=0,E.lencode=E.lendyn=new r.Buf32(h),E.distcode=E.distdyn=new r.Buf32(x),E.sane=1,E.back=-1,g):f}function R(v){var E;return v&&v.state?((E=v.state).wsize=0,E.whave=0,E.wnext=0,w(v)):f}function A(v,E){var u,F;return v&&v.state?(F=v.state,E<0?(u=0,E=-E):(u=1+(E>>4),E<48&&(E&=15)),E&&(E<8||15<E)?f:(F.window!==null&&F.wbits!==E&&(F.window=null),F.wrap=u,F.wbits=E,R(v))):f}function S(v,E){var u,F;return v?(F=new C,(v.state=F).window=null,(u=A(v,E))!==g&&(v.state=null),u):f}var k,G,B=!0;function I(v){if(B){var E;for(k=new r.Buf32(512),G=new r.Buf32(32),E=0;E<144;)v.lens[E++]=8;for(;E<256;)v.lens[E++]=9;for(;E<280;)v.lens[E++]=7;for(;E<288;)v.lens[E++]=8;for(c(p,v.lens,0,288,k,0,v.work,{bits:9}),E=0;E<32;)v.lens[E++]=5;c(m,v.lens,0,32,G,0,v.work,{bits:5}),B=!1}v.lencode=k,v.lenbits=9,v.distcode=G,v.distbits=5}function P(v,E,u,F){var q,U=v.state;return U.window===null&&(U.wsize=1<<U.wbits,U.wnext=0,U.whave=0,U.window=new r.Buf8(U.wsize)),F>=U.wsize?(r.arraySet(U.window,E,u-U.wsize,U.wsize,0),U.wnext=0,U.whave=U.wsize):(F<(q=U.wsize-U.wnext)&&(q=F),r.arraySet(U.window,E,u-F,q,U.wnext),(F-=q)?(r.arraySet(U.window,E,u-F,F,0),U.wnext=F,U.whave=U.wsize):(U.wnext+=q,U.wnext===U.wsize&&(U.wnext=0),U.whave<U.wsize&&(U.whave+=q))),0}a.inflateReset=R,a.inflateReset2=A,a.inflateResetKeep=w,a.inflateInit=function(v){return S(v,15)},a.inflateInit2=S,a.inflate=function(v,E){var u,F,q,U,tt,V,Q,D,L,et,J,K,ot,lt,rt,nt,st,ct,mt,xt,d,Z,z,M,b=0,_=new r.Buf8(4),W=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];if(!v||!v.state||!v.output||!v.input&&v.avail_in!==0)return f;(u=v.state).mode===12&&(u.mode=13),tt=v.next_out,q=v.output,Q=v.avail_out,U=v.next_in,F=v.input,V=v.avail_in,D=u.hold,L=u.bits,et=V,J=Q,Z=g;t:for(;;)switch(u.mode){case y:if(u.wrap===0){u.mode=13;break}for(;L<16;){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}if(2&u.wrap&&D===35615){_[u.check=0]=255&D,_[1]=D>>>8&255,u.check=o(u.check,_,2,0),L=D=0,u.mode=2;break}if(u.flags=0,u.head&&(u.head.done=!1),!(1&u.wrap)||(((255&D)<<8)+(D>>8))%31){v.msg="incorrect header check",u.mode=30;break}if((15&D)!=8){v.msg="unknown compression method",u.mode=30;break}if(L-=4,d=8+(15&(D>>>=4)),u.wbits===0)u.wbits=d;else if(d>u.wbits){v.msg="invalid window size",u.mode=30;break}u.dmax=1<<d,v.adler=u.check=1,u.mode=512&D?10:12,L=D=0;break;case 2:for(;L<16;){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}if(u.flags=D,(255&u.flags)!=8){v.msg="unknown compression method",u.mode=30;break}if(57344&u.flags){v.msg="unknown header flags set",u.mode=30;break}u.head&&(u.head.text=D>>8&1),512&u.flags&&(_[0]=255&D,_[1]=D>>>8&255,u.check=o(u.check,_,2,0)),L=D=0,u.mode=3;case 3:for(;L<32;){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}u.head&&(u.head.time=D),512&u.flags&&(_[0]=255&D,_[1]=D>>>8&255,_[2]=D>>>16&255,_[3]=D>>>24&255,u.check=o(u.check,_,4,0)),L=D=0,u.mode=4;case 4:for(;L<16;){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}u.head&&(u.head.xflags=255&D,u.head.os=D>>8),512&u.flags&&(_[0]=255&D,_[1]=D>>>8&255,u.check=o(u.check,_,2,0)),L=D=0,u.mode=5;case 5:if(1024&u.flags){for(;L<16;){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}u.length=D,u.head&&(u.head.extra_len=D),512&u.flags&&(_[0]=255&D,_[1]=D>>>8&255,u.check=o(u.check,_,2,0)),L=D=0}else u.head&&(u.head.extra=null);u.mode=6;case 6:if(1024&u.flags&&(V<(K=u.length)&&(K=V),K&&(u.head&&(d=u.head.extra_len-u.length,u.head.extra||(u.head.extra=new Array(u.head.extra_len)),r.arraySet(u.head.extra,F,U,K,d)),512&u.flags&&(u.check=o(u.check,F,K,U)),V-=K,U+=K,u.length-=K),u.length))break t;u.length=0,u.mode=7;case 7:if(2048&u.flags){if(V===0)break t;for(K=0;d=F[U+K++],u.head&&d&&u.length<65536&&(u.head.name+=String.fromCharCode(d)),d&&K<V;);if(512&u.flags&&(u.check=o(u.check,F,K,U)),V-=K,U+=K,d)break t}else u.head&&(u.head.name=null);u.length=0,u.mode=8;case 8:if(4096&u.flags){if(V===0)break t;for(K=0;d=F[U+K++],u.head&&d&&u.length<65536&&(u.head.comment+=String.fromCharCode(d)),d&&K<V;);if(512&u.flags&&(u.check=o(u.check,F,K,U)),V-=K,U+=K,d)break t}else u.head&&(u.head.comment=null);u.mode=9;case 9:if(512&u.flags){for(;L<16;){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}if(D!==(65535&u.check)){v.msg="header crc mismatch",u.mode=30;break}L=D=0}u.head&&(u.head.hcrc=u.flags>>9&1,u.head.done=!0),v.adler=u.check=0,u.mode=12;break;case 10:for(;L<32;){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}v.adler=u.check=T(D),L=D=0,u.mode=11;case 11:if(u.havedict===0)return v.next_out=tt,v.avail_out=Q,v.next_in=U,v.avail_in=V,u.hold=D,u.bits=L,2;v.adler=u.check=1,u.mode=12;case 12:if(E===5||E===6)break t;case 13:if(u.last){D>>>=7&L,L-=7&L,u.mode=27;break}for(;L<3;){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}switch(u.last=1&D,L-=1,3&(D>>>=1)){case 0:u.mode=14;break;case 1:if(I(u),u.mode=20,E!==6)break;D>>>=2,L-=2;break t;case 2:u.mode=17;break;case 3:v.msg="invalid block type",u.mode=30}D>>>=2,L-=2;break;case 14:for(D>>>=7&L,L-=7&L;L<32;){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}if((65535&D)!=(D>>>16^65535)){v.msg="invalid stored block lengths",u.mode=30;break}if(u.length=65535&D,L=D=0,u.mode=15,E===6)break t;case 15:u.mode=16;case 16:if(K=u.length){if(V<K&&(K=V),Q<K&&(K=Q),K===0)break t;r.arraySet(q,F,U,K,tt),V-=K,U+=K,Q-=K,tt+=K,u.length-=K;break}u.mode=12;break;case 17:for(;L<14;){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}if(u.nlen=257+(31&D),D>>>=5,L-=5,u.ndist=1+(31&D),D>>>=5,L-=5,u.ncode=4+(15&D),D>>>=4,L-=4,286<u.nlen||30<u.ndist){v.msg="too many length or distance symbols",u.mode=30;break}u.have=0,u.mode=18;case 18:for(;u.have<u.ncode;){for(;L<3;){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}u.lens[W[u.have++]]=7&D,D>>>=3,L-=3}for(;u.have<19;)u.lens[W[u.have++]]=0;if(u.lencode=u.lendyn,u.lenbits=7,z={bits:u.lenbits},Z=c(0,u.lens,0,19,u.lencode,0,u.work,z),u.lenbits=z.bits,Z){v.msg="invalid code lengths set",u.mode=30;break}u.have=0,u.mode=19;case 19:for(;u.have<u.nlen+u.ndist;){for(;nt=(b=u.lencode[D&(1<<u.lenbits)-1])>>>16&255,st=65535&b,!((rt=b>>>24)<=L);){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}if(st<16)D>>>=rt,L-=rt,u.lens[u.have++]=st;else{if(st===16){for(M=rt+2;L<M;){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}if(D>>>=rt,L-=rt,u.have===0){v.msg="invalid bit length repeat",u.mode=30;break}d=u.lens[u.have-1],K=3+(3&D),D>>>=2,L-=2}else if(st===17){for(M=rt+3;L<M;){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}L-=rt,d=0,K=3+(7&(D>>>=rt)),D>>>=3,L-=3}else{for(M=rt+7;L<M;){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}L-=rt,d=0,K=11+(127&(D>>>=rt)),D>>>=7,L-=7}if(u.have+K>u.nlen+u.ndist){v.msg="invalid bit length repeat",u.mode=30;break}for(;K--;)u.lens[u.have++]=d}}if(u.mode===30)break;if(u.lens[256]===0){v.msg="invalid code -- missing end-of-block",u.mode=30;break}if(u.lenbits=9,z={bits:u.lenbits},Z=c(p,u.lens,0,u.nlen,u.lencode,0,u.work,z),u.lenbits=z.bits,Z){v.msg="invalid literal/lengths set",u.mode=30;break}if(u.distbits=6,u.distcode=u.distdyn,z={bits:u.distbits},Z=c(m,u.lens,u.nlen,u.ndist,u.distcode,0,u.work,z),u.distbits=z.bits,Z){v.msg="invalid distances set",u.mode=30;break}if(u.mode=20,E===6)break t;case 20:u.mode=21;case 21:if(6<=V&&258<=Q){v.next_out=tt,v.avail_out=Q,v.next_in=U,v.avail_in=V,u.hold=D,u.bits=L,l(v,J),tt=v.next_out,q=v.output,Q=v.avail_out,U=v.next_in,F=v.input,V=v.avail_in,D=u.hold,L=u.bits,u.mode===12&&(u.back=-1);break}for(u.back=0;nt=(b=u.lencode[D&(1<<u.lenbits)-1])>>>16&255,st=65535&b,!((rt=b>>>24)<=L);){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}if(nt&&(240&nt)==0){for(ct=rt,mt=nt,xt=st;nt=(b=u.lencode[xt+((D&(1<<ct+mt)-1)>>ct)])>>>16&255,st=65535&b,!(ct+(rt=b>>>24)<=L);){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}D>>>=ct,L-=ct,u.back+=ct}if(D>>>=rt,L-=rt,u.back+=rt,u.length=st,nt===0){u.mode=26;break}if(32&nt){u.back=-1,u.mode=12;break}if(64&nt){v.msg="invalid literal/length code",u.mode=30;break}u.extra=15&nt,u.mode=22;case 22:if(u.extra){for(M=u.extra;L<M;){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}u.length+=D&(1<<u.extra)-1,D>>>=u.extra,L-=u.extra,u.back+=u.extra}u.was=u.length,u.mode=23;case 23:for(;nt=(b=u.distcode[D&(1<<u.distbits)-1])>>>16&255,st=65535&b,!((rt=b>>>24)<=L);){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}if((240&nt)==0){for(ct=rt,mt=nt,xt=st;nt=(b=u.distcode[xt+((D&(1<<ct+mt)-1)>>ct)])>>>16&255,st=65535&b,!(ct+(rt=b>>>24)<=L);){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}D>>>=ct,L-=ct,u.back+=ct}if(D>>>=rt,L-=rt,u.back+=rt,64&nt){v.msg="invalid distance code",u.mode=30;break}u.offset=st,u.extra=15&nt,u.mode=24;case 24:if(u.extra){for(M=u.extra;L<M;){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}u.offset+=D&(1<<u.extra)-1,D>>>=u.extra,L-=u.extra,u.back+=u.extra}if(u.offset>u.dmax){v.msg="invalid distance too far back",u.mode=30;break}u.mode=25;case 25:if(Q===0)break t;if(K=J-Q,u.offset>K){if((K=u.offset-K)>u.whave&&u.sane){v.msg="invalid distance too far back",u.mode=30;break}ot=K>u.wnext?(K-=u.wnext,u.wsize-K):u.wnext-K,K>u.length&&(K=u.length),lt=u.window}else lt=q,ot=tt-u.offset,K=u.length;for(Q<K&&(K=Q),Q-=K,u.length-=K;q[tt++]=lt[ot++],--K;);u.length===0&&(u.mode=21);break;case 26:if(Q===0)break t;q[tt++]=u.length,Q--,u.mode=21;break;case 27:if(u.wrap){for(;L<32;){if(V===0)break t;V--,D|=F[U++]<<L,L+=8}if(J-=Q,v.total_out+=J,u.total+=J,J&&(v.adler=u.check=u.flags?o(u.check,q,J,tt-J):i(u.check,q,J,tt-J)),J=Q,(u.flags?D:T(D))!==u.check){v.msg="incorrect data check",u.mode=30;break}L=D=0}u.mode=28;case 28:if(u.wrap&&u.flags){for(;L<32;){if(V===0)break t;V--,D+=F[U++]<<L,L+=8}if(D!==(4294967295&u.total)){v.msg="incorrect length check",u.mode=30;break}L=D=0}u.mode=29;case 29:Z=1;break t;case 30:Z=-3;break t;case 31:return-4;default:return f}return v.next_out=tt,v.avail_out=Q,v.next_in=U,v.avail_in=V,u.hold=D,u.bits=L,(u.wsize||J!==v.avail_out&&u.mode<30&&(u.mode<27||E!==4))&&P(v,v.output,v.next_out,J-v.avail_out)?(u.mode=31,-4):(et-=v.avail_in,J-=v.avail_out,v.total_in+=et,v.total_out+=J,u.total+=J,u.wrap&&J&&(v.adler=u.check=u.flags?o(u.check,q,J,v.next_out-J):i(u.check,q,J,v.next_out-J)),v.data_type=u.bits+(u.last?64:0)+(u.mode===12?128:0)+(u.mode===20||u.mode===15?256:0),(et==0&&J===0||E===4)&&Z===g&&(Z=-5),Z)},a.inflateEnd=function(v){if(!v||!v.state)return f;var E=v.state;return E.window&&(E.window=null),v.state=null,g},a.inflateGetHeader=function(v,E){var u;return v&&v.state?(2&(u=v.state).wrap)==0?f:((u.head=E).done=!1,g):f},a.inflateSetDictionary=function(v,E){var u,F=E.length;return v&&v.state?(u=v.state).wrap!==0&&u.mode!==11?f:u.mode===11&&i(1,E,F,0)!==u.check?-3:P(v,E,F,F)?(u.mode=31,-4):(u.havedict=1,g):f},a.inflateInfo="pako inflate (from Nodeca project)"},{"../utils/common":41,"./adler32":43,"./crc32":45,"./inffast":48,"./inftrees":50}],50:[function(e,s,a){var r=e("../utils/common"),i=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258,0,0],o=[16,16,16,16,16,16,16,16,17,17,17,17,18,18,18,18,19,19,19,19,20,20,20,20,21,21,21,21,16,72,78],l=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577,0,0],c=[16,16,16,16,17,17,18,18,19,19,20,20,21,21,22,22,23,23,24,24,25,25,26,26,27,27,28,28,29,29,64,64];s.exports=function(p,m,g,f,y,h,x,T){var C,w,R,A,S,k,G,B,I,P=T.bits,v=0,E=0,u=0,F=0,q=0,U=0,tt=0,V=0,Q=0,D=0,L=null,et=0,J=new r.Buf16(16),K=new r.Buf16(16),ot=null,lt=0;for(v=0;v<=15;v++)J[v]=0;for(E=0;E<f;E++)J[m[g+E]]++;for(q=P,F=15;1<=F&&J[F]===0;F--);if(F<q&&(q=F),F===0)return y[h++]=20971520,y[h++]=20971520,T.bits=1,0;for(u=1;u<F&&J[u]===0;u++);for(q<u&&(q=u),v=V=1;v<=15;v++)if(V<<=1,(V-=J[v])<0)return-1;if(0<V&&(p===0||F!==1))return-1;for(K[1]=0,v=1;v<15;v++)K[v+1]=K[v]+J[v];for(E=0;E<f;E++)m[g+E]!==0&&(x[K[m[g+E]]++]=E);if(k=p===0?(L=ot=x,19):p===1?(L=i,et-=257,ot=o,lt-=257,256):(L=l,ot=c,-1),v=u,S=h,tt=E=D=0,R=-1,A=(Q=1<<(U=q))-1,p===1&&852<Q||p===2&&592<Q)return 1;for(;;){for(G=v-tt,I=x[E]<k?(B=0,x[E]):x[E]>k?(B=ot[lt+x[E]],L[et+x[E]]):(B=96,0),C=1<<v-tt,u=w=1<<U;y[S+(D>>tt)+(w-=C)]=G<<24|B<<16|I|0,w!==0;);for(C=1<<v-1;D&C;)C>>=1;if(C!==0?(D&=C-1,D+=C):D=0,E++,--J[v]==0){if(v===F)break;v=m[g+x[E]]}if(q<v&&(D&A)!==R){for(tt===0&&(tt=q),S+=u,V=1<<(U=v-tt);U+tt<F&&!((V-=J[U+tt])<=0);)U++,V<<=1;if(Q+=1<<U,p===1&&852<Q||p===2&&592<Q)return 1;y[R=D&A]=q<<24|U<<16|S-h|0}}return D!==0&&(y[S+D]=v-tt<<24|64<<16|0),T.bits=q,0}},{"../utils/common":41}],51:[function(e,s,a){s.exports={2:"need dictionary",1:"stream end",0:"","-1":"file error","-2":"stream error","-3":"data error","-4":"insufficient memory","-5":"buffer error","-6":"incompatible version"}},{}],52:[function(e,s,a){var r=e("../utils/common"),i=0,o=1;function l(b){for(var _=b.length;0<=--_;)b[_]=0}var c=0,p=29,m=256,g=m+1+p,f=30,y=19,h=2*g+1,x=15,T=16,C=7,w=256,R=16,A=17,S=18,k=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0],G=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13],B=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,3,7],I=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15],P=new Array(2*(g+2));l(P);var v=new Array(2*f);l(v);var E=new Array(512);l(E);var u=new Array(256);l(u);var F=new Array(p);l(F);var q,U,tt,V=new Array(f);function Q(b,_,W,Y,O){this.static_tree=b,this.extra_bits=_,this.extra_base=W,this.elems=Y,this.max_length=O,this.has_stree=b&&b.length}function D(b,_){this.dyn_tree=b,this.max_code=0,this.stat_desc=_}function L(b){return b<256?E[b]:E[256+(b>>>7)]}function et(b,_){b.pending_buf[b.pending++]=255&_,b.pending_buf[b.pending++]=_>>>8&255}function J(b,_,W){b.bi_valid>T-W?(b.bi_buf|=_<<b.bi_valid&65535,et(b,b.bi_buf),b.bi_buf=_>>T-b.bi_valid,b.bi_valid+=W-T):(b.bi_buf|=_<<b.bi_valid&65535,b.bi_valid+=W)}function K(b,_,W){J(b,W[2*_],W[2*_+1])}function ot(b,_){for(var W=0;W|=1&b,b>>>=1,W<<=1,0<--_;);return W>>>1}function lt(b,_,W){var Y,O,$=new Array(x+1),j=0;for(Y=1;Y<=x;Y++)$[Y]=j=j+W[Y-1]<<1;for(O=0;O<=_;O++){var X=b[2*O+1];X!==0&&(b[2*O]=ot($[X]++,X))}}function rt(b){var _;for(_=0;_<g;_++)b.dyn_ltree[2*_]=0;for(_=0;_<f;_++)b.dyn_dtree[2*_]=0;for(_=0;_<y;_++)b.bl_tree[2*_]=0;b.dyn_ltree[2*w]=1,b.opt_len=b.static_len=0,b.last_lit=b.matches=0}function nt(b){8<b.bi_valid?et(b,b.bi_buf):0<b.bi_valid&&(b.pending_buf[b.pending++]=b.bi_buf),b.bi_buf=0,b.bi_valid=0}function st(b,_,W,Y){var O=2*_,$=2*W;return b[O]<b[$]||b[O]===b[$]&&Y[_]<=Y[W]}function ct(b,_,W){for(var Y=b.heap[W],O=W<<1;O<=b.heap_len&&(O<b.heap_len&&st(_,b.heap[O+1],b.heap[O],b.depth)&&O++,!st(_,Y,b.heap[O],b.depth));)b.heap[W]=b.heap[O],W=O,O<<=1;b.heap[W]=Y}function mt(b,_,W){var Y,O,$,j,X=0;if(b.last_lit!==0)for(;Y=b.pending_buf[b.d_buf+2*X]<<8|b.pending_buf[b.d_buf+2*X+1],O=b.pending_buf[b.l_buf+X],X++,Y===0?K(b,O,_):(K(b,($=u[O])+m+1,_),(j=k[$])!==0&&J(b,O-=F[$],j),K(b,$=L(--Y),W),(j=G[$])!==0&&J(b,Y-=V[$],j)),X<b.last_lit;);K(b,w,_)}function xt(b,_){var W,Y,O,$=_.dyn_tree,j=_.stat_desc.static_tree,X=_.stat_desc.has_stree,N=_.stat_desc.elems,at=-1;for(b.heap_len=0,b.heap_max=h,W=0;W<N;W++)$[2*W]!==0?(b.heap[++b.heap_len]=at=W,b.depth[W]=0):$[2*W+1]=0;for(;b.heap_len<2;)$[2*(O=b.heap[++b.heap_len]=at<2?++at:0)]=1,b.depth[O]=0,b.opt_len--,X&&(b.static_len-=j[2*O+1]);for(_.max_code=at,W=b.heap_len>>1;1<=W;W--)ct(b,$,W);for(O=N;W=b.heap[1],b.heap[1]=b.heap[b.heap_len--],ct(b,$,1),Y=b.heap[1],b.heap[--b.heap_max]=W,b.heap[--b.heap_max]=Y,$[2*O]=$[2*W]+$[2*Y],b.depth[O]=(b.depth[W]>=b.depth[Y]?b.depth[W]:b.depth[Y])+1,$[2*W+1]=$[2*Y+1]=O,b.heap[1]=O++,ct(b,$,1),2<=b.heap_len;);b.heap[--b.heap_max]=b.heap[1],(function(it,pt){var Rt,At,Lt,ft,vt,St,wt=pt.dyn_tree,Pt=pt.max_code,Pe=pt.stat_desc.static_tree,Fe=pt.stat_desc.has_stree,se=pt.stat_desc.extra_bits,oe=pt.stat_desc.extra_base,Dt=pt.stat_desc.max_length,Ot=0;for(ft=0;ft<=x;ft++)it.bl_count[ft]=0;for(wt[2*it.heap[it.heap_max]+1]=0,Rt=it.heap_max+1;Rt<h;Rt++)Dt<(ft=wt[2*wt[2*(At=it.heap[Rt])+1]+1]+1)&&(ft=Dt,Ot++),wt[2*At+1]=ft,Pt<At||(it.bl_count[ft]++,vt=0,oe<=At&&(vt=se[At-oe]),St=wt[2*At],it.opt_len+=St*(ft+vt),Fe&&(it.static_len+=St*(Pe[2*At+1]+vt)));if(Ot!==0){do{for(ft=Dt-1;it.bl_count[ft]===0;)ft--;it.bl_count[ft]--,it.bl_count[ft+1]+=2,it.bl_count[Dt]--,Ot-=2}while(0<Ot);for(ft=Dt;ft!==0;ft--)for(At=it.bl_count[ft];At!==0;)Pt<(Lt=it.heap[--Rt])||(wt[2*Lt+1]!==ft&&(it.opt_len+=(ft-wt[2*Lt+1])*wt[2*Lt],wt[2*Lt+1]=ft),At--)}})(b,_),lt($,at,b.bl_count)}function d(b,_,W){var Y,O,$=-1,j=_[1],X=0,N=7,at=4;for(j===0&&(N=138,at=3),_[2*(W+1)+1]=65535,Y=0;Y<=W;Y++)O=j,j=_[2*(Y+1)+1],++X<N&&O===j||(X<at?b.bl_tree[2*O]+=X:O!==0?(O!==$&&b.bl_tree[2*O]++,b.bl_tree[2*R]++):X<=10?b.bl_tree[2*A]++:b.bl_tree[2*S]++,$=O,at=(X=0)===j?(N=138,3):O===j?(N=6,3):(N=7,4))}function Z(b,_,W){var Y,O,$=-1,j=_[1],X=0,N=7,at=4;for(j===0&&(N=138,at=3),Y=0;Y<=W;Y++)if(O=j,j=_[2*(Y+1)+1],!(++X<N&&O===j)){if(X<at)for(;K(b,O,b.bl_tree),--X!=0;);else O!==0?(O!==$&&(K(b,O,b.bl_tree),X--),K(b,R,b.bl_tree),J(b,X-3,2)):X<=10?(K(b,A,b.bl_tree),J(b,X-3,3)):(K(b,S,b.bl_tree),J(b,X-11,7));$=O,at=(X=0)===j?(N=138,3):O===j?(N=6,3):(N=7,4)}}l(V);var z=!1;function M(b,_,W,Y){J(b,(c<<1)+(Y?1:0),3),(function(O,$,j,X){nt(O),et(O,j),et(O,~j),r.arraySet(O.pending_buf,O.window,$,j,O.pending),O.pending+=j})(b,_,W)}a._tr_init=function(b){z||((function(){var _,W,Y,O,$,j=new Array(x+1);for(O=Y=0;O<p-1;O++)for(F[O]=Y,_=0;_<1<<k[O];_++)u[Y++]=O;for(u[Y-1]=O,O=$=0;O<16;O++)for(V[O]=$,_=0;_<1<<G[O];_++)E[$++]=O;for($>>=7;O<f;O++)for(V[O]=$<<7,_=0;_<1<<G[O]-7;_++)E[256+$++]=O;for(W=0;W<=x;W++)j[W]=0;for(_=0;_<=143;)P[2*_+1]=8,_++,j[8]++;for(;_<=255;)P[2*_+1]=9,_++,j[9]++;for(;_<=279;)P[2*_+1]=7,_++,j[7]++;for(;_<=287;)P[2*_+1]=8,_++,j[8]++;for(lt(P,g+1,j),_=0;_<f;_++)v[2*_+1]=5,v[2*_]=ot(_,5);q=new Q(P,k,m+1,g,x),U=new Q(v,G,0,f,x),tt=new Q(new Array(0),B,0,y,C)})(),z=!0),b.l_desc=new D(b.dyn_ltree,q),b.d_desc=new D(b.dyn_dtree,U),b.bl_desc=new D(b.bl_tree,tt),b.bi_buf=0,b.bi_valid=0,rt(b)},a._tr_stored_block=M,a._tr_flush_block=function(b,_,W,Y){var O,$,j=0;0<b.level?(b.strm.data_type===2&&(b.strm.data_type=(function(X){var N,at=4093624447;for(N=0;N<=31;N++,at>>>=1)if(1&at&&X.dyn_ltree[2*N]!==0)return i;if(X.dyn_ltree[18]!==0||X.dyn_ltree[20]!==0||X.dyn_ltree[26]!==0)return o;for(N=32;N<m;N++)if(X.dyn_ltree[2*N]!==0)return o;return i})(b)),xt(b,b.l_desc),xt(b,b.d_desc),j=(function(X){var N;for(d(X,X.dyn_ltree,X.l_desc.max_code),d(X,X.dyn_dtree,X.d_desc.max_code),xt(X,X.bl_desc),N=y-1;3<=N&&X.bl_tree[2*I[N]+1]===0;N--);return X.opt_len+=3*(N+1)+5+5+4,N})(b),O=b.opt_len+3+7>>>3,($=b.static_len+3+7>>>3)<=O&&(O=$)):O=$=W+5,W+4<=O&&_!==-1?M(b,_,W,Y):b.strategy===4||$===O?(J(b,2+(Y?1:0),3),mt(b,P,v)):(J(b,4+(Y?1:0),3),(function(X,N,at,it){var pt;for(J(X,N-257,5),J(X,at-1,5),J(X,it-4,4),pt=0;pt<it;pt++)J(X,X.bl_tree[2*I[pt]+1],3);Z(X,X.dyn_ltree,N-1),Z(X,X.dyn_dtree,at-1)})(b,b.l_desc.max_code+1,b.d_desc.max_code+1,j+1),mt(b,b.dyn_ltree,b.dyn_dtree)),rt(b),Y&&nt(b)},a._tr_tally=function(b,_,W){return b.pending_buf[b.d_buf+2*b.last_lit]=_>>>8&255,b.pending_buf[b.d_buf+2*b.last_lit+1]=255&_,b.pending_buf[b.l_buf+b.last_lit]=255&W,b.last_lit++,_===0?b.dyn_ltree[2*W]++:(b.matches++,_--,b.dyn_ltree[2*(u[W]+m+1)]++,b.dyn_dtree[2*L(_)]++),b.last_lit===b.lit_bufsize-1},a._tr_align=function(b){J(b,2,3),K(b,w,P),(function(_){_.bi_valid===16?(et(_,_.bi_buf),_.bi_buf=0,_.bi_valid=0):8<=_.bi_valid&&(_.pending_buf[_.pending++]=255&_.bi_buf,_.bi_buf>>=8,_.bi_valid-=8)})(b)}},{"../utils/common":41}],53:[function(e,s,a){s.exports=function(){this.input=null,this.next_in=0,this.avail_in=0,this.total_in=0,this.output=null,this.next_out=0,this.avail_out=0,this.total_out=0,this.msg="",this.state=null,this.data_type=2,this.adler=0}},{}],54:[function(e,s,a){(function(r){(function(i,o){if(!i.setImmediate){var l,c,p,m,g=1,f={},y=!1,h=i.document,x=Object.getPrototypeOf&&Object.getPrototypeOf(i);x=x&&x.setTimeout?x:i,l={}.toString.call(i.process)==="[object process]"?function(R){process.nextTick(function(){C(R)})}:(function(){if(i.postMessage&&!i.importScripts){var R=!0,A=i.onmessage;return i.onmessage=function(){R=!1},i.postMessage("","*"),i.onmessage=A,R}})()?(m="setImmediate$"+Math.random()+"$",i.addEventListener?i.addEventListener("message",w,!1):i.attachEvent("onmessage",w),function(R){i.postMessage(m+R,"*")}):i.MessageChannel?((p=new MessageChannel).port1.onmessage=function(R){C(R.data)},function(R){p.port2.postMessage(R)}):h&&"onreadystatechange"in h.createElement("script")?(c=h.documentElement,function(R){var A=h.createElement("script");A.onreadystatechange=function(){C(R),A.onreadystatechange=null,c.removeChild(A),A=null},c.appendChild(A)}):function(R){setTimeout(C,0,R)},x.setImmediate=function(R){typeof R!="function"&&(R=new Function(""+R));for(var A=new Array(arguments.length-1),S=0;S<A.length;S++)A[S]=arguments[S+1];var k={callback:R,args:A};return f[g]=k,l(g),g++},x.clearImmediate=T}function T(R){delete f[R]}function C(R){if(y)setTimeout(C,0,R);else{var A=f[R];if(A){y=!0;try{(function(S){var k=S.callback,G=S.args;switch(G.length){case 0:k();break;case 1:k(G[0]);break;case 2:k(G[0],G[1]);break;case 3:k(G[0],G[1],G[2]);break;default:k.apply(o,G)}})(A)}finally{T(R),y=!1}}}}function w(R){R.source===i&&typeof R.data=="string"&&R.data.indexOf(m)===0&&C(+R.data.slice(m.length))}})(typeof self>"u"?r===void 0?this:r:self)}).call(this,typeof ve<"u"?ve:typeof self<"u"?self:typeof window<"u"?window:{})},{}]},{},[10])(10)})})(Ve)),Ve.exports}var qa=Ha();const en=Wa(qa);function Za(n){if(n.length===0)return new Float32Array(0);if(n.length%4!==0)throw new Error(`Byte-shuffled float32 payload has invalid length (${n.length}).`);const t=n.length/4,e=new Uint8Array(n.length);for(let s=0;s<4;s+=1){const a=s*t;let r=s;for(let i=0;i<t;i+=1)e[r]=n[a+i],r+=4}return new Float32Array(e.buffer)}function ja(n){if(n.length===0)return new Float32Array(0);if(n.length%4!==0)throw new Error(`XOR-delta byte-shuffled float32 payload has invalid length (${n.length}).`);const t=n.length/4,e=Ka(n,t),s=new Uint32Array(e.buffer),a=new Uint32Array(t);let r=0;for(let i=0;i<t;i+=1){const o=s[i]^r;a[i]=o,r=o}return new Float32Array(a.buffer)}function $a(n){if(n.length===0)return new Uint8Array(0);if(n.length%4!==0)throw new Error(`Channel-major float32 source length must be divisible by 4 (${n.length}).`);const t=n.length/4,e=new Float32Array(n.length);for(let s=0;s<4;s+=1){const a=s*t;let r=s;for(let i=0;i<t;i+=1)e[a+i]=n[r],r+=4}return new Uint8Array(e.buffer)}function Qa(n){if(n.length===0)return new Float32Array(0);if(n.length%16!==0)throw new Error(`Channel-major float32 payload has invalid length (${n.length}).`);const t=new Float32Array(n.buffer,n.byteOffset,n.byteLength/4),e=t.length/4,s=new Float32Array(t.length);for(let a=0;a<4;a+=1){const r=a*e;let i=a;for(let o=0;o<e;o+=1)s[i]=t[r+o],i+=4}return s}function Ka(n,t){const e=new Uint8Array(n.length);for(let s=0;s<4;s+=1){const a=s*t;let r=s;for(let i=0;i<t;i+=1)e[r]=n[a+i],r+=4}return e}async function Ds(n,t,e,s,a,r,i={}){const o=i.encodeRasterImages??!0,l=i.zipCompression??"DEFLATE",c=i.zipDeflateLevel??9,p=new en,m=Ja(n,t,a),f=!!s&&s.length>0&&n.imagePaintOpCount>0&&r.length===0,y=f?[]:r,h=y[0]??null,x=f?"source/source.pdf":void 0;for(const A of m){const S=A.layout==="channel-major"?$a(A.data):new Uint8Array(A.data.buffer,A.data.byteOffset,A.data.byteLength);p.file(A.filePath,S)}x&&s&&p.file(x,s);const T=[];for(let A=0;A<y.length;A+=1){const S=y[A],k=S.width*S.height*4,G=S.data.subarray(0,k);let B=`raster/layer-${A}.rgba`,I="rgba",P=G;if(o){const v=await hs(S.width,S.height,G);v&&(B=`raster/layer-${A}.${v.extension}`,I=v.encoding,P=v.bytes)}p.file(B,P,{compression:"STORE"}),T.push({width:S.width,height:S.height,matrix:Array.from(S.matrix),file:B,encoding:I})}const C={formatVersion:3,sourceFile:e,sourcePdfFile:x,sourcePdfSizeBytes:f?s?.length??0:0,generatedAt:new Date().toISOString(),scene:{bounds:n.bounds,pageBounds:n.pageBounds,pageRects:Array.from(n.pageRects),pageTextRanges:Array.from(n.pageTextRanges),pageCount:n.pageCount,pagesPerRow:n.pagesPerRow,maxHalfWidth:n.maxHalfWidth,operatorCount:n.operatorCount,imagePaintOpCount:n.imagePaintOpCount,pathCount:n.pathCount,sourceSegmentCount:n.sourceSegmentCount,mergedSegmentCount:n.mergedSegmentCount,segmentCount:n.segmentCount,fillPathCount:n.fillPathCount,fillSegmentCount:n.fillSegmentCount,textInstanceCount:n.textInstanceCount,textGlyphCount:n.textGlyphCount,textGlyphPrimitiveCount:n.textGlyphSegmentCount,rasterLayers:T,rasterLayerWidth:h?.width??0,rasterLayerHeight:h?.height??0,rasterLayerMatrix:h?Array.from(h.matrix):void 0,rasterLayerFile:T[0]?.file},textures:m.map(A=>({name:A.name,file:A.filePath,width:A.width,height:A.height,channels:4,componentType:"float32",layout:A.layout,byteShuffle:!1,predictor:"none",logicalItemCount:A.logicalItemCount,logicalFloatCount:A.logicalFloatCount,paddedFloatCount:A.data.length}))};p.file("manifest.json",JSON.stringify(C,null,2));const w=l==="DEFLATE"?{type:"blob",compression:"DEFLATE",compressionOptions:{level:c}}:{type:"blob",compression:"STORE"},R=await p.generateAsync(w);return{blob:R,byteLength:R.size,textureCount:m.length,rasterLayerCount:y.length,layout:a}}function Ja(n,t,e){return[Mt("fill-path-meta-a",n.fillPathMetaA,t.fillPathTextureWidth,t.fillPathTextureHeight,n.fillPathCount,e),Mt("fill-path-meta-b",n.fillPathMetaB,t.fillPathTextureWidth,t.fillPathTextureHeight,n.fillPathCount,e),Mt("fill-path-meta-c",n.fillPathMetaC,t.fillPathTextureWidth,t.fillPathTextureHeight,n.fillPathCount,e),Mt("fill-primitives-a",n.fillSegmentsA,t.fillSegmentTextureWidth,t.fillSegmentTextureHeight,n.fillSegmentCount,e),Mt("fill-primitives-b",n.fillSegmentsB,t.fillSegmentTextureWidth,t.fillSegmentTextureHeight,n.fillSegmentCount,e),Mt("stroke-primitives-a",n.endpoints,t.textureWidth,t.textureHeight,n.segmentCount,e),Mt("stroke-primitives-b",n.primitiveMeta,t.textureWidth,t.textureHeight,n.segmentCount,e),Mt("stroke-styles",n.styles,t.textureWidth,t.textureHeight,n.segmentCount,e),Mt("stroke-primitive-bounds",n.primitiveBounds,t.textureWidth,t.textureHeight,n.segmentCount,e),Mt("text-instance-a",n.textInstanceA,t.textInstanceTextureWidth,t.textInstanceTextureHeight,n.textInstanceCount,e),Mt("text-instance-b",n.textInstanceB,t.textInstanceTextureWidth,t.textInstanceTextureHeight,n.textInstanceCount,e),Mt("text-instance-c",n.textInstanceC,t.textInstanceTextureWidth,t.textInstanceTextureHeight,n.textInstanceCount,e),Mt("text-glyph-meta-a",n.textGlyphMetaA,t.textGlyphTextureWidth,t.textGlyphTextureHeight,n.textGlyphCount,e),Mt("text-glyph-meta-b",n.textGlyphMetaB,t.textGlyphTextureWidth,t.textGlyphTextureHeight,n.textGlyphCount,e),Mt("text-glyph-primitives-a",n.textGlyphSegmentsA,t.textSegmentTextureWidth,t.textSegmentTextureHeight,n.textGlyphSegmentCount,e),Mt("text-glyph-primitives-b",n.textGlyphSegmentsB,t.textSegmentTextureWidth,t.textSegmentTextureHeight,n.textGlyphSegmentCount,e)]}async function Os(n,t={}){const e=Se(t.onProgress),s=await e.child(0,.16,{sourceType:"zip"}).withIndeterminateProgress(en.loadAsync(n),{stage:"zip-open",sourceType:"zip"}),a=s.file("manifest.json");if(!a)throw new Error("Parsed data zip is missing manifest.json.");const r=await e.child(.16,.22,{sourceType:"zip"}).withIndeterminateProgress(a.async("string"),{stage:"zip-manifest",sourceType:"zip"});let i;try{i=JSON.parse(r)}catch(vt){const St=vt instanceof Error?vt.message:String(vt);throw new Error(`Invalid manifest.json: ${St}`)}const o=typeof i.scene=="object"&&i.scene?i.scene:{},l=Array.isArray(i.textures)?i.textures:[],c=new Map,p=16;let m=0;const g=()=>{e.report(.22+m/p*.58,{stage:"zip-file",sourceType:"zip",unit:"files",processed:m,total:p})};for(const vt of l){const St=typeof vt.name=="string"?vt.name:null;St&&c.set(St,vt)}const f=async(vt,St)=>{try{g();for(const wt of vt){const Pt=c.get(wt);if(!Pt)continue;const Pe=typeof Pt.layout=="string"&&Pt.layout==="channel-major"?".f32cm":Pt.byteShuffle===!0?".f32bs":".f32",Fe=typeof Pt.file=="string"?Pt.file:`textures/${wt}${Pe}`,se=s.file(Fe);if(!se)continue;const oe=await se.async("arraybuffer"),Dt=gs(oe,Pt,wt),Ot=ut(Pt.logicalFloatCount,Dt.length);if(Ot>Dt.length)throw new Error(`Texture ${wt} logical float count exceeds file length.`);const Ai=ut(Pt.logicalItemCount,Math.floor(Ot/4));return{data:Dt.slice(0,Ot),logicalItemCount:Ai}}return null}finally{m+=1,g()}},y=await f(["fill-path-meta-a"],!1),h=await f(["fill-path-meta-b"],!1),x=await f(["fill-path-meta-c"],!1),T=await f(["fill-primitives-a","fill-segments"],!1),C=await f(["fill-primitives-b"],!1),w=await f(["stroke-primitives-a","stroke-endpoints"],!1),R=await f(["stroke-primitives-b"],!1),A=await f(["stroke-styles"],!1),S=await f(["stroke-primitive-bounds"],!1),k=await f(["text-instance-a"],!1),G=await f(["text-instance-b"],!1),B=await f(["text-instance-c"],!1),I=await f(["text-glyph-meta-a"],!1),P=await f(["text-glyph-meta-b"],!1),v=await f(["text-glyph-primitives-a"],!1),E=await f(["text-glyph-primitives-b"],!1),u=ut(o.fillPathCount,y?.logicalItemCount??0),F=ut(o.fillSegmentCount,T?.logicalItemCount??0),q=ut(o.segmentCount,A?.logicalItemCount??w?.logicalItemCount??0),U=ut(o.textInstanceCount,k?.logicalItemCount??0),tt=ut(o.textGlyphCount,I?.logicalItemCount??0),V=ut(o.textGlyphPrimitiveCount,ut(o.textGlyphSegmentCount,v?.logicalItemCount??0));if(q>0&&(!w||!A))throw new Error("Parsed data zip is missing stroke geometry textures.");const Q=_t(y?.data??new Float32Array(0),u,"fill-path-meta-a"),D=_t(h?.data??new Float32Array(0),u,"fill-path-meta-b"),L=_t(x?.data??new Float32Array(0),u,"fill-path-meta-c"),et=_t(T?.data??new Float32Array(0),F,"fill-primitives-a"),J=C?_t(C.data,F,"fill-primitives-b"):zn(et,F),K=_t(w?.data??new Float32Array(0),q,"stroke-primitives-a"),ot=_t(A?.data??new Float32Array(0),q,"stroke-styles"),lt=R?_t(R.data,q,"stroke-primitives-b"):zn(K,q),rt=S?_t(S.data,q,"stroke-primitive-bounds"):rs(K,lt,q),nt=_t(k?.data??new Float32Array(0),U,"text-instance-a"),st=_t(G?.data??new Float32Array(0),U,"text-instance-b"),ct=B?_t(B.data,U,"text-instance-c"):es(st,U),mt=_t(I?.data??new Float32Array(0),tt,"text-glyph-meta-a"),xt=_t(P?.data??new Float32Array(0),tt,"text-glyph-meta-b"),d=_t(v?.data??new Float32Array(0),V,"text-glyph-primitives-a"),Z=_t(E?.data??new Float32Array(0),V,"text-glyph-primitives-b");ns(lt,ot,q),is(D,L,u);const z=ut(o.sourceSegmentCount,q),M=ut(o.mergedSegmentCount,q),b=ut(o.sourceTextCount,U),_=ut(o.textInPageCount,U),W=ut(o.textOutOfPageCount,Math.max(0,b-_)),Y=Math.max(1,ut(o.pageCount,1)),O=Math.max(1,ut(o.pagesPerRow,1));e.report(.82,{stage:"zip-file",sourceType:"zip",unit:"files"});let $=await ms(s,o);if(e.report(.88,{stage:"compile",sourceType:"zip"}),$.length===0){const vt=await us(s,i);if(vt)try{const St=await Hr(vs(vt),{maxPages:Y,maxPagesPerRow:O});$=ts(St),$.length>0&&console.log(`[Parsed data load] Restored ${$.length.toLocaleString()} raster layer(s) from embedded source PDF.`)}catch(St){const wt=St instanceof Error?St.message:String(St);console.warn(`[Parsed data load] Failed to restore raster layers from source PDF: ${wt}`)}}const j=$[0]??null,X=ne(o.maxHalfWidth,Number.NaN)||ps(ot,q),N=Nn(o.bounds),at=Nn(o.pageBounds),it=os(as(rt,q),ss(Q,D,u))??{minX:0,minY:0,maxX:1,maxY:1},pt=N??it,Rt=at??pt,At=ls(o.pageRects,Rt),Lt=cs(o.pageTextRanges,Math.max(1,Math.floor(At.length/4)),U)??pi(At,st,U);e.report(.96,{stage:"compile",sourceType:"zip"});const ft=mi({pageRects:At,pageTextRanges:Lt,fillPathCount:u,fillSegmentCount:F,fillPathMetaA:Q,fillPathMetaB:D,fillPathMetaC:L,fillSegmentsA:et,fillSegmentsB:J,segmentCount:q,sourceSegmentCount:z,mergedSegmentCount:M,sourceTextCount:b,textInstanceCount:U,textGlyphCount:tt,textGlyphSegmentCount:V,textInPageCount:_,textOutOfPageCount:W,textInstanceA:nt,textInstanceB:st,textInstanceC:ct,textGlyphMetaA:mt,textGlyphMetaB:xt,textGlyphSegmentsA:d,textGlyphSegmentsB:Z,rasterLayers:$,rasterLayerWidth:j?.width??0,rasterLayerHeight:j?.height??0,rasterLayerData:j?.data??new Uint8Array(0),rasterLayerMatrix:j?.matrix??new Float32Array([1,0,0,1,0,0]),endpoints:K,primitiveMeta:lt,primitiveBounds:rt,styles:ot,bounds:pt,pageBounds:Rt,pageCount:Y,pagesPerRow:O,maxHalfWidth:X,imagePaintOpCount:ut(o.imagePaintOpCount,0),operatorCount:ut(o.operatorCount,0),pathCount:ut(o.pathCount,0),discardedTransparentCount:ut(o.discardedTransparentCount,0),discardedDegenerateCount:ut(o.discardedDegenerateCount,0),discardedDuplicateCount:ut(o.discardedDuplicateCount,0),discardedContainedCount:ut(o.discardedContainedCount,0)});return e.complete({sourceType:"zip"}),ft}function ts(n){const t=[];if(Array.isArray(n.rasterLayers))for(const a of n.rasterLayers){const r=Math.max(0,Math.trunc(a?.width??0)),i=Math.max(0,Math.trunc(a?.height??0));if(r<=0||i<=0||!(a.data instanceof Uint8Array)||a.data.length<r*i*4)continue;const o=a.matrix instanceof Float32Array?a.matrix:new Float32Array(a.matrix);t.push({width:r,height:i,data:a.data,matrix:o})}if(t.length>0)return t;const e=Math.max(0,Math.trunc(n.rasterLayerWidth)),s=Math.max(0,Math.trunc(n.rasterLayerHeight));return e<=0||s<=0||n.rasterLayerData.length<e*s*4||t.push({width:e,height:s,data:n.rasterLayerData,matrix:n.rasterLayerMatrix}),t}function _t(n,t,e){const s=t*4;if(s===0)return new Float32Array(0);if(n.length<s)throw new Error(`Texture ${e} has insufficient data (${n.length} < ${s}).`);return n.length===s?n:n.slice(0,s)}function zn(n,t){const e=new Float32Array(t*4);for(let s=0;s<t;s+=1){const a=s*4;e[a]=n[a+2],e[a+1]=n[a+3],e[a+2]=0,e[a+3]=0}return e}function es(n,t){const e=new Float32Array(t*4);for(let s=0;s<t;s+=1){const a=s*4,r=ae(n[a+3]);e[a]=r,e[a+1]=r,e[a+2]=r,e[a+3]=1}return e}function ae(n){return!Number.isFinite(n)||n<0?0:n>1?1:n}function ns(n,t,e){if(e<=0)return;let s=!1;for(let a=0;a<e;a+=1)if(Math.abs(n[a*4+3])>1e-6){s=!0;break}if(!s)for(let a=0;a<e;a+=1){const r=a*4,i=ae(t[r+1]),o=ae(t[r+2]),l=t[r+3]>=.5?1:0;t[r+1]=i,t[r+2]=i,t[r+3]=i,n[r+3]=o+l*2}}function is(n,t,e){if(e<=0)return;let s=!1;for(let a=0;a<e;a+=1)if(Math.abs(t[a*4+3])>1e-6){s=!0;break}if(!s)for(let a=0;a<e;a+=1){const r=a*4,i=ae(n[r+2]),o=ae(n[r+3]);n[r+2]=i,n[r+3]=i,t[r+2]=i,t[r+3]=o}}function rs(n,t,e){const s=new Float32Array(e*4);for(let a=0;a<e;a+=1){const r=a*4,i=n[r],o=n[r+1],l=n[r+2],c=n[r+3],p=t[r],m=t[r+1];s[r]=Math.min(i,l,p),s[r+1]=Math.min(o,c,m),s[r+2]=Math.max(i,l,p),s[r+3]=Math.max(o,c,m)}return s}function as(n,t){if(t<=0||n.length<t*4)return null;let e=Number.POSITIVE_INFINITY,s=Number.POSITIVE_INFINITY,a=Number.NEGATIVE_INFINITY,r=Number.NEGATIVE_INFINITY;for(let i=0;i<t;i+=1){const o=i*4;e=Math.min(e,n[o]),s=Math.min(s,n[o+1]),a=Math.max(a,n[o+2]),r=Math.max(r,n[o+3])}return{minX:e,minY:s,maxX:a,maxY:r}}function ss(n,t,e){if(e<=0||n.length<e*4||t.length<e*4)return null;let s=Number.POSITIVE_INFINITY,a=Number.POSITIVE_INFINITY,r=Number.NEGATIVE_INFINITY,i=Number.NEGATIVE_INFINITY;for(let o=0;o<e;o+=1){const l=o*4;s=Math.min(s,n[l+2]),a=Math.min(a,n[l+3]),r=Math.max(r,t[l]),i=Math.max(i,t[l+1])}return{minX:s,minY:a,maxX:r,maxY:i}}function os(n,t){return!n&&!t?null:n?t?{minX:Math.min(n.minX,t.minX),minY:Math.min(n.minY,t.minY),maxX:Math.max(n.maxX,t.maxX),maxY:Math.max(n.maxY,t.maxY)}:{...n}:t?{...t}:null}function Nn(n){if(!n||typeof n!="object")return null;const t=n,e=ne(t.minX,Number.NaN),s=ne(t.minY,Number.NaN),a=ne(t.maxX,Number.NaN),r=ne(t.maxY,Number.NaN);return[e,s,a,r].every(Number.isFinite)?{minX:e,minY:s,maxX:a,maxY:r}:null}function ls(n,t){if(Array.isArray(n)){const e=Math.floor(n.length/4);if(e>0){const s=new Float32Array(e*4);let a=0;for(let r=0;r<e;r+=1){const i=r*4,o=Number(n[i]),l=Number(n[i+1]),c=Number(n[i+2]),p=Number(n[i+3]);[o,l,c,p].every(Number.isFinite)&&(s[a]=o,s[a+1]=l,s[a+2]=c,s[a+3]=p,a+=4)}if(a>0)return s.slice(0,a)}}return new Float32Array([t.minX,t.minY,t.maxX,t.maxY])}function cs(n,t,e){if(!Array.isArray(n))return null;const s=Math.max(1,t|0);if(n.length<s*2)return null;const a=Math.max(0,e|0),r=new Uint32Array(s*2);let i=0;for(let o=0;o<s;o+=1){const l=o*2,c=ut(n[l],i),p=ut(n[l+1],0),m=Math.min(Math.max(c,i),a),g=Math.min(p,Math.max(0,a-m));r[l]=m,r[l+1]=g,i=m+g}return r}function Vn(n){if(!Array.isArray(n)||n.length<6)return null;const t=new Float32Array(6);for(let e=0;e<6;e+=1){const s=Number(n[e]);if(!Number.isFinite(s))return null;t[e]=s}return t}async function us(n,t){const e=je(t.sourcePdfFile),s=je(t.sourcePdfUrl),a=[e,"source/source.pdf","source.pdf"];for(const r of a){if(!r)continue;const i=n.file(r);if(!i)continue;const o=await i.async("arraybuffer");if(!(o.byteLength<=0))return new Uint8Array(o)}if(s)try{const r=await fetch(Ts(s));if(r.ok){const i=await r.arrayBuffer();if(i.byteLength>0)return new Uint8Array(i)}}catch{}return null}async function hs(n,t,e){const[s,a]=await Promise.all([Yn(n,t,e,"image/webp"),Yn(n,t,e,"image/png")]);return!s&&!a?null:s&&!a?{bytes:s,encoding:"webp",extension:"webp"}:a&&!s?{bytes:a,encoding:"png",extension:"png"}:!s||!a?null:s.byteLength<a.byteLength?{bytes:s,encoding:"webp",extension:"webp"}:{bytes:a,encoding:"png",extension:"png"}}async function Yn(n,t,e,s){if(typeof document>"u")return null;const a=n*t*4;if(n<=0||t<=0||e.length<a)return null;const r=document.createElement("canvas");r.width=n,r.height=t;const i=r.getContext("2d",{alpha:!0});if(!i)return r.width=0,r.height=0,null;const o=new Uint8ClampedArray(a);o.set(e.subarray(0,a));const l=new ImageData(o,n,t);i.putImageData(l,0,0);const c=await new Promise(m=>{r.toBlob(m,s)});if(r.width=0,r.height=0,!c)return null;const p=await c.arrayBuffer();return new Uint8Array(p)}function ds(n){const t=n.toLowerCase();return t.endsWith(".png")?"image/png":t.endsWith(".webp")?"image/webp":t.endsWith(".jpg")||t.endsWith(".jpeg")?"image/jpeg":null}async function fs(n,t){if(typeof document>"u")return null;const e=ds(n);if(!e)return null;const s=new Uint8Array(t.length);s.set(t);const a=new Blob([s],{type:e}),r=await createImageBitmap(a);try{const i=r.width,o=r.height;if(i<=0||o<=0)return null;const l=document.createElement("canvas");l.width=i,l.height=o;const c=l.getContext("2d",{alpha:!0,willReadFrequently:!0});if(!c)return l.width=0,l.height=0,null;c.drawImage(r,0,0);const p=c.getImageData(0,0,i,o),m=new Uint8Array(p.data);return l.width=0,l.height=0,{width:i,height:o,data:m}}finally{r.close()}}async function Gs(n){try{const t=await en.loadAsync(n),e=t.file("manifest.json");let s=null;if(e){const r=await e.async("string");try{const i=JSON.parse(r);s=je(i.sourcePdfFile)}catch{s=null}}const a=[s,"source/source.pdf","source.pdf"];for(const r of a){if(!r)continue;const i=t.file(r);if(!i)continue;const o=await i.async("arraybuffer");if(!(o.byteLength<=0))return new Uint8Array(o)}}catch{}return null}async function ms(n,t){const e=[],s=Array.isArray(t.rasterLayers)?t.rasterLayers:[];for(let c=0;c<s.length;c+=1){const p=s[c];if(!p||typeof p!="object")continue;const m=p,g=ut(m.width,0),f=ut(m.height,0),y=typeof m.file=="string"?m.file:`raster/layer-${c}.rgba`,h=Vn(m.matrix)??new Float32Array([1,0,0,1,0,0]),x=await Wn(n,y,g,f);!x||x.width<=0||x.height<=0||x.data.length<x.width*x.height*4||e.push({width:x.width,height:x.height,matrix:h,data:x.data})}if(e.length>0)return e;const a=ut(t.rasterLayerWidth,0),r=ut(t.rasterLayerHeight,0),i=Vn(t.rasterLayerMatrix)??new Float32Array([1,0,0,1,0,0]),o=n.file("raster/layer-0.webp")?"raster/layer-0.webp":n.file("raster/layer-0.png")?"raster/layer-0.png":n.file("raster/layer-0.rgba")?"raster/layer-0.rgba":n.file("raster/layer.webp")?"raster/layer.webp":n.file("raster/layer.png")?"raster/layer.png":"raster/layer.rgba",l=await Wn(n,typeof t.rasterLayerFile=="string"?t.rasterLayerFile:o,a,r);return l&&l.width>0&&l.height>0&&l.data.length>=l.width*l.height*4&&e.push({width:l.width,height:l.height,data:l.data,matrix:i}),e}async function Wn(n,t,e,s){const a=n.file(t);if(!a)return null;const r=await a.async("arraybuffer"),i=new Uint8Array(r),o=await fs(t,i);if(o)return o;if(e<=0||s<=0)return null;const l=e*s*4;if(i.length<l)throw new Error(`Raster layer data is truncated (${i.length} < ${l}).`);return{width:e,height:s,data:i.length===l?i:i.slice(0,l)}}function ps(n,t){let e=0;for(let s=0;s<t;s+=1)e=Math.max(e,n[s*4]);return e}function ne(n,t){const e=Number(n);return Number.isFinite(e)?e:t}function ut(n,t){const e=Number(n);return Number.isFinite(e)?Math.max(0,Math.trunc(e)):Math.max(0,Math.trunc(t))}function je(n){if(typeof n!="string")return null;const t=n.trim();return t.length>0?t:null}function Mt(n,t,e,s,a,r){const i=a*4;if(t.length<i)throw new Error(`Texture ${n} has insufficient data (${t.length} < ${i}).`);return{name:n,filePath:`textures/${n}.f32`,width:e,height:s,logicalItemCount:a,logicalFloatCount:i,data:t.subarray(0,i),layout:r}}function gs(n,t,e){const s=typeof t.componentType=="string"?t.componentType:"float32";if(s!=="float32")throw new Error(`Texture ${e} has unsupported componentType ${String(s)}.`);const a=typeof t.layout=="string"?t.layout:"interleaved";if(a!=="interleaved"&&a!=="channel-major")throw new Error(`Texture ${e} has unsupported layout ${String(a)}.`);if(a==="channel-major")return Qa(new Uint8Array(n));const r=t.byteShuffle===!0,i=typeof t.predictor=="string"?t.predictor:"none";if(i!=="none"&&i!=="xor-delta-u32")throw new Error(`Texture ${e} has unsupported predictor ${String(i)}.`);if(r)return i==="xor-delta-u32"?ja(new Uint8Array(n)):Za(new Uint8Array(n));if(i!=="none")throw new Error(`Texture ${e} declares predictor ${i} without byteShuffle.`);if(n.byteLength%4!==0)throw new Error(`Texture ${e} has invalid byte length (${n.byteLength}).`);return new Float32Array(n)}const xs=/^[a-z][a-z\d+.-]*:/i,ys=new URL("./",window.location.href);function Ts(n){const t=n.trim();if(xs.test(t))return t;const e=t.replace(/^\/+/,"");return new URL(e,ys).toString()}function vs(n){return n.slice().buffer}const Cs=/^[a-z][a-z\d+.-]*:/i;function Hn(n){const t=n.trim();if(Cs.test(t))return t;const e=t.replace(/^\/+/,""),s=new URL("./",window.location.href);return new URL(e,s).toString()}function Us(n){const t=Array.isArray(n.examples)?n.examples:[],e=[];for(let s=0;s<t.length;s+=1){const a=t[s],r=be(a?.name);if(!r)continue;const i=be(a?.id)??`example-${s+1}`,o=be(a?.pdf?.path),l=be(a?.parsedZip?.path),c=o?Hn(o):null,p=l?Hn(l):null;!c||!p||e.push({id:i,name:r,pdfPath:c,pdfSizeBytes:qn(a?.pdf?.sizeBytes,0),zipPath:p,zipSizeBytes:qn(a?.parsedZip?.sizeBytes,0)})}return e}function qn(n,t){const e=Number(n);return Number.isFinite(e)?Math.max(0,Math.trunc(e)):Math.max(0,Math.trunc(t))}function be(n){if(typeof n!="string")return null;const t=n.trim();return t.length>0?t:null}export{_s as C,Ps as W,ks as a,Os as b,Se as c,Ds as d,Bs as e,Ls as f,Fs as g,ri as h,ws as i,Is as j,Es as k,ts as l,Ss as m,Us as n,As as o,bs as p,jn as q,Hn as r,Rs as s,Gs as t,Ms as u};
