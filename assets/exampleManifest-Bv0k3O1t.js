(function(){const t=document.createElement("link").relList;if(t&&t.supports&&t.supports("modulepreload"))return;for(const a of document.querySelectorAll('link[rel="modulepreload"]'))s(a);new MutationObserver(a=>{for(const r of a)if(r.type==="childList")for(const i of r.addedNodes)i.tagName==="LINK"&&i.rel==="modulepreload"&&s(i)}).observe(document,{childList:!0,subtree:!0});function e(a){const r={};return a.integrity&&(r.integrity=a.integrity),a.referrerPolicy&&(r.referrerPolicy=a.referrerPolicy),a.crossOrigin==="use-credentials"?r.credentials="include":a.crossOrigin==="anonymous"?r.credentials="omit":r.credentials="same-origin",r}function s(a){if(a.ep)return;a.ep=!0;const r=e(a);fetch(a.href,r)}})();const Os=""+new URL("pdf.worker.min-wgc6bjNh.mjs",import.meta.url).href,sn=64,on=1024,Mi=3e4,Ei=22e4;function Qn(n){const t=n.segmentCount,e=Math.max(n.bounds.maxX-n.bounds.minX,1e-5),s=Math.max(n.bounds.maxY-n.bounds.minY,1e-5),{gridWidth:a,gridHeight:r}=Ri(t,e,s),i=a*r,o=e/a,l=s/r,c=new Uint32Array(i);let p=0;for(let u=0;u<t;u+=1){const x=u*4,T=u*4,S=n.styles[T]+.35,E=n.primitiveBounds[x]-S,A=n.primitiveBounds[x+1]-S,w=n.primitiveBounds[x+2]+S,k=n.primitiveBounds[x+3]+S,N=Gt(Math.floor((E-n.bounds.minX)/o),a),B=Gt(Math.floor((w-n.bounds.minX)/o),a),I=Gt(Math.floor((A-n.bounds.minY)/l),r),P=Gt(Math.floor((k-n.bounds.minY)/l),r);for(let v=I;v<=P;v+=1){let R=v*a+N;for(let h=N;h<=B;h+=1){const F=c[R]+1;c[R]=F,F>p&&(p=F),R+=1}}}const m=new Uint32Array(i+1);for(let u=0;u<i;u+=1)m[u+1]=m[u]+c[u];const g=m[i],d=new Uint32Array(g),y=m.slice(0,i);for(let u=0;u<t;u+=1){const x=u*4,T=u*4,S=n.styles[T]+.35,E=n.primitiveBounds[x]-S,A=n.primitiveBounds[x+1]-S,w=n.primitiveBounds[x+2]+S,k=n.primitiveBounds[x+3]+S,N=Gt(Math.floor((E-n.bounds.minX)/o),a),B=Gt(Math.floor((w-n.bounds.minX)/o),a),I=Gt(Math.floor((A-n.bounds.minY)/l),r),P=Gt(Math.floor((k-n.bounds.minY)/l),r);for(let v=I;v<=P;v+=1){let R=v*a+N;for(let h=N;h<=B;h+=1){const F=y[R];d[F]=u,y[R]=F+1,R+=1}}}return{gridWidth:a,gridHeight:r,minX:n.bounds.minX,minY:n.bounds.minY,maxX:n.bounds.maxX,maxY:n.bounds.maxY,cellWidth:o,cellHeight:l,offsets:m,counts:c,indices:d,maxCellPopulation:p}}function Ri(n,t,e){const s=ke(Math.round(n/8),Mi,Ei),a=t/e;let r=Math.round(Math.sqrt(s*a)),i=Math.round(s/Math.max(r,1));return r=ke(r,sn,on),i=ke(i,sn,on),{gridWidth:r,gridHeight:i}}function Gt(n,t){return n<0?0:n>=t?t-1:n}function ke(n,t,e){return n<t?t:n>e?e:n}const Ii=96,Pi=[1,.85,.7,.55,.4,.3],qe=8,ln=256,Qt=8,cn=.001;function Kn(n,t){if(typeof document>"u"||n.textGlyphCount<=0)return null;const e=new Float32Array(n.textGlyphCount*4),s=re(Math.trunc(t)||4096,256,8192);let a=null;for(const c of Pi){const p=Math.max(qe,Math.round(Ii*c)),m=Fi(n,p);if(m.length===0)return null;const g=Bi(m,s);if(g){a=g;break}}if(!a)return null;const r=document.createElement("canvas");r.width=a.width,r.height=a.height;const i=r.getContext("2d",{alpha:!0,willReadFrequently:!0});if(!i)return null;i.setTransform(1,0,0,1,0,0),i.clearRect(0,0,a.width,a.height),i.fillStyle="#ffffff",i.globalCompositeOperation="source-over";for(const c of a.placements){if(!ki(i,c,n))continue;i.fill("nonzero");const p=c.index*4;e[p]=(c.x+Qt)/a.width,e[p+1]=(c.y+Qt)/a.height,e[p+2]=c.innerWidth/a.width,e[p+3]=c.innerHeight/a.height}const o=i.getImageData(0,0,a.width,a.height),l=new Uint8Array(a.width*a.height);for(let c=0,p=0;p<l.length;c+=4,p+=1)l[p]=o.data[c+3];return{width:a.width,height:a.height,alpha:l,glyphUvRects:e}}function Fi(n,t){const e=[];for(let s=0;s<n.textGlyphCount;s+=1){const a=s*4,r=Math.max(0,Math.trunc(n.textGlyphMetaA[a])),i=Math.max(0,Math.trunc(n.textGlyphMetaA[a+1]));if(i<=0)continue;const o=n.textGlyphMetaA[a+2],l=n.textGlyphMetaA[a+3],c=n.textGlyphMetaB[a],p=n.textGlyphMetaB[a+1],m=c-o,g=p-l;if(!Number.isFinite(m)||!Number.isFinite(g)||m<=1e-6||g<=1e-6)continue;const d=t/Math.max(m,g),y=re(Math.ceil(m*d),qe,ln),u=re(Math.ceil(g*d),qe,ln);e.push({index:s,segmentStart:r,segmentCount:i,minX:o,minY:l,maxX:c,maxY:p,innerWidth:y,innerHeight:u,tileWidth:y+Qt*2,tileHeight:u+Qt*2,x:0,y:0})}return e}function Bi(n,t){if(n.length===0)return null;const e=n.slice().sort((i,o)=>i.tileHeight!==o.tileHeight?o.tileHeight-i.tileHeight:o.tileWidth-i.tileWidth),s=e.reduce((i,o)=>i+o.tileWidth*o.tileHeight,0),a=e.reduce((i,o)=>Math.max(i,o.tileWidth),0);let r=re(hn(Math.ceil(Math.sqrt(s)*1.15)),a,t);for(;r<=t;){let i=0,o=0,l=0,c=!1;for(const p of e){if(p.tileWidth>r){c=!0;break}if(i+p.tileWidth>r&&(i=0,o+=l,l=0),p.x=i,p.y=o,i+=p.tileWidth,l=Math.max(l,p.tileHeight),o+l>t){c=!0;break}}if(!c){const p=o+l,m=re(hn(Math.max(p,1)),1,t);if(m<=t)return{placements:e,width:r,height:m}}if(r===t)break;r=Math.min(t,r*2)}return null}function ki(n,t,e){const s=Math.max(t.maxX-t.minX,1e-6),a=Math.max(t.maxY-t.minY,1e-6),r=t.innerWidth/s,i=t.innerHeight/a,o=t.x+Qt-t.minX*r,l=t.y+Qt+t.maxY*i,c=T=>o+T*r,p=T=>l-T*i;n.beginPath();let m=!1,g=!1,d=0,y=0,u=0,x=0;for(let T=0;T<t.segmentCount;T+=1){const S=(t.segmentStart+T)*4;if(S+3>=e.textGlyphSegmentsA.length||S+3>=e.textGlyphSegmentsB.length)break;const E=e.textGlyphSegmentsA[S],A=e.textGlyphSegmentsA[S+1],w=e.textGlyphSegmentsA[S+2],k=e.textGlyphSegmentsA[S+3],N=e.textGlyphSegmentsB[S],B=e.textGlyphSegmentsB[S+1],I=e.textGlyphSegmentsB[S+2];(!g||!un(E,A,u,x))&&(g&&n.closePath(),n.moveTo(c(E),p(A)),g=!0,d=E,y=A),I>=.5?n.quadraticCurveTo(c(w),p(k),c(N),p(B)):n.lineTo(c(N),p(B)),m=!0,u=N,x=B,un(u,x,d,y)&&(n.closePath(),g=!1)}return g&&n.closePath(),m}function un(n,t,e,s){return Math.abs(n-e)<=cn&&Math.abs(t-s)<=cn}function hn(n){if(n<=1)return 1;let t=1;for(;t<n;)t<<=1;return t}function re(n,t,e){return n<t?t:n>e?e:n}const Jn=`#version 300 es
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
`,ti=`#version 300 es
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
`,ei=`#version 300 es
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
`,ni=`#version 300 es
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
`,ii=`#version 300 es
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
`,ri=`#version 300 es
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
`,dn=`#version 300 es
precision highp float;

layout(location = 0) in vec2 aCorner;

void main() {
  gl_Position = vec4(aCorner, 0.0, 1.0);
}
`,Di=`#version 300 es
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
`,Li=`#version 300 es
precision highp float;

uniform sampler2D uVectorLayerTex;
uniform vec2 uViewportPx;

out vec4 outColor;

void main() {
  vec2 uv = gl_FragCoord.xy / max(uViewportPx, vec2(1.0));
  outColor = texture(uVectorLayerTex, clamp(uv, vec2(0.0), vec2(1.0)));
}
`,ai=`#version 300 es
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
`,si=`#version 300 es
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
`,Oi=140,fn=3e5,mn=1.8,pn=96,Ni=1e-5,Gi=.75,Ui=1.3333333333,zi=2,Xi=2.25,De=24,Wt=1e-4,le=1e-5,Vi=64,gn=5,xn=2e4,Yi=120,ce=160/255,ue=169/255,he=175/255,Ns=Jn,Gs=ti,Us=ei,zs=ni,Xs=ii,Vs=ri,Ys=ai,Ws=si;class Hs{canvas;gl;segmentProgram;fillProgram;textProgram;blitProgram;vectorCompositeProgram;rasterProgram;segmentVao;fillVao;textVao;blitVao;cornerBuffer;allSegmentIdBuffer;visibleSegmentIdBuffer;allFillPathIdBuffer;allTextInstanceIdBuffer;segmentTextureA;segmentTextureB;segmentTextureC;segmentTextureD;fillPathMetaTextureA;fillPathMetaTextureB;fillPathMetaTextureC;fillSegmentTextureA;fillSegmentTextureB;textInstanceTextureA;textInstanceTextureB;textInstanceTextureC;textGlyphMetaTextureA;textGlyphMetaTextureB;textGlyphRasterMetaTexture;textGlyphSegmentTextureA;textGlyphSegmentTextureB;textRasterAtlasTexture;pageBackgroundTexture;uSegmentTexA;uSegmentTexB;uSegmentStyleTex;uSegmentBoundsTex;uSegmentTexSize;uViewport;uCameraCenter;uZoom;uAAScreenPx;uStrokeCurveEnabled;uStrokeVectorOverride;uFillPathMetaTexA;uFillPathMetaTexB;uFillPathMetaTexC;uFillSegmentTexA;uFillSegmentTexB;uFillPathMetaTexSize;uFillSegmentTexSize;uFillViewport;uFillCameraCenter;uFillZoom;uFillAAScreenPx;uFillVectorOverride;uTextInstanceTexA;uTextInstanceTexB;uTextInstanceTexC;uTextGlyphMetaTexA;uTextGlyphMetaTexB;uTextGlyphRasterMetaTex;uTextGlyphSegmentTexA;uTextGlyphSegmentTexB;uTextInstanceTexSize;uTextGlyphMetaTexSize;uTextGlyphSegmentTexSize;uTextViewport;uTextCameraCenter;uTextZoom;uTextAAScreenPx;uTextCurveEnabled;uTextRasterAtlasTex;uTextRasterAtlasSize;uTextVectorOnly;uTextVectorOverride;uCacheTex;uViewportPx;uCacheSizePx;uOffsetPx;uSampleScale;uVectorLayerTex;uVectorLayerViewportPx;uRasterTex;uRasterMatrixABCD;uRasterMatrixEF;uRasterViewport;uRasterCameraCenter;uRasterZoom;scene=null;grid=null;sceneStats=null;allSegmentIds=new Float32Array(0);visibleSegmentIds=new Float32Array(0);allFillPathIds=new Float32Array(0);allTextInstanceIds=new Float32Array(0);segmentMarks=new Uint32Array(0);segmentMinX=new Float32Array(0);segmentMinY=new Float32Array(0);segmentMaxX=new Float32Array(0);segmentMaxY=new Float32Array(0);markToken=1;segmentCount=0;fillPathCount=0;textInstanceCount=0;rasterLayers=[];pageRects=new Float32Array(0);pageTextRanges=new Uint32Array(0);visiblePageRectIndices=new Uint32Array(0);visiblePageRectCount=0;visibleTextRanges=[];visibleSegmentCount=0;usingAllSegments=!0;segmentTextureWidth=1;segmentTextureHeight=1;fillPathMetaTextureWidth=1;fillPathMetaTextureHeight=1;fillSegmentTextureWidth=1;fillSegmentTextureHeight=1;textInstanceTextureWidth=1;textInstanceTextureHeight=1;textGlyphMetaTextureWidth=1;textGlyphMetaTextureHeight=1;textRasterAtlasWidth=1;textRasterAtlasHeight=1;textGlyphSegmentTextureWidth=1;textGlyphSegmentTextureHeight=1;needsVisibleSetUpdate=!1;rafHandle=0;frameListener=null;interactionViewportProvider=null;externalFrameDriver=!1;presentedCameraCenterX=0;presentedCameraCenterY=0;presentedZoom=1;presentedFrameSerial=0;cameraCenterX=0;cameraCenterY=0;zoom=1;targetCameraCenterX=0;targetCameraCenterY=0;targetZoom=1;lastCameraAnimationTimeMs=0;hasZoomAnchor=!1;zoomAnchorClientX=0;zoomAnchorClientY=0;zoomAnchorWorldX=0;zoomAnchorWorldY=0;panVelocityWorldX=0;panVelocityWorldY=0;lastPanVelocityUpdateTimeMs=0;lastPanFrameCameraX=0;lastPanFrameCameraY=0;lastPanFrameTimeMs=0;minZoom=.01;maxZoom=4096;lastInteractionTime=Number.NEGATIVE_INFINITY;isPanInteracting=!1;panCacheTexture=null;panCacheFramebuffer=null;panCacheWidth=0;panCacheHeight=0;panCacheValid=!1;panCacheCenterX=0;panCacheCenterY=0;panCacheZoom=1;panCacheRenderedSegments=0;panCacheUsedCulling=!1;vectorMinifyTexture=null;vectorMinifyFramebuffer=null;vectorMinifyWidth=0;vectorMinifyHeight=0;vectorMinifyWarmupPending=!1;panOptimizationEnabled=!0;rasterRenderingEnabled=!0;fillRenderingEnabled=!0;strokeRenderingEnabled=!0;textRenderingEnabled=!0;strokeCurveEnabled=!0;textVectorOnly=!1;hasCameraInteractionSinceSceneLoad=!1;pageBackgroundColor=[1,1,1,1];vectorOverrideColor=[0,0,0];vectorOverrideOpacity=0;constructor(t){this.canvas=t;const e=t.getContext("webgl2",{antialias:!1,depth:!1,stencil:!1,alpha:!1,premultipliedAlpha:!1});if(!e)throw new Error("WebGL2 is required for this proof-of-concept renderer.");this.gl=e,this.segmentProgram=this.createProgram(Jn,ti),this.fillProgram=this.createProgram(ei,ni),this.textProgram=this.createProgram(ii,ri),this.blitProgram=this.createProgram(dn,Di),this.vectorCompositeProgram=this.createProgram(dn,Li),this.rasterProgram=this.createProgram(ai,si),this.segmentVao=this.createVertexArray(),this.fillVao=this.createVertexArray(),this.textVao=this.createVertexArray(),this.blitVao=this.createVertexArray(),this.cornerBuffer=this.mustCreateBuffer(),this.allSegmentIdBuffer=this.mustCreateBuffer(),this.visibleSegmentIdBuffer=this.mustCreateBuffer(),this.allFillPathIdBuffer=this.mustCreateBuffer(),this.allTextInstanceIdBuffer=this.mustCreateBuffer(),this.segmentTextureA=this.mustCreateTexture(),this.segmentTextureB=this.mustCreateTexture(),this.segmentTextureC=this.mustCreateTexture(),this.segmentTextureD=this.mustCreateTexture(),this.fillPathMetaTextureA=this.mustCreateTexture(),this.fillPathMetaTextureB=this.mustCreateTexture(),this.fillPathMetaTextureC=this.mustCreateTexture(),this.fillSegmentTextureA=this.mustCreateTexture(),this.fillSegmentTextureB=this.mustCreateTexture(),this.textInstanceTextureA=this.mustCreateTexture(),this.textInstanceTextureB=this.mustCreateTexture(),this.textInstanceTextureC=this.mustCreateTexture(),this.textGlyphMetaTextureA=this.mustCreateTexture(),this.textGlyphMetaTextureB=this.mustCreateTexture(),this.textGlyphRasterMetaTexture=this.mustCreateTexture(),this.textGlyphSegmentTextureA=this.mustCreateTexture(),this.textGlyphSegmentTextureB=this.mustCreateTexture(),this.textRasterAtlasTexture=this.mustCreateTexture(),this.pageBackgroundTexture=this.mustCreateTexture(),this.uSegmentTexA=this.mustGetUniformLocation(this.segmentProgram,"uSegmentTexA"),this.uSegmentTexB=this.mustGetUniformLocation(this.segmentProgram,"uSegmentTexB"),this.uSegmentStyleTex=this.mustGetUniformLocation(this.segmentProgram,"uSegmentStyleTex"),this.uSegmentBoundsTex=this.mustGetUniformLocation(this.segmentProgram,"uSegmentBoundsTex"),this.uSegmentTexSize=this.mustGetUniformLocation(this.segmentProgram,"uSegmentTexSize"),this.uViewport=this.mustGetUniformLocation(this.segmentProgram,"uViewport"),this.uCameraCenter=this.mustGetUniformLocation(this.segmentProgram,"uCameraCenter"),this.uZoom=this.mustGetUniformLocation(this.segmentProgram,"uZoom"),this.uAAScreenPx=this.mustGetUniformLocation(this.segmentProgram,"uAAScreenPx"),this.uStrokeCurveEnabled=this.mustGetUniformLocation(this.segmentProgram,"uStrokeCurveEnabled"),this.uStrokeVectorOverride=this.mustGetUniformLocation(this.segmentProgram,"uVectorOverride"),this.uFillPathMetaTexA=this.mustGetUniformLocation(this.fillProgram,"uFillPathMetaTexA"),this.uFillPathMetaTexB=this.mustGetUniformLocation(this.fillProgram,"uFillPathMetaTexB"),this.uFillPathMetaTexC=this.mustGetUniformLocation(this.fillProgram,"uFillPathMetaTexC"),this.uFillSegmentTexA=this.mustGetUniformLocation(this.fillProgram,"uFillSegmentTexA"),this.uFillSegmentTexB=this.mustGetUniformLocation(this.fillProgram,"uFillSegmentTexB"),this.uFillPathMetaTexSize=this.mustGetUniformLocation(this.fillProgram,"uFillPathMetaTexSize"),this.uFillSegmentTexSize=this.mustGetUniformLocation(this.fillProgram,"uFillSegmentTexSize"),this.uFillViewport=this.mustGetUniformLocation(this.fillProgram,"uViewport"),this.uFillCameraCenter=this.mustGetUniformLocation(this.fillProgram,"uCameraCenter"),this.uFillZoom=this.mustGetUniformLocation(this.fillProgram,"uZoom"),this.uFillAAScreenPx=this.mustGetUniformLocation(this.fillProgram,"uFillAAScreenPx"),this.uFillVectorOverride=this.mustGetUniformLocation(this.fillProgram,"uVectorOverride"),this.uTextInstanceTexA=this.mustGetUniformLocation(this.textProgram,"uTextInstanceTexA"),this.uTextInstanceTexB=this.mustGetUniformLocation(this.textProgram,"uTextInstanceTexB"),this.uTextInstanceTexC=this.mustGetUniformLocation(this.textProgram,"uTextInstanceTexC"),this.uTextGlyphMetaTexA=this.mustGetUniformLocation(this.textProgram,"uTextGlyphMetaTexA"),this.uTextGlyphMetaTexB=this.mustGetUniformLocation(this.textProgram,"uTextGlyphMetaTexB"),this.uTextGlyphRasterMetaTex=this.mustGetUniformLocation(this.textProgram,"uTextGlyphRasterMetaTex"),this.uTextGlyphSegmentTexA=this.mustGetUniformLocation(this.textProgram,"uTextGlyphSegmentTexA"),this.uTextGlyphSegmentTexB=this.mustGetUniformLocation(this.textProgram,"uTextGlyphSegmentTexB"),this.uTextInstanceTexSize=this.mustGetUniformLocation(this.textProgram,"uTextInstanceTexSize"),this.uTextGlyphMetaTexSize=this.mustGetUniformLocation(this.textProgram,"uTextGlyphMetaTexSize"),this.uTextGlyphSegmentTexSize=this.mustGetUniformLocation(this.textProgram,"uTextGlyphSegmentTexSize"),this.uTextViewport=this.mustGetUniformLocation(this.textProgram,"uViewport"),this.uTextCameraCenter=this.mustGetUniformLocation(this.textProgram,"uCameraCenter"),this.uTextZoom=this.mustGetUniformLocation(this.textProgram,"uZoom"),this.uTextAAScreenPx=this.mustGetUniformLocation(this.textProgram,"uTextAAScreenPx"),this.uTextCurveEnabled=this.mustGetUniformLocation(this.textProgram,"uTextCurveEnabled"),this.uTextRasterAtlasTex=this.mustGetUniformLocation(this.textProgram,"uTextRasterAtlasTex"),this.uTextRasterAtlasSize=this.mustGetUniformLocation(this.textProgram,"uTextRasterAtlasSize"),this.uTextVectorOnly=this.mustGetUniformLocation(this.textProgram,"uTextVectorOnly"),this.uTextVectorOverride=this.mustGetUniformLocation(this.textProgram,"uVectorOverride"),this.uCacheTex=this.mustGetUniformLocation(this.blitProgram,"uCacheTex"),this.uViewportPx=this.mustGetUniformLocation(this.blitProgram,"uViewportPx"),this.uCacheSizePx=this.mustGetUniformLocation(this.blitProgram,"uCacheSizePx"),this.uOffsetPx=this.mustGetUniformLocation(this.blitProgram,"uOffsetPx"),this.uSampleScale=this.mustGetUniformLocation(this.blitProgram,"uSampleScale"),this.uVectorLayerTex=this.mustGetUniformLocation(this.vectorCompositeProgram,"uVectorLayerTex"),this.uVectorLayerViewportPx=this.mustGetUniformLocation(this.vectorCompositeProgram,"uViewportPx"),this.uRasterTex=this.mustGetUniformLocation(this.rasterProgram,"uRasterTex"),this.uRasterMatrixABCD=this.mustGetUniformLocation(this.rasterProgram,"uRasterMatrixABCD"),this.uRasterMatrixEF=this.mustGetUniformLocation(this.rasterProgram,"uRasterMatrixEF"),this.uRasterViewport=this.mustGetUniformLocation(this.rasterProgram,"uViewport"),this.uRasterCameraCenter=this.mustGetUniformLocation(this.rasterProgram,"uCameraCenter"),this.uRasterZoom=this.mustGetUniformLocation(this.rasterProgram,"uZoom"),this.initializeGeometry(),this.initializeState(),this.uploadPageBackgroundTexture()}setFrameListener(t){this.frameListener=t}setExternalFrameDriver(t){const e=!!t;this.externalFrameDriver!==e&&(this.externalFrameDriver=e,this.externalFrameDriver&&this.rafHandle!==0&&(cancelAnimationFrame(this.rafHandle),this.rafHandle=0))}renderExternalFrame(t=performance.now()){this.render(t)}setPanOptimizationEnabled(t){const e=!!t;this.panOptimizationEnabled!==e&&(this.panOptimizationEnabled=e,this.isPanInteracting=!1,this.panCacheValid=!1,this.panOptimizationEnabled||this.destroyPanCacheResources(),this.needsVisibleSetUpdate=!0,this.requestFrame())}setStrokeCurveEnabled(t){const e=!!t;this.strokeCurveEnabled!==e&&(this.strokeCurveEnabled=e,this.requestFrame())}setRasterRenderingEnabled(t){const e=!!t;this.rasterRenderingEnabled!==e&&(this.rasterRenderingEnabled=e,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setStrokeRenderingEnabled(t){const e=!!t;this.strokeRenderingEnabled!==e&&(this.strokeRenderingEnabled=e,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setFillRenderingEnabled(t){const e=!!t;this.fillRenderingEnabled!==e&&(this.fillRenderingEnabled=e,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setTextRenderingEnabled(t){const e=!!t;this.textRenderingEnabled!==e&&(this.textRenderingEnabled=e,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setTextVectorOnly(t){const e=!!t;this.textVectorOnly!==e&&(this.textVectorOnly=e,this.panCacheValid=!1,this.textVectorOnly&&this.destroyVectorMinifyResources(),this.requestFrame())}setPageBackgroundColor(t,e,s,a){const r=yt(t,0,1),i=yt(e,0,1),o=yt(s,0,1),l=yt(a,0,1),c=this.pageBackgroundColor;Math.abs(c[0]-r)<=1e-6&&Math.abs(c[1]-i)<=1e-6&&Math.abs(c[2]-o)<=1e-6&&Math.abs(c[3]-l)<=1e-6||(this.pageBackgroundColor=[r,i,o,l],this.uploadPageBackgroundTexture(),this.panCacheValid=!1,this.requestFrame())}setVectorColorOverride(t,e,s,a){const r=yt(t,0,1),i=yt(e,0,1),o=yt(s,0,1),l=yt(a,0,1),c=this.vectorOverrideColor;Math.abs(c[0]-r)<=1e-6&&Math.abs(c[1]-i)<=1e-6&&Math.abs(c[2]-o)<=1e-6&&Math.abs(this.vectorOverrideOpacity-l)<=1e-6||(this.vectorOverrideColor=[r,i,o],this.vectorOverrideOpacity=l,this.panCacheValid=!1,this.requestFrame())}setInteractionViewportProvider(t){this.interactionViewportProvider=t}beginPanInteraction(){this.hasCameraInteractionSinceSceneLoad=!0,this.syncCameraTargetsToCurrent(),this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameCameraX=this.cameraCenterX,this.lastPanFrameCameraY=this.cameraCenterY,this.lastPanFrameTimeMs=0,this.isPanInteracting=!0,this.markInteraction()}endPanInteraction(){this.isPanInteracting=!1;const t=performance.now(),s=this.lastPanVelocityUpdateTimeMs>0&&t-this.lastPanVelocityUpdateTimeMs<=Yi?Math.hypot(this.panVelocityWorldX,this.panVelocityWorldY):0;Number.isFinite(s)&&s>=gn?(this.targetCameraCenterX=this.cameraCenterX+this.panVelocityWorldX/De,this.targetCameraCenterY=this.cameraCenterY+this.panVelocityWorldY/De,this.lastCameraAnimationTimeMs=0):(this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY),this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameTimeMs=0,this.markInteraction(),this.needsVisibleSetUpdate=!0,this.requestFrame()}resize(){const t=window.devicePixelRatio||1,e=Math.max(1,Math.round(this.canvas.clientWidth*t)),s=Math.max(1,Math.round(this.canvas.clientHeight*t));this.canvas.width===e&&this.canvas.height===s||(this.canvas.width=e,this.canvas.height=s,this.destroyPanCacheResources(),this.destroyVectorMinifyResources(),this.needsVisibleSetUpdate=!0,this.requestFrame())}setScene(t){this.scene=t,this.segmentCount=t.segmentCount,this.fillPathCount=t.fillPathCount,this.textInstanceCount=t.textInstanceCount,this.pageRects=$i(t),this.pageTextRanges=Qi(t,this.pageRects,this.textInstanceCount),this.visiblePageRectIndices.length<Math.floor(this.pageRects.length/4)&&(this.visiblePageRectIndices=new Uint32Array(Math.floor(this.pageRects.length/4))),this.visiblePageRectCount=0,this.visibleTextRanges=[],this.buildSegmentBounds(t),this.isPanInteracting=!1,this.panCacheValid=!1,this.destroyVectorMinifyResources(),this.grid=this.segmentCount>0?Qn(t):null,this.uploadRasterLayers(t);const e=this.uploadFillPaths(t),s=this.uploadSegments(t),a=this.uploadTextData(t);this.sceneStats={gridWidth:this.grid?.gridWidth??0,gridHeight:this.grid?.gridHeight??0,gridIndexCount:this.grid?.indices.length??0,maxCellPopulation:this.grid?.maxCellPopulation??0,fillPathTextureWidth:e.pathMetaTextureWidth,fillPathTextureHeight:e.pathMetaTextureHeight,fillSegmentTextureWidth:e.segmentTextureWidth,fillSegmentTextureHeight:e.segmentTextureHeight,textureWidth:s.textureWidth,textureHeight:s.textureHeight,maxTextureSize:s.maxTextureSize,textInstanceTextureWidth:a.instanceTextureWidth,textInstanceTextureHeight:a.instanceTextureHeight,textGlyphTextureWidth:a.glyphMetaTextureWidth,textGlyphTextureHeight:a.glyphMetaTextureHeight,textSegmentTextureWidth:a.glyphSegmentTextureWidth,textSegmentTextureHeight:a.glyphSegmentTextureHeight},this.allSegmentIds=new Float32Array(this.segmentCount);for(let r=0;r<this.segmentCount;r+=1)this.allSegmentIds[r]=r;this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.allSegmentIdBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,this.allSegmentIds,this.gl.STATIC_DRAW),this.allFillPathIds=new Float32Array(this.fillPathCount);for(let r=0;r<this.fillPathCount;r+=1)this.allFillPathIds[r]=r;this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.allFillPathIdBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,this.allFillPathIds,this.gl.STATIC_DRAW),this.allTextInstanceIds=new Float32Array(this.textInstanceCount);for(let r=0;r<this.textInstanceCount;r+=1)this.allTextInstanceIds[r]=r;return this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.allTextInstanceIdBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,this.allTextInstanceIds,this.gl.STATIC_DRAW),this.visibleSegmentIds.length<this.segmentCount&&(this.visibleSegmentIds=new Float32Array(this.segmentCount)),this.segmentMarks.length<this.segmentCount&&(this.segmentMarks=new Uint32Array(this.segmentCount),this.markToken=1),this.visibleSegmentCount=this.segmentCount,this.usingAllSegments=!0,this.setAllPagesAndTextVisible(),this.minZoom=.01,this.maxZoom=8192,this.hasCameraInteractionSinceSceneLoad=!0,this.syncCameraTargetsToCurrent(),this.needsVisibleSetUpdate=!0,this.requestFrame(),this.sceneStats}getSceneStats(){return this.sceneStats}getViewState(){return{cameraCenterX:this.cameraCenterX,cameraCenterY:this.cameraCenterY,zoom:this.zoom}}getPresentedViewState(){return{cameraCenterX:this.presentedCameraCenterX,cameraCenterY:this.presentedCameraCenterY,zoom:this.presentedZoom}}getPresentedFrameSerial(){return this.presentedFrameSerial}setViewState(t){const e=Number(t.cameraCenterX),s=Number(t.cameraCenterY),a=Number(t.zoom);if(!Number.isFinite(e)||!Number.isFinite(s)||!Number.isFinite(a))return;this.cameraCenterX=e,this.cameraCenterY=s;const r=yt(a,this.minZoom,this.maxZoom);this.zoom=r,this.targetCameraCenterX=e,this.targetCameraCenterY=s,this.targetZoom=r,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1,this.isPanInteracting=!1,this.panCacheValid=!1,this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.needsVisibleSetUpdate=!0,this.requestFrame()}fitToBounds(t,e=64){const s=Math.max(t.maxX-t.minX,1e-4),a=Math.max(t.maxY-t.minY,1e-4),r=Math.max(1,this.canvas.width-e*2),i=Math.max(1,this.canvas.height-e*2),o=Math.min(r/s,i/a),l=yt(o,1e-8,this.maxZoom);this.minZoom=Math.min(this.minZoom,l);const c=(t.minX+t.maxX)*.5,p=(t.minY+t.maxY)*.5;this.zoom=l,this.cameraCenterX=c,this.cameraCenterY=p,this.targetZoom=l,this.targetCameraCenterX=c,this.targetCameraCenterY=p,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1,this.isPanInteracting=!1,this.panCacheValid=!1,this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.needsVisibleSetUpdate=!0,this.requestFrame()}dispose(){this.rafHandle!==0&&(cancelAnimationFrame(this.rafHandle),this.rafHandle=0),this.frameListener=null,this.destroyPanCacheResources(),this.destroyVectorMinifyResources();for(const t of this.rasterLayers)this.gl.deleteTexture(t.texture);this.rasterLayers=[]}panByPixels(t,e){if(!Number.isFinite(t)||!Number.isFinite(e))return;this.hasCameraInteractionSinceSceneLoad=!0,this.markInteraction(),this.hasZoomAnchor=!1;const s=this.resolveClientToPixelScale(),a=-(t*s.x)/this.zoom,r=e*s.y/this.zoom;this.cameraCenterX+=a,this.cameraCenterY+=r,this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY,this.needsVisibleSetUpdate=!0,this.requestFrame()}zoomAtClientPoint(t,e,s){const a=yt(s,.1,10);this.hasCameraInteractionSinceSceneLoad=!0,this.markInteraction();const r=this.clientToWorld(t,e),i=yt(this.targetZoom*a,this.minZoom,this.maxZoom);this.hasZoomAnchor=!0,this.zoomAnchorClientX=t,this.zoomAnchorClientY=e,this.zoomAnchorWorldX=r.x,this.zoomAnchorWorldY=r.y,this.targetZoom=i;const o=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,i);this.targetCameraCenterX=o.x,this.targetCameraCenterY=o.y,this.needsVisibleSetUpdate=!0,this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameTimeMs=0,this.requestFrame()}requestFrame(){this.externalFrameDriver||this.rafHandle===0&&(this.rafHandle=requestAnimationFrame(t=>{this.rafHandle=0,this.render(t)}))}render(t=performance.now()){const e=this.updateCameraWithDamping(t);this.updatePanReleaseVelocitySample(t);const s=this.gl;if(this.ensureRenderState(),!this.scene||this.fillPathCount===0&&this.segmentCount===0&&this.textInstanceCount===0&&this.rasterLayers.length===0&&this.pageRects.length===0){s.bindFramebuffer(s.FRAMEBUFFER,null),s.viewport(0,0,this.canvas.width,this.canvas.height),s.clearColor(ce,ue,he,1),s.clear(s.COLOR_BUFFER_BIT),this.capturePresentedFrameState(),this.frameListener?.({renderedSegments:0,totalSegments:0,usedCulling:!1,zoom:this.zoom}),e&&this.requestFrame();return}this.shouldUsePanCache(e)?this.renderWithPanCache():this.renderDirectToScreen(),this.capturePresentedFrameState(),e&&this.requestFrame()}capturePresentedFrameState(){this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.presentedFrameSerial+=1}shouldUsePanCache(t){return!this.panOptimizationEnabled||this.segmentCount<fn?!1:this.isPanInteracting?!0:t}renderDirectToScreen(){const t=this.gl;let e=this.shouldUseVectorMinifyPath()&&this.ensureVectorMinifyResources();if(this.panOptimizationEnabled&&this.segmentCount>=fn&&(e=!1),e&&this.vectorMinifyWarmupPending&&(e=!1,this.vectorMinifyWarmupPending=!1,this.needsVisibleSetUpdate=!0,this.requestFrame()),t.bindFramebuffer(t.FRAMEBUFFER,null),t.viewport(0,0,this.canvas.width,this.canvas.height),t.clearColor(ce,ue,he,1),t.clear(t.COLOR_BUFFER_BIT),this.needsVisibleSetUpdate){if(e){const a=this.computeVectorMinifyZoom(this.vectorMinifyWidth,this.vectorMinifyHeight);this.updateVisibleSet(this.cameraCenterX,this.cameraCenterY,this.vectorMinifyWidth,this.vectorMinifyHeight,a)}else this.updateVisibleSet(this.cameraCenterX,this.cameraCenterY,this.canvas.width,this.canvas.height,this.zoom);this.needsVisibleSetUpdate=!1}this.rasterRenderingEnabled&&this.drawRasterLayer(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY);let s=0;e?(s=this.renderVectorLayerIntoMinifyTarget(this.vectorMinifyWidth,this.vectorMinifyHeight,this.cameraCenterX,this.cameraCenterY),this.compositeVectorMinifyLayer()):(this.fillRenderingEnabled&&this.drawFilledPaths(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY),this.strokeRenderingEnabled&&(s=this.drawVisibleSegments(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY)),this.textRenderingEnabled&&this.drawTextInstances(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY)),this.frameListener?.({renderedSegments:s,totalSegments:this.segmentCount,usedCulling:!this.usingAllSegments,zoom:this.zoom})}hasVectorContent(){return this.fillRenderingEnabled&&this.fillPathCount>0||this.strokeRenderingEnabled&&this.segmentCount>0||this.textRenderingEnabled&&this.textInstanceCount>0}shouldUseVectorMinifyPath(){return this.textVectorOnly||!this.hasVectorContent()||this.textInstanceCount>1e5&&this.segmentCount===0?!1:this.zoom<=Xi}computeVectorMinifyZoom(t,e){const s=Math.min(t/Math.max(1,this.canvas.width),e/Math.max(1,this.canvas.height));return this.zoom*Math.max(1,s)}ensureVectorMinifyResources(){const t=this.gl,e=t.getParameter(t.MAX_TEXTURE_SIZE),s=e/Math.max(1,this.canvas.width),a=e/Math.max(1,this.canvas.height),r=Math.max(1,Math.min(zi,s,a)),i=Math.max(this.canvas.width,Math.floor(this.canvas.width*r)),o=Math.max(this.canvas.height,Math.floor(this.canvas.height*r));if(i<this.canvas.width||o<this.canvas.height)return!1;if(this.vectorMinifyTexture&&this.vectorMinifyFramebuffer&&this.vectorMinifyWidth===i&&this.vectorMinifyHeight===o)return!0;this.destroyVectorMinifyResources();const l=t.createTexture();if(!l)return!1;t.bindTexture(t.TEXTURE_2D,l),qi(t),t.texStorage2D(t.TEXTURE_2D,1,t.RGBA8,i,o);const c=t.createFramebuffer();if(!c)return t.deleteTexture(l),!1;t.bindFramebuffer(t.FRAMEBUFFER,c),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,l,0);const p=t.checkFramebufferStatus(t.FRAMEBUFFER);return t.bindFramebuffer(t.FRAMEBUFFER,null),p!==t.FRAMEBUFFER_COMPLETE?(t.deleteFramebuffer(c),t.deleteTexture(l),!1):(this.vectorMinifyTexture=l,this.vectorMinifyFramebuffer=c,this.vectorMinifyWidth=i,this.vectorMinifyHeight=o,this.vectorMinifyWarmupPending=!0,!0)}renderVectorLayerIntoMinifyTarget(t,e,s,a){if(!this.vectorMinifyFramebuffer||!this.vectorMinifyTexture)return 0;const r=this.gl,i=this.computeVectorMinifyZoom(t,e);r.bindFramebuffer(r.FRAMEBUFFER,this.vectorMinifyFramebuffer),r.viewport(0,0,t,e),r.clearColor(0,0,0,0),r.clear(r.COLOR_BUFFER_BIT),r.blendFuncSeparate(r.SRC_ALPHA,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA),this.fillRenderingEnabled&&this.drawFilledPaths(t,e,s,a,i);const o=this.strokeRenderingEnabled?this.drawVisibleSegments(t,e,s,a,i):0;return this.textRenderingEnabled&&this.drawTextInstances(t,e,s,a,i),r.bindTexture(r.TEXTURE_2D,this.vectorMinifyTexture),r.bindFramebuffer(r.FRAMEBUFFER,null),o}compositeVectorMinifyLayer(){if(!this.vectorMinifyTexture)return;const t=this.gl;t.bindFramebuffer(t.FRAMEBUFFER,null),t.viewport(0,0,this.canvas.width,this.canvas.height),t.useProgram(this.vectorCompositeProgram),t.bindVertexArray(this.blitVao),t.activeTexture(t.TEXTURE0),t.bindTexture(t.TEXTURE_2D,this.vectorMinifyTexture),t.uniform1i(this.uVectorLayerTex,0),t.uniform2f(this.uVectorLayerViewportPx,this.canvas.width,this.canvas.height),t.blendFuncSeparate(t.ONE,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA),t.drawArrays(t.TRIANGLE_STRIP,0,4),t.blendFuncSeparate(t.SRC_ALPHA,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA)}renderWithPanCache(){if(!this.ensurePanCacheResources()){this.renderDirectToScreen();return}let t=this.panCacheZoom/Math.max(this.zoom,1e-6),e=(this.cameraCenterX-this.panCacheCenterX)*this.panCacheZoom,s=(this.cameraCenterY-this.panCacheCenterY)*this.panCacheZoom;const a=this.panCacheWidth*.5-2,r=this.panCacheHeight*.5-2,i=this.canvas.width*.5*Math.abs(t),o=this.canvas.height*.5*Math.abs(t),l=a-i,c=r-o,p=this.zoom/Math.max(this.panCacheZoom,1e-6),m=p<Gi||p>Ui,d=Math.abs(this.targetZoom-this.zoom)<=le&&Math.abs(this.panCacheZoom-this.zoom)>Ni,y=l<0||c<0||Math.abs(e)>l||Math.abs(s)>c;if(!this.panCacheValid||m||y||d){this.panCacheCenterX=this.cameraCenterX,this.panCacheCenterY=this.cameraCenterY,this.panCacheZoom=this.zoom,this.updateVisibleSet(this.panCacheCenterX,this.panCacheCenterY,this.panCacheWidth,this.panCacheHeight),this.needsVisibleSetUpdate=!1;const x=this.gl;x.bindFramebuffer(x.FRAMEBUFFER,this.panCacheFramebuffer),x.viewport(0,0,this.panCacheWidth,this.panCacheHeight),x.clearColor(ce,ue,he,1),x.clear(x.COLOR_BUFFER_BIT),this.rasterRenderingEnabled&&this.drawRasterLayer(this.panCacheWidth,this.panCacheHeight,this.panCacheCenterX,this.panCacheCenterY),this.fillRenderingEnabled&&this.drawFilledPaths(this.panCacheWidth,this.panCacheHeight,this.panCacheCenterX,this.panCacheCenterY),this.panCacheRenderedSegments=this.strokeRenderingEnabled?this.drawVisibleSegments(this.panCacheWidth,this.panCacheHeight,this.panCacheCenterX,this.panCacheCenterY):0,this.textRenderingEnabled&&this.drawTextInstances(this.panCacheWidth,this.panCacheHeight,this.panCacheCenterX,this.panCacheCenterY),this.panCacheUsedCulling=!this.usingAllSegments,this.panCacheValid=!0,t=1,e=0,s=0}this.blitPanCache(e,s,t),this.frameListener?.({renderedSegments:this.panCacheRenderedSegments,totalSegments:this.segmentCount,usedCulling:this.panCacheUsedCulling,zoom:this.zoom})}drawRasterLayer(t,e,s,a){if(this.rasterLayers.length===0&&this.pageRects.length===0)return;const r=this.gl;if(r.useProgram(this.rasterProgram),r.bindVertexArray(this.blitVao),r.uniform2f(this.uRasterViewport,t,e),r.uniform2f(this.uRasterCameraCenter,s,a),r.uniform1f(this.uRasterZoom,this.zoom),this.pageRects.length>0&&this.visiblePageRectCount>0){r.activeTexture(r.TEXTURE12),r.bindTexture(r.TEXTURE_2D,this.pageBackgroundTexture),r.uniform1i(this.uRasterTex,12);for(let i=0;i<this.visiblePageRectCount;i+=1){const o=this.visiblePageRectIndices[i]*4,l=this.pageRects[o],c=this.pageRects[o+1],p=this.pageRects[o+2],m=this.pageRects[o+3],g=Math.max(p-l,1e-6),d=Math.max(m-c,1e-6);r.uniform4f(this.uRasterMatrixABCD,g,0,0,d),r.uniform2f(this.uRasterMatrixEF,l,c),r.drawArrays(r.TRIANGLE_STRIP,0,4)}}if(this.rasterLayers.length!==0){r.blendFuncSeparate(r.ONE,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA);for(const i of this.rasterLayers)r.activeTexture(r.TEXTURE12),r.bindTexture(r.TEXTURE_2D,i.texture),r.uniform1i(this.uRasterTex,12),r.uniform4f(this.uRasterMatrixABCD,i.matrix[0],i.matrix[1],i.matrix[2],i.matrix[3]),r.uniform2f(this.uRasterMatrixEF,i.matrix[4],i.matrix[5]),r.drawArrays(r.TRIANGLE_STRIP,0,4);r.blendFuncSeparate(r.SRC_ALPHA,r.ONE_MINUS_SRC_ALPHA,r.ONE,r.ONE_MINUS_SRC_ALPHA)}}drawFilledPaths(t,e,s,a,r=this.zoom){if(!this.scene||this.fillPathCount<=0)return 0;const i=this.gl;return i.useProgram(this.fillProgram),i.bindVertexArray(this.fillVao),i.activeTexture(i.TEXTURE7),i.bindTexture(i.TEXTURE_2D,this.fillPathMetaTextureA),i.activeTexture(i.TEXTURE8),i.bindTexture(i.TEXTURE_2D,this.fillPathMetaTextureB),i.activeTexture(i.TEXTURE9),i.bindTexture(i.TEXTURE_2D,this.fillPathMetaTextureC),i.activeTexture(i.TEXTURE10),i.bindTexture(i.TEXTURE_2D,this.fillSegmentTextureA),i.activeTexture(i.TEXTURE11),i.bindTexture(i.TEXTURE_2D,this.fillSegmentTextureB),i.uniform1i(this.uFillPathMetaTexA,7),i.uniform1i(this.uFillPathMetaTexB,8),i.uniform1i(this.uFillPathMetaTexC,9),i.uniform1i(this.uFillSegmentTexA,10),i.uniform1i(this.uFillSegmentTexB,11),i.uniform2i(this.uFillPathMetaTexSize,this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight),i.uniform2i(this.uFillSegmentTexSize,this.fillSegmentTextureWidth,this.fillSegmentTextureHeight),i.uniform2f(this.uFillViewport,t,e),i.uniform2f(this.uFillCameraCenter,s,a),i.uniform1f(this.uFillZoom,r),i.uniform1f(this.uFillAAScreenPx,1),i.uniform4f(this.uFillVectorOverride,this.vectorOverrideColor[0],this.vectorOverrideColor[1],this.vectorOverrideColor[2],this.vectorOverrideOpacity),i.drawArraysInstanced(i.TRIANGLE_STRIP,0,4,this.fillPathCount),this.fillPathCount}drawVisibleSegments(t,e,s,a,r=this.zoom){const i=this.usingAllSegments?this.segmentCount:this.visibleSegmentCount;if(i===0)return 0;const o=this.gl;o.useProgram(this.segmentProgram),o.bindVertexArray(this.segmentVao);const l=this.usingAllSegments?this.allSegmentIdBuffer:this.visibleSegmentIdBuffer;return o.bindBuffer(o.ARRAY_BUFFER,l),o.enableVertexAttribArray(1),o.vertexAttribPointer(1,1,o.FLOAT,!1,4,0),o.vertexAttribDivisor(1,1),o.activeTexture(o.TEXTURE0),o.bindTexture(o.TEXTURE_2D,this.segmentTextureA),o.activeTexture(o.TEXTURE1),o.bindTexture(o.TEXTURE_2D,this.segmentTextureB),o.activeTexture(o.TEXTURE2),o.bindTexture(o.TEXTURE_2D,this.segmentTextureC),o.activeTexture(o.TEXTURE3),o.bindTexture(o.TEXTURE_2D,this.segmentTextureD),o.uniform1i(this.uSegmentTexA,0),o.uniform1i(this.uSegmentTexB,1),o.uniform1i(this.uSegmentStyleTex,2),o.uniform1i(this.uSegmentBoundsTex,3),o.uniform2i(this.uSegmentTexSize,this.segmentTextureWidth,this.segmentTextureHeight),o.uniform2f(this.uViewport,t,e),o.uniform2f(this.uCameraCenter,s,a),o.uniform1f(this.uZoom,r),o.uniform1f(this.uAAScreenPx,1),o.uniform1f(this.uStrokeCurveEnabled,this.strokeCurveEnabled?1:0),o.uniform4f(this.uStrokeVectorOverride,this.vectorOverrideColor[0],this.vectorOverrideColor[1],this.vectorOverrideColor[2],this.vectorOverrideOpacity),o.drawArraysInstanced(o.TRIANGLE_STRIP,0,4,i),i}drawTextInstances(t,e,s,a,r=this.zoom){if(!this.scene||this.textInstanceCount<=0||this.visibleTextRanges.length===0)return 0;const i=this.gl;i.useProgram(this.textProgram),i.bindVertexArray(this.textVao),i.bindBuffer(i.ARRAY_BUFFER,this.allTextInstanceIdBuffer),i.enableVertexAttribArray(2),i.vertexAttribDivisor(2,1),i.activeTexture(i.TEXTURE2),i.bindTexture(i.TEXTURE_2D,this.textInstanceTextureA),i.activeTexture(i.TEXTURE3),i.bindTexture(i.TEXTURE_2D,this.textInstanceTextureB),i.activeTexture(i.TEXTURE4),i.bindTexture(i.TEXTURE_2D,this.textInstanceTextureC),i.activeTexture(i.TEXTURE5),i.bindTexture(i.TEXTURE_2D,this.textGlyphMetaTextureA),i.activeTexture(i.TEXTURE6),i.bindTexture(i.TEXTURE_2D,this.textGlyphMetaTextureB),i.activeTexture(i.TEXTURE7),i.bindTexture(i.TEXTURE_2D,this.textGlyphSegmentTextureA),i.activeTexture(i.TEXTURE8),i.bindTexture(i.TEXTURE_2D,this.textGlyphSegmentTextureB),i.activeTexture(i.TEXTURE9),i.bindTexture(i.TEXTURE_2D,this.textGlyphRasterMetaTexture),i.activeTexture(i.TEXTURE13),i.bindTexture(i.TEXTURE_2D,this.textRasterAtlasTexture),i.uniform1i(this.uTextInstanceTexA,2),i.uniform1i(this.uTextInstanceTexB,3),i.uniform1i(this.uTextInstanceTexC,4),i.uniform1i(this.uTextGlyphMetaTexA,5),i.uniform1i(this.uTextGlyphMetaTexB,6),i.uniform1i(this.uTextGlyphSegmentTexA,7),i.uniform1i(this.uTextGlyphSegmentTexB,8),i.uniform1i(this.uTextGlyphRasterMetaTex,9),i.uniform1i(this.uTextRasterAtlasTex,13),i.uniform2i(this.uTextInstanceTexSize,this.textInstanceTextureWidth,this.textInstanceTextureHeight),i.uniform2i(this.uTextGlyphMetaTexSize,this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight),i.uniform2i(this.uTextGlyphSegmentTexSize,this.textGlyphSegmentTextureWidth,this.textGlyphSegmentTextureHeight),i.uniform2f(this.uTextRasterAtlasSize,this.textRasterAtlasWidth,this.textRasterAtlasHeight),i.uniform2f(this.uTextViewport,t,e),i.uniform2f(this.uTextCameraCenter,s,a),i.uniform1f(this.uTextZoom,r),i.uniform1f(this.uTextAAScreenPx,1.25),i.uniform1f(this.uTextCurveEnabled,this.strokeCurveEnabled?1:0),i.uniform1f(this.uTextVectorOnly,this.textVectorOnly?1:0),i.uniform4f(this.uTextVectorOverride,this.vectorOverrideColor[0],this.vectorOverrideColor[1],this.vectorOverrideColor[2],this.vectorOverrideOpacity);let o=0;for(const l of this.visibleTextRanges)l.count<=0||(i.vertexAttribPointer(2,1,i.FLOAT,!1,4,l.start*4),i.drawArraysInstanced(i.TRIANGLE_STRIP,0,4,l.count),o+=l.count);return o}blitPanCache(t,e,s){if(!this.panCacheTexture)return;const a=this.gl;a.bindFramebuffer(a.FRAMEBUFFER,null),a.viewport(0,0,this.canvas.width,this.canvas.height),a.clearColor(ce,ue,he,1),a.clear(a.COLOR_BUFFER_BIT),a.useProgram(this.blitProgram),a.bindVertexArray(this.blitVao),a.activeTexture(a.TEXTURE0),a.bindTexture(a.TEXTURE_2D,this.panCacheTexture),a.uniform1i(this.uCacheTex,0),a.uniform2f(this.uViewportPx,this.canvas.width,this.canvas.height),a.uniform2f(this.uCacheSizePx,this.panCacheWidth,this.panCacheHeight),a.uniform2f(this.uOffsetPx,t,e),a.uniform1f(this.uSampleScale,s),a.disable(a.BLEND),a.drawArrays(a.TRIANGLE_STRIP,0,4),a.enable(a.BLEND)}ensurePanCacheResources(){const t=this.gl,e=t.getParameter(t.MAX_TEXTURE_SIZE),s=Math.min(e,Math.max(this.canvas.width+pn*2,Math.ceil(this.canvas.width*mn))),a=Math.min(e,Math.max(this.canvas.height+pn*2,Math.ceil(this.canvas.height*mn)));if(s<this.canvas.width||a<this.canvas.height)return!1;if(this.panCacheTexture&&this.panCacheFramebuffer&&this.panCacheWidth===s&&this.panCacheHeight===a)return!0;this.destroyPanCacheResources();const r=t.createTexture();if(!r)return!1;t.bindTexture(t.TEXTURE_2D,r),Hi(t),t.texImage2D(t.TEXTURE_2D,0,t.RGBA8,s,a,0,t.RGBA,t.UNSIGNED_BYTE,null);const i=t.createFramebuffer();if(!i)return t.deleteTexture(r),!1;t.bindFramebuffer(t.FRAMEBUFFER,i),t.framebufferTexture2D(t.FRAMEBUFFER,t.COLOR_ATTACHMENT0,t.TEXTURE_2D,r,0);const o=t.checkFramebufferStatus(t.FRAMEBUFFER);return t.bindFramebuffer(t.FRAMEBUFFER,null),o!==t.FRAMEBUFFER_COMPLETE?(t.deleteFramebuffer(i),t.deleteTexture(r),!1):(this.panCacheTexture=r,this.panCacheFramebuffer=i,this.panCacheWidth=s,this.panCacheHeight=a,this.panCacheValid=!1,!0)}destroyPanCacheResources(){this.panCacheFramebuffer&&(this.gl.deleteFramebuffer(this.panCacheFramebuffer),this.panCacheFramebuffer=null),this.panCacheTexture&&(this.gl.deleteTexture(this.panCacheTexture),this.panCacheTexture=null),this.panCacheWidth=0,this.panCacheHeight=0,this.panCacheValid=!1,this.panCacheRenderedSegments=0,this.panCacheUsedCulling=!1}destroyVectorMinifyResources(){this.vectorMinifyFramebuffer&&(this.gl.deleteFramebuffer(this.vectorMinifyFramebuffer),this.vectorMinifyFramebuffer=null),this.vectorMinifyTexture&&(this.gl.deleteTexture(this.vectorMinifyTexture),this.vectorMinifyTexture=null),this.vectorMinifyWidth=0,this.vectorMinifyHeight=0,this.vectorMinifyWarmupPending=!1}updateVisibleSet(t=this.cameraCenterX,e=this.cameraCenterY,s=this.canvas.width,a=this.canvas.height,r=this.zoom){if(!this.scene){this.visibleSegmentCount=0,this.usingAllSegments=!0,this.visiblePageRectCount=0,this.visibleTextRanges=[];return}if(!this.hasCameraInteractionSinceSceneLoad){this.usingAllSegments=!0,this.visibleSegmentCount=this.segmentCount,this.setAllPagesAndTextVisible();return}const i=Math.max(r,1e-6),o=s/(2*i),l=a/(2*i),c=Math.max(16/i,this.scene.maxHalfWidth*2),p=t-o-c,m=t+o+c,g=e-l-c,d=e+l+c;if(this.updateVisiblePagesAndTextRanges(p,g,m,d),!this.grid){this.visibleSegmentCount=0,this.usingAllSegments=!0;return}const y=this.grid,u=de(Math.floor((p-y.minX)/y.cellWidth),y.gridWidth),x=de(Math.floor((m-y.minX)/y.cellWidth),y.gridWidth),T=de(Math.floor((g-y.minY)/y.cellHeight),y.gridHeight),b=de(Math.floor((d-y.minY)/y.cellHeight),y.gridHeight);this.usingAllSegments=!1,this.markToken+=1,this.markToken===4294967295&&(this.segmentMarks.fill(0),this.markToken=1);let S=0;for(let A=T;A<=b;A+=1){let w=A*y.gridWidth+u;for(let k=u;k<=x;k+=1){const N=y.offsets[w],B=y.counts[w];for(let I=0;I<B;I+=1){const P=y.indices[N+I];this.segmentMarks[P]!==this.markToken&&(this.segmentMarks[P]=this.markToken,!(this.segmentMaxX[P]<p||this.segmentMinX[P]>m||this.segmentMaxY[P]<g||this.segmentMinY[P]>d)&&(this.visibleSegmentIds[S]=P,S+=1))}w+=1}}this.visibleSegmentCount=S;const E=this.visibleSegmentIds.subarray(0,S);this.gl.bindBuffer(this.gl.ARRAY_BUFFER,this.visibleSegmentIdBuffer),this.gl.bufferData(this.gl.ARRAY_BUFFER,E,this.gl.DYNAMIC_DRAW)}setAllPagesAndTextVisible(){const t=Math.floor(this.pageRects.length/4);this.visiblePageRectIndices.length<t&&(this.visiblePageRectIndices=new Uint32Array(t));for(let e=0;e<t;e+=1)this.visiblePageRectIndices[e]=e;this.visiblePageRectCount=t,this.visibleTextRanges=this.textInstanceCount>0?[{start:0,count:this.textInstanceCount}]:[]}updateVisiblePagesAndTextRanges(t,e,s,a){const r=Math.floor(this.pageRects.length/4);if(r<=0){this.visiblePageRectCount=0,this.visibleTextRanges=this.textInstanceCount>0?[{start:0,count:this.textInstanceCount}]:[];return}this.visiblePageRectIndices.length<r&&(this.visiblePageRectIndices=new Uint32Array(r));const i=[];let o=0;for(let l=0;l<r;l+=1){const c=l*4,p=Math.min(this.pageRects[c],this.pageRects[c+2]),m=Math.min(this.pageRects[c+1],this.pageRects[c+3]),g=Math.max(this.pageRects[c],this.pageRects[c+2]),d=Math.max(this.pageRects[c+1],this.pageRects[c+3]);if(g<t||p>s||d<e||m>a)continue;this.visiblePageRectIndices[o]=l,o+=1;const y=l*2,u=this.pageTextRanges[y]??0,x=this.pageTextRanges[y+1]??0;this.appendVisibleTextRange(i,u,x)}this.visiblePageRectCount=o,this.visibleTextRanges=i}appendVisibleTextRange(t,e,s){const a=yt(Math.trunc(e),0,this.textInstanceCount),r=yt(Math.trunc(s),0,this.textInstanceCount-a);if(r<=0)return;const i=t[t.length-1];if(i&&a<=i.start+i.count){const o=Math.max(i.start+i.count,a+r);i.count=o-i.start;return}t.push({start:a,count:r})}uploadRasterLayers(t){const e=this.gl;for(const s of this.rasterLayers)e.deleteTexture(s.texture);this.rasterLayers=[];for(const s of this.getSceneRasterLayers(t)){const a=e.createTexture();if(!a)continue;e.bindTexture(e.TEXTURE_2D,a),yn(e);const r=s.data.subarray(0,s.width*s.height*4),i=Zi(r);e.texImage2D(e.TEXTURE_2D,0,e.RGBA,s.width,s.height,0,e.RGBA,e.UNSIGNED_BYTE,i),e.generateMipmap(e.TEXTURE_2D);const o=new Float32Array(6);s.matrix.length>=6?(o[0]=s.matrix[0],o[1]=s.matrix[1],o[2]=s.matrix[2],o[3]=s.matrix[3],o[4]=s.matrix[4],o[5]=s.matrix[5]):(o[0]=1,o[3]=1),this.rasterLayers.push({texture:a,matrix:o})}}getSceneRasterLayers(t){const e=[];if(Array.isArray(t.rasterLayers))for(const r of t.rasterLayers){const i=Math.max(0,Math.trunc(r?.width??0)),o=Math.max(0,Math.trunc(r?.height??0));i<=0||o<=0||!(r.data instanceof Uint8Array)||r.data.length<i*o*4||e.push({width:i,height:o,data:r.data,matrix:r.matrix instanceof Float32Array?r.matrix:new Float32Array(r.matrix)})}if(e.length>0)return e;const s=Math.max(0,Math.trunc(t.rasterLayerWidth)),a=Math.max(0,Math.trunc(t.rasterLayerHeight));return s<=0||a<=0||t.rasterLayerData.length<s*a*4||e.push({width:s,height:a,data:t.rasterLayerData,matrix:t.rasterLayerMatrix}),e}uploadFillPaths(t){const e=this.gl,s=e.getParameter(e.MAX_TEXTURE_SIZE),a=Jt(t.fillPathCount,s),r=Jt(t.fillSegmentCount,s);this.fillPathMetaTextureWidth=a.width,this.fillPathMetaTextureHeight=a.height,this.fillSegmentTextureWidth=r.width,this.fillSegmentTextureHeight=r.height;const i=a.width*a.height,o=r.width*r.height,l=new Float32Array(i*4);l.set(t.fillPathMetaA);const c=new Float32Array(i*4);c.set(t.fillPathMetaB);const p=new Float32Array(i*4);p.set(t.fillPathMetaC);const m=new Float32Array(o*4);m.set(t.fillSegmentsA);const g=new Float32Array(o*4);return g.set(t.fillSegmentsB),e.bindTexture(e.TEXTURE_2D,this.fillPathMetaTextureA),wt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,0,e.RGBA,e.FLOAT,l),e.bindTexture(e.TEXTURE_2D,this.fillPathMetaTextureB),wt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,0,e.RGBA,e.FLOAT,c),e.bindTexture(e.TEXTURE_2D,this.fillPathMetaTextureC),wt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,0,e.RGBA,e.FLOAT,p),e.bindTexture(e.TEXTURE_2D,this.fillSegmentTextureA),wt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.fillSegmentTextureWidth,this.fillSegmentTextureHeight,0,e.RGBA,e.FLOAT,m),e.bindTexture(e.TEXTURE_2D,this.fillSegmentTextureB),wt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.fillSegmentTextureWidth,this.fillSegmentTextureHeight,0,e.RGBA,e.FLOAT,g),{pathMetaTextureWidth:this.fillPathMetaTextureWidth,pathMetaTextureHeight:this.fillPathMetaTextureHeight,segmentTextureWidth:this.fillSegmentTextureWidth,segmentTextureHeight:this.fillSegmentTextureHeight}}uploadSegments(t){const e=this.gl,s=e.getParameter(e.MAX_TEXTURE_SIZE),a=Math.ceil(Math.sqrt(t.segmentCount));if(this.segmentTextureWidth=yt(a,1,s),this.segmentTextureHeight=Math.max(1,Math.ceil(t.segmentCount/this.segmentTextureWidth)),this.segmentTextureHeight>s)throw new Error("Segment texture exceeds GPU limits for this browser/GPU.");const r=this.segmentTextureWidth*this.segmentTextureHeight,i=new Float32Array(r*4);i.set(t.endpoints);const o=new Float32Array(r*4);o.set(t.primitiveMeta);const l=new Float32Array(r*4);l.set(t.styles);const c=new Float32Array(r*4);return c.set(t.primitiveBounds),e.bindTexture(e.TEXTURE_2D,this.segmentTextureA),wt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.segmentTextureWidth,this.segmentTextureHeight,0,e.RGBA,e.FLOAT,i),e.bindTexture(e.TEXTURE_2D,this.segmentTextureB),wt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.segmentTextureWidth,this.segmentTextureHeight,0,e.RGBA,e.FLOAT,o),e.bindTexture(e.TEXTURE_2D,this.segmentTextureC),wt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.segmentTextureWidth,this.segmentTextureHeight,0,e.RGBA,e.FLOAT,l),e.bindTexture(e.TEXTURE_2D,this.segmentTextureD),wt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.segmentTextureWidth,this.segmentTextureHeight,0,e.RGBA,e.FLOAT,c),{textureWidth:this.segmentTextureWidth,textureHeight:this.segmentTextureHeight,maxTextureSize:s}}uploadTextData(t){const e=this.gl,s=e.getParameter(e.MAX_TEXTURE_SIZE),a=Jt(t.textInstanceCount,s),r=Jt(t.textGlyphCount,s),i=Jt(t.textGlyphSegmentCount,s);this.textInstanceTextureWidth=a.width,this.textInstanceTextureHeight=a.height,this.textGlyphMetaTextureWidth=r.width,this.textGlyphMetaTextureHeight=r.height,this.textGlyphSegmentTextureWidth=i.width,this.textGlyphSegmentTextureHeight=i.height;const o=a.width*a.height,l=r.width*r.height,c=i.width*i.height,p=new Float32Array(o*4);p.set(t.textInstanceA);const m=new Float32Array(o*4);m.set(t.textInstanceB);const g=ji(t.textInstanceC,o),d=new Float32Array(l*4);d.set(t.textGlyphMetaA);const y=new Float32Array(l*4);y.set(t.textGlyphMetaB);const u=new Float32Array(l*4),x=Kn(t,s);x?(u.set(x.glyphUvRects),this.textRasterAtlasWidth=x.width,this.textRasterAtlasHeight=x.height):(this.textRasterAtlasWidth=1,this.textRasterAtlasHeight=1);const T=new Float32Array(c*4);T.set(t.textGlyphSegmentsA);const b=new Float32Array(c*4);if(b.set(t.textGlyphSegmentsB),e.bindTexture(e.TEXTURE_2D,this.textInstanceTextureA),wt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.textInstanceTextureWidth,this.textInstanceTextureHeight,0,e.RGBA,e.FLOAT,p),e.bindTexture(e.TEXTURE_2D,this.textInstanceTextureB),wt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.textInstanceTextureWidth,this.textInstanceTextureHeight,0,e.RGBA,e.FLOAT,m),e.bindTexture(e.TEXTURE_2D,this.textInstanceTextureC),Wi(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA8,this.textInstanceTextureWidth,this.textInstanceTextureHeight,0,e.RGBA,e.UNSIGNED_BYTE,g),e.bindTexture(e.TEXTURE_2D,this.textGlyphMetaTextureA),wt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,0,e.RGBA,e.FLOAT,d),e.bindTexture(e.TEXTURE_2D,this.textGlyphMetaTextureB),wt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,0,e.RGBA,e.FLOAT,y),e.bindTexture(e.TEXTURE_2D,this.textGlyphRasterMetaTexture),wt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,0,e.RGBA,e.FLOAT,u),e.bindTexture(e.TEXTURE_2D,this.textGlyphSegmentTextureA),wt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.textGlyphSegmentTextureWidth,this.textGlyphSegmentTextureHeight,0,e.RGBA,e.FLOAT,T),e.bindTexture(e.TEXTURE_2D,this.textGlyphSegmentTextureB),wt(e),e.texImage2D(e.TEXTURE_2D,0,e.RGBA32F,this.textGlyphSegmentTextureWidth,this.textGlyphSegmentTextureHeight,0,e.RGBA,e.FLOAT,b),e.bindTexture(e.TEXTURE_2D,this.textRasterAtlasTexture),yn(e),e.pixelStorei(e.UNPACK_ALIGNMENT,1),x)e.texImage2D(e.TEXTURE_2D,0,e.R8,this.textRasterAtlasWidth,this.textRasterAtlasHeight,0,e.RED,e.UNSIGNED_BYTE,x.alpha);else{const S=new Uint8Array([0]);e.texImage2D(e.TEXTURE_2D,0,e.R8,1,1,0,e.RED,e.UNSIGNED_BYTE,S)}return e.pixelStorei(e.UNPACK_ALIGNMENT,4),e.generateMipmap(e.TEXTURE_2D),{instanceTextureWidth:this.textInstanceTextureWidth,instanceTextureHeight:this.textInstanceTextureHeight,glyphMetaTextureWidth:this.textGlyphMetaTextureWidth,glyphMetaTextureHeight:this.textGlyphMetaTextureHeight,glyphSegmentTextureWidth:this.textGlyphSegmentTextureWidth,glyphSegmentTextureHeight:this.textGlyphSegmentTextureHeight}}buildSegmentBounds(t){this.segmentMinX.length<this.segmentCount&&(this.segmentMinX=new Float32Array(this.segmentCount),this.segmentMinY=new Float32Array(this.segmentCount),this.segmentMaxX=new Float32Array(this.segmentCount),this.segmentMaxY=new Float32Array(this.segmentCount));for(let e=0;e<this.segmentCount;e+=1){const s=e*4,a=e*4,r=t.styles[a]+.35;this.segmentMinX[e]=t.primitiveBounds[s]-r,this.segmentMinY[e]=t.primitiveBounds[s+1]-r,this.segmentMaxX[e]=t.primitiveBounds[s+2]+r,this.segmentMaxY[e]=t.primitiveBounds[s+3]+r}}markInteraction(){this.lastInteractionTime=performance.now()}isInteractionActive(){return performance.now()-this.lastInteractionTime<=Oi}initializeGeometry(){const t=this.gl;t.bindBuffer(t.ARRAY_BUFFER,this.cornerBuffer);const e=new Float32Array([-1,-1,1,-1,-1,1,1,1]);t.bufferData(t.ARRAY_BUFFER,e,t.STATIC_DRAW),t.bindVertexArray(this.segmentVao),t.bindBuffer(t.ARRAY_BUFFER,this.cornerBuffer),t.enableVertexAttribArray(0),t.vertexAttribPointer(0,2,t.FLOAT,!1,8,0),t.vertexAttribDivisor(0,0),t.bindBuffer(t.ARRAY_BUFFER,this.allSegmentIdBuffer),t.enableVertexAttribArray(1),t.vertexAttribPointer(1,1,t.FLOAT,!1,4,0),t.vertexAttribDivisor(1,1),t.bindVertexArray(this.fillVao),t.bindBuffer(t.ARRAY_BUFFER,this.cornerBuffer),t.enableVertexAttribArray(0),t.vertexAttribPointer(0,2,t.FLOAT,!1,8,0),t.vertexAttribDivisor(0,0),t.bindBuffer(t.ARRAY_BUFFER,this.allFillPathIdBuffer),t.enableVertexAttribArray(3),t.vertexAttribPointer(3,1,t.FLOAT,!1,4,0),t.vertexAttribDivisor(3,1),t.bindVertexArray(this.textVao),t.bindBuffer(t.ARRAY_BUFFER,this.cornerBuffer),t.enableVertexAttribArray(0),t.vertexAttribPointer(0,2,t.FLOAT,!1,8,0),t.vertexAttribDivisor(0,0),t.bindBuffer(t.ARRAY_BUFFER,this.allTextInstanceIdBuffer),t.enableVertexAttribArray(2),t.vertexAttribPointer(2,1,t.FLOAT,!1,4,0),t.vertexAttribDivisor(2,1),t.bindVertexArray(this.blitVao),t.bindBuffer(t.ARRAY_BUFFER,this.cornerBuffer),t.enableVertexAttribArray(0),t.vertexAttribPointer(0,2,t.FLOAT,!1,8,0),t.vertexAttribDivisor(0,0),t.bindVertexArray(null)}initializeState(){this.ensureRenderState()}ensureRenderState(){const t=this.gl;t.disable(t.DEPTH_TEST),t.disable(t.CULL_FACE),t.disable(t.SCISSOR_TEST),t.colorMask(!0,!0,!0,!0),t.enable(t.BLEND),t.blendEquationSeparate(t.FUNC_ADD,t.FUNC_ADD),t.blendFuncSeparate(t.SRC_ALPHA,t.ONE_MINUS_SRC_ALPHA,t.ONE,t.ONE_MINUS_SRC_ALPHA)}uploadPageBackgroundTexture(){const t=this.gl,e=this.pageBackgroundColor,s=new Uint8Array([Math.round(e[0]*255),Math.round(e[1]*255),Math.round(e[2]*255),Math.round(e[3]*255)]);t.bindTexture(t.TEXTURE_2D,this.pageBackgroundTexture),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MIN_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_MAG_FILTER,t.NEAREST),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_S,t.CLAMP_TO_EDGE),t.texParameteri(t.TEXTURE_2D,t.TEXTURE_WRAP_T,t.CLAMP_TO_EDGE),t.texImage2D(t.TEXTURE_2D,0,t.RGBA,1,1,0,t.RGBA,t.UNSIGNED_BYTE,s),t.bindTexture(t.TEXTURE_2D,null)}clientToWorld(t,e){return this.clientToWorldAt(t,e,this.cameraCenterX,this.cameraCenterY,this.zoom)}clientToWorldAt(t,e,s,a,r){const i=this.resolveInteractionViewportRect(),o=this.resolveClientToPixelScale(i),l=(t-i.left)*o.x,c=(i.bottom-e)*o.y;return{x:(l-this.canvas.width*.5)/r+s,y:(c-this.canvas.height*.5)/r+a}}syncCameraTargetsToCurrent(){this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY,this.targetZoom=this.zoom,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1}updatePanReleaseVelocitySample(t){if(!this.isPanInteracting){this.lastPanFrameTimeMs=0;return}if(this.lastPanFrameTimeMs>0){const e=t-this.lastPanFrameTimeMs;if(e>.1){const s=this.cameraCenterX-this.lastPanFrameCameraX,a=this.cameraCenterY-this.lastPanFrameCameraY;let r=s*1e3/e,i=a*1e3/e;const o=Math.hypot(r,i);if(Number.isFinite(o)&&o>=gn){if(o>xn){const l=xn/o;r*=l,i*=l}this.panVelocityWorldX=r,this.panVelocityWorldY=i,this.lastPanVelocityUpdateTimeMs=t}}}this.lastPanFrameCameraX=this.cameraCenterX,this.lastPanFrameCameraY=this.cameraCenterY,this.lastPanFrameTimeMs=t}updateCameraWithDamping(t){let e=Math.abs(this.targetCameraCenterX-this.cameraCenterX)>Wt||Math.abs(this.targetCameraCenterY-this.cameraCenterY)>Wt,s=Math.abs(this.targetZoom-this.zoom)>le;if(!e&&!s)return this.hasZoomAnchor=!1,this.lastCameraAnimationTimeMs=t,!1;this.lastCameraAnimationTimeMs<=0&&(this.lastCameraAnimationTimeMs=t-16);const a=yt(t-this.lastCameraAnimationTimeMs,0,Vi);this.lastCameraAnimationTimeMs=t;const r=a/1e3,i=1-Math.exp(-De*r),o=1-Math.exp(-24*r);if(s&&(this.zoom+=(this.targetZoom-this.zoom)*o,Math.abs(this.targetZoom-this.zoom)<=le&&(this.zoom=this.targetZoom)),this.hasZoomAnchor){const l=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,this.zoom),c=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,this.targetZoom);this.cameraCenterX=l.x,this.cameraCenterY=l.y,this.targetCameraCenterX=c.x,this.targetCameraCenterY=c.y,s||(this.hasZoomAnchor=!1),e=!1}else e&&(this.cameraCenterX+=(this.targetCameraCenterX-this.cameraCenterX)*i,this.cameraCenterY+=(this.targetCameraCenterY-this.cameraCenterY)*i,Math.abs(this.targetCameraCenterX-this.cameraCenterX)<=Wt&&(this.cameraCenterX=this.targetCameraCenterX),Math.abs(this.targetCameraCenterY-this.cameraCenterY)<=Wt&&(this.cameraCenterY=this.targetCameraCenterY));return this.markInteraction(),this.needsVisibleSetUpdate=!0,e=Math.abs(this.targetCameraCenterX-this.cameraCenterX)>Wt||Math.abs(this.targetCameraCenterY-this.cameraCenterY)>Wt,s=Math.abs(this.targetZoom-this.zoom)>le,e||s}computeCameraCenterForAnchor(t,e,s,a,r){const i=this.resolveInteractionViewportRect(),o=this.resolveClientToPixelScale(i),l=(t-i.left)*o.x,c=(i.bottom-e)*o.y;return{x:s-(l-this.canvas.width*.5)/r,y:a-(c-this.canvas.height*.5)/r}}resolveInteractionViewportRect(){const t=this.interactionViewportProvider?.();return t||this.canvas.getBoundingClientRect()}resolveClientToPixelScale(t){const e=t??this.resolveInteractionViewportRect(),s=Math.max(window.devicePixelRatio||1,1e-6),a=e.width>1e-6?this.canvas.width/e.width:s,r=e.height>1e-6?this.canvas.height/e.height:s;return{x:Math.max(1e-6,a),y:Math.max(1e-6,r)}}createProgram(t,e){const s=this.gl,a=this.compileShader(s.VERTEX_SHADER,t),r=this.compileShader(s.FRAGMENT_SHADER,e),i=s.createProgram();if(!i)throw new Error("Unable to create WebGL program.");if(s.attachShader(i,a),s.attachShader(i,r),s.linkProgram(i),!s.getProgramParameter(i,s.LINK_STATUS)){const l=s.getProgramInfoLog(i)||"Unknown linker error.";throw s.deleteProgram(i),new Error(`Program link failed: ${l}`)}return s.deleteShader(a),s.deleteShader(r),i}compileShader(t,e){const s=this.gl.createShader(t);if(!s)throw new Error("Unable to create shader.");if(this.gl.shaderSource(s,e),this.gl.compileShader(s),!this.gl.getShaderParameter(s,this.gl.COMPILE_STATUS)){const r=this.gl.getShaderInfoLog(s)||"Unknown shader compiler error.";throw this.gl.deleteShader(s),new Error(`Shader compilation failed: ${r}`)}return s}createVertexArray(){const t=this.gl.createVertexArray();if(!t)throw new Error("Unable to create VAO.");return t}mustCreateBuffer(){const t=this.gl.createBuffer();if(!t)throw new Error("Unable to create WebGL buffer.");return t}mustCreateTexture(){const t=this.gl.createTexture();if(!t)throw new Error("Unable to create WebGL texture.");return t}mustGetUniformLocation(t,e){const s=this.gl.getUniformLocation(t,e);if(!s)throw new Error(`Missing uniform: ${e}`);return s}}function wt(n){n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,n.NEAREST),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAG_FILTER,n.NEAREST),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_S,n.CLAMP_TO_EDGE),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_T,n.CLAMP_TO_EDGE)}function Wi(n){n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,n.NEAREST),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAG_FILTER,n.NEAREST),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_S,n.CLAMP_TO_EDGE),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_T,n.CLAMP_TO_EDGE)}function Hi(n){n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,n.LINEAR),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAG_FILTER,n.LINEAR),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_S,n.CLAMP_TO_EDGE),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_T,n.CLAMP_TO_EDGE)}function qi(n){n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,n.LINEAR),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAG_FILTER,n.LINEAR),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_S,n.CLAMP_TO_EDGE),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_T,n.CLAMP_TO_EDGE)}function yn(n){n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MIN_FILTER,n.LINEAR_MIPMAP_LINEAR),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_MAG_FILTER,n.LINEAR),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_S,n.CLAMP_TO_EDGE),n.texParameteri(n.TEXTURE_2D,n.TEXTURE_WRAP_T,n.CLAMP_TO_EDGE)}function Zi(n){const t=new Uint8Array(n.length);for(let e=0;e+3<n.length;e+=4){const s=n[e+3];if(s<=0){t[e]=0,t[e+1]=0,t[e+2]=0,t[e+3]=0;continue}if(s>=255){t[e]=n[e],t[e+1]=n[e+1],t[e+2]=n[e+2],t[e+3]=255;continue}const a=s/255;t[e]=Math.round(n[e]*a),t[e+1]=Math.round(n[e+1]*a),t[e+2]=Math.round(n[e+2]*a),t[e+3]=s}return t}function ji(n,t){const e=new Uint8Array(t*4),s=Math.min(n.length,e.length);for(let a=0;a<s;a+=1)e[a]=Math.round(yt(n[a],0,1)*255);return e}function Jt(n,t){const e=Math.max(1,n),s=Math.ceil(Math.sqrt(e)),a=yt(s,1,t),r=Math.max(1,Math.ceil(e/a));if(r>t)throw new Error("Data texture exceeds GPU limits for this browser/GPU.");return{width:a,height:r}}function $i(n){return n.pageRects instanceof Float32Array&&n.pageRects.length>=4?new Float32Array(n.pageRects):new Float32Array([n.pageBounds.minX,n.pageBounds.minY,n.pageBounds.maxX,n.pageBounds.maxY])}function Qi(n,t,e){const s=Math.max(1,Math.floor(t.length/4)),a=s*2,r=Math.max(0,e|0);if(n.pageTextRanges instanceof Uint32Array&&n.pageTextRanges.length>=a){const o=new Uint32Array(a);let l=0;for(let c=0;c<s;c+=1){const p=c*2,m=yt(Math.trunc(n.pageTextRanges[p]),l,r),g=yt(Math.trunc(n.pageTextRanges[p+1]),0,r-m);o[p]=m,o[p+1]=g,l=m+g}return o}const i=new Uint32Array(a);i[0]=0,i[1]=r;for(let o=1;o<s;o+=1){const l=o*2;i[l]=r,i[l+1]=0}return i}function yt(n,t,e){return n<t?t:n>e?e:n}function de(n,t){return n<0?0:n>=t?t-1:n}const Ki=140,Ji=.92,Tn=3e5,vn=1.8,bn=96,tr=1e-5,er=.75,nr=1.3333333333,ir=2,rr=2.25,Le=24,Ht=1e-4,fe=1e-5,ar=64,Cn=5,An=2e4,sr=120,te={r:160/255,g:169/255,b:175/255,a:1},or=16,Ft=64,lr=12,me=48,cr=4,pe=16,ur=8,ge=32,hr=`
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
`,dr=`
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
`,fr=`
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
`,mr=`
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
`,pr=`
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
`,gr=`
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
`;class oi{canvas;gpuDevice;gpuContext;presentationFormat;strokePipeline;fillPipeline;textPipeline;rasterPipeline;blitPipeline;vectorCompositePipeline;cameraUniformBuffer;blitUniformBuffer;vectorCompositeUniformBuffer;panCacheSampler;rasterLayerSampler;vectorCompositeSampler;strokeBindGroupLayout;fillBindGroupLayout;textBindGroupLayout;rasterBindGroupLayout;blitBindGroupLayout;vectorCompositeBindGroupLayout;strokeBindGroupAll=null;strokeBindGroupVisible=null;fillBindGroup=null;textBindGroup=null;blitBindGroup=null;vectorCompositeBindGroup=null;segmentTextureA=null;segmentTextureB=null;segmentTextureC=null;segmentTextureD=null;fillPathMetaTextureA=null;fillPathMetaTextureB=null;fillPathMetaTextureC=null;fillSegmentTextureA=null;fillSegmentTextureB=null;textInstanceTextureA=null;textInstanceTextureB=null;textInstanceTextureC=null;rasterLayerResources=[];pageBackgroundResources=[];textGlyphMetaTextureA=null;textGlyphMetaTextureB=null;textGlyphRasterMetaTexture=null;textGlyphSegmentTextureA=null;textGlyphSegmentTextureB=null;textRasterAtlasTexture=null;pageBackgroundTexture=null;segmentIdBufferAll=null;segmentIdBufferVisible=null;panCacheTexture=null;panCacheWidth=0;panCacheHeight=0;panCacheValid=!1;panCacheCenterX=0;panCacheCenterY=0;panCacheZoom=1;panCacheRenderedSegments=0;panCacheUsedCulling=!1;vectorMinifyTexture=null;vectorMinifyWidth=0;vectorMinifyHeight=0;scene=null;sceneStats=null;grid=null;frameListener=null;interactionViewportProvider=null;presentedCameraCenterX=0;presentedCameraCenterY=0;presentedZoom=1;presentedFrameSerial=0;rafHandle=0;externalFrameDriver=!1;externalFramePending=!1;cameraCenterX=0;cameraCenterY=0;zoom=1;targetCameraCenterX=0;targetCameraCenterY=0;targetZoom=1;lastCameraAnimationTimeMs=0;hasZoomAnchor=!1;zoomAnchorClientX=0;zoomAnchorClientY=0;zoomAnchorWorldX=0;zoomAnchorWorldY=0;panVelocityWorldX=0;panVelocityWorldY=0;lastPanVelocityUpdateTimeMs=0;lastPanFrameCameraX=0;lastPanFrameCameraY=0;lastPanFrameTimeMs=0;minZoom=.01;maxZoom=8192;strokeCurveEnabled=!0;rasterRenderingEnabled=!0;fillRenderingEnabled=!0;strokeRenderingEnabled=!0;textRenderingEnabled=!0;textVectorOnly=!1;pageBackgroundColor=[1,1,1,1];vectorOverrideColor=[0,0,0];vectorOverrideOpacity=0;panOptimizationEnabled=!0;isPanInteracting=!1;hasCameraInteractionSinceSceneLoad=!1;lastInteractionTime=Number.NEGATIVE_INFINITY;needsVisibleSetUpdate=!1;segmentCount=0;fillPathCount=0;textInstanceCount=0;visibleSegmentCount=0;usingAllSegments=!0;segmentTextureWidth=1;segmentTextureHeight=1;fillPathMetaTextureWidth=1;fillPathMetaTextureHeight=1;fillSegmentTextureWidth=1;fillSegmentTextureHeight=1;textInstanceTextureWidth=1;textInstanceTextureHeight=1;textGlyphMetaTextureWidth=1;textGlyphMetaTextureHeight=1;textGlyphSegmentTextureWidth=1;textGlyphSegmentTextureHeight=1;allSegmentIds=new Uint32Array(0);visibleSegmentIds=new Uint32Array(0);segmentMarks=new Uint32Array(0);segmentMinX=new Float32Array(0);segmentMinY=new Float32Array(0);segmentMaxX=new Float32Array(0);segmentMaxY=new Float32Array(0);markToken=1;constructor(t,e,s,a){this.canvas=t,this.gpuDevice=e,this.gpuContext=s,this.presentationFormat=a,this.configureContext();const r=globalThis.GPUBufferUsage,i=globalThis.GPUShaderStage;this.cameraUniformBuffer=this.gpuDevice.createBuffer({size:Ft,usage:r.UNIFORM|r.COPY_DST}),this.blitUniformBuffer=this.gpuDevice.createBuffer({size:me,usage:r.UNIFORM|r.COPY_DST}),this.vectorCompositeUniformBuffer=this.gpuDevice.createBuffer({size:pe,usage:r.UNIFORM|r.COPY_DST}),this.strokeBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:i.VERTEX|i.FRAGMENT,buffer:{type:"uniform",minBindingSize:Ft}},{binding:1,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:3,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:4,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:5,visibility:i.VERTEX,buffer:{type:"read-only-storage"}}]}),this.fillBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:i.VERTEX|i.FRAGMENT,buffer:{type:"uniform",minBindingSize:Ft}},{binding:1,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:3,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:4,visibility:i.FRAGMENT,texture:{sampleType:"unfilterable-float"}},{binding:5,visibility:i.FRAGMENT,texture:{sampleType:"unfilterable-float"}}]}),this.textBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:i.VERTEX|i.FRAGMENT,buffer:{type:"uniform",minBindingSize:Ft}},{binding:1,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:2,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:3,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:4,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:5,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:6,visibility:i.FRAGMENT,texture:{sampleType:"unfilterable-float"}},{binding:7,visibility:i.FRAGMENT,texture:{sampleType:"unfilterable-float"}},{binding:8,visibility:i.VERTEX,texture:{sampleType:"unfilterable-float"}},{binding:9,visibility:i.FRAGMENT,sampler:{type:"filtering"}},{binding:10,visibility:i.FRAGMENT,texture:{sampleType:"float"}}]}),this.rasterBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:i.VERTEX,buffer:{type:"uniform",minBindingSize:Ft}},{binding:1,visibility:i.VERTEX,buffer:{type:"uniform",minBindingSize:ge}},{binding:2,visibility:i.FRAGMENT,sampler:{type:"filtering"}},{binding:3,visibility:i.FRAGMENT,texture:{sampleType:"float"}}]}),this.blitBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:i.FRAGMENT,sampler:{type:"filtering"}},{binding:1,visibility:i.FRAGMENT,texture:{sampleType:"float"}},{binding:2,visibility:i.FRAGMENT,buffer:{type:"uniform",minBindingSize:me}}]}),this.vectorCompositeBindGroupLayout=this.gpuDevice.createBindGroupLayout({entries:[{binding:0,visibility:i.FRAGMENT,sampler:{type:"filtering"}},{binding:1,visibility:i.FRAGMENT,texture:{sampleType:"float"}},{binding:2,visibility:i.FRAGMENT,buffer:{type:"uniform",minBindingSize:pe}}]});const o=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.strokeBindGroupLayout]}),l=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.fillBindGroupLayout]}),c=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.textBindGroupLayout]}),p=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.rasterBindGroupLayout]}),m=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.blitBindGroupLayout]}),g=this.gpuDevice.createPipelineLayout({bindGroupLayouts:[this.vectorCompositeBindGroupLayout]});this.strokePipeline=this.createPipeline(hr,"vsMain","fsMain",o),this.fillPipeline=this.createPipeline(dr,"vsMain","fsMain",l),this.textPipeline=this.createPipeline(fr,"vsMain","fsMain",c),this.rasterPipeline=this.createPipeline(mr,"vsMain","fsMain",p,!0),this.blitPipeline=this.createPipeline(pr,"vsMain","fsMain",m),this.vectorCompositePipeline=this.createPipeline(gr,"vsMain","fsMain",g,!0),this.panCacheSampler=this.gpuDevice.createSampler({magFilter:"linear",minFilter:"linear",mipmapFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),this.rasterLayerSampler=this.gpuDevice.createSampler({magFilter:"linear",minFilter:"linear",mipmapFilter:"linear",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),this.vectorCompositeSampler=this.gpuDevice.createSampler({magFilter:"linear",minFilter:"linear",mipmapFilter:"nearest",addressModeU:"clamp-to-edge",addressModeV:"clamp-to-edge"}),this.pageBackgroundTexture=this.createRgba8Texture(1,1,new Uint8Array([255,255,255,255])),this.ensureSegmentIdBuffers(1)}static async create(t){const e=navigator;if(!e.gpu)throw new Error("WebGPU is not available in this browser.");const s=await e.gpu.requestAdapter({powerPreference:"high-performance"})??await e.gpu.requestAdapter();if(!s)throw new Error("Failed to acquire a WebGPU adapter.");const a=await s.requestDevice();typeof a.addEventListener=="function"&&a.addEventListener("uncapturederror",o=>{const l=o?.error?.message||o?.error||o;console.warn("[WebGPU uncaptured error]",l)});const r=t.getContext("webgpu");if(!r)throw new Error("Failed to acquire a WebGPU canvas context.");const i=e.gpu.getPreferredCanvasFormat?.()??"bgra8unorm";return new oi(t,a,r,i)}setFrameListener(t){this.frameListener=t}setExternalFrameDriver(t){const e=!!t;if(this.externalFrameDriver!==e){if(this.externalFrameDriver=e,this.externalFrameDriver){this.externalFramePending=!0,this.rafHandle!==0&&(cancelAnimationFrame(this.rafHandle),this.rafHandle=0);return}this.externalFramePending&&(this.externalFramePending=!1,this.requestFrame())}}renderExternalFrame(t=performance.now()){this.externalFrameDriver&&!this.externalFramePending||(this.externalFramePending=!1,this.render(t))}setPanOptimizationEnabled(t){const e=!!t;this.panOptimizationEnabled!==e&&(this.panOptimizationEnabled=e,this.isPanInteracting=!1,this.panCacheValid=!1,this.panOptimizationEnabled||this.destroyPanCacheResources(),this.needsVisibleSetUpdate=!0,this.requestFrame())}setStrokeCurveEnabled(t){const e=!!t;this.strokeCurveEnabled!==e&&(this.strokeCurveEnabled=e,this.requestFrame())}setRasterRenderingEnabled(t){const e=!!t;this.rasterRenderingEnabled!==e&&(this.rasterRenderingEnabled=e,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setFillRenderingEnabled(t){const e=!!t;this.fillRenderingEnabled!==e&&(this.fillRenderingEnabled=e,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setStrokeRenderingEnabled(t){const e=!!t;this.strokeRenderingEnabled!==e&&(this.strokeRenderingEnabled=e,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setTextRenderingEnabled(t){const e=!!t;this.textRenderingEnabled!==e&&(this.textRenderingEnabled=e,this.panCacheValid=!1,this.needsVisibleSetUpdate=!0,this.requestFrame())}setTextVectorOnly(t){const e=!!t;this.textVectorOnly!==e&&(this.textVectorOnly=e,this.panCacheValid=!1,this.textVectorOnly&&this.destroyVectorMinifyResources(),this.requestFrame())}setPageBackgroundColor(t,e,s,a){const r=It(t,0,1),i=It(e,0,1),o=It(s,0,1),l=It(a,0,1),c=this.pageBackgroundColor;Math.abs(c[0]-r)<=1e-6&&Math.abs(c[1]-i)<=1e-6&&Math.abs(c[2]-o)<=1e-6&&Math.abs(c[3]-l)<=1e-6||(this.pageBackgroundColor=[r,i,o,l],this.uploadPageBackgroundTexture(),this.panCacheValid=!1,this.requestFrame())}setVectorColorOverride(t,e,s,a){const r=It(t,0,1),i=It(e,0,1),o=It(s,0,1),l=It(a,0,1),c=this.vectorOverrideColor;Math.abs(c[0]-r)<=1e-6&&Math.abs(c[1]-i)<=1e-6&&Math.abs(c[2]-o)<=1e-6&&Math.abs(this.vectorOverrideOpacity-l)<=1e-6||(this.vectorOverrideColor=[r,i,o],this.vectorOverrideOpacity=l,this.panCacheValid=!1,this.requestFrame())}setInteractionViewportProvider(t){this.interactionViewportProvider=t}beginPanInteraction(){this.hasCameraInteractionSinceSceneLoad=!0,this.syncCameraTargetsToCurrent(),this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameCameraX=this.cameraCenterX,this.lastPanFrameCameraY=this.cameraCenterY,this.lastPanFrameTimeMs=0,this.isPanInteracting=!0,this.markInteraction()}endPanInteraction(){this.isPanInteracting=!1;const t=performance.now(),s=this.lastPanVelocityUpdateTimeMs>0&&t-this.lastPanVelocityUpdateTimeMs<=sr?Math.hypot(this.panVelocityWorldX,this.panVelocityWorldY):0;Number.isFinite(s)&&s>=Cn?(this.targetCameraCenterX=this.cameraCenterX+this.panVelocityWorldX/Le,this.targetCameraCenterY=this.cameraCenterY+this.panVelocityWorldY/Le,this.lastCameraAnimationTimeMs=0):(this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY),this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameTimeMs=0,this.markInteraction(),this.needsVisibleSetUpdate=!0,this.requestFrame()}resize(){const t=window.devicePixelRatio||1,e=Math.max(1,Math.round(this.canvas.clientWidth*t)),s=Math.max(1,Math.round(this.canvas.clientHeight*t));this.canvas.width===e&&this.canvas.height===s||(this.canvas.width=e,this.canvas.height=s,this.configureContext(),this.destroyPanCacheResources(),this.destroyVectorMinifyResources(),this.needsVisibleSetUpdate=!0,this.requestFrame())}setScene(t){this.scene=t,this.segmentCount=t.segmentCount,this.fillPathCount=t.fillPathCount,this.textInstanceCount=t.textInstanceCount,this.buildSegmentBounds(t),this.isPanInteracting=!1,this.panCacheValid=!1,this.destroyVectorMinifyResources(),this.grid=this.segmentCount>0?Qn(t):null;const e=this.maxTextureSize(),s=qt(t.segmentCount,e),a=qt(t.fillPathCount,e),r=qt(t.fillSegmentCount,e),i=qt(t.textInstanceCount,e),o=qt(t.textGlyphCount,e),l=qt(t.textGlyphSegmentCount,e);this.segmentTextureWidth=s.width,this.segmentTextureHeight=s.height,this.fillPathMetaTextureWidth=a.width,this.fillPathMetaTextureHeight=a.height,this.fillSegmentTextureWidth=r.width,this.fillSegmentTextureHeight=r.height,this.textInstanceTextureWidth=i.width,this.textInstanceTextureHeight=i.height,this.textGlyphMetaTextureWidth=o.width,this.textGlyphMetaTextureHeight=o.height,this.textGlyphSegmentTextureWidth=l.width,this.textGlyphSegmentTextureHeight=l.height,this.destroyDataResources(),this.segmentTextureA=this.createFloatTexture(this.segmentTextureWidth,this.segmentTextureHeight,t.endpoints),this.segmentTextureB=this.createFloatTexture(this.segmentTextureWidth,this.segmentTextureHeight,t.primitiveMeta),this.segmentTextureC=this.createFloatTexture(this.segmentTextureWidth,this.segmentTextureHeight,t.styles),this.segmentTextureD=this.createFloatTexture(this.segmentTextureWidth,this.segmentTextureHeight,t.primitiveBounds),this.fillPathMetaTextureA=this.createFloatTexture(this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,t.fillPathMetaA),this.fillPathMetaTextureB=this.createFloatTexture(this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,t.fillPathMetaB),this.fillPathMetaTextureC=this.createFloatTexture(this.fillPathMetaTextureWidth,this.fillPathMetaTextureHeight,t.fillPathMetaC),this.fillSegmentTextureA=this.createFloatTexture(this.fillSegmentTextureWidth,this.fillSegmentTextureHeight,t.fillSegmentsA),this.fillSegmentTextureB=this.createFloatTexture(this.fillSegmentTextureWidth,this.fillSegmentTextureHeight,t.fillSegmentsB),this.textInstanceTextureA=this.createFloatTexture(this.textInstanceTextureWidth,this.textInstanceTextureHeight,t.textInstanceA),this.textInstanceTextureB=this.createFloatTexture(this.textInstanceTextureWidth,this.textInstanceTextureHeight,t.textInstanceB),this.textInstanceTextureC=this.createRgba8DataTexture(this.textInstanceTextureWidth,this.textInstanceTextureHeight,Tr(t.textInstanceC,this.textInstanceTextureWidth*this.textInstanceTextureHeight)),this.textGlyphMetaTextureA=this.createFloatTexture(this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,t.textGlyphMetaA),this.textGlyphMetaTextureB=this.createFloatTexture(this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,t.textGlyphMetaB),this.textGlyphSegmentTextureA=this.createFloatTexture(this.textGlyphSegmentTextureWidth,this.textGlyphSegmentTextureHeight,t.textGlyphSegmentsA),this.textGlyphSegmentTextureB=this.createFloatTexture(this.textGlyphSegmentTextureWidth,this.textGlyphSegmentTextureHeight,t.textGlyphSegmentsB);const c=new Float32Array(this.textGlyphMetaTextureWidth*this.textGlyphMetaTextureHeight*4),p=Kn(t,e);p&&c.set(p.glyphUvRects),this.textGlyphRasterMetaTexture=this.createFloatTexture(this.textGlyphMetaTextureWidth,this.textGlyphMetaTextureHeight,c),this.textRasterAtlasTexture=p?this.createR8Texture(p.width,p.height,p.alpha):this.createR8Texture(1,1,new Uint8Array([0])),this.configurePageBackgroundResources(t),this.configureRasterLayers(t),this.allSegmentIds=new Uint32Array(this.segmentCount);for(let m=0;m<this.segmentCount;m+=1)this.allSegmentIds[m]=m;return this.ensureSegmentIdBuffers(Math.max(1,this.segmentCount)),this.segmentCount>0&&(this.gpuDevice.queue.writeBuffer(this.segmentIdBufferAll,0,this.allSegmentIds),this.gpuDevice.queue.writeBuffer(this.segmentIdBufferVisible,0,this.allSegmentIds)),this.fillBindGroup=this.gpuDevice.createBindGroup({layout:this.fillPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:Ft}},{binding:1,resource:this.fillPathMetaTextureA.createView()},{binding:2,resource:this.fillPathMetaTextureB.createView()},{binding:3,resource:this.fillPathMetaTextureC.createView()},{binding:4,resource:this.fillSegmentTextureA.createView()},{binding:5,resource:this.fillSegmentTextureB.createView()}]}),this.textBindGroup=this.gpuDevice.createBindGroup({layout:this.textPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:Ft}},{binding:1,resource:this.textInstanceTextureA.createView()},{binding:2,resource:this.textInstanceTextureB.createView()},{binding:3,resource:this.textInstanceTextureC.createView()},{binding:4,resource:this.textGlyphMetaTextureA.createView()},{binding:5,resource:this.textGlyphMetaTextureB.createView()},{binding:6,resource:this.textGlyphSegmentTextureA.createView()},{binding:7,resource:this.textGlyphSegmentTextureB.createView()},{binding:8,resource:this.textGlyphRasterMetaTexture.createView()},{binding:9,resource:this.rasterLayerSampler},{binding:10,resource:this.textRasterAtlasTexture.createView()}]}),this.strokeBindGroupAll=this.gpuDevice.createBindGroup({layout:this.strokePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:Ft}},{binding:1,resource:this.segmentTextureA.createView()},{binding:2,resource:this.segmentTextureB.createView()},{binding:3,resource:this.segmentTextureC.createView()},{binding:4,resource:this.segmentTextureD.createView()},{binding:5,resource:{buffer:this.segmentIdBufferAll}}]}),this.strokeBindGroupVisible=this.gpuDevice.createBindGroup({layout:this.strokePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:Ft}},{binding:1,resource:this.segmentTextureA.createView()},{binding:2,resource:this.segmentTextureB.createView()},{binding:3,resource:this.segmentTextureC.createView()},{binding:4,resource:this.segmentTextureD.createView()},{binding:5,resource:{buffer:this.segmentIdBufferVisible}}]}),this.visibleSegmentIds.length<this.segmentCount&&(this.visibleSegmentIds=new Uint32Array(this.segmentCount)),this.segmentMarks.length<this.segmentCount&&(this.segmentMarks=new Uint32Array(this.segmentCount),this.markToken=1),this.visibleSegmentCount=this.segmentCount,this.usingAllSegments=!0,this.sceneStats={gridWidth:this.grid?.gridWidth??0,gridHeight:this.grid?.gridHeight??0,gridIndexCount:this.grid?.indices.length??0,maxCellPopulation:this.grid?.maxCellPopulation??0,fillPathTextureWidth:this.fillPathMetaTextureWidth,fillPathTextureHeight:this.fillPathMetaTextureHeight,fillSegmentTextureWidth:this.fillSegmentTextureWidth,fillSegmentTextureHeight:this.fillSegmentTextureHeight,textureWidth:this.segmentTextureWidth,textureHeight:this.segmentTextureHeight,maxTextureSize:e,textInstanceTextureWidth:this.textInstanceTextureWidth,textInstanceTextureHeight:this.textInstanceTextureHeight,textGlyphTextureWidth:this.textGlyphMetaTextureWidth,textGlyphTextureHeight:this.textGlyphMetaTextureHeight,textSegmentTextureWidth:this.textGlyphSegmentTextureWidth,textSegmentTextureHeight:this.textGlyphSegmentTextureHeight},this.minZoom=.01,this.maxZoom=8192,this.hasCameraInteractionSinceSceneLoad=!1,this.syncCameraTargetsToCurrent(),this.needsVisibleSetUpdate=!0,this.requestFrame(),this.sceneStats}getSceneStats(){return this.sceneStats}getViewState(){return{cameraCenterX:this.cameraCenterX,cameraCenterY:this.cameraCenterY,zoom:this.zoom}}getPresentedViewState(){return{cameraCenterX:this.presentedCameraCenterX,cameraCenterY:this.presentedCameraCenterY,zoom:this.presentedZoom}}getPresentedFrameSerial(){return this.presentedFrameSerial}setViewState(t){const e=Number(t.cameraCenterX),s=Number(t.cameraCenterY),a=Number(t.zoom);if(!Number.isFinite(e)||!Number.isFinite(s)||!Number.isFinite(a))return;this.cameraCenterX=e,this.cameraCenterY=s;const r=It(a,this.minZoom,this.maxZoom);this.zoom=r,this.targetCameraCenterX=e,this.targetCameraCenterY=s,this.targetZoom=r,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1,this.isPanInteracting=!1,this.panCacheValid=!1,this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.needsVisibleSetUpdate=!0,this.requestFrame()}fitToBounds(t,e=64){const s=Math.max(t.maxX-t.minX,1e-4),a=Math.max(t.maxY-t.minY,1e-4),r=Math.max(1,this.canvas.width-e*2),i=Math.max(1,this.canvas.height-e*2),o=Math.min(r/s,i/a),l=It(o,1e-8,this.maxZoom);this.minZoom=Math.min(this.minZoom,l);const c=(t.minX+t.maxX)*.5,p=(t.minY+t.maxY)*.5;this.zoom=l,this.cameraCenterX=c,this.cameraCenterY=p,this.targetZoom=l,this.targetCameraCenterX=c,this.targetCameraCenterY=p,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1,this.isPanInteracting=!1,this.panCacheValid=!1,this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.needsVisibleSetUpdate=!0,this.requestFrame()}panByPixels(t,e){if(!Number.isFinite(t)||!Number.isFinite(e))return;this.hasCameraInteractionSinceSceneLoad=!0,this.markInteraction(),this.hasZoomAnchor=!1;const s=this.resolveClientToPixelScale(),a=-(t*s.x)/this.zoom,r=e*s.y/this.zoom;this.cameraCenterX+=a,this.cameraCenterY+=r,this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY,this.needsVisibleSetUpdate=!0,this.requestFrame()}zoomAtClientPoint(t,e,s){const a=It(s,.1,10);this.hasCameraInteractionSinceSceneLoad=!0,this.markInteraction();const r=this.clientToWorld(t,e),i=It(this.targetZoom*a,this.minZoom,this.maxZoom);this.hasZoomAnchor=!0,this.zoomAnchorClientX=t,this.zoomAnchorClientY=e,this.zoomAnchorWorldX=r.x,this.zoomAnchorWorldY=r.y,this.targetZoom=i;const o=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,i);this.targetCameraCenterX=o.x,this.targetCameraCenterY=o.y,this.needsVisibleSetUpdate=!0,this.panVelocityWorldX=0,this.panVelocityWorldY=0,this.lastPanVelocityUpdateTimeMs=0,this.lastPanFrameTimeMs=0,this.requestFrame()}dispose(){this.rafHandle!==0&&(cancelAnimationFrame(this.rafHandle),this.rafHandle=0),this.frameListener=null,this.destroyPanCacheResources(),this.destroyVectorMinifyResources(),this.destroyDataResources(),this.segmentIdBufferAll&&(this.segmentIdBufferAll.destroy(),this.segmentIdBufferAll=null),this.segmentIdBufferVisible&&(this.segmentIdBufferVisible.destroy(),this.segmentIdBufferVisible=null),this.cameraUniformBuffer&&this.cameraUniformBuffer.destroy(),this.blitUniformBuffer&&this.blitUniformBuffer.destroy(),this.vectorCompositeUniformBuffer&&this.vectorCompositeUniformBuffer.destroy(),this.pageBackgroundTexture&&(this.pageBackgroundTexture.destroy(),this.pageBackgroundTexture=null)}configureContext(){this.gpuContext.configure({device:this.gpuDevice,format:this.presentationFormat,alphaMode:"opaque"})}createPipeline(t,e,s,a,r=!1){const i=this.gpuDevice.createShaderModule({code:t}),o=r?"one":"src-alpha";return this.gpuDevice.createRenderPipeline({layout:a,vertex:{module:i,entryPoint:e},fragment:{module:i,entryPoint:s,targets:[{format:this.presentationFormat,blend:{color:{srcFactor:o,dstFactor:"one-minus-src-alpha",operation:"add"},alpha:{srcFactor:"one",dstFactor:"one-minus-src-alpha",operation:"add"}}}]},primitive:{topology:"triangle-strip"}})}maxTextureSize(){const t=Number(this.gpuDevice?.limits?.maxTextureDimension2D);return Number.isFinite(t)&&t>=1?Math.floor(t):8192}ensureSegmentIdBuffers(t){const e=globalThis.GPUBufferUsage,s=Math.max(1,t)*4;this.segmentIdBufferAll&&(this.segmentIdBufferAll.destroy(),this.segmentIdBufferAll=null),this.segmentIdBufferVisible&&(this.segmentIdBufferVisible.destroy(),this.segmentIdBufferVisible=null),this.segmentIdBufferAll=this.gpuDevice.createBuffer({size:s,usage:e.STORAGE|e.COPY_DST}),this.segmentIdBufferVisible=this.gpuDevice.createBuffer({size:s,usage:e.STORAGE|e.COPY_DST})}requestFrame(){if(this.externalFrameDriver){this.externalFramePending=!0;return}this.rafHandle===0&&(this.rafHandle=requestAnimationFrame(t=>{this.rafHandle=0,this.render(t)}))}render(t=performance.now()){const e=this.updateCameraWithDamping(t);if(this.updatePanReleaseVelocitySample(t),!this.scene||this.segmentCount===0&&this.fillPathCount===0&&this.textInstanceCount===0&&this.rasterLayerResources.length===0&&this.pageBackgroundResources.length===0){this.clearToScreen(),this.capturePresentedFrameState(),this.frameListener?.({renderedSegments:0,totalSegments:0,usedCulling:!1,zoom:this.zoom}),e&&this.requestFrame();return}if(!this.hasNativeRenderingEnabled()){this.capturePresentedFrameState(),this.frameListener?.({renderedSegments:0,totalSegments:this.segmentCount,usedCulling:!1,zoom:this.zoom}),e&&this.requestFrame();return}this.shouldUsePanCache(e)?this.renderWithPanCache():this.renderDirectToScreen(),this.capturePresentedFrameState(),e&&this.requestFrame()}hasNativeRenderingEnabled(){return this.rasterRenderingEnabled||this.fillRenderingEnabled||this.strokeRenderingEnabled||this.textRenderingEnabled}capturePresentedFrameState(){this.presentedCameraCenterX=this.cameraCenterX,this.presentedCameraCenterY=this.cameraCenterY,this.presentedZoom=this.zoom,this.presentedFrameSerial+=1}shouldUsePanCache(t){return!this.panOptimizationEnabled||this.segmentCount<Tn?!1:this.isPanInteracting?!0:t}renderDirectToScreen(){let t=this.shouldUseVectorMinifyPath()&&this.ensureVectorMinifyResources();if(this.panOptimizationEnabled&&this.segmentCount>=Tn&&(t=!1),this.needsVisibleSetUpdate){if(t){const i=this.computeVectorMinifyZoom(this.vectorMinifyWidth,this.vectorMinifyHeight);this.updateVisibleSet(this.cameraCenterX,this.cameraCenterY,this.vectorMinifyWidth,this.vectorMinifyHeight,i)}else this.updateVisibleSet(this.cameraCenterX,this.cameraCenterY,this.canvas.width,this.canvas.height,this.zoom);this.needsVisibleSetUpdate=!1}if(t){const i=this.renderVectorLayerIntoMinifyTarget(this.vectorMinifyWidth,this.vectorMinifyHeight,this.cameraCenterX,this.cameraCenterY),o=this.gpuContext.getCurrentTexture().createView(),l=this.gpuDevice.createCommandEncoder(),c=l.beginRenderPass({colorAttachments:[{view:o,clearValue:te,loadOp:"clear",storeOp:"store"}]});this.updateCameraUniforms(this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY),this.drawRasterContentIntoPass(c),this.drawVectorMinifyCompositeIntoPass(c,this.canvas.width,this.canvas.height),c.end(),this.gpuDevice.queue.submit([l.finish()]),this.frameListener?.({renderedSegments:i,totalSegments:this.segmentCount,usedCulling:!this.usingAllSegments,zoom:this.zoom});return}const e=this.gpuContext.getCurrentTexture().createView(),s=this.gpuDevice.createCommandEncoder(),a=s.beginRenderPass({colorAttachments:[{view:e,clearValue:te,loadOp:"clear",storeOp:"store"}]}),r=this.drawSceneIntoPass(a,this.canvas.width,this.canvas.height,this.cameraCenterX,this.cameraCenterY);a.end(),this.gpuDevice.queue.submit([s.finish()]),this.frameListener?.({renderedSegments:r,totalSegments:this.segmentCount,usedCulling:!this.usingAllSegments,zoom:this.zoom})}hasVectorContent(){return this.fillRenderingEnabled&&this.fillPathCount>0||this.strokeRenderingEnabled&&this.segmentCount>0||this.textRenderingEnabled&&this.textInstanceCount>0}shouldUseVectorMinifyPath(){return this.textVectorOnly||!this.hasVectorContent()?!1:this.zoom<=rr}computeVectorMinifyZoom(t,e){const s=Math.min(t/Math.max(1,this.canvas.width),e/Math.max(1,this.canvas.height));return this.zoom*Math.max(1,s)}renderVectorLayerIntoMinifyTarget(t,e,s,a){if(!this.vectorMinifyTexture)return 0;const r=this.computeVectorMinifyZoom(t,e),i=this.gpuDevice.createCommandEncoder(),o=i.beginRenderPass({colorAttachments:[{view:this.vectorMinifyTexture.createView(),clearValue:{r:0,g:0,b:0,a:0},loadOp:"clear",storeOp:"store"}]});this.updateCameraUniforms(t,e,s,a,r);const l=this.drawVectorContentIntoPass(o);return o.end(),this.gpuDevice.queue.submit([i.finish()]),l}drawVectorMinifyCompositeIntoPass(t,e,s){!this.vectorCompositeBindGroup||!this.vectorMinifyTexture||(this.updateVectorCompositeUniforms(e,s),t.setPipeline(this.vectorCompositePipeline),t.setBindGroup(0,this.vectorCompositeBindGroup),t.draw(4,1,0,0))}renderWithPanCache(){if(!this.ensurePanCacheResources()){this.renderDirectToScreen();return}let t=this.panCacheZoom/Math.max(this.zoom,1e-6),e=(this.cameraCenterX-this.panCacheCenterX)*this.panCacheZoom,s=(this.cameraCenterY-this.panCacheCenterY)*this.panCacheZoom;const a=this.panCacheWidth*.5-2,r=this.panCacheHeight*.5-2,i=this.canvas.width*.5*Math.abs(t),o=this.canvas.height*.5*Math.abs(t),l=a-i,c=r-o,p=this.zoom/Math.max(this.panCacheZoom,1e-6),m=p<er||p>nr,d=Math.abs(this.targetZoom-this.zoom)<=fe&&Math.abs(this.panCacheZoom-this.zoom)>tr,y=l<0||c<0||Math.abs(e)>l||Math.abs(s)>c;if(!this.panCacheValid||m||y||d){this.panCacheCenterX=this.cameraCenterX,this.panCacheCenterY=this.cameraCenterY,this.panCacheZoom=this.zoom,this.updateVisibleSet(this.panCacheCenterX,this.panCacheCenterY,this.panCacheWidth,this.panCacheHeight),this.needsVisibleSetUpdate=!1;const x=this.gpuDevice.createCommandEncoder(),T=x.beginRenderPass({colorAttachments:[{view:this.panCacheTexture.createView(),clearValue:te,loadOp:"clear",storeOp:"store"}]});this.panCacheRenderedSegments=this.drawSceneIntoPass(T,this.panCacheWidth,this.panCacheHeight,this.panCacheCenterX,this.panCacheCenterY),T.end(),this.gpuDevice.queue.submit([x.finish()]),this.panCacheUsedCulling=!this.usingAllSegments,this.panCacheValid=!0,t=1,e=0,s=0}this.blitPanCache(e,s,t),this.frameListener?.({renderedSegments:this.panCacheRenderedSegments,totalSegments:this.segmentCount,usedCulling:this.panCacheUsedCulling,zoom:this.zoom})}drawSceneIntoPass(t,e,s,a,r){return this.updateCameraUniforms(e,s,a,r),this.drawRasterContentIntoPass(t),this.drawVectorContentIntoPass(t)}drawRasterContentIntoPass(t){if(this.rasterRenderingEnabled){if(this.pageBackgroundResources.length>0){t.setPipeline(this.rasterPipeline);for(const e of this.pageBackgroundResources)t.setBindGroup(0,e.bindGroup),t.draw(4,1,0,0)}if(this.rasterLayerResources.length>0){t.setPipeline(this.rasterPipeline);for(const e of this.rasterLayerResources)t.setBindGroup(0,e.bindGroup),t.draw(4,1,0,0)}}}drawVectorContentIntoPass(t){this.fillRenderingEnabled&&this.fillPathCount>0&&this.fillBindGroup&&(t.setPipeline(this.fillPipeline),t.setBindGroup(0,this.fillBindGroup),t.draw(4,this.fillPathCount,0,0));let e=this.strokeRenderingEnabled?this.usingAllSegments?this.segmentCount:this.visibleSegmentCount:0;if(e>0){const s=this.usingAllSegments?this.strokeBindGroupAll:this.strokeBindGroupVisible;s&&(t.setPipeline(this.strokePipeline),t.setBindGroup(0,s),t.draw(4,e,0,0))}return this.textRenderingEnabled&&this.textInstanceCount>0&&this.textBindGroup&&(t.setPipeline(this.textPipeline),t.setBindGroup(0,this.textBindGroup),t.draw(4,this.textInstanceCount,0,0)),e}updateCameraUniforms(t,e,s,a,r=this.zoom){const i=new Float32Array(or);i[0]=t,i[1]=e,i[2]=s,i[3]=a,i[4]=r,i[5]=1,i[6]=this.strokeCurveEnabled?1:0,i[7]=1.25,i[8]=this.strokeCurveEnabled?1:0,i[9]=1,i[10]=this.textVectorOnly?1:0,i[11]=0,i[12]=this.vectorOverrideColor[0],i[13]=this.vectorOverrideColor[1],i[14]=this.vectorOverrideColor[2],i[15]=this.vectorOverrideOpacity,xe(i,Ft,"camera"),this.gpuDevice.queue.writeBuffer(this.cameraUniformBuffer,0,i)}updateVectorCompositeUniforms(t,e){const s=new Float32Array(cr);s[0]=t,s[1]=e,s[2]=0,s[3]=0,xe(s,pe,"vector composite"),this.gpuDevice.queue.writeBuffer(this.vectorCompositeUniformBuffer,0,s)}updateBlitUniforms(t,e,s){const a=new Float32Array(lr);a[0]=this.canvas.width,a[1]=this.canvas.height,a[2]=this.panCacheWidth,a[3]=this.panCacheHeight,a[4]=t,a[5]=e,a[6]=s,a[7]=0,a[8]=0,a[9]=0,a[10]=0,a[11]=0,xe(a,me,"blit"),this.gpuDevice.queue.writeBuffer(this.blitUniformBuffer,0,a)}blitPanCache(t,e,s){if(!this.panCacheTexture||!this.blitBindGroup){this.renderDirectToScreen();return}this.updateBlitUniforms(t,e,s);const a=this.gpuContext.getCurrentTexture().createView(),r=this.gpuDevice.createCommandEncoder(),i=r.beginRenderPass({colorAttachments:[{view:a,clearValue:te,loadOp:"clear",storeOp:"store"}]});i.setPipeline(this.blitPipeline),i.setBindGroup(0,this.blitBindGroup),i.draw(4,1,0,0),i.end(),this.gpuDevice.queue.submit([r.finish()])}ensureVectorMinifyResources(){const t=this.maxTextureSize(),e=t/Math.max(1,this.canvas.width),s=t/Math.max(1,this.canvas.height),a=Math.max(1,Math.min(ir,e,s)),r=Math.max(this.canvas.width,Math.floor(this.canvas.width*a)),i=Math.max(this.canvas.height,Math.floor(this.canvas.height*a));if(r<this.canvas.width||i<this.canvas.height)return!1;if(this.vectorMinifyTexture&&this.vectorMinifyWidth===r&&this.vectorMinifyHeight===i&&this.vectorCompositeBindGroup)return!0;this.destroyVectorMinifyResources();const o=globalThis.GPUTextureUsage;return this.vectorMinifyTexture=this.gpuDevice.createTexture({size:{width:r,height:i,depthOrArrayLayers:1},format:this.presentationFormat,usage:o.RENDER_ATTACHMENT|o.TEXTURE_BINDING}),this.vectorMinifyWidth=r,this.vectorMinifyHeight=i,this.vectorCompositeBindGroup=this.gpuDevice.createBindGroup({layout:this.vectorCompositePipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.vectorCompositeSampler},{binding:1,resource:this.vectorMinifyTexture.createView()},{binding:2,resource:{buffer:this.vectorCompositeUniformBuffer,size:pe}}]}),!0}ensurePanCacheResources(){const t=this.maxTextureSize(),e=Math.min(t,Math.max(this.canvas.width+bn*2,Math.ceil(this.canvas.width*vn))),s=Math.min(t,Math.max(this.canvas.height+bn*2,Math.ceil(this.canvas.height*vn)));if(e<this.canvas.width||s<this.canvas.height)return!1;if(this.panCacheTexture&&this.panCacheWidth===e&&this.panCacheHeight===s&&this.blitBindGroup)return!0;this.destroyPanCacheResources();const a=globalThis.GPUTextureUsage;return this.panCacheTexture=this.gpuDevice.createTexture({size:{width:e,height:s,depthOrArrayLayers:1},format:this.presentationFormat,usage:a.RENDER_ATTACHMENT|a.TEXTURE_BINDING}),this.panCacheWidth=e,this.panCacheHeight=s,this.panCacheValid=!1,this.blitBindGroup=this.gpuDevice.createBindGroup({layout:this.blitPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:this.panCacheSampler},{binding:1,resource:this.panCacheTexture.createView()},{binding:2,resource:{buffer:this.blitUniformBuffer,size:me}}]}),!0}destroyPanCacheResources(){this.panCacheTexture&&(this.panCacheTexture.destroy(),this.panCacheTexture=null),this.panCacheWidth=0,this.panCacheHeight=0,this.panCacheValid=!1,this.panCacheRenderedSegments=0,this.panCacheUsedCulling=!1,this.blitBindGroup=null}destroyVectorMinifyResources(){this.vectorMinifyTexture&&(this.vectorMinifyTexture.destroy(),this.vectorMinifyTexture=null),this.vectorMinifyWidth=0,this.vectorMinifyHeight=0,this.vectorCompositeBindGroup=null}updateVisibleSet(t=this.cameraCenterX,e=this.cameraCenterY,s=this.canvas.width,a=this.canvas.height,r=this.zoom){if(!this.scene||!this.grid){this.visibleSegmentCount=0,this.usingAllSegments=!0;return}if(!this.hasCameraInteractionSinceSceneLoad){this.usingAllSegments=!0,this.visibleSegmentCount=this.segmentCount;return}const i=this.grid,o=Math.max(r,1e-6),l=s/(2*o),c=a/(2*o),p=Math.max(16/o,this.scene.maxHalfWidth*2),m=t-l-p,g=t+l+p,d=e-c-p,y=e+c+p,u=ye(Math.floor((m-i.minX)/i.cellWidth),i.gridWidth),x=ye(Math.floor((g-i.minX)/i.cellWidth),i.gridWidth),T=ye(Math.floor((d-i.minY)/i.cellHeight),i.gridHeight),b=ye(Math.floor((y-i.minY)/i.cellHeight),i.gridHeight),S=(x-u+1)*(b-T+1),E=i.gridWidth*i.gridHeight;if(!this.isInteractionActive()&&S>=E*Ji){this.usingAllSegments=!0,this.visibleSegmentCount=this.segmentCount;return}this.usingAllSegments=!1,this.markToken+=1,this.markToken===4294967295&&(this.segmentMarks.fill(0),this.markToken=1);let A=0;for(let w=T;w<=b;w+=1){let k=w*i.gridWidth+u;for(let N=u;N<=x;N+=1){const B=i.offsets[k],I=i.counts[k];for(let P=0;P<I;P+=1){const v=i.indices[B+P];this.segmentMarks[v]!==this.markToken&&(this.segmentMarks[v]=this.markToken,!(this.segmentMaxX[v]<m||this.segmentMinX[v]>g||this.segmentMaxY[v]<d||this.segmentMinY[v]>y)&&(this.visibleSegmentIds[A]=v,A+=1))}k+=1}}if(this.visibleSegmentCount=A,this.segmentIdBufferVisible&&A>0){const w=this.visibleSegmentIds.subarray(0,A);this.gpuDevice.queue.writeBuffer(this.segmentIdBufferVisible,0,w)}}buildSegmentBounds(t){this.segmentMinX.length<this.segmentCount&&(this.segmentMinX=new Float32Array(this.segmentCount),this.segmentMinY=new Float32Array(this.segmentCount),this.segmentMaxX=new Float32Array(this.segmentCount),this.segmentMaxY=new Float32Array(this.segmentCount));for(let e=0;e<this.segmentCount;e+=1){const s=e*4,a=e*4,r=t.styles[a]+.35;this.segmentMinX[e]=t.primitiveBounds[s]-r,this.segmentMinY[e]=t.primitiveBounds[s+1]-r,this.segmentMaxX[e]=t.primitiveBounds[s+2]+r,this.segmentMaxY[e]=t.primitiveBounds[s+3]+r}}markInteraction(){this.lastInteractionTime=performance.now()}isInteractionActive(){return performance.now()-this.lastInteractionTime<=Ki}configureRasterLayers(t){this.destroyRasterLayerResources();for(const e of this.getSceneRasterLayers(t)){const s=new Float32Array(6);e.matrix.length>=6?(s[0]=e.matrix[0],s[1]=e.matrix[1],s[2]=e.matrix[2],s[3]=e.matrix[3],s[4]=e.matrix[4],s[5]=e.matrix[5]):(s[0]=1,s[3]=1);const a=e.data.subarray(0,e.width*e.height*4),r=yr(a),i=this.createRgba8Texture(e.width,e.height,r);this.rasterLayerResources.push(this.createRasterLayerResource(s,i))}}configurePageBackgroundResources(t){if(this.destroyPageBackgroundResources(),this.pageBackgroundTexture||this.uploadPageBackgroundTexture(),!this.pageBackgroundTexture)return;const e=Cr(t);for(let s=0;s+3<e.length;s+=4){const a=e[s],r=e[s+1],i=e[s+2],o=e[s+3];if(![a,r,i,o].every(Number.isFinite))continue;const l=Math.max(i-a,1e-6),c=Math.max(o-r,1e-6),p=new Float32Array([l,0,0,c,a,r]);this.pageBackgroundResources.push(this.createRasterLayerResource(p,this.pageBackgroundTexture))}}getSceneRasterLayers(t){const e=[];if(Array.isArray(t.rasterLayers))for(const r of t.rasterLayers){const i=Math.max(0,Math.trunc(r?.width??0)),o=Math.max(0,Math.trunc(r?.height??0));i<=0||o<=0||!(r.data instanceof Uint8Array)||r.data.length<i*o*4||e.push({width:i,height:o,data:r.data,matrix:r.matrix instanceof Float32Array?r.matrix:new Float32Array(r.matrix)})}if(e.length>0)return e;const s=Math.max(0,Math.trunc(t.rasterLayerWidth)),a=Math.max(0,Math.trunc(t.rasterLayerHeight));return s<=0||a<=0||t.rasterLayerData.length<s*a*4||e.push({width:s,height:a,data:t.rasterLayerData,matrix:t.rasterLayerMatrix}),e}destroyRasterLayerResources(){for(const t of this.rasterLayerResources)t.texture&&t.texture.destroy(),t.uniformBuffer&&t.uniformBuffer.destroy();this.rasterLayerResources=[]}destroyPageBackgroundResources(){for(const t of this.pageBackgroundResources)t.uniformBuffer&&t.uniformBuffer.destroy();this.pageBackgroundResources=[]}uploadPageBackgroundTexture(){const t=Math.round(this.pageBackgroundColor[3]*255),e=t/255,s=new Uint8Array([Math.round(this.pageBackgroundColor[0]*e*255),Math.round(this.pageBackgroundColor[1]*e*255),Math.round(this.pageBackgroundColor[2]*e*255),t]);if(!this.pageBackgroundTexture){this.pageBackgroundTexture=this.createRgba8Texture(1,1,s);return}this.writeRgba8Texture(this.pageBackgroundTexture,1,1,s,0)}createRasterLayerResource(t,e){const s=globalThis.GPUBufferUsage,a=new Float32Array(ur);a[0]=t[0],a[1]=t[1],a[2]=t[2],a[3]=t[3],a[4]=t[4],a[5]=t[5],a[6]=0,a[7]=0,xe(a,ge,"raster");const r=this.gpuDevice.createBuffer({size:ge,usage:s.UNIFORM|s.COPY_DST});this.gpuDevice.queue.writeBuffer(r,0,a);const i=this.gpuDevice.createBindGroup({layout:this.rasterPipeline.getBindGroupLayout(0),entries:[{binding:0,resource:{buffer:this.cameraUniformBuffer,size:Ft}},{binding:1,resource:{buffer:r,size:ge}},{binding:2,resource:this.rasterLayerSampler},{binding:3,resource:e.createView()}]});return{texture:e,uniformBuffer:r,bindGroup:i}}createFloatTexture(t,e,s){const a=globalThis.GPUTextureUsage,r=this.gpuDevice.createTexture({size:{width:t,height:e,depthOrArrayLayers:1},format:"rgba32float",usage:a.TEXTURE_BINDING|a.COPY_DST}),i=xr(s,t,e);return this.writeFloatTexture(r,t,e,i),r}createRgba8Texture(t,e,s){const a=globalThis.GPUTextureUsage,r=vr(s,t,e),i=this.gpuDevice.createTexture({size:{width:t,height:e,depthOrArrayLayers:1},format:"rgba8unorm",mipLevelCount:r.length,usage:a.TEXTURE_BINDING|a.COPY_DST});for(let o=0;o<r.length;o+=1){const l=r[o],c=Oe(l.data,l.width,l.height);this.writeRgba8Texture(i,l.width,l.height,c,o)}return i}createR8Texture(t,e,s){const a=globalThis.GPUTextureUsage,r=br(s,t,e),i=this.gpuDevice.createTexture({size:{width:t,height:e,depthOrArrayLayers:1},format:"r8unorm",mipLevelCount:r.length,usage:a.TEXTURE_BINDING|a.COPY_DST});for(let o=0;o<r.length;o+=1){const l=r[o],c=Oe(l.data,l.width,l.height,1);this.writeR8Texture(i,l.width,l.height,c,o)}return i}createRgba8DataTexture(t,e,s){const a=globalThis.GPUTextureUsage,r=this.gpuDevice.createTexture({size:{width:t,height:e,depthOrArrayLayers:1},format:"rgba8unorm",usage:a.TEXTURE_BINDING|a.COPY_DST}),i=Oe(s,t,e,4);return this.writeRgba8Texture(r,t,e,i),r}writeFloatTexture(t,e,s,a){const r=e*16,i=Ne(r,256);if(s<=1&&r===i){this.gpuDevice.queue.writeTexture({texture:t},a,{offset:0},{width:e,height:s,depthOrArrayLayers:1});return}if(r===i){this.gpuDevice.queue.writeTexture({texture:t},a,{offset:0,bytesPerRow:r,rowsPerImage:s},{width:e,height:s,depthOrArrayLayers:1});return}const o=new Uint8Array(a.buffer,a.byteOffset,a.byteLength),l=new Uint8Array(i*s);for(let c=0;c<s;c+=1){const p=c*r,m=c*i;l.set(o.subarray(p,p+r),m)}this.gpuDevice.queue.writeTexture({texture:t},l,{offset:0,bytesPerRow:i,rowsPerImage:s},{width:e,height:s,depthOrArrayLayers:1})}writeRgba8Texture(t,e,s,a,r=0){const i=e*4,o=Ne(i,256);if(s<=1&&i===o){this.gpuDevice.queue.writeTexture({texture:t,mipLevel:r},a,{offset:0},{width:e,height:s,depthOrArrayLayers:1});return}if(i===o){this.gpuDevice.queue.writeTexture({texture:t,mipLevel:r},a,{offset:0,bytesPerRow:i,rowsPerImage:s},{width:e,height:s,depthOrArrayLayers:1});return}const l=new Uint8Array(o*s);for(let c=0;c<s;c+=1){const p=c*i,m=c*o;l.set(a.subarray(p,p+i),m)}this.gpuDevice.queue.writeTexture({texture:t,mipLevel:r},l,{offset:0,bytesPerRow:o,rowsPerImage:s},{width:e,height:s,depthOrArrayLayers:1})}writeR8Texture(t,e,s,a,r=0){const i=e,o=Ne(i,256);if(s<=1&&i===o){this.gpuDevice.queue.writeTexture({texture:t,mipLevel:r},a,{offset:0},{width:e,height:s,depthOrArrayLayers:1});return}if(i===o){this.gpuDevice.queue.writeTexture({texture:t,mipLevel:r},a,{offset:0,bytesPerRow:i,rowsPerImage:s},{width:e,height:s,depthOrArrayLayers:1});return}const l=new Uint8Array(o*s);for(let c=0;c<s;c+=1){const p=c*i,m=c*o;l.set(a.subarray(p,p+i),m)}this.gpuDevice.queue.writeTexture({texture:t,mipLevel:r},l,{offset:0,bytesPerRow:o,rowsPerImage:s},{width:e,height:s,depthOrArrayLayers:1})}clearToScreen(){const t=this.gpuContext.getCurrentTexture().createView(),e=this.gpuDevice.createCommandEncoder();e.beginRenderPass({colorAttachments:[{view:t,clearValue:te,loadOp:"clear",storeOp:"store"}]}).end(),this.gpuDevice.queue.submit([e.finish()])}destroyDataResources(){this.strokeBindGroupAll=null,this.strokeBindGroupVisible=null,this.fillBindGroup=null,this.textBindGroup=null,this.destroyPageBackgroundResources(),this.destroyRasterLayerResources();const t=[this.segmentTextureA,this.segmentTextureB,this.segmentTextureC,this.segmentTextureD,this.fillPathMetaTextureA,this.fillPathMetaTextureB,this.fillPathMetaTextureC,this.fillSegmentTextureA,this.fillSegmentTextureB,this.textInstanceTextureA,this.textInstanceTextureB,this.textInstanceTextureC,this.textGlyphMetaTextureA,this.textGlyphMetaTextureB,this.textGlyphRasterMetaTexture,this.textGlyphSegmentTextureA,this.textGlyphSegmentTextureB,this.textRasterAtlasTexture];for(const e of t)e&&e.destroy();this.segmentTextureA=null,this.segmentTextureB=null,this.segmentTextureC=null,this.segmentTextureD=null,this.fillPathMetaTextureA=null,this.fillPathMetaTextureB=null,this.fillPathMetaTextureC=null,this.fillSegmentTextureA=null,this.fillSegmentTextureB=null,this.textInstanceTextureA=null,this.textInstanceTextureB=null,this.textInstanceTextureC=null,this.textGlyphMetaTextureA=null,this.textGlyphMetaTextureB=null,this.textGlyphRasterMetaTexture=null,this.textGlyphSegmentTextureA=null,this.textGlyphSegmentTextureB=null,this.textRasterAtlasTexture=null}clientToWorld(t,e){return this.clientToWorldAt(t,e,this.cameraCenterX,this.cameraCenterY,this.zoom)}clientToWorldAt(t,e,s,a,r){const i=this.resolveInteractionViewportRect(),o=this.resolveClientToPixelScale(i),l=(t-i.left)*o.x,c=(i.bottom-e)*o.y;return{x:(l-this.canvas.width*.5)/r+s,y:(c-this.canvas.height*.5)/r+a}}syncCameraTargetsToCurrent(){this.targetCameraCenterX=this.cameraCenterX,this.targetCameraCenterY=this.cameraCenterY,this.targetZoom=this.zoom,this.lastCameraAnimationTimeMs=0,this.hasZoomAnchor=!1}updatePanReleaseVelocitySample(t){if(!this.isPanInteracting){this.lastPanFrameTimeMs=0;return}if(this.lastPanFrameTimeMs>0){const e=t-this.lastPanFrameTimeMs;if(e>.1){const s=this.cameraCenterX-this.lastPanFrameCameraX,a=this.cameraCenterY-this.lastPanFrameCameraY;let r=s*1e3/e,i=a*1e3/e;const o=Math.hypot(r,i);if(Number.isFinite(o)&&o>=Cn){if(o>An){const l=An/o;r*=l,i*=l}this.panVelocityWorldX=r,this.panVelocityWorldY=i,this.lastPanVelocityUpdateTimeMs=t}}}this.lastPanFrameCameraX=this.cameraCenterX,this.lastPanFrameCameraY=this.cameraCenterY,this.lastPanFrameTimeMs=t}updateCameraWithDamping(t){let e=Math.abs(this.targetCameraCenterX-this.cameraCenterX)>Ht||Math.abs(this.targetCameraCenterY-this.cameraCenterY)>Ht,s=Math.abs(this.targetZoom-this.zoom)>fe;if(!e&&!s)return this.hasZoomAnchor=!1,this.lastCameraAnimationTimeMs=t,!1;this.lastCameraAnimationTimeMs<=0&&(this.lastCameraAnimationTimeMs=t-16);const a=It(t-this.lastCameraAnimationTimeMs,0,ar);this.lastCameraAnimationTimeMs=t;const r=a/1e3,i=1-Math.exp(-Le*r),o=1-Math.exp(-24*r);if(s&&(this.zoom+=(this.targetZoom-this.zoom)*o,Math.abs(this.targetZoom-this.zoom)<=fe&&(this.zoom=this.targetZoom)),this.hasZoomAnchor){const l=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,this.zoom),c=this.computeCameraCenterForAnchor(this.zoomAnchorClientX,this.zoomAnchorClientY,this.zoomAnchorWorldX,this.zoomAnchorWorldY,this.targetZoom);this.cameraCenterX=l.x,this.cameraCenterY=l.y,this.targetCameraCenterX=c.x,this.targetCameraCenterY=c.y,s||(this.hasZoomAnchor=!1),e=!1}else e&&(this.cameraCenterX+=(this.targetCameraCenterX-this.cameraCenterX)*i,this.cameraCenterY+=(this.targetCameraCenterY-this.cameraCenterY)*i,Math.abs(this.targetCameraCenterX-this.cameraCenterX)<=Ht&&(this.cameraCenterX=this.targetCameraCenterX),Math.abs(this.targetCameraCenterY-this.cameraCenterY)<=Ht&&(this.cameraCenterY=this.targetCameraCenterY));return this.markInteraction(),this.needsVisibleSetUpdate=!0,e=Math.abs(this.targetCameraCenterX-this.cameraCenterX)>Ht||Math.abs(this.targetCameraCenterY-this.cameraCenterY)>Ht,s=Math.abs(this.targetZoom-this.zoom)>fe,e||s}computeCameraCenterForAnchor(t,e,s,a,r){const i=this.resolveInteractionViewportRect(),o=this.resolveClientToPixelScale(i),l=(t-i.left)*o.x,c=(i.bottom-e)*o.y;return{x:s-(l-this.canvas.width*.5)/r,y:a-(c-this.canvas.height*.5)/r}}resolveInteractionViewportRect(){const t=this.interactionViewportProvider?.();return t||this.canvas.getBoundingClientRect()}resolveClientToPixelScale(t){const e=t??this.resolveInteractionViewportRect(),s=Math.max(window.devicePixelRatio||1,1e-6),a=e.width>1e-6?this.canvas.width/e.width:s,r=e.height>1e-6?this.canvas.height/e.height:s;return{x:Math.max(1e-6,a),y:Math.max(1e-6,r)}}}function xr(n,t,e){const s=t*e*4;if(n.length>s)throw new Error(`Texture source data exceeds texture size (${n.length} > ${s}).`);const a=new Float32Array(s);return a.set(n),a}function Oe(n,t,e,s=4){const a=t*e*s;if(n.length>a)throw new Error(`Texture source data exceeds texture size (${n.length} > ${a}).`);const r=new Uint8Array(a);return r.set(n),r}function yr(n){const t=new Uint8Array(n.length);for(let e=0;e+3<n.length;e+=4){const s=n[e+3];if(s<=0){t[e]=0,t[e+1]=0,t[e+2]=0,t[e+3]=0;continue}if(s>=255){t[e]=n[e],t[e+1]=n[e+1],t[e+2]=n[e+2],t[e+3]=255;continue}const a=s/255;t[e]=Math.round(n[e]*a),t[e+1]=Math.round(n[e+1]*a),t[e+2]=Math.round(n[e+2]*a),t[e+3]=s}return t}function Tr(n,t){const e=new Uint8Array(t*4),s=Math.min(n.length,e.length);for(let a=0;a<s;a+=1)e[a]=Math.round(It(n[a],0,1)*255);return e}function vr(n,t,e){const s=[];let a=Math.max(1,Math.trunc(t)),r=Math.max(1,Math.trunc(e)),i=n;for(s.push({width:a,height:r,data:i});a>1||r>1;){const o=Math.max(1,a>>1),l=Math.max(1,r>>1),c=new Uint8Array(o*l*4);for(let p=0;p<l;p+=1){const m=Math.min(r-1,p*2),g=Math.min(r-1,m+1);for(let d=0;d<o;d+=1){const y=Math.min(a-1,d*2),u=Math.min(a-1,y+1),x=(m*a+y)*4,T=(m*a+u)*4,b=(g*a+y)*4,S=(g*a+u)*4,E=(p*o+d)*4;c[E]=i[x]+i[T]+i[b]+i[S]+2>>2,c[E+1]=i[x+1]+i[T+1]+i[b+1]+i[S+1]+2>>2,c[E+2]=i[x+2]+i[T+2]+i[b+2]+i[S+2]+2>>2,c[E+3]=i[x+3]+i[T+3]+i[b+3]+i[S+3]+2>>2}}s.push({width:o,height:l,data:c}),a=o,r=l,i=c}return s}function br(n,t,e){const s=[];let a=Math.max(1,Math.trunc(t)),r=Math.max(1,Math.trunc(e)),i=n;for(s.push({width:a,height:r,data:i});a>1||r>1;){const o=Math.max(1,a>>1),l=Math.max(1,r>>1),c=new Uint8Array(o*l);for(let p=0;p<l;p+=1){const m=Math.min(r-1,p*2),g=Math.min(r-1,m+1);for(let d=0;d<o;d+=1){const y=Math.min(a-1,d*2),u=Math.min(a-1,y+1),x=m*a+y,T=m*a+u,b=g*a+y,S=g*a+u;c[p*o+d]=i[x]+i[T]+i[b]+i[S]+2>>2}}s.push({width:o,height:l,data:c}),a=o,r=l,i=c}return s}function xe(n,t,e){const s=n.byteLength;if(s>t)throw new Error(`${e} uniform data (${s} bytes) exceeds buffer size ${t} bytes.`)}function qt(n,t){const e=Math.max(1,n),s=Math.ceil(Math.sqrt(e)),a=It(s,1,t),r=Math.max(1,Math.ceil(e/a));if(r>t)throw new Error("Data texture exceeds GPU limits for this browser/GPU.");return{width:a,height:r}}function Cr(n){return n.pageRects instanceof Float32Array&&n.pageRects.length>=4?new Float32Array(n.pageRects):new Float32Array([n.pageBounds.minX,n.pageBounds.minY,n.pageBounds.maxX,n.pageBounds.maxY])}function Ne(n,t){return Math.ceil(n/t)*t}function It(n,t,e){return n<t?t:n>e?e:n}function ye(n,t){return n<0?0:n>=t?t-1:n}const Ar="modulepreload",Sr=function(n,t){return new URL(n,t).href},Sn={},wn=function(t,e,s){let a=Promise.resolve();if(e&&e.length>0){let c=function(p){return Promise.all(p.map(m=>Promise.resolve(m).then(g=>({status:"fulfilled",value:g}),g=>({status:"rejected",reason:g}))))};const i=document.getElementsByTagName("link"),o=document.querySelector("meta[property=csp-nonce]"),l=o?.nonce||o?.getAttribute("nonce");a=c(e.map(p=>{if(p=Sr(p,s),p in Sn)return;Sn[p]=!0;const m=p.endsWith(".css"),g=m?'[rel="stylesheet"]':"";if(s)for(let y=i.length-1;y>=0;y--){const u=i[y];if(u.href===p&&(!m||u.rel==="stylesheet"))return}else if(document.querySelector(`link[href="${p}"]${g}`))return;const d=document.createElement("link");if(d.rel=m?"stylesheet":Ar,m||(d.as="script"),d.crossOrigin="",d.href=p,l&&d.setAttribute("nonce",l),document.head.appendChild(d),m)return new Promise((y,u)=>{d.addEventListener("load",y),d.addEventListener("error",()=>u(new Error(`Unable to preload CSS for ${p}`)))})}))}function r(i){const o=new Event("vite:preloadError",{cancelable:!0});if(o.payload=i,window.dispatchEvent(o),!o.defaultPrevented)throw i}return a.then(i=>{for(const o of i||[])o.status==="rejected"&&r(o.reason);return t().catch(r)})};class Je{enabled;root;start;end;fixedMeta;constructor(t,e={}){this.root=e.root??{callback:t,throttleMs:e.throttleMs??80,minDelta:e.minDelta??.002,lastEmittedValue:-1,lastEmittedAt:0},this.start=Zt(e.start??0),this.end=Zt(e.end??1),this.fixedMeta=e.fixedMeta??{},this.enabled=typeof this.root.callback=="function"}child(t,e,s={}){const a=Ge(this.start,this.end,Zt(t)),r=Ge(this.start,this.end,Zt(e));return new Je(void 0,{start:a,end:r,root:this.root,fixedMeta:{...this.fixedMeta,...s}})}toCallback(){return t=>{this.report(t.value,t)}}report(t,e={}){if(!this.enabled)return;const s={...this.fixedMeta,...e},a=Zt(t),r=Ge(this.start,this.end,a),i=Math.max(this.root.lastEmittedValue,r),o=s.stage??this.fixedMeta.stage??this.root.lastStage??"source",l=Ue(),c=i-this.root.lastEmittedValue,p=o!==this.root.lastStage;if(!(this.root.lastEmittedValue<0||i>=1||p||c>=this.root.minDelta||l-this.root.lastEmittedAt>=this.root.throttleMs))return;const g={value:Zt(i),stage:o,executionPath:s.executionPath,sourceType:s.sourceType,unit:s.unit,processed:s.processed,total:s.total,pageIndex:s.pageIndex,pageCount:s.pageCount};this.root.lastEmittedValue=g.value,this.root.lastEmittedAt=l,this.root.lastStage=g.stage,this.root.callback?.(g)}complete(t={}){this.report(1,{stage:"complete",...t})}async withIndeterminateProgress(t,e){if(!this.enabled)return typeof t=="function"?t():t;const s=Math.max(50,Math.trunc(e.tickMs??90)),a=li(e.ceiling??.9,.1,.999),r=Ue(),i={stage:e.stage,sourceType:e.sourceType,unit:e.unit,processed:e.processed,total:e.total,pageIndex:e.pageIndex,pageCount:e.pageCount};this.report(0,i);const o=globalThis.setInterval(()=>{const c=Math.max(0,Ue()-r)/800;this.report(Math.min(a,a*(1-1/(1+c))),i)},s);try{const l=await(typeof t=="function"?t():t);return this.report(1,i),l}finally{globalThis.clearInterval(o)}}}function we(n,t={}){return new Je(n,t)}function qs(n){switch(n){case"source":return"Reading source";case"pdf-page":return"Processing pages";case"pdf-operators":return"Scanning operators";case"pdf-text":return"Extracting text";case"pdf-raster":return"Extracting rasters";case"compile":return"Compiling";case"zip-open":return"Opening ZIP";case"zip-manifest":return"Reading manifest";case"zip-file":return"Decoding ZIP";case"upload":return"Uploading";case"complete":return"Complete";default:return"Parsing / loading"}}function Zt(n){return li(n,0,1)}function li(n,t,e){return!Number.isFinite(n)||n<t?t:n>e?e:n}function Ge(n,t,e){return n+(t-n)*e}function Ue(){return typeof performance<"u"&&typeof performance.now=="function"?performance.now():Date.now()}const wr=typeof window>"u"?await wn(()=>import("./pdf-CoaqzUNK.js"),[],import.meta.url):await wn(()=>import("./pdf-TYrZqVzP.js"),[],import.meta.url),{getDocument:ci,OPS:H,VerbosityLevel:_r}=wr,_e=0,Me=1,Ee=2,Re=3,Ie=4;class vt{data;length=0;constructor(t=32768){this.data=new Float32Array(t*4)}get quadCount(){return this.length>>2}push(t,e,s,a){this.ensureCapacity(4);const r=this.length;this.data[r]=t,this.data[r+1]=e,this.data[r+2]=s,this.data[r+3]=a,this.length+=4}append(t,e,s){s<=0||(this.ensureCapacity(s),this.data.set(t.subarray(e,e+s),this.length),this.length+=s)}toTypedArray(){return this.data.slice(0,this.length)}ensureCapacity(t){if(this.length+t<=this.data.length)return;let e=this.data.length;for(;this.length+t>e;)e*=2;const s=new Float32Array(e);s.set(this.data),this.data=s}}const kt=[1,0,0,1,0,0],_n=.001,Mr=.999995,Mn=.05,ui=.001,Er=.999,jt=1e3,zt=1e4,En=2e3,Rr=200,ze=.05,Rn=1e-4,Ir=.015,Pr=12,Ut=1e-4,Fr=.001,Br=.001,kr=.001,Dr=3,Lr=24,In=16384,Or=134217728,Nr=0,Gr=1,hi=0,Ur=2,zr=4,Xr=6,Vr=0,Yr=1,Xe=0,tn=1,Wr=0,Hr=1,di=.08,fi=9,mi=1,en=2,Ze=2,qr=.08,Zr=24,pi=_r?.ERRORS??0;function jr(n,t){const e=dt(n),s=Math.max(0,Math.trunc(t+1e-6));return e+s*Ze}function $r(n){const t=Math.max(0,Math.trunc(n/Ze+1e-6));return{alpha:dt(n-t*Ze),styleFlags:t}}async function Zs(n,t={}){const e=t.enableSegmentMerge!==!1,s=t.enableInvisibleCull!==!1,a=Kt(t.maxPages,Number.MAX_SAFE_INTEGER,1,Number.MAX_SAFE_INTEGER),r=Ci(),i=we(t.onProgress);i.report(0,{stage:"source",sourceType:"pdf"});const l=await ci({data:new Uint8Array(n),disableFontFace:!0,fontExtraProperties:!0,verbosity:pi,...r?{standardFontDataUrl:r}:{}}).promise;i.report(.06,{stage:"pdf-page",sourceType:"pdf"});try{const c=Kt(l.numPages,1,1,Number.MAX_SAFE_INTEGER),p=Math.max(1,Math.min(c,a)),m=[],g=.08,d=.84;for(let y=1;y<=p;y+=1){const u=y-1,x=g+u/p*d,T=g+y/p*d;i.report(x,{stage:"pdf-page",sourceType:"pdf",unit:"pages",processed:u,total:p,pageIndex:u,pageCount:p});const b=await l.getPage(y);i.report(Qe(x,T,.28),{stage:"pdf-operators",sourceType:"pdf",unit:"pages",processed:u,total:p,pageIndex:u,pageCount:p});const S=await b.getOperatorList();i.report(Qe(x,T,.58),{stage:"compile",sourceType:"pdf",unit:"operators",processed:S.fnArray.length,total:S.fnArray.length,pageIndex:u,pageCount:p});const E=await ta(b,S,{enableSegmentMerge:e,enableInvisibleCull:s});m.push(E),i.report(T,{stage:"pdf-page",sourceType:"pdf",unit:"pages",processed:y,total:p,pageIndex:u,pageCount:p})}return i.report(.94,{stage:"compile",sourceType:"pdf"}),m}finally{await l.destroy()}}function js(n,t){return gi(n,t)}async function Qr(n,t={}){const e=Kt(t.maxPages,Number.MAX_SAFE_INTEGER,1,Number.MAX_SAFE_INTEGER),s=Ci(),a=we(t.onProgress);a.report(0,{stage:"source",sourceType:"pdf"});const i=await ci({data:new Uint8Array(n),disableFontFace:!0,fontExtraProperties:!0,verbosity:pi,...s?{standardFontDataUrl:s}:{}}).promise;a.report(.06,{stage:"pdf-page",sourceType:"pdf"});try{const o=Kt(i.numPages,1,1,Number.MAX_SAFE_INTEGER),l=Math.max(1,Math.min(o,e)),c=[],p=.08,m=.84;for(let g=1;g<=l;g+=1){const d=g-1,y=p+d/l*m,u=p+g/l*m;a.report(y,{stage:"pdf-page",sourceType:"pdf",unit:"pages",processed:d,total:l,pageIndex:d,pageCount:l});const x=await i.getPage(g),T=await x.getOperatorList();a.report(Qe(y,u,.4),{stage:"pdf-raster",sourceType:"pdf",unit:"pages",processed:d,total:l,pageIndex:d,pageCount:l}),c.push(await Jr(x,T)),a.report(u,{stage:"pdf-page",sourceType:"pdf",unit:"pages",processed:g,total:l,pageIndex:d,pageCount:l})}return a.report(.94,{stage:"compile",sourceType:"pdf"}),c}finally{await i.destroy()}}async function Kr(n,t={}){const e=Kt(t.maxPagesPerRow,10,1,100),s=await Qr(n,t),a=we(t.onProgress);a.report(.96,{stage:"compile",sourceType:"pdf"});const r=gi(s,e);return a.complete({sourceType:"pdf"}),r}async function Jr(n,t){const e=n.view,s=Array.isArray(e)?e:[0,0,1,1],a={minX:Math.min(Number(s[0])||0,Number(s[2])||1),minY:Math.min(Number(s[1])||0,Number(s[3])||1),maxX:Math.max(Number(s[0])||0,Number(s[2])||1),maxY:Math.max(Number(s[1])||0,Number(s[3])||1)},r=bi(n),i=Pe(a,r),o=Si(t),l=await wi(n,t,r,{allowFullPageFallback:!0}),c=l.width>0&&l.height>0&&l.data.length>=l.width*l.height*4?[{width:l.width,height:l.height,data:l.data,matrix:new Float32Array(l.matrix)}]:[],p=vi(),m=c[0]??null,g=$t(i,l.bounds)??i;return{...p,pageCount:1,pagesPerRow:1,pageRects:new Float32Array([i.minX,i.minY,i.maxX,i.maxY]),pageTextRanges:new Uint32Array([0,0]),rasterLayers:c,rasterLayerWidth:m?.width??0,rasterLayerHeight:m?.height??0,rasterLayerData:m?.data??new Uint8Array(0),rasterLayerMatrix:m?.matrix??new Float32Array([1,0,0,1,0,0]),bounds:g,pageBounds:i,imagePaintOpCount:o,operatorCount:t.fnArray.length}}async function ta(n,t,e){const s=n.view,a=Array.isArray(s)?s:[0,0,1,1],r={minX:Math.min(Number(a[0])||0,Number(a[2])||1),minY:Math.min(Number(a[1])||0,Number(a[3])||1),maxX:Math.max(Number(a[0])||0,Number(a[2])||1),maxY:Math.max(Number(a[1])||0,Number(a[3])||1)},i=bi(n),o=Pe(r,i),l=Si(t),c=new vt,p=new vt,m=new vt,g=new vt,d=new vt(8192),y=new vt(8192),u=new vt(8192),x=new vt(65536),T=new vt(65536),b={minX:Number.POSITIVE_INFINITY,minY:Number.POSITIVE_INFINITY,maxX:Number.NEGATIVE_INFINITY,maxY:Number.NEGATIVE_INFINITY},S={minX:Number.POSITIVE_INFINITY,minY:Number.POSITIVE_INFINITY,maxX:Number.NEGATIVE_INFINITY,maxY:Number.NEGATIVE_INFINITY};let E=0,A=0,w=0,k=0;const N=[],B=[];let I=ca(i);for(let _=0;_<t.fnArray.length;_+=1){const W=t.fnArray[_],Y=t.argsArray[_];if(W===H.save){N.push(kn(I));continue}if(W===H.restore){const X=N.pop();X&&(I=X);continue}if(W===H.transform){const X=Yt(Y);X&&(I.matrix=Pt(I.matrix,X));continue}if(W===H.paintFormXObjectBegin){B.push(kn(I));const X=Yt(Y);X&&(I.matrix=Pt(I.matrix,X));continue}if(W===H.paintFormXObjectEnd){const X=B.pop();X&&(I=X);continue}if(W===H.setLineWidth){const X=gt(Y,0,I.lineWidth);I.lineWidth=Math.max(0,X);continue}if(W===H.setLineCap){const X=Math.trunc(gt(Y,0,I.lineCap));I.lineCap=Math.min(2,Math.max(0,X));continue}if(W===H.setStrokeRGBColor||W===H.setStrokeColor){const[X,at,it]=ae(Y,[I.strokeR,I.strokeG,I.strokeB]);I.strokeR=X,I.strokeG=at,I.strokeB=it;continue}if(W===H.setStrokeGray){const X=Bt(Y,0),[at]=je(X,I.strokeR);I.strokeR=at,I.strokeG=at,I.strokeB=at;continue}if(W===H.setStrokeCMYKColor){const[X,at,it]=$e(Y,[I.strokeR,I.strokeG,I.strokeB]);I.strokeR=X,I.strokeG=at,I.strokeB=it;continue}if(W===H.setFillRGBColor||W===H.setFillColor){const[X,at,it]=ae(Y,[I.fillR,I.fillG,I.fillB]);I.fillR=X,I.fillG=at,I.fillB=it;continue}if(W===H.setFillGray){const[X]=je(Bt(Y,0),I.fillR);I.fillR=X,I.fillG=X,I.fillB=X;continue}if(W===H.setFillCMYKColor){const[X,at,it]=$e(Y,[I.fillR,I.fillG,I.fillB]);I.fillR=X,I.fillG=at,I.fillB=it;continue}if(W===H.setGState){pa(Bt(Y,0),I);continue}if(W!==H.constructPath)continue;const O=gt(Y,0,-1),$=ha(O),j=da(O);if(!$&&!j)continue;const U=Ai(Y);if(U){if(E+=1,$){const X=I.lineWidth<=0,at=$a(I.matrix),it=X?0:I.lineWidth*at,pt=Math.max(0,it*.5);w=Math.max(w,pt);let Mt=0;X&&(Mt|=mi),I.lineCap===1&&(Mt|=en);const Ct=dt(I.strokeR),Dt=dt(I.strokeG),ft=dt(I.strokeB),bt=dt(I.strokeAlpha);A+=ga(U,I.matrix,pt,Ct,Dt,ft,bt,Mt,e.enableSegmentMerge,c,p,g,m,b)}if(j){const X=fa(O)?Gr:Nr,at=dt(I.fillAlpha),it=$&&dt(I.strokeAlpha)>ui;at>kr&&xa(U,I.matrix,X,it,dt(I.fillR),dt(I.fillG),dt(I.fillB),at,d,y,u,x,T,S)&&(k+=1)}}}const P=c.quadCount,v=c.toTypedArray(),R=p.toTypedArray(),h=m.toTypedArray(),F=g.toTypedArray(),q=x.quadCount,G=d.toTypedArray(),tt=y.toTypedArray(),V=u.toTypedArray(),Q=x.toTypedArray(),L=T.toTypedArray(),D=k>0?S:null;let et=P,J=v,K=R,ot=h,lt=F,rt=P>0?b:null,nt=P>0?w:0,st=0,ct=0,mt=0,xt=0;if(P>0&&e.enableInvisibleCull){const _=ya(v,R,F,h);et=_.segmentCount,J=_.endpoints,K=_.primitiveMeta,ot=_.primitiveBounds,lt=_.styles,rt=_.segmentCount>0?_.bounds:null,nt=_.maxHalfWidth,st=_.discardedTransparentCount,ct=_.discardedDegenerateCount,mt=_.discardedDuplicateCount,xt=_.discardedContainedCount}et===0&&(J=new Float32Array(0),K=new Float32Array(0),ot=new Float32Array(0),lt=new Float32Array(0),nt=0);let f=await Ye(n,t,i,o);if(f.instanceCount===0&&wa(t)&&(await _a(n),f=await Ye(n,t,i,o)),f.instanceCount>0&&f.inPageCount<f.instanceCount*.2){const _=await Ye(n,t,kt,o);_.inPageCount>f.inPageCount&&(f=_)}const Z=et===0&&k===0&&f.instanceCount===0,z=await wi(n,t,i,{allowFullPageFallback:Z}),M=z.width>0&&z.height>0&&z.data.length>=z.width*z.height*4?[{width:z.width,height:z.height,data:z.data,matrix:new Float32Array(z.matrix)}]:[],C=$t($t($t(rt,D),f.bounds),z.bounds)??{...o};return{pageCount:1,pagesPerRow:1,pageRects:new Float32Array([o.minX,o.minY,o.maxX,o.maxY]),pageTextRanges:new Uint32Array([0,f.instanceCount]),fillPathCount:k,fillSegmentCount:q,fillPathMetaA:G,fillPathMetaB:tt,fillPathMetaC:V,fillSegmentsA:Q,fillSegmentsB:L,segmentCount:et,sourceSegmentCount:A,mergedSegmentCount:P,sourceTextCount:f.sourceTextCount,textInstanceCount:f.instanceCount,textGlyphCount:f.glyphCount,textGlyphSegmentCount:f.glyphSegmentCount,textInPageCount:f.inPageCount,textOutOfPageCount:f.outOfPageCount,textInstanceA:f.instanceA,textInstanceB:f.instanceB,textInstanceC:f.instanceC,textGlyphMetaA:f.glyphMetaA,textGlyphMetaB:f.glyphMetaB,textGlyphSegmentsA:f.glyphSegmentsA,textGlyphSegmentsB:f.glyphSegmentsB,rasterLayers:M,rasterLayerWidth:M[0]?.width??0,rasterLayerHeight:M[0]?.height??0,rasterLayerData:M[0]?.data??new Uint8Array(0),rasterLayerMatrix:M[0]?.matrix??new Float32Array([1,0,0,1,0,0]),endpoints:J,primitiveMeta:K,primitiveBounds:ot,styles:lt,bounds:C,pageBounds:o,maxHalfWidth:nt,imagePaintOpCount:l,operatorCount:t.fnArray.length,pathCount:E,discardedTransparentCount:st,discardedDegenerateCount:ct,discardedDuplicateCount:mt,discardedContainedCount:xt}}function gi(n,t){if(n.length===0)return vi();if(n.length===1)return{...n[0],pageCount:1,pagesPerRow:1,pageTextRanges:Pn(n[0])};const e=Kt(t,10,1,100),s=sa(n,e);let a=0,r=0,i=0,o=0,l=0,c=0,p=0,m=0,g=0,d=0,y=0,u=0,x=0,T=0,b=0,S=0,E=0,A=0,w=0,k=0;for(const C of n){a+=C.fillPathCount,r+=C.fillSegmentCount,i+=C.segmentCount,o+=C.sourceSegmentCount,l+=C.mergedSegmentCount,c+=C.sourceTextCount,p+=C.textInstanceCount,m+=C.textGlyphCount,g+=C.textGlyphSegmentCount,d+=C.textInPageCount,y+=C.textOutOfPageCount,u+=C.operatorCount,x+=C.imagePaintOpCount,T+=C.pathCount,b+=C.discardedTransparentCount,S+=C.discardedDegenerateCount,E+=C.discardedDuplicateCount,A+=C.discardedContainedCount,w=Math.max(w,C.maxHalfWidth);const _=C.pageRects.length>=4?Math.floor(C.pageRects.length/4):1;k+=Math.max(1,_)}const N=new Float32Array(a*4),B=new Float32Array(a*4),I=new Float32Array(a*4),P=new Float32Array(r*4),v=new Float32Array(r*4),R=new Float32Array(i*4),h=new Float32Array(i*4),F=new Float32Array(i*4),q=new Float32Array(i*4),G=new Float32Array(p*4),tt=new Float32Array(p*4),V=new Float32Array(p*4),Q=new Float32Array(m*4),L=new Float32Array(m*4),D=new Float32Array(g*4),et=new Float32Array(g*4),J=new Float32Array(k*4),K=new Uint32Array(k*2);let ot=0,lt=0,rt=0,nt=0,st=0,ct=0,mt=0,xt=null,f=null;const Z=[];for(let C=0;C<n.length;C+=1){const _=n[C],W=s[C],Y=W.translateX,O=W.translateY;for(let j=0;j<_.fillPathCount;j+=1){const U=j*4,X=(ot+j)*4;N[X]=_.fillPathMetaA[U]+lt,N[X+1]=_.fillPathMetaA[U+1],N[X+2]=_.fillPathMetaA[U+2]+Y,N[X+3]=_.fillPathMetaA[U+3]+O,B[X]=_.fillPathMetaB[U]+Y,B[X+1]=_.fillPathMetaB[U+1]+O,B[X+2]=_.fillPathMetaB[U+2],B[X+3]=_.fillPathMetaB[U+3],I[X]=_.fillPathMetaC[U],I[X+1]=_.fillPathMetaC[U+1],I[X+2]=_.fillPathMetaC[U+2],I[X+3]=_.fillPathMetaC[U+3]}for(let j=0;j<_.fillSegmentCount;j+=1){const U=j*4,X=(lt+j)*4;P[X]=_.fillSegmentsA[U]+Y,P[X+1]=_.fillSegmentsA[U+1]+O,P[X+2]=_.fillSegmentsA[U+2]+Y,P[X+3]=_.fillSegmentsA[U+3]+O,v[X]=_.fillSegmentsB[U]+Y,v[X+1]=_.fillSegmentsB[U+1]+O,v[X+2]=_.fillSegmentsB[U+2],v[X+3]=_.fillSegmentsB[U+3]}for(let j=0;j<_.segmentCount;j+=1){const U=j*4,X=(rt+j)*4;R[X]=_.endpoints[U]+Y,R[X+1]=_.endpoints[U+1]+O,R[X+2]=_.endpoints[U+2]+Y,R[X+3]=_.endpoints[U+3]+O,h[X]=_.primitiveMeta[U]+Y,h[X+1]=_.primitiveMeta[U+1]+O,h[X+2]=_.primitiveMeta[U+2],h[X+3]=_.primitiveMeta[U+3],F[X]=_.primitiveBounds[U]+Y,F[X+1]=_.primitiveBounds[U+1]+O,F[X+2]=_.primitiveBounds[U+2]+Y,F[X+3]=_.primitiveBounds[U+3]+O,q[X]=_.styles[U],q[X+1]=_.styles[U+1],q[X+2]=_.styles[U+2],q[X+3]=_.styles[U+3]}G.set(_.textInstanceA,nt*4),V.set(_.textInstanceC,nt*4);for(let j=0;j<_.textInstanceCount;j+=1){const U=j*4,X=(nt+j)*4;tt[X]=_.textInstanceB[U]+Y,tt[X+1]=_.textInstanceB[U+1]+O,tt[X+2]=_.textInstanceB[U+2]+st,tt[X+3]=_.textInstanceB[U+3]}for(let j=0;j<_.textGlyphCount;j+=1){const U=j*4,X=(st+j)*4;Q[X]=_.textGlyphMetaA[U]+ct,Q[X+1]=_.textGlyphMetaA[U+1],Q[X+2]=_.textGlyphMetaA[U+2],Q[X+3]=_.textGlyphMetaA[U+3],L[X]=_.textGlyphMetaB[U],L[X+1]=_.textGlyphMetaB[U+1],L[X+2]=_.textGlyphMetaB[U+2],L[X+3]=_.textGlyphMetaB[U+3]}D.set(_.textGlyphSegmentsA,ct*4),et.set(_.textGlyphSegmentsB,ct*4);const $=_.pageRects;if($.length>=4){const j=Math.floor($.length/4),U=Pn(_,j);for(let X=0;X<j;X+=1){const at=X*4,it=(mt+X)*4;J[it]=$[at]+Y,J[it+1]=$[at+1]+O,J[it+2]=$[at+2]+Y,J[it+3]=$[at+3]+O;const pt=(mt+X)*2,Mt=X*2;K[pt]=U[Mt]+nt,K[pt+1]=U[Mt+1]}mt+=j}else{const j=mt*4;J[j]=_.pageBounds.minX+Y,J[j+1]=_.pageBounds.minY+O,J[j+2]=_.pageBounds.maxX+Y,J[j+3]=_.pageBounds.maxY+O;const U=mt*2;K[U]=nt,K[U+1]=_.textInstanceCount,mt+=1}xt=$t(xt,Bn(_.bounds,Y,O)),f=$t(f,Bn(_.pageBounds,Y,O));for(const j of la(_)){if(j.matrix.length<6)continue;const U=new Float32Array(6);U[0]=j.matrix[0],U[1]=j.matrix[1],U[2]=j.matrix[2],U[3]=j.matrix[3],U[4]=j.matrix[4]+Y,U[5]=j.matrix[5]+O,Z.push({width:j.width,height:j.height,data:j.data,matrix:U})}ot+=_.fillPathCount,lt+=_.fillSegmentCount,rt+=_.segmentCount,nt+=_.textInstanceCount,st+=_.textGlyphCount,ct+=_.textGlyphSegmentCount}const z=Z[0]??null,M={pageCount:n.length,pagesPerRow:e,pageRects:J,pageTextRanges:K,fillPathCount:a,fillSegmentCount:r,fillPathMetaA:N,fillPathMetaB:B,fillPathMetaC:I,fillSegmentsA:P,fillSegmentsB:v,segmentCount:i,sourceSegmentCount:o,mergedSegmentCount:l,sourceTextCount:c,textInstanceCount:p,textGlyphCount:m,textGlyphSegmentCount:g,textInPageCount:d,textOutOfPageCount:y,textInstanceA:G,textInstanceB:tt,textInstanceC:V,textGlyphMetaA:Q,textGlyphMetaB:L,textGlyphSegmentsA:D,textGlyphSegmentsB:et,rasterLayers:Z,rasterLayerWidth:z?.width??0,rasterLayerHeight:z?.height??0,rasterLayerData:z?.data??new Uint8Array(0),rasterLayerMatrix:z?.matrix??new Float32Array([1,0,0,1,0,0]),endpoints:R,primitiveMeta:h,primitiveBounds:F,styles:q,bounds:xt??{minX:0,minY:0,maxX:1,maxY:1},pageBounds:f??xt??{minX:0,minY:0,maxX:1,maxY:1},maxHalfWidth:w,imagePaintOpCount:x,operatorCount:u,pathCount:T,discardedTransparentCount:b,discardedDegenerateCount:S,discardedDuplicateCount:E,discardedContainedCount:A};return xi(M)}function xi(n){const t=Math.max(0,n.textGlyphCount|0),e=Math.max(0,n.textGlyphSegmentCount|0);if(t<=1||e<=0||n.textGlyphMetaA.length<t*4||n.textGlyphMetaB.length<t*4)return n;const s=new Uint32Array(n.textGlyphSegmentsA.buffer,n.textGlyphSegmentsA.byteOffset,n.textGlyphSegmentsA.length),a=new Uint32Array(n.textGlyphSegmentsB.buffer,n.textGlyphSegmentsB.byteOffset,n.textGlyphSegmentsB.length),r=new Uint32Array(n.textGlyphMetaA.buffer,n.textGlyphMetaA.byteOffset,n.textGlyphMetaA.length),i=new Uint32Array(n.textGlyphMetaB.buffer,n.textGlyphMetaB.byteOffset,n.textGlyphMetaB.length),o=new Uint32Array(t),l=[],c=new Map,p=new vt(Math.min(t,4096)),m=new vt(Math.min(t,4096)),g=new vt(Math.min(e,65536)),d=new vt(Math.min(e,65536));for(let u=0;u<t;u+=1){const x=ea(n,u,r,i,s,a),T=c.get(x);let b=-1;if(T){for(const S of T)if(na(n,u,l[S])){b=S;break}}if(b<0){b=l.length,l.push(u),T?T.push(b):c.set(x,[b]);const S=u*4,E=Math.max(0,Math.trunc(n.textGlyphMetaA[S])),A=Math.max(0,Math.trunc(n.textGlyphMetaA[S+1])),w=E*4,k=Math.min(A*4,Math.max(0,n.textGlyphSegmentsA.length-w),Math.max(0,n.textGlyphSegmentsB.length-w)),N=g.quadCount;g.append(n.textGlyphSegmentsA,w,k),d.append(n.textGlyphSegmentsB,w,k),p.push(N,k/4,n.textGlyphMetaA[S+2],n.textGlyphMetaA[S+3]),m.push(n.textGlyphMetaB[S],n.textGlyphMetaB[S+1],n.textGlyphMetaB[S+2],n.textGlyphMetaB[S+3])}o[u]=b}if(l.length===t)return n;const y=n.textInstanceB;for(let u=0;u<n.textInstanceCount;u+=1){const x=u*4+2,T=Math.max(0,Math.trunc(y[x]));T<o.length&&(y[x]=o[T])}return{...n,textInstanceB:y,textGlyphCount:l.length,textGlyphSegmentCount:g.quadCount,textGlyphMetaA:p.toTypedArray(),textGlyphMetaB:m.toTypedArray(),textGlyphSegmentsA:g.toTypedArray(),textGlyphSegmentsB:d.toTypedArray()}}function yi(n,t,e){const s=Math.max(1,Math.floor(n.length/4)),a=new Uint32Array(s*2),r=Math.max(0,Math.min(e|0,Math.floor(t.length/4)));if(s<=1||r<=0)return a[0]=0,a[1]=r,a;const i=ia(n,s);let o=0,l=0;for(let c=0;c<r;c+=1){const p=c*4,m=t[p],g=t[p+1];if(!Number.isFinite(m)||!Number.isFinite(g)||Ti(n,o,m,g,i))continue;const d=ra(n,s,o+1,m,g,i);if(!(d<=o)){a[o*2]=l,a[o*2+1]=c-l;for(let y=o+1;y<d;y+=1)a[y*2]=c,a[y*2+1]=0;o=d,l=c}}a[o*2]=l,a[o*2+1]=r-l;for(let c=o+1;c<s;c+=1)a[c*2]=r,a[c*2+1]=0;return a}function Pn(n,t){const e=Math.floor(n.pageRects.length/4)||n.pageCount||1,a=Math.max(1,t??e)*2;return n.pageTextRanges instanceof Uint32Array&&n.pageTextRanges.length>=a?n.pageTextRanges.subarray(0,a):yi(n.pageRects,n.textInstanceB,n.textInstanceCount)}function ea(n,t,e,s,a,r){const i=t*4,o=Math.max(0,Math.trunc(n.textGlyphMetaA[i])),l=Math.max(0,Math.trunc(n.textGlyphMetaA[i+1])),c=o*4,p=Math.min(l*4,Math.max(0,a.length-c),Math.max(0,r.length-c));let m=2166136261;m=Xt(m,l),m=Xt(m,e[i+2]??0),m=Xt(m,e[i+3]??0),m=Xt(m,s[i]??0),m=Xt(m,s[i+1]??0);for(let g=0;g<p;g+=1)m=Xt(m,a[c+g]),m=Xt(m,r[c+g]);return`${l}:${m>>>0}`}function na(n,t,e){if(t===e)return!0;const s=t*4,a=e*4,r=Math.max(0,Math.trunc(n.textGlyphMetaA[s+1])),i=Math.max(0,Math.trunc(n.textGlyphMetaA[a+1]));if(r!==i||n.textGlyphMetaA[s+2]!==n.textGlyphMetaA[a+2]||n.textGlyphMetaA[s+3]!==n.textGlyphMetaA[a+3]||n.textGlyphMetaB[s]!==n.textGlyphMetaB[a]||n.textGlyphMetaB[s+1]!==n.textGlyphMetaB[a+1]||n.textGlyphMetaB[s+2]!==n.textGlyphMetaB[a+2]||n.textGlyphMetaB[s+3]!==n.textGlyphMetaB[a+3])return!1;const o=Math.max(0,Math.trunc(n.textGlyphMetaA[s])),l=Math.max(0,Math.trunc(n.textGlyphMetaA[a])),c=o*4,p=l*4,m=r*4;for(let g=0;g<m;g+=1)if(n.textGlyphSegmentsA[c+g]!==n.textGlyphSegmentsA[p+g]||n.textGlyphSegmentsB[c+g]!==n.textGlyphSegmentsB[p+g])return!1;return!0}function Xt(n,t){return n^=t>>>0,Math.imul(n,16777619)}function ia(n,t){let e=0,s=0;for(let a=0;a<t;a+=1){const r=a*4,i=Math.abs(n[r+2]-n[r]),o=Math.abs(n[r+3]-n[r+1]),l=Math.max(i,o);Number.isFinite(l)&&l>0&&(e+=l,s+=1)}return s===0?8:aa(e/s*.025,4,24)}function ra(n,t,e,s,a,r){for(let i=Math.max(0,e);i<t;i+=1)if(Ti(n,i,s,a,r))return i;return-1}function Ti(n,t,e,s,a){const r=t*4,i=Math.min(n[r],n[r+2])-a,o=Math.max(n[r],n[r+2])+a,l=Math.min(n[r+1],n[r+3])-a,c=Math.max(n[r+1],n[r+3])+a;return e>=i&&e<=o&&s>=l&&s<=c}function aa(n,t,e){return n<t?t:n>e?e:n}function sa(n,t){const e=n.map(m=>oa(m.pageBounds,m.bounds)),s=Math.ceil(n.length/t),a=new Float64Array(s);let r=0;for(let m=0;m<e.length;m+=1){const g=e[m],d=Math.max(g.maxX-g.minX,.001),y=Math.max(g.maxY-g.minY,.001);r+=Math.max(d,y);const u=Math.floor(m/t);a[u]=Math.max(a[u],y)}const i=r/Math.max(1,e.length),o=Math.max(i*qr,Zr),l=new Float64Array(s);for(let m=1;m<s;m+=1)l[m]=l[m-1]-a[m-1]-o;const c=new Float64Array(s),p=new Array(n.length);for(let m=0;m<e.length;m+=1){const g=e[m],d=Math.max(g.maxX-g.minX,.001),y=Math.floor(m/t),u=c[y]-g.minX,x=l[y]-g.maxY;p[m]={translateX:u,translateY:x},c[y]+=d+o}return p}function oa(n,t){const e=Fn(n)?n:t;return Fn(e)?e:{minX:0,minY:0,maxX:1,maxY:1}}function Fn(n){return Number.isFinite(n.minX)&&Number.isFinite(n.minY)&&Number.isFinite(n.maxX)&&Number.isFinite(n.maxY)}function Bn(n,t,e){return{minX:n.minX+t,minY:n.minY+e,maxX:n.maxX+t,maxY:n.maxY+e}}function la(n){const t=[];if(Array.isArray(n.rasterLayers))for(const r of n.rasterLayers){const i=Math.max(0,Math.trunc(r?.width??0)),o=Math.max(0,Math.trunc(r?.height??0));if(i<=0||o<=0||!(r.data instanceof Uint8Array)||r.data.length<i*o*4)continue;const l=new Float32Array(6);r.matrix.length>=6?(l[0]=r.matrix[0],l[1]=r.matrix[1],l[2]=r.matrix[2],l[3]=r.matrix[3],l[4]=r.matrix[4],l[5]=r.matrix[5]):(l[0]=1,l[3]=1),t.push({width:i,height:o,data:r.data,matrix:l})}if(t.length>0)return t;const e=Math.max(0,Math.trunc(n.rasterLayerWidth)),s=Math.max(0,Math.trunc(n.rasterLayerHeight));if(e<=0||s<=0||n.rasterLayerData.length<e*s*4)return t;const a=new Float32Array([1,0,0,1,0,0]);return n.rasterLayerMatrix.length>=6&&(a[0]=n.rasterLayerMatrix[0],a[1]=n.rasterLayerMatrix[1],a[2]=n.rasterLayerMatrix[2],a[3]=n.rasterLayerMatrix[3],a[4]=n.rasterLayerMatrix[4],a[5]=n.rasterLayerMatrix[5]),t.push({width:e,height:s,data:n.rasterLayerData,matrix:a}),t}function vi(){return{pageCount:0,pagesPerRow:1,pageRects:new Float32Array(0),pageTextRanges:new Uint32Array(0),fillPathCount:0,fillSegmentCount:0,fillPathMetaA:new Float32Array(0),fillPathMetaB:new Float32Array(0),fillPathMetaC:new Float32Array(0),fillSegmentsA:new Float32Array(0),fillSegmentsB:new Float32Array(0),segmentCount:0,sourceSegmentCount:0,mergedSegmentCount:0,sourceTextCount:0,textInstanceCount:0,textGlyphCount:0,textGlyphSegmentCount:0,textInPageCount:0,textOutOfPageCount:0,textInstanceA:new Float32Array(0),textInstanceB:new Float32Array(0),textInstanceC:new Float32Array(0),textGlyphMetaA:new Float32Array(0),textGlyphMetaB:new Float32Array(0),textGlyphSegmentsA:new Float32Array(0),textGlyphSegmentsB:new Float32Array(0),rasterLayers:[],rasterLayerWidth:0,rasterLayerHeight:0,rasterLayerData:new Uint8Array(0),rasterLayerMatrix:new Float32Array([1,0,0,1,0,0]),endpoints:new Float32Array(0),primitiveMeta:new Float32Array(0),primitiveBounds:new Float32Array(0),styles:new Float32Array(0),bounds:{minX:0,minY:0,maxX:1,maxY:1},pageBounds:{minX:0,minY:0,maxX:1,maxY:1},maxHalfWidth:0,imagePaintOpCount:0,operatorCount:0,pathCount:0,discardedTransparentCount:0,discardedDegenerateCount:0,discardedDuplicateCount:0,discardedContainedCount:0}}function Kt(n,t,e,s){const a=Math.trunc(Number(n)),r=Number.isFinite(a)?a:t;return r<e?e:r>s?s:r}function ca(n=kt){return{matrix:[...n],lineWidth:1,lineCap:0,strokeR:0,strokeG:0,strokeB:0,strokeAlpha:1,fillR:0,fillG:0,fillB:0,fillAlpha:1}}function bi(n){const t=Ae(n.rotate),e=n.getViewport({scale:1,rotation:t,dontFlip:!1}),s=e.transform;if(!Array.isArray(s)||s.length<6)return[...kt];const a=Number(s[0]),r=Number(s[1]),i=Number(s[2]),o=Number(s[3]),l=Number(s[4]),c=Number(s[5]);if(![a,r,i,o,l,c].every(Number.isFinite))return[...kt];const p=Number(e.height);return Number.isFinite(p)?Pt([1,0,0,-1,0,p],[a,r,i,o,l,c]):[a,r,i,o,l,c]}function Pe(n,t){const e=ht(t,n.minX,n.minY),s=ht(t,n.minX,n.maxY),a=ht(t,n.maxX,n.minY),r=ht(t,n.maxX,n.maxY);return{minX:Math.min(e[0],s[0],a[0],r[0]),minY:Math.min(e[1],s[1],a[1],r[1]),maxX:Math.max(e[0],s[0],a[0],r[0]),maxY:Math.max(e[1],s[1],a[1],r[1])}}function Ae(n){if(!Number.isFinite(n))return 0;let t=n%360;return t<0&&(t+=360),t}function Ci(){if(typeof window<"u"&&window.location)return new URL("pdfjs-standard-fonts/",window.location.href).toString();if(typeof window>"u"){const n=new URL("../node_modules/pdfjs-dist/standard_fonts/",import.meta.url);if(n.protocol==="file:"){const t=decodeURIComponent(n.pathname);return t.endsWith("/")?t:`${t}/`}return n.toString()}}function ua(n,t,e=1){if(!Number.isFinite(n)||!Number.isFinite(t)||n<=0||t<=0)return 1;const s=typeof window>"u"?1:Math.max(1,Number(window.devicePixelRatio)||1),a=Math.max(s*Dr,Number.isFinite(e)?e:1);let r=Math.max(1,Math.min(Lr,a));for(;r>1;){const i=Math.max(1,Math.ceil(n*r)),o=Math.max(1,Math.ceil(t*r));if(i<=In&&o<=In&&i*o<=Or)return r;if(r*=.85,r<1.05)return 1}return 1}function kn(n){return{matrix:[...n.matrix],lineWidth:n.lineWidth,lineCap:n.lineCap,strokeR:n.strokeR,strokeG:n.strokeG,strokeB:n.strokeB,strokeAlpha:n.strokeAlpha,fillR:n.fillR,fillG:n.fillG,fillB:n.fillB,fillAlpha:n.fillAlpha}}let Vt;function Yt(n){const t=Dn(n);if(!t)return null;const e=Array.isArray(n)?Dn(n[0]):null,s=t.length>=6?t:e;if(!s||s.length<6)return null;const a=Number(s[0]),r=Number(s[1]),i=Number(s[2]),o=Number(s[3]),l=Number(s[4]),c=Number(s[5]);return[a,r,i,o,l,c].every(Number.isFinite)?[a,r,i,o,l,c]:null}function Dn(n){return Array.isArray(n)||ArrayBuffer.isView(n)?n:null}function Ai(n){if(!Array.isArray(n)||n.length<2)return null;const t=n[1];if(!Array.isArray(t)||t.length===0)return null;const e=t[0];return e instanceof Float32Array?e:null}function Bt(n,t){if(Array.isArray(n))return n[t]}function gt(n,t,e){const s=Bt(n,t),a=Number(s);return Number.isFinite(a)?a:e}function ha(n){return n===H.stroke||n===H.closeStroke||n===H.fillStroke||n===H.eoFillStroke||n===H.closeFillStroke||n===H.closeEOFillStroke}function da(n){return n===H.fill||n===H.eoFill||n===H.fillStroke||n===H.eoFillStroke||n===H.closeFillStroke||n===H.closeEOFillStroke}function fa(n){return n===H.eoFill||n===H.eoFillStroke||n===H.closeEOFillStroke}function je(n,t){const e=Number(n);if(Number.isFinite(e)){const s=dt(e>1?e/255:e);return[s,s,s]}return[t,t,t]}function Ve(n,t){if(typeof n=="number"&&Number.isFinite(n)){const e=dt(n>1?n/255:n);return[e,e,e]}if(typeof n=="string"&&n.startsWith("#")&&(n.length===7||n.length===4)){const[e,s,a]=ma(n);return[dt(e/255),dt(s/255),dt(a/255)]}if(Array.isArray(n)&&n.length>=3){const e=Number(n[0]),s=Number(n[1]),a=Number(n[2]);if([e,s,a].every(Number.isFinite))return[dt(e>1?e/255:e),dt(s>1?s/255:s),dt(a>1?a/255:a)]}return[t[0],t[1],t[2]]}function ae(n,t){return Array.isArray(n)?n.length>=3&&n.slice(0,3).every(e=>Number.isFinite(Number(e)))?Ve([n[0],n[1],n[2]],t):n.length>0?Ve(n[0],t):[t[0],t[1],t[2]]:Ve(n,t)}function $e(n,t){if(!Array.isArray(n)||n.length<4)return ae(n,t);const e=Te(n[0]),s=Te(n[1]),a=Te(n[2]),r=Te(n[3]);if([e,s,a,r].some(d=>d===null))return ae(n,t);const i=e,o=s,l=a,c=r,p=1-Math.min(1,i+c),m=1-Math.min(1,o+c),g=1-Math.min(1,l+c);return[dt(p),dt(m),dt(g)]}function Te(n){const t=Number(n);if(!Number.isFinite(t))return null;const e=t>1?t/100:t;return dt(e)}function ma(n){if(n.length===4){const a=Number.parseInt(n[1]+n[1],16),r=Number.parseInt(n[2]+n[2],16),i=Number.parseInt(n[3]+n[3],16);return[a,r,i]}const t=Number.parseInt(n.slice(1,3),16),e=Number.parseInt(n.slice(3,5),16),s=Number.parseInt(n.slice(5,7),16);return[t,e,s]}function pa(n,t){if(Array.isArray(n))for(const e of n){if(!Array.isArray(e)||e.length<2)continue;const s=e[0],a=e[1];if(s==="CA"){const r=Number(a);Number.isFinite(r)&&(t.strokeAlpha=dt(r));continue}if(s==="ca"){const r=Number(a);Number.isFinite(r)&&(t.fillAlpha=dt(r));continue}if(s==="LW"){const r=Number(a);Number.isFinite(r)&&(t.lineWidth=Math.max(0,r));continue}if(s==="LC"){const r=Number(a);Number.isFinite(r)&&(t.lineCap=Math.min(2,Math.max(0,Math.trunc(r))))}}}function ga(n,t,e,s,a,r,i,o,l,c,p,m,g,d){let y=0,u=0,x=0,T=0,b=0,S=!1,E=0,A=0,w=0,k=0,N=!1;const B=(h,F,q,G,tt,V,Q)=>{c.push(h,F,q,G),p.push(tt,V,Q,jr(i,o)),m.push(e,s,a,r);const L=Math.min(h,q,tt),D=Math.min(F,G,V),et=Math.max(h,q,tt),J=Math.max(F,G,V);g.push(L,D,et,J),d.minX=Math.min(d.minX,L),d.minY=Math.min(d.minY,D),d.maxX=Math.max(d.maxX,et),d.maxY=Math.max(d.maxY,J)},I=()=>{N&&(B(E,A,w,k,w,k,Xe),N=!1)},P=(h,F,q,G)=>{if(!N)return!1;const tt=h-w,V=F-k;if(tt*tt+V*V>_n*_n)return!1;const Q=w-E,L=k-A,D=q-h,et=G-F,J=Q*Q+L*L,K=D*D+et*et;if(J<1e-10||K<1e-10)return!1;const ot=1/Math.sqrt(J*K);if((Q*D+L*et)*ot<Mr)return!1;const rt=q-E,nt=G-A;return Za(rt,nt,Q,L,J)>Mn*Mn?!1:(w=q,k=G,!0)},v=(h,F,q,G,tt)=>{const V=q-h,Q=G-F;if(V*V+Q*Q<1e-10){if((o&en)===0)return;y+=1,I(),B(h,F,q,G,q,G,Xe);return}if(y+=1,!(l&&tt&&P(h,F,q,G))){if(l){I(),E=h,A=F,w=q,k=G,N=!0;return}B(h,F,q,G,q,G,Xe)}},R=(h,F,q,G,tt,V)=>{const Q=tt-h,L=V-F,D=q-h,et=G-F;Q*Q+L*L<1e-10&&D*D+et*et<1e-10||(y+=1,I(),B(h,F,q,G,tt,V,tn))};for(let h=0;h<n.length;){const F=n[h++];if(F===_e){I(),u=n[h++],x=n[h++],T=u,b=x,S=!0;continue}if(F===Me){const q=n[h++],G=n[h++],[tt,V]=ht(t,u,x),[Q,L]=ht(t,q,G);v(tt,V,Q,L,!0),u=q,x=G;continue}if(F===Ee){const q=n[h++],G=n[h++],tt=n[h++],V=n[h++],Q=n[h++],L=n[h++],[D,et]=ht(t,u,x),[J,K]=ht(t,q,G),[ot,lt]=ht(t,tt,V),[rt,nt]=ht(t,Q,L);rn(D,et,J,K,ot,lt,rt,nt,R,di,fi),u=Q,x=L;continue}if(F===Re){const q=n[h++],G=n[h++],tt=n[h++],V=n[h++],[Q,L]=ht(t,u,x),[D,et]=ht(t,q,G),[J,K]=ht(t,tt,V);R(Q,L,D,et,J,K),u=tt,x=V;continue}if(F===Ie){if(S&&(u!==T||x!==b)){const[q,G]=ht(t,u,x),[tt,V]=ht(t,T,b);v(q,G,tt,V,!0)}u=T,x=b,I();continue}I();break}return I(),y}function xa(n,t,e,s,a,r,i,o,l,c,p,m,g,d){let y=0,u=0,x=0,T=0,b=!1;const S=m.quadCount;let E=0;const A={minX:Number.POSITIVE_INFINITY,minY:Number.POSITIVE_INFINITY,maxX:Number.NEGATIVE_INFINITY,maxY:Number.NEGATIVE_INFINITY},w=(B,I,P,v)=>{const R=P-B,h=v-I;R*R+h*h<1e-12||(m.push(B,I,P,v),g.push(P,v,Wr,0),E+=1,A.minX=Math.min(A.minX,B,P),A.minY=Math.min(A.minY,I,v),A.maxX=Math.max(A.maxX,B,P),A.maxY=Math.max(A.maxY,I,v))},k=(B,I,P,v,R,h)=>{const F=R-B,q=h-I,G=P-B,tt=v-I;F*F+q*q<1e-12&&G*G+tt*tt<1e-12||(m.push(B,I,P,v),g.push(R,h,Hr,0),E+=1,A.minX=Math.min(A.minX,B,P,R),A.minY=Math.min(A.minY,I,v,h),A.maxX=Math.max(A.maxX,B,P,R),A.maxY=Math.max(A.maxY,I,v,h))},N=()=>{if(b){if(y!==x||u!==T){const[B,I]=ht(t,y,u),[P,v]=ht(t,x,T);w(B,I,P,v)}y=x,u=T}};for(let B=0;B<n.length;){const I=n[B++];if(I===_e){N(),y=n[B++],u=n[B++],x=y,T=u,b=!0;continue}if(I===Me){const P=n[B++],v=n[B++],[R,h]=ht(t,y,u),[F,q]=ht(t,P,v);w(R,h,F,q),y=P,u=v;continue}if(I===Ee){const P=n[B++],v=n[B++],R=n[B++],h=n[B++],F=n[B++],q=n[B++],[G,tt]=ht(t,y,u),[V,Q]=ht(t,P,v),[L,D]=ht(t,R,h),[et,J]=ht(t,F,q);rn(G,tt,V,Q,L,D,et,J,k,di,fi),y=F,u=q;continue}if(I===Re){const P=n[B++],v=n[B++],R=n[B++],h=n[B++],[F,q]=ht(t,y,u),[G,tt]=ht(t,P,v),[V,Q]=ht(t,R,h);k(F,q,G,tt,V,Q),y=R,u=h;continue}if(I===Ie){N();continue}N();break}return N(),E===0?!1:(l.push(S,E,A.minX,A.minY),c.push(A.maxX,A.maxY,a,r),p.push(e,s?1:0,i,o),d.minX=Math.min(d.minX,A.minX),d.minY=Math.min(d.minY,A.minY),d.maxX=Math.max(d.maxX,A.maxX),d.maxY=Math.max(d.maxY,A.maxY),!0)}function ya(n,t,e,s){const a=n.length>>2,r=new Uint8Array(a),i=new Set,o=new Map;let l=0,c=0,p=0,m=0;for(let E=0;E<a;E+=1){const A=E*4,w=n[A],k=n[A+1],N=n[A+2],B=n[A+3],I=t[A],P=t[A+1],v=t[A+2],R=v>=tn-.5,h=e[A],F=e[A+1],q=e[A+2],G=e[A+3],{alpha:tt,styleFlags:V}=$r(t[A+3]);if(tt<=ui){l+=1;continue}const Q=R?Math.hypot(N-w,B-k)+Math.hypot(I-N,P-B):Math.hypot(I-w,P-k);if(Q<1e-5){const D=!R&&(V&en)!==0,J=(V&mi)!==0||h>1e-6;if(!D||!J){c+=1;continue}}const L=Ta(w,k,N,B,I,P,v,h,F,q,G,tt,V);if(i.has(L)){p+=1;continue}if(i.add(L),r[E]=1,!R&&Q>=1e-5){const D=va(E,w,k,I,P,h,F,q,G,tt,V);let et=o.get(D.key);et||(et=[],o.set(D.key,et)),et.push({index:D.index,start:D.start,end:D.end,halfWidth:D.halfWidth,alpha:D.alpha,styleFlags:D.styleFlags})}}for(const E of o.values()){E.sort((w,k)=>{if(Math.abs(w.halfWidth-k.halfWidth)>Rn)return k.halfWidth-w.halfWidth;const N=w.end-w.start,B=k.end-k.start;return Math.abs(N-B)>ze?B-N:w.start-k.start});const A=[];for(const w of E){let k=!1;for(const N of A)if(!(N.halfWidth+Rn<w.halfWidth)&&N.start-ze<=w.start&&N.end+ze>=w.end){k=!0;break}if(k){r[w.index]===1&&(r[w.index]=0,m+=1);continue}w.alpha>=Er&&A.push(w)}}let g=0;for(let E=0;E<a;E+=1)r[E]===1&&(g+=1);if(g===0)return{segmentCount:0,endpoints:new Float32Array(0),primitiveMeta:new Float32Array(0),primitiveBounds:new Float32Array(0),styles:new Float32Array(0),bounds:{minX:0,minY:0,maxX:0,maxY:0},maxHalfWidth:0,discardedTransparentCount:l,discardedDegenerateCount:c,discardedDuplicateCount:p,discardedContainedCount:m};const d=new Float32Array(g*4),y=new Float32Array(g*4),u=new Float32Array(g*4),x=new Float32Array(g*4),T={minX:Number.POSITIVE_INFINITY,minY:Number.POSITIVE_INFINITY,maxX:Number.NEGATIVE_INFINITY,maxY:Number.NEGATIVE_INFINITY};let b=0,S=0;for(let E=0;E<a;E+=1){if(r[E]===0)continue;const A=E*4,w=S*4,k=n[A],N=n[A+1],B=s[A],I=s[A+1],P=s[A+2],v=s[A+3],R=e[A];d[w]=k,d[w+1]=N,d[w+2]=n[A+2],d[w+3]=n[A+3],y[w]=t[A],y[w+1]=t[A+1],y[w+2]=t[A+2],y[w+3]=t[A+3],u[w]=B,u[w+1]=I,u[w+2]=P,u[w+3]=v,x[w]=e[A],x[w+1]=e[A+1],x[w+2]=e[A+2],x[w+3]=e[A+3],T.minX=Math.min(T.minX,B),T.minY=Math.min(T.minY,I),T.maxX=Math.max(T.maxX,P),T.maxY=Math.max(T.maxY,v),b=Math.max(b,R),S+=1}return{segmentCount:g,endpoints:d,primitiveMeta:y,primitiveBounds:u,styles:x,bounds:T,maxHalfWidth:b,discardedTransparentCount:l,discardedDegenerateCount:c,discardedDuplicateCount:p,discardedContainedCount:m}}function Ta(n,t,e,s,a,r,i,o,l,c,p,m,g){const d=i>=tn-.5;let y=n,u=t,x=a,T=r,b=e,S=s;return!d&&(y>x||y===x&&u>T)&&(y=a,u=r,x=n,T=t),d||(b=x,S=T),[Tt(i,10),Tt(o,zt),Tt(l,zt),Tt(c,zt),Tt(p,zt),Tt(m,zt),Tt(g,1),Tt(y,jt),Tt(u,jt),Tt(b,jt),Tt(S,jt),Tt(x,jt),Tt(T,jt)].join("|")}function va(n,t,e,s,a,r,i,o,l,c,p){let m=t,g=e,d=s,y=a,u=d-m,x=y-g;const T=Math.hypot(u,x);let b=u/T,S=x/T;(b<0||Math.abs(b)<1e-10&&S<0)&&(b=-b,S=-S,m=s,g=a,d=t,y=e);const E=-S,A=b,w=E*m+A*g,k=b*m+S*g,N=b*d+S*y,B=Math.min(k,N),I=Math.max(k,N);return{key:[Tt(b,En),Tt(S,En),Tt(w,Rr),Tt(i,zt),Tt(o,zt),Tt(l,zt),Tt(p,1)].join("|"),index:n,start:B,end:I,halfWidth:r,alpha:c,styleFlags:p}}async function Ye(n,t,e,s){const a=Sa(n);if(!a)return Aa();const r=new vt(4096),i=new vt(4096),o=new vt(4096),l=new vt(2048),c=new vt(2048),p=new vt(16384),m=new vt(16384),g=new Map,d=[];let y=0,u=null,x=0,T=0;const b=[],S=[],E=[],A=[];let w=Ba(e),k=null,N=null;const B=(P,v,R)=>{if(!R)return null;const h=typeof P?.loadedName=="string"&&P.loadedName.length>0?P.loadedName:v;if(!h)return null;const F=`${h}|${R}`,q=g.get(F);if(q!==void 0)return{index:q,bounds:d[q]};const G=Ua(a,h,R);if(!G)return null;const tt=p.quadCount,V=Xa(G,p,m);if(V.segmentCount<=0)return null;const Q=l.quadCount;return l.push(tt,V.segmentCount,V.bounds.minX,V.bounds.minY),c.push(V.bounds.maxX,V.bounds.maxY,0,0),g.set(F,Q),d[Q]=V.bounds,{index:Q,bounds:V.bounds}},I=P=>{if(P.length===0||w.fontSize===0)return;const v=Na(a,w.fontRef),R=Ga(v),h=w.fontSize*R,F=v?.vertical===!0,q=F?1:-1,G=w.textHScale*w.fontDirection;let tt=0;for(const V of P){if(typeof V=="number"&&Number.isFinite(V)){tt+=q*V*w.fontSize/1e3;continue}const Q=V,L=typeof Q.fontChar=="string"?Q.fontChar:"",D=Number(Q.width),et=Number.isFinite(D)?D:0,J=Q.isSpace===!0,K=Oa(Q,L),ot=(J?w.wordSpacing:0)+w.charSpacing;if(!F&&!K&&La(w.renderMode)&&w.fillAlpha>Br){const rt=B(v,w.fontRef,L);if(rt){const nt=qa(w,tt,0),st=Pe(rt.bounds,nt);(!k||zn(st,k))&&(r.push(nt[0],nt[1],nt[2],nt[3]),i.push(nt[4],nt[5],rt.index,0),o.push(w.fillR,w.fillG,w.fillB,w.fillAlpha),y+=1,s&&(zn(st,s)?x+=1:T+=1),u?(u.minX=Math.min(u.minX,st.minX-Ut),u.minY=Math.min(u.minY,st.minY-Ut),u.maxX=Math.max(u.maxX,st.maxX+Ut),u.maxY=Math.max(u.maxY,st.maxY+Ut)):u={minX:st.minX-Ut,minY:st.minY-Ut,maxX:st.maxX+Ut,maxY:st.maxY+Ut})}}const lt=F?et*h-ot*w.fontDirection:et*h+ot*w.fontDirection;tt+=lt}F?w.textY-=tt:w.textX+=tt*G};for(let P=0;P<t.fnArray.length;P+=1){const v=t.fnArray[P],R=t.argsArray[P];if(v===H.save){b.push(Un(w)),E.push(Ln(k));continue}if(v===H.restore){const h=b.pop();h&&(w=h),k=E.pop()??null,N=null;continue}if(v===H.transform){const h=Yt(R);h&&(w.matrix=Pt(w.matrix,h));continue}if(v===H.paintFormXObjectBegin){S.push(Un(w)),A.push(Ln(k));const h=Yt(R);h&&(w.matrix=Pt(w.matrix,h)),N=null;continue}if(v===H.paintFormXObjectEnd){const h=S.pop();h&&(w=h),k=A.pop()??k,N=null;continue}if(v===H.constructPath){if(gt(R,0,-1)===H.endPath){const F=Ai(R);N=F?Ca(F,w.matrix):null}else N=null;continue}if(v===H.clip||v===H.eoClip){N&&(k=ba(k,N));continue}if(v===H.endPath){N=null;continue}if(v===H.setFillRGBColor||v===H.setFillColor||v===H.setFillGray||v===H.setFillCMYKColor){if(v===H.setFillCMYKColor){const[h,F,q]=$e(R,[w.fillR,w.fillG,w.fillB]);w.fillR=h,w.fillG=F,w.fillB=q}else if(v===H.setFillGray){const[h]=je(Bt(R,0),w.fillR);w.fillR=h,w.fillG=h,w.fillB=h}else{const[h,F,q]=ae(R,[w.fillR,w.fillG,w.fillB]);w.fillR=h,w.fillG=F,w.fillB=q}continue}if(v===H.setGState){Da(Bt(R,0),w);continue}if(v===H.beginText){ka(w);continue}if(v===H.setCharSpacing){w.charSpacing=gt(R,0,w.charSpacing);continue}if(v===H.setWordSpacing){w.wordSpacing=gt(R,0,w.wordSpacing);continue}if(v===H.setHScale){w.textHScale=gt(R,0,w.textHScale*100)/100;continue}if(v===H.setLeading){w.leading=-gt(R,0,-w.leading);continue}if(v===H.setFont){const h=Bt(R,0),F=gt(R,1,w.fontSize);typeof h=="string"&&(w.fontRef=h),F<0?(w.fontSize=-F,w.fontDirection=-1):(w.fontSize=F,w.fontDirection=1);continue}if(v===H.setTextRenderingMode){w.renderMode=Math.max(0,Math.trunc(gt(R,0,w.renderMode)));continue}if(v===H.setTextRise){w.textRise=gt(R,0,w.textRise);continue}if(v===H.moveText){const h=gt(R,0,0),F=gt(R,1,0);ne(w,h,F);continue}if(v===H.setLeadingMoveText){const h=gt(R,0,0),F=gt(R,1,0);w.leading=F,ne(w,h,F);continue}if(v===H.setTextMatrix){const h=Yt(R);h&&(w.textMatrix=h,w.textX=0,w.textY=0,w.lineX=0,w.lineY=0);continue}if(v===H.nextLine){ne(w,0,w.leading);continue}if(v===H.showText||v===H.showSpacedText){I(We(Bt(R,0))),N=null;continue}if(v===H.nextLineShowText){ne(w,0,w.leading),I(We(Bt(R,0))),N=null;continue}if(v===H.nextLineSetSpacingShowText){w.wordSpacing=gt(R,0,w.wordSpacing),w.charSpacing=gt(R,1,w.charSpacing),ne(w,0,w.leading),I(We(Bt(R,2))),N=null;continue}}return{sourceTextCount:y,instanceCount:r.quadCount,glyphCount:l.quadCount,glyphSegmentCount:p.quadCount,inPageCount:x,outOfPageCount:T,instanceA:r.toTypedArray(),instanceB:i.toTypedArray(),instanceC:o.toTypedArray(),glyphMetaA:l.toTypedArray(),glyphMetaB:c.toTypedArray(),glyphSegmentsA:p.toTypedArray(),glyphSegmentsB:m.toTypedArray(),bounds:u}}function Ln(n){return n?{...n}:null}function ba(n,t){if(!n&&!t)return null;if(!n&&t)return{...t};if(n&&!t)return{...n};const e=Math.max(n.minX,t.minX),s=Math.max(n.minY,t.minY),a=Math.min(n.maxX,t.maxX),r=Math.min(n.maxY,t.maxY);return e<=a&&s<=r?{minX:e,minY:s,maxX:a,maxY:r}:null}function Ca(n,t){let e=Number.POSITIVE_INFINITY,s=Number.POSITIVE_INFINITY,a=Number.NEGATIVE_INFINITY,r=Number.NEGATIVE_INFINITY,i=!1,o=0,l=0,c=0,p=0,m=!1;const g=(d,y)=>{const[u,x]=ht(t,d,y);e=Math.min(e,u),s=Math.min(s,x),a=Math.max(a,u),r=Math.max(r,x),i=!0};for(let d=0;d<n.length;){const y=n[d++];if(y===_e){if(d+1>=n.length)break;o=n[d++],l=n[d++],c=o,p=l,m=!0,g(o,l);continue}if(y===Me){if(d+1>=n.length)break;const u=n[d++],x=n[d++];g(o,l),g(u,x),o=u,l=x;continue}if(y===Ee){if(d+5>=n.length)break;const u=n[d++],x=n[d++],T=n[d++],b=n[d++],S=n[d++],E=n[d++];g(o,l),g(u,x),g(T,b),g(S,E),o=S,l=E;continue}if(y===Re){if(d+3>=n.length)break;const u=n[d++],x=n[d++],T=n[d++],b=n[d++];g(o,l),g(u,x),g(T,b),o=T,l=b;continue}if(y===Ie){m&&(g(o,l),g(c,p),o=c,l=p);continue}break}return i?{minX:e,minY:s,maxX:a,maxY:r}:null}function Aa(){return{sourceTextCount:0,instanceCount:0,glyphCount:0,glyphSegmentCount:0,inPageCount:0,outOfPageCount:0,instanceA:new Float32Array(0),instanceB:new Float32Array(0),instanceC:new Float32Array(0),glyphMetaA:new Float32Array(0),glyphMetaB:new Float32Array(0),glyphSegmentsA:new Float32Array(0),glyphSegmentsB:new Float32Array(0),bounds:null}}function Sa(n){const t=n;return!t.commonObjs||typeof t.commonObjs.get!="function"?null:t.commonObjs}function wa(n){for(const t of n.fnArray)if(t===H.showText||t===H.showSpacedText||t===H.nextLineShowText||t===H.nextLineSetSpacingShowText)return!0;return!1}function Si(n){let t=0;for(const e of n.fnArray)nn(e)&&(t+=1);return t}async function _a(n){if(typeof document>"u")return;const t=n;if(!Array.isArray(t.view)||typeof t.getViewport!="function"||typeof t.render!="function")return;const e=Math.max(1,Math.abs(t.view[2]-t.view[0])),s=Math.max(1,Math.abs(t.view[3]-t.view[1])),a=Math.max(e,s),i=dt(1024/a)*.95+.05,o=t.getViewport({scale:i,rotation:Ae(t.rotate),dontFlip:!0}),l=Math.max(1,Math.ceil(o.width)),c=Math.max(1,Math.ceil(o.height)),p=document.createElement("canvas");p.width=l,p.height=c;const m=p.getContext("2d",{alpha:!1});if(m)try{await t.render({canvasContext:m,viewport:o,intent:"display"}).promise}catch{}finally{p.width=0,p.height=0}}function nn(n){return n===H.paintImageXObject||n===H.paintInlineImageXObject||n===H.paintInlineImageXObjectGroup||n===H.paintImageXObjectRepeat||n===H.paintImageMaskXObject||n===H.paintImageMaskXObjectGroup||n===H.paintImageMaskXObjectRepeat||n===H.paintSolidColorImageMask||n===H.beginInlineImage||n===H.beginImageData||n===H.endInlineImage}function Ma(n,t){return n===H.dependency||n===H.save||n===H.restore||n===H.transform||n===H.setGState||n===H.beginGroup||n===H.endGroup||n===H.beginCompat||n===H.endCompat||n===H.beginMarkedContent||n===H.beginMarkedContentProps||n===H.endMarkedContent||n===H.paintFormXObjectBegin||n===H.paintFormXObjectEnd||n===H.paintXObject||n===H.clip||n===H.eoClip||n===H.endPath||n===H.setFillRGBColor||n===H.setFillColor||n===H.setFillGray||n===H.setFillCMYKColor||n===H.setFillColorN||n===H.setFillColorSpace||n===H.setFillTransparent||n===H.setStrokeRGBColor||n===H.setStrokeColor||n===H.setStrokeGray||n===H.setStrokeCMYKColor||n===H.setStrokeColorN||n===H.setStrokeColorSpace||n===H.setStrokeTransparent?!0:n===H.constructPath?gt(t,0,-1)===H.endPath:!1}function Ea(n){const t=new Uint8Array(n.fnArray.length);let e=!1,s=!1;for(let a=0;a<n.fnArray.length;a+=1){const r=n.fnArray[a],i=n.argsArray[a];if(nn(r)){e=!0,t[a]=1;continue}(r===H.paintFormXObjectBegin||r===H.paintFormXObjectEnd||r===H.paintXObject)&&(s=!0),Ma(r,i)&&(t[a]=1)}return{hasImagePaintOps:e,hasFormXObjectOps:s,imageOnlyMask:t}}function Ra(n){const t=[];let e=[...kt],s=1;for(let a=0;a<n.fnArray.length;a+=1){const r=n.fnArray[a],i=n.argsArray[a];if(r===H.save){t.push([...e]);continue}if(r===H.restore){const g=t.pop();g&&(e=g);continue}if(r===H.transform){const g=Yt(i);g&&(e=Pt(e,g));continue}if(!nn(r))continue;const o=Ia(r,i);if(!o)continue;const l=Math.hypot(e[0],e[1]),c=Math.hypot(e[2],e[3]);if(!Number.isFinite(l)||!Number.isFinite(c)||l<=1e-5||c<=1e-5)continue;const p=o.width/l,m=o.height/c;Number.isFinite(p)&&p>s&&(s=p),Number.isFinite(m)&&m>s&&(s=m)}return Number.isFinite(s)?Math.max(1,s):1}function Ia(n,t){if(n===H.paintImageXObject||n===H.paintImageXObjectRepeat){const e=gt(t,1,Number.NaN),s=gt(t,2,Number.NaN);if(e>0&&s>0)return{width:e,height:s}}if(n===H.paintInlineImageXObject){const e=Bt(t,0),s=Number(e?.width),a=Number(e?.height);if(s>0&&a>0)return{width:s,height:a}}if(n===H.paintImageMaskXObject||n===H.paintImageMaskXObjectRepeat){const e=gt(t,1,Number.NaN),s=gt(t,2,Number.NaN);if(e>0&&s>0)return{width:e,height:s}}return null}function ee(){return{width:0,height:0,data:new Uint8Array(0),matrix:[...kt],bounds:null}}async function wi(n,t,e,s){const a=Ea(t);if(!a.hasImagePaintOps&&!(s.allowFullPageFallback&&a.hasFormXObjectOps))return ee();const r=n;if(!Array.isArray(r.view)||typeof r.getViewport!="function"||typeof r.render!="function")return ee();const i=r.getViewport({scale:1,rotation:Ae(r.rotate),dontFlip:!1}),o=Ra(t),l=ua(Math.max(1,Math.ceil(i.width)),Math.max(1,Math.ceil(i.height)),o),c=l===1?i:r.getViewport({scale:l,rotation:Ae(r.rotate),dontFlip:!1}),p=Math.max(1,Math.ceil(c.width)),m=Math.max(1,Math.ceil(c.height));if(!Number.isFinite(p)||!Number.isFinite(m)||p<=0||m<=0)return ee();let g=null;return a.hasImagePaintOps&&(g=await On(r,c,a.imageOnlyMask),g&&Nn(g))?Gn(p,m,g,c,e):!s.allowFullPageFallback||!a.hasFormXObjectOps||(g=await On(r,c),!g||!Nn(g))?ee():Gn(p,m,g,c,e)}async function Pa(){if(Vt!==void 0)return Vt;if(typeof window<"u")return Vt=null,null;try{const t=await import("@napi-rs/canvas");return typeof t.createCanvas!="function"?(Vt=null,null):(Vt={createCanvas:t.createCanvas},Vt)}catch{return Vt=null,null}}async function Fa(n,t){if(typeof document<"u"){const r=document.createElement("canvas");r.width=n,r.height=t;const i=r.getContext("2d",{alpha:!0,willReadFrequently:!0});return i?{context:i,dispose:()=>{r.width=0,r.height=0}}:null}const e=await Pa();if(!e)return null;const s=e.createCanvas(n,t),a=s.getContext("2d");return!a||typeof a.getImageData!="function"?null:{context:a,dispose:()=>{s.width=0,s.height=0}}}async function On(n,t,e){const s=t,a=Math.max(1,Math.ceil(Number(s.width)||1)),r=Math.max(1,Math.ceil(Number(s.height)||1)),i=await Fa(a,r);if(!i)return null;const o=i.context;try{const p={canvasContext:o,viewport:t,intent:"display",background:"rgba(0,0,0,0)"};e&&(p.operationsFilter=m=>m>=0&&m<e.length&&e[m]===1),await n.render(p).promise}catch{return i.dispose(),null}const l=o.getImageData(0,0,a,r),c=new Uint8Array(l.data instanceof Uint8ClampedArray?l.data:new Uint8Array(l.data));return i.dispose(),c}function Nn(n){for(let t=3;t<n.length;t+=4)if(n[t]>0)return!0;return!1}function Gn(n,t,e,s,a){const r=Yt(s.transform)??[...kt],i=ja(r)??[...kt],l=Pt(a,Pt(i,[n,0,0,t,0,0])),c=Pe({minX:0,minY:0,maxX:1,maxY:1},l);return{width:n,height:t,data:e,matrix:l,bounds:c}}function Ba(n){return{matrix:[...n],fillR:0,fillG:0,fillB:0,fillAlpha:1,textMatrix:[...kt],textX:0,textY:0,lineX:0,lineY:0,charSpacing:0,wordSpacing:0,textHScale:1,leading:0,textRise:0,renderMode:hi,fontRef:"",fontSize:0,fontDirection:1}}function Un(n){return{matrix:[...n.matrix],fillR:n.fillR,fillG:n.fillG,fillB:n.fillB,fillAlpha:n.fillAlpha,textMatrix:[...n.textMatrix],textX:n.textX,textY:n.textY,lineX:n.lineX,lineY:n.lineY,charSpacing:n.charSpacing,wordSpacing:n.wordSpacing,textHScale:n.textHScale,leading:n.leading,textRise:n.textRise,renderMode:n.renderMode,fontRef:n.fontRef,fontSize:n.fontSize,fontDirection:n.fontDirection}}function ka(n){n.textMatrix=[...kt],n.textX=0,n.textY=0,n.lineX=0,n.lineY=0}function ne(n,t,e){n.lineX+=t,n.lineY+=e,n.textX=n.lineX,n.textY=n.lineY}function Da(n,t){if(Array.isArray(n))for(const e of n){if(!Array.isArray(e)||e.length<2)continue;const s=e[0],a=e[1];if(s==="ca"){const r=Number(a);Number.isFinite(r)&&(t.fillAlpha=dt(r));continue}if(s==="Font"&&Array.isArray(a)){const r=a[0],i=Number(a[1]);typeof r=="string"&&(t.fontRef=r),Number.isFinite(i)&&(i<0?(t.fontSize=-i,t.fontDirection=-1):(t.fontSize=i,t.fontDirection=1))}}}function La(n){return n===hi||n===Ur||n===zr||n===Xr}function Oa(n,t){if(!t||n.isSpace===!0)return!0;const e=typeof n.unicode=="string"?n.unicode:"";return e.length>0&&e.trim().length===0}function We(n){return Array.isArray(n)?n:[]}function Na(n,t){if(!t)return null;try{const e=n.get(t);return!e||typeof e!="object"?null:e}catch{return null}}function Ga(n){const t=n?.fontMatrix;if(Array.isArray(t)&&t.length>=1){const e=Number(t[0]);if(Number.isFinite(e)&&e!==0)return e}return Fr}function Ua(n,t,e){const s=`${t}_path_${e}`;let a;try{a=n.get(s)}catch{return null}const r=a?.path;return za(r)}function za(n){if(!n)return null;if(n instanceof Float32Array)return n;if(ArrayBuffer.isView(n)){const t=n,e=new Float32Array(t.length);for(let s=0;s<t.length;s+=1){const a=Number(t[s]);e[s]=Number.isFinite(a)?a:0}return e}if(Array.isArray(n)){const t=new Float32Array(n.length);for(let e=0;e<n.length;e+=1){const s=Number(n[e]);t[e]=Number.isFinite(s)?s:0}return t}return null}function Xa(n,t,e){let s=0,a=0,r=0,i=0,o=0,l=!1;const c={minX:Number.POSITIVE_INFINITY,minY:Number.POSITIVE_INFINITY,maxX:Number.NEGATIVE_INFINITY,maxY:Number.NEGATIVE_INFINITY},p=(g,d,y,u)=>{const x=y-g,T=u-d;x*x+T*T<1e-12||(t.push(g,d,y,u),e.push(y,u,Vr,0),s+=1,c.minX=Math.min(c.minX,g,y),c.minY=Math.min(c.minY,d,u),c.maxX=Math.max(c.maxX,g,y),c.maxY=Math.max(c.maxY,d,u))},m=(g,d,y,u,x,T)=>{const b=x-g,S=T-d,E=y-g,A=u-d;b*b+S*S<1e-12&&E*E+A*A<1e-12||(t.push(g,d,y,u),e.push(x,T,Yr,0),s+=1,c.minX=Math.min(c.minX,g,y,x),c.minY=Math.min(c.minY,d,u,T),c.maxX=Math.max(c.maxX,g,y,x),c.maxY=Math.max(c.maxY,d,u,T))};for(let g=0;g<n.length;){const d=n[g++];if(d===_e){a=n[g++],r=n[g++],i=a,o=r,l=!0;continue}if(d===Me){const y=n[g++],u=n[g++];p(a,r,y,u),a=y,r=u;continue}if(d===Ee){const y=n[g++],u=n[g++],x=n[g++],T=n[g++],b=n[g++],S=n[g++];rn(a,r,y,u,x,T,b,S,m,Ir,Pr),a=b,r=S;continue}if(d===Re){const y=n[g++],u=n[g++],x=n[g++],T=n[g++];m(a,r,y,u,x,T),a=x,r=T;continue}if(d===Ie){l&&(a!==i||r!==o)&&p(a,r,i,o),a=i,r=o;continue}break}return s===0?{segmentCount:0,bounds:{minX:0,minY:0,maxX:0,maxY:0}}:{segmentCount:s,bounds:c}}function rn(n,t,e,s,a,r,i,o,l,c,p){const m=[n,t,e,s,a,r,i,o,0],g=c*c;for(;m.length>0;){const d=m.pop(),y=m.pop(),u=m.pop(),x=m.pop(),T=m.pop(),b=m.pop(),S=m.pop(),E=m.pop(),A=m.pop(),[w,k]=Va(A,E,S,b,T,x,u,y),N=Ya(A,E,S,b,T,x,u,y,w,k);if(d>=p||N<=g){l(A,E,w,k,u,y);continue}const B=(A+S)*.5,I=(E+b)*.5,P=(S+T)*.5,v=(b+x)*.5,R=(T+u)*.5,h=(x+y)*.5,F=(B+P)*.5,q=(I+v)*.5,G=(P+R)*.5,tt=(v+h)*.5,V=(F+G)*.5,Q=(q+tt)*.5,L=d+1;m.push(V,Q,G,tt,R,h,u,y,L),m.push(A,E,B,I,F,q,V,Q,L)}}function Va(n,t,e,s,a,r,i,o){return[(3*(e+a)-n-i)*.25,(3*(s+r)-t-o)*.25]}function Ya(n,t,e,s,a,r,i,o,l,c){const p=[.25,.5,.75];let m=0;for(const g of p){const d=Wa(n,t,e,s,a,r,i,o,g),y=Ha(n,t,l,c,i,o,g),u=d[0]-y[0],x=d[1]-y[1],T=u*u+x*x;T>m&&(m=T)}return m}function Wa(n,t,e,s,a,r,i,o,l){const c=1-l,p=c*c,m=p*c,g=l*l,d=g*l,y=m*n+3*p*l*e+3*c*g*a+d*i,u=m*t+3*p*l*s+3*c*g*r+d*o;return[y,u]}function Ha(n,t,e,s,a,r,i){const o=1-i,l=o*o,c=i*i,p=l*n+2*o*i*e+c*a,m=l*t+2*o*i*s+c*r;return[p,m]}function qa(n,t,e){let s=n.matrix;return s=Pt(s,n.textMatrix),s=Pt(s,[1,0,0,1,n.textX,n.textY+n.textRise]),s=Pt(s,[n.textHScale*n.fontDirection,0,0,n.fontDirection>0?-1:1,0,0]),s=Pt(s,[1,0,0,1,t,e]),s=Pt(s,[n.fontSize,0,0,-n.fontSize,0,0]),s}function $t(n,t){if(!n&&!t)return null;if(!n&&t)return{...t};if(n&&!t)return{...n};const e=n,s=t;return{minX:Math.min(e.minX,s.minX),minY:Math.min(e.minY,s.minY),maxX:Math.max(e.maxX,s.maxX),maxY:Math.max(e.maxY,s.maxY)}}function zn(n,t){return!(n.maxX<t.minX||n.minX>t.maxX||n.maxY<t.minY||n.minY>t.maxY)}function Za(n,t,e,s,a){const r=n*s-t*e;return r*r/a}function Tt(n,t){return Math.round(n*t)}function Pt(n,t){return[n[0]*t[0]+n[2]*t[1],n[1]*t[0]+n[3]*t[1],n[0]*t[2]+n[2]*t[3],n[1]*t[2]+n[3]*t[3],n[0]*t[4]+n[2]*t[5]+n[4],n[1]*t[4]+n[3]*t[5]+n[5]]}function ja(n){const t=n[0],e=n[1],s=n[2],a=n[3],r=n[4],i=n[5],o=t*a-e*s;if(!Number.isFinite(o)||Math.abs(o)<=1e-12)return null;const l=1/o;return[a*l,-e*l,-s*l,t*l,(s*i-a*r)*l,(e*r-t*i)*l]}function $a(n){const t=Math.hypot(n[0],n[1]),e=Math.hypot(n[2],n[3]),s=(t+e)*.5;return Number.isFinite(s)&&s>0?s:1}function ht(n,t,e){return[n[0]*t+n[2]*e+n[4],n[1]*t+n[3]*e+n[5]]}function dt(n){return n<=0?0:n>=1?1:n}function Qe(n,t,e){return n+(t-n)*e}function $s(n){let t=null,e=!1,s=0,a=0;const r=new Set,i=new Map;let o=null,l=!1,c=0,p=0,m=0;function g(){e=!1,s=0,a=0,r.clear(),i.clear(),o=null,l=!1,c=0,p=0,m=0}function d(){i.clear(),o=null,l=!1,c=0,p=0,m=0}function y(P){e&&n().endPanInteraction(),d(),g()}function u(){if(i.size<2)return null;const P=i.values(),v=P.next().value,R=P.next().value;if(!v||!R)return null;const h=R.x-v.x,F=R.y-v.y;return{distance:Math.hypot(h,F),centerX:(v.x+R.x)*.5,centerY:(v.y+R.y)*.5}}function x(P,v){if(P.hasPointerCapture(v))try{P.releasePointerCapture(v)}catch{}}function T(P){if(!i.has(P.pointerId)||!e)return;i.set(P.pointerId,{x:P.clientX,y:P.clientY});const v=n();if(i.size>=2){const F=u();if(!F)return;if(!l){l=!0,o=null,c=Math.max(F.distance,.001),p=F.centerX,m=F.centerY;return}const q=Math.max(c,.001),G=Math.max(F.distance,.001),tt=G/q,V=F.centerX-p,Q=F.centerY-m;(V!==0||Q!==0)&&v.panByPixels(V,Q),Number.isFinite(tt)&&Math.abs(tt-1)>1e-4&&v.zoomAtClientPoint(F.centerX,F.centerY,tt),c=G,p=F.centerX,m=F.centerY;return}if(o===null){o=P.pointerId,s=P.clientX,a=P.clientY,l=!1,c=0;return}if(P.pointerId!==o)return;const R=P.clientX-s,h=P.clientY-a;s=P.clientX,a=P.clientY,v.panByPixels(R,h)}function b(P,v){if(i.delete(v.pointerId),r.delete(v.pointerId),x(P,v.pointerId),i.size>=2){const R=u();R&&(l=!0,o=null,c=Math.max(R.distance,.001),p=R.centerX,m=R.centerY);return}if(i.size===1){const R=i.entries().next().value;R?(o=R[0],s=R[1].x,a=R[1].y):o=null,l=!1,c=0,p=0,m=0;return}y()}const S=P=>{const v=t;if(v){if(r.add(P.pointerId),e||(e=!0,n().beginPanInteraction()),P.pointerType==="touch")if(i.set(P.pointerId,{x:P.clientX,y:P.clientY}),i.size===1)o=P.pointerId,l=!1,c=0,p=P.clientX,m=P.clientY,s=P.clientX,a=P.clientY;else{const R=u();R&&(l=!0,o=null,c=Math.max(R.distance,.001),p=R.centerX,m=R.centerY)}else s=P.clientX,a=P.clientY;v.setPointerCapture(P.pointerId)}},E=P=>{if(P.pointerType==="touch"){T(P);return}if(!e)return;const v=P.clientX-s,R=P.clientY-a;s=P.clientX,a=P.clientY,n().panByPixels(v,R)},A=P=>{const v=t;if(v){if(P.pointerType==="touch"){b(v,P);return}r.delete(P.pointerId),y(),x(v,P.pointerId)}},w=P=>{const v=t;if(v){if(P.pointerType==="touch"){b(v,P);return}r.delete(P.pointerId),y(),x(v,P.pointerId)}},k=P=>{if(r.delete(P.pointerId),P.pointerType==="touch"){i.has(P.pointerId)&&i.delete(P.pointerId),i.size===0&&y();return}e&&y()},N=P=>{P.preventDefault();const v=Math.exp(-P.deltaY*.0013);n().zoomAtClientPoint(P.clientX,P.clientY,v)};function B(P){t!==P&&(t&&I(),t=P,P.addEventListener("pointerdown",S),P.addEventListener("pointermove",E),P.addEventListener("pointerup",A),P.addEventListener("pointercancel",w),P.addEventListener("lostpointercapture",k),P.addEventListener("wheel",N,{passive:!1}))}function I(){const P=t;if(P){for(const v of r)x(P,v);P.removeEventListener("pointerdown",S),P.removeEventListener("pointermove",E),P.removeEventListener("pointerup",A),P.removeEventListener("pointercancel",w),P.removeEventListener("lostpointercapture",k),P.removeEventListener("wheel",N),t=null,y()}}return{attach:B,detach:I,resetState:g}}var ve=typeof globalThis<"u"?globalThis:typeof window<"u"?window:typeof global<"u"?global:typeof self<"u"?self:{};function Qa(n){return n&&n.__esModule&&Object.prototype.hasOwnProperty.call(n,"default")?n.default:n}function be(n){throw new Error('Could not dynamically require "'+n+'". Please configure the dynamicRequireTargets or/and ignoreDynamicRequires option of @rollup/plugin-commonjs appropriately for this require call to work.')}var He={exports:{}};var Xn;function Ka(){return Xn||(Xn=1,(function(n,t){(function(e){n.exports=e()})(function(){return(function e(s,a,r){function i(c,p){if(!a[c]){if(!s[c]){var m=typeof be=="function"&&be;if(!p&&m)return m(c,!0);if(o)return o(c,!0);var g=new Error("Cannot find module '"+c+"'");throw g.code="MODULE_NOT_FOUND",g}var d=a[c]={exports:{}};s[c][0].call(d.exports,function(y){var u=s[c][1][y];return i(u||y)},d,d.exports,e,s,a,r)}return a[c].exports}for(var o=typeof be=="function"&&be,l=0;l<r.length;l++)i(r[l]);return i})({1:[function(e,s,a){var r=e("./utils"),i=e("./support"),o="ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=";a.encode=function(l){for(var c,p,m,g,d,y,u,x=[],T=0,b=l.length,S=b,E=r.getTypeOf(l)!=="string";T<l.length;)S=b-T,m=E?(c=l[T++],p=T<b?l[T++]:0,T<b?l[T++]:0):(c=l.charCodeAt(T++),p=T<b?l.charCodeAt(T++):0,T<b?l.charCodeAt(T++):0),g=c>>2,d=(3&c)<<4|p>>4,y=1<S?(15&p)<<2|m>>6:64,u=2<S?63&m:64,x.push(o.charAt(g)+o.charAt(d)+o.charAt(y)+o.charAt(u));return x.join("")},a.decode=function(l){var c,p,m,g,d,y,u=0,x=0,T="data:";if(l.substr(0,T.length)===T)throw new Error("Invalid base64 input, it looks like a data url.");var b,S=3*(l=l.replace(/[^A-Za-z0-9+/=]/g,"")).length/4;if(l.charAt(l.length-1)===o.charAt(64)&&S--,l.charAt(l.length-2)===o.charAt(64)&&S--,S%1!=0)throw new Error("Invalid base64 input, bad content length.");for(b=i.uint8array?new Uint8Array(0|S):new Array(0|S);u<l.length;)c=o.indexOf(l.charAt(u++))<<2|(g=o.indexOf(l.charAt(u++)))>>4,p=(15&g)<<4|(d=o.indexOf(l.charAt(u++)))>>2,m=(3&d)<<6|(y=o.indexOf(l.charAt(u++))),b[x++]=c,d!==64&&(b[x++]=p),y!==64&&(b[x++]=m);return b}},{"./support":30,"./utils":32}],2:[function(e,s,a){var r=e("./external"),i=e("./stream/DataWorker"),o=e("./stream/Crc32Probe"),l=e("./stream/DataLengthProbe");function c(p,m,g,d,y){this.compressedSize=p,this.uncompressedSize=m,this.crc32=g,this.compression=d,this.compressedContent=y}c.prototype={getContentWorker:function(){var p=new i(r.Promise.resolve(this.compressedContent)).pipe(this.compression.uncompressWorker()).pipe(new l("data_length")),m=this;return p.on("end",function(){if(this.streamInfo.data_length!==m.uncompressedSize)throw new Error("Bug : uncompressed data size mismatch")}),p},getCompressedWorker:function(){return new i(r.Promise.resolve(this.compressedContent)).withStreamInfo("compressedSize",this.compressedSize).withStreamInfo("uncompressedSize",this.uncompressedSize).withStreamInfo("crc32",this.crc32).withStreamInfo("compression",this.compression)}},c.createWorkerFrom=function(p,m,g){return p.pipe(new o).pipe(new l("uncompressedSize")).pipe(m.compressWorker(g)).pipe(new l("compressedSize")).withStreamInfo("compression",m)},s.exports=c},{"./external":6,"./stream/Crc32Probe":25,"./stream/DataLengthProbe":26,"./stream/DataWorker":27}],3:[function(e,s,a){var r=e("./stream/GenericWorker");a.STORE={magic:"\0\0",compressWorker:function(){return new r("STORE compression")},uncompressWorker:function(){return new r("STORE decompression")}},a.DEFLATE=e("./flate")},{"./flate":7,"./stream/GenericWorker":28}],4:[function(e,s,a){var r=e("./utils"),i=(function(){for(var o,l=[],c=0;c<256;c++){o=c;for(var p=0;p<8;p++)o=1&o?3988292384^o>>>1:o>>>1;l[c]=o}return l})();s.exports=function(o,l){return o!==void 0&&o.length?r.getTypeOf(o)!=="string"?(function(c,p,m,g){var d=i,y=g+m;c^=-1;for(var u=g;u<y;u++)c=c>>>8^d[255&(c^p[u])];return-1^c})(0|l,o,o.length,0):(function(c,p,m,g){var d=i,y=g+m;c^=-1;for(var u=g;u<y;u++)c=c>>>8^d[255&(c^p.charCodeAt(u))];return-1^c})(0|l,o,o.length,0):0}},{"./utils":32}],5:[function(e,s,a){a.base64=!1,a.binary=!1,a.dir=!1,a.createFolders=!0,a.date=null,a.compression=null,a.compressionOptions=null,a.comment=null,a.unixPermissions=null,a.dosPermissions=null},{}],6:[function(e,s,a){var r=null;r=typeof Promise<"u"?Promise:e("lie"),s.exports={Promise:r}},{lie:37}],7:[function(e,s,a){var r=typeof Uint8Array<"u"&&typeof Uint16Array<"u"&&typeof Uint32Array<"u",i=e("pako"),o=e("./utils"),l=e("./stream/GenericWorker"),c=r?"uint8array":"array";function p(m,g){l.call(this,"FlateWorker/"+m),this._pako=null,this._pakoAction=m,this._pakoOptions=g,this.meta={}}a.magic="\b\0",o.inherits(p,l),p.prototype.processChunk=function(m){this.meta=m.meta,this._pako===null&&this._createPako(),this._pako.push(o.transformTo(c,m.data),!1)},p.prototype.flush=function(){l.prototype.flush.call(this),this._pako===null&&this._createPako(),this._pako.push([],!0)},p.prototype.cleanUp=function(){l.prototype.cleanUp.call(this),this._pako=null},p.prototype._createPako=function(){this._pako=new i[this._pakoAction]({raw:!0,level:this._pakoOptions.level||-1});var m=this;this._pako.onData=function(g){m.push({data:g,meta:m.meta})}},a.compressWorker=function(m){return new p("Deflate",m)},a.uncompressWorker=function(){return new p("Inflate",{})}},{"./stream/GenericWorker":28,"./utils":32,pako:38}],8:[function(e,s,a){function r(d,y){var u,x="";for(u=0;u<y;u++)x+=String.fromCharCode(255&d),d>>>=8;return x}function i(d,y,u,x,T,b){var S,E,A=d.file,w=d.compression,k=b!==c.utf8encode,N=o.transformTo("string",b(A.name)),B=o.transformTo("string",c.utf8encode(A.name)),I=A.comment,P=o.transformTo("string",b(I)),v=o.transformTo("string",c.utf8encode(I)),R=B.length!==A.name.length,h=v.length!==I.length,F="",q="",G="",tt=A.dir,V=A.date,Q={crc32:0,compressedSize:0,uncompressedSize:0};y&&!u||(Q.crc32=d.crc32,Q.compressedSize=d.compressedSize,Q.uncompressedSize=d.uncompressedSize);var L=0;y&&(L|=8),k||!R&&!h||(L|=2048);var D=0,et=0;tt&&(D|=16),T==="UNIX"?(et=798,D|=(function(K,ot){var lt=K;return K||(lt=ot?16893:33204),(65535&lt)<<16})(A.unixPermissions,tt)):(et=20,D|=(function(K){return 63&(K||0)})(A.dosPermissions)),S=V.getUTCHours(),S<<=6,S|=V.getUTCMinutes(),S<<=5,S|=V.getUTCSeconds()/2,E=V.getUTCFullYear()-1980,E<<=4,E|=V.getUTCMonth()+1,E<<=5,E|=V.getUTCDate(),R&&(q=r(1,1)+r(p(N),4)+B,F+="up"+r(q.length,2)+q),h&&(G=r(1,1)+r(p(P),4)+v,F+="uc"+r(G.length,2)+G);var J="";return J+=`
\0`,J+=r(L,2),J+=w.magic,J+=r(S,2),J+=r(E,2),J+=r(Q.crc32,4),J+=r(Q.compressedSize,4),J+=r(Q.uncompressedSize,4),J+=r(N.length,2),J+=r(F.length,2),{fileRecord:m.LOCAL_FILE_HEADER+J+N+F,dirRecord:m.CENTRAL_FILE_HEADER+r(et,2)+J+r(P.length,2)+"\0\0\0\0"+r(D,4)+r(x,4)+N+F+P}}var o=e("../utils"),l=e("../stream/GenericWorker"),c=e("../utf8"),p=e("../crc32"),m=e("../signature");function g(d,y,u,x){l.call(this,"ZipFileWorker"),this.bytesWritten=0,this.zipComment=y,this.zipPlatform=u,this.encodeFileName=x,this.streamFiles=d,this.accumulate=!1,this.contentBuffer=[],this.dirRecords=[],this.currentSourceOffset=0,this.entriesCount=0,this.currentFile=null,this._sources=[]}o.inherits(g,l),g.prototype.push=function(d){var y=d.meta.percent||0,u=this.entriesCount,x=this._sources.length;this.accumulate?this.contentBuffer.push(d):(this.bytesWritten+=d.data.length,l.prototype.push.call(this,{data:d.data,meta:{currentFile:this.currentFile,percent:u?(y+100*(u-x-1))/u:100}}))},g.prototype.openedSource=function(d){this.currentSourceOffset=this.bytesWritten,this.currentFile=d.file.name;var y=this.streamFiles&&!d.file.dir;if(y){var u=i(d,y,!1,this.currentSourceOffset,this.zipPlatform,this.encodeFileName);this.push({data:u.fileRecord,meta:{percent:0}})}else this.accumulate=!0},g.prototype.closedSource=function(d){this.accumulate=!1;var y=this.streamFiles&&!d.file.dir,u=i(d,y,!0,this.currentSourceOffset,this.zipPlatform,this.encodeFileName);if(this.dirRecords.push(u.dirRecord),y)this.push({data:(function(x){return m.DATA_DESCRIPTOR+r(x.crc32,4)+r(x.compressedSize,4)+r(x.uncompressedSize,4)})(d),meta:{percent:100}});else for(this.push({data:u.fileRecord,meta:{percent:0}});this.contentBuffer.length;)this.push(this.contentBuffer.shift());this.currentFile=null},g.prototype.flush=function(){for(var d=this.bytesWritten,y=0;y<this.dirRecords.length;y++)this.push({data:this.dirRecords[y],meta:{percent:100}});var u=this.bytesWritten-d,x=(function(T,b,S,E,A){var w=o.transformTo("string",A(E));return m.CENTRAL_DIRECTORY_END+"\0\0\0\0"+r(T,2)+r(T,2)+r(b,4)+r(S,4)+r(w.length,2)+w})(this.dirRecords.length,u,d,this.zipComment,this.encodeFileName);this.push({data:x,meta:{percent:100}})},g.prototype.prepareNextSource=function(){this.previous=this._sources.shift(),this.openedSource(this.previous.streamInfo),this.isPaused?this.previous.pause():this.previous.resume()},g.prototype.registerPrevious=function(d){this._sources.push(d);var y=this;return d.on("data",function(u){y.processChunk(u)}),d.on("end",function(){y.closedSource(y.previous.streamInfo),y._sources.length?y.prepareNextSource():y.end()}),d.on("error",function(u){y.error(u)}),this},g.prototype.resume=function(){return!!l.prototype.resume.call(this)&&(!this.previous&&this._sources.length?(this.prepareNextSource(),!0):this.previous||this._sources.length||this.generatedError?void 0:(this.end(),!0))},g.prototype.error=function(d){var y=this._sources;if(!l.prototype.error.call(this,d))return!1;for(var u=0;u<y.length;u++)try{y[u].error(d)}catch{}return!0},g.prototype.lock=function(){l.prototype.lock.call(this);for(var d=this._sources,y=0;y<d.length;y++)d[y].lock()},s.exports=g},{"../crc32":4,"../signature":23,"../stream/GenericWorker":28,"../utf8":31,"../utils":32}],9:[function(e,s,a){var r=e("../compressions"),i=e("./ZipFileWorker");a.generateWorker=function(o,l,c){var p=new i(l.streamFiles,c,l.platform,l.encodeFileName),m=0;try{o.forEach(function(g,d){m++;var y=(function(b,S){var E=b||S,A=r[E];if(!A)throw new Error(E+" is not a valid compression method !");return A})(d.options.compression,l.compression),u=d.options.compressionOptions||l.compressionOptions||{},x=d.dir,T=d.date;d._compressWorker(y,u).withStreamInfo("file",{name:g,dir:x,date:T,comment:d.comment||"",unixPermissions:d.unixPermissions,dosPermissions:d.dosPermissions}).pipe(p)}),p.entriesCount=m}catch(g){p.error(g)}return p}},{"../compressions":3,"./ZipFileWorker":8}],10:[function(e,s,a){function r(){if(!(this instanceof r))return new r;if(arguments.length)throw new Error("The constructor with parameters has been removed in JSZip 3.0, please check the upgrade guide.");this.files=Object.create(null),this.comment=null,this.root="",this.clone=function(){var i=new r;for(var o in this)typeof this[o]!="function"&&(i[o]=this[o]);return i}}(r.prototype=e("./object")).loadAsync=e("./load"),r.support=e("./support"),r.defaults=e("./defaults"),r.version="3.10.1",r.loadAsync=function(i,o){return new r().loadAsync(i,o)},r.external=e("./external"),s.exports=r},{"./defaults":5,"./external":6,"./load":11,"./object":15,"./support":30}],11:[function(e,s,a){var r=e("./utils"),i=e("./external"),o=e("./utf8"),l=e("./zipEntries"),c=e("./stream/Crc32Probe"),p=e("./nodejsUtils");function m(g){return new i.Promise(function(d,y){var u=g.decompressed.getContentWorker().pipe(new c);u.on("error",function(x){y(x)}).on("end",function(){u.streamInfo.crc32!==g.decompressed.crc32?y(new Error("Corrupted zip : CRC32 mismatch")):d()}).resume()})}s.exports=function(g,d){var y=this;return d=r.extend(d||{},{base64:!1,checkCRC32:!1,optimizedBinaryString:!1,createFolders:!1,decodeFileName:o.utf8decode}),p.isNode&&p.isStream(g)?i.Promise.reject(new Error("JSZip can't accept a stream when loading a zip file.")):r.prepareContent("the loaded zip file",g,!0,d.optimizedBinaryString,d.base64).then(function(u){var x=new l(d);return x.load(u),x}).then(function(u){var x=[i.Promise.resolve(u)],T=u.files;if(d.checkCRC32)for(var b=0;b<T.length;b++)x.push(m(T[b]));return i.Promise.all(x)}).then(function(u){for(var x=u.shift(),T=x.files,b=0;b<T.length;b++){var S=T[b],E=S.fileNameStr,A=r.resolve(S.fileNameStr);y.file(A,S.decompressed,{binary:!0,optimizedBinaryString:!0,date:S.date,dir:S.dir,comment:S.fileCommentStr.length?S.fileCommentStr:null,unixPermissions:S.unixPermissions,dosPermissions:S.dosPermissions,createFolders:d.createFolders}),S.dir||(y.file(A).unsafeOriginalName=E)}return x.zipComment.length&&(y.comment=x.zipComment),y})}},{"./external":6,"./nodejsUtils":14,"./stream/Crc32Probe":25,"./utf8":31,"./utils":32,"./zipEntries":33}],12:[function(e,s,a){var r=e("../utils"),i=e("../stream/GenericWorker");function o(l,c){i.call(this,"Nodejs stream input adapter for "+l),this._upstreamEnded=!1,this._bindStream(c)}r.inherits(o,i),o.prototype._bindStream=function(l){var c=this;(this._stream=l).pause(),l.on("data",function(p){c.push({data:p,meta:{percent:0}})}).on("error",function(p){c.isPaused?this.generatedError=p:c.error(p)}).on("end",function(){c.isPaused?c._upstreamEnded=!0:c.end()})},o.prototype.pause=function(){return!!i.prototype.pause.call(this)&&(this._stream.pause(),!0)},o.prototype.resume=function(){return!!i.prototype.resume.call(this)&&(this._upstreamEnded?this.end():this._stream.resume(),!0)},s.exports=o},{"../stream/GenericWorker":28,"../utils":32}],13:[function(e,s,a){var r=e("readable-stream").Readable;function i(o,l,c){r.call(this,l),this._helper=o;var p=this;o.on("data",function(m,g){p.push(m)||p._helper.pause(),c&&c(g)}).on("error",function(m){p.emit("error",m)}).on("end",function(){p.push(null)})}e("../utils").inherits(i,r),i.prototype._read=function(){this._helper.resume()},s.exports=i},{"../utils":32,"readable-stream":16}],14:[function(e,s,a){s.exports={isNode:typeof Buffer<"u",newBufferFrom:function(r,i){if(Buffer.from&&Buffer.from!==Uint8Array.from)return Buffer.from(r,i);if(typeof r=="number")throw new Error('The "data" argument must not be a number');return new Buffer(r,i)},allocBuffer:function(r){if(Buffer.alloc)return Buffer.alloc(r);var i=new Buffer(r);return i.fill(0),i},isBuffer:function(r){return Buffer.isBuffer(r)},isStream:function(r){return r&&typeof r.on=="function"&&typeof r.pause=="function"&&typeof r.resume=="function"}}},{}],15:[function(e,s,a){function r(A,w,k){var N,B=o.getTypeOf(w),I=o.extend(k||{},p);I.date=I.date||new Date,I.compression!==null&&(I.compression=I.compression.toUpperCase()),typeof I.unixPermissions=="string"&&(I.unixPermissions=parseInt(I.unixPermissions,8)),I.unixPermissions&&16384&I.unixPermissions&&(I.dir=!0),I.dosPermissions&&16&I.dosPermissions&&(I.dir=!0),I.dir&&(A=T(A)),I.createFolders&&(N=x(A))&&b.call(this,N,!0);var P=B==="string"&&I.binary===!1&&I.base64===!1;k&&k.binary!==void 0||(I.binary=!P),(w instanceof m&&w.uncompressedSize===0||I.dir||!w||w.length===0)&&(I.base64=!1,I.binary=!0,w="",I.compression="STORE",B="string");var v=null;v=w instanceof m||w instanceof l?w:y.isNode&&y.isStream(w)?new u(A,w):o.prepareContent(A,w,I.binary,I.optimizedBinaryString,I.base64);var R=new g(A,v,I);this.files[A]=R}var i=e("./utf8"),o=e("./utils"),l=e("./stream/GenericWorker"),c=e("./stream/StreamHelper"),p=e("./defaults"),m=e("./compressedObject"),g=e("./zipObject"),d=e("./generate"),y=e("./nodejsUtils"),u=e("./nodejs/NodejsStreamInputAdapter"),x=function(A){A.slice(-1)==="/"&&(A=A.substring(0,A.length-1));var w=A.lastIndexOf("/");return 0<w?A.substring(0,w):""},T=function(A){return A.slice(-1)!=="/"&&(A+="/"),A},b=function(A,w){return w=w!==void 0?w:p.createFolders,A=T(A),this.files[A]||r.call(this,A,null,{dir:!0,createFolders:w}),this.files[A]};function S(A){return Object.prototype.toString.call(A)==="[object RegExp]"}var E={load:function(){throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.")},forEach:function(A){var w,k,N;for(w in this.files)N=this.files[w],(k=w.slice(this.root.length,w.length))&&w.slice(0,this.root.length)===this.root&&A(k,N)},filter:function(A){var w=[];return this.forEach(function(k,N){A(k,N)&&w.push(N)}),w},file:function(A,w,k){if(arguments.length!==1)return A=this.root+A,r.call(this,A,w,k),this;if(S(A)){var N=A;return this.filter(function(I,P){return!P.dir&&N.test(I)})}var B=this.files[this.root+A];return B&&!B.dir?B:null},folder:function(A){if(!A)return this;if(S(A))return this.filter(function(B,I){return I.dir&&A.test(B)});var w=this.root+A,k=b.call(this,w),N=this.clone();return N.root=k.name,N},remove:function(A){A=this.root+A;var w=this.files[A];if(w||(A.slice(-1)!=="/"&&(A+="/"),w=this.files[A]),w&&!w.dir)delete this.files[A];else for(var k=this.filter(function(B,I){return I.name.slice(0,A.length)===A}),N=0;N<k.length;N++)delete this.files[k[N].name];return this},generate:function(){throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.")},generateInternalStream:function(A){var w,k={};try{if((k=o.extend(A||{},{streamFiles:!1,compression:"STORE",compressionOptions:null,type:"",platform:"DOS",comment:null,mimeType:"application/zip",encodeFileName:i.utf8encode})).type=k.type.toLowerCase(),k.compression=k.compression.toUpperCase(),k.type==="binarystring"&&(k.type="string"),!k.type)throw new Error("No output type specified.");o.checkSupport(k.type),k.platform!=="darwin"&&k.platform!=="freebsd"&&k.platform!=="linux"&&k.platform!=="sunos"||(k.platform="UNIX"),k.platform==="win32"&&(k.platform="DOS");var N=k.comment||this.comment||"";w=d.generateWorker(this,k,N)}catch(B){(w=new l("error")).error(B)}return new c(w,k.type||"string",k.mimeType)},generateAsync:function(A,w){return this.generateInternalStream(A).accumulate(w)},generateNodeStream:function(A,w){return(A=A||{}).type||(A.type="nodebuffer"),this.generateInternalStream(A).toNodejsStream(w)}};s.exports=E},{"./compressedObject":2,"./defaults":5,"./generate":9,"./nodejs/NodejsStreamInputAdapter":12,"./nodejsUtils":14,"./stream/GenericWorker":28,"./stream/StreamHelper":29,"./utf8":31,"./utils":32,"./zipObject":35}],16:[function(e,s,a){s.exports=e("stream")},{stream:void 0}],17:[function(e,s,a){var r=e("./DataReader");function i(o){r.call(this,o);for(var l=0;l<this.data.length;l++)o[l]=255&o[l]}e("../utils").inherits(i,r),i.prototype.byteAt=function(o){return this.data[this.zero+o]},i.prototype.lastIndexOfSignature=function(o){for(var l=o.charCodeAt(0),c=o.charCodeAt(1),p=o.charCodeAt(2),m=o.charCodeAt(3),g=this.length-4;0<=g;--g)if(this.data[g]===l&&this.data[g+1]===c&&this.data[g+2]===p&&this.data[g+3]===m)return g-this.zero;return-1},i.prototype.readAndCheckSignature=function(o){var l=o.charCodeAt(0),c=o.charCodeAt(1),p=o.charCodeAt(2),m=o.charCodeAt(3),g=this.readData(4);return l===g[0]&&c===g[1]&&p===g[2]&&m===g[3]},i.prototype.readData=function(o){if(this.checkOffset(o),o===0)return[];var l=this.data.slice(this.zero+this.index,this.zero+this.index+o);return this.index+=o,l},s.exports=i},{"../utils":32,"./DataReader":18}],18:[function(e,s,a){var r=e("../utils");function i(o){this.data=o,this.length=o.length,this.index=0,this.zero=0}i.prototype={checkOffset:function(o){this.checkIndex(this.index+o)},checkIndex:function(o){if(this.length<this.zero+o||o<0)throw new Error("End of data reached (data length = "+this.length+", asked index = "+o+"). Corrupted zip ?")},setIndex:function(o){this.checkIndex(o),this.index=o},skip:function(o){this.setIndex(this.index+o)},byteAt:function(){},readInt:function(o){var l,c=0;for(this.checkOffset(o),l=this.index+o-1;l>=this.index;l--)c=(c<<8)+this.byteAt(l);return this.index+=o,c},readString:function(o){return r.transformTo("string",this.readData(o))},readData:function(){},lastIndexOfSignature:function(){},readAndCheckSignature:function(){},readDate:function(){var o=this.readInt(4);return new Date(Date.UTC(1980+(o>>25&127),(o>>21&15)-1,o>>16&31,o>>11&31,o>>5&63,(31&o)<<1))}},s.exports=i},{"../utils":32}],19:[function(e,s,a){var r=e("./Uint8ArrayReader");function i(o){r.call(this,o)}e("../utils").inherits(i,r),i.prototype.readData=function(o){this.checkOffset(o);var l=this.data.slice(this.zero+this.index,this.zero+this.index+o);return this.index+=o,l},s.exports=i},{"../utils":32,"./Uint8ArrayReader":21}],20:[function(e,s,a){var r=e("./DataReader");function i(o){r.call(this,o)}e("../utils").inherits(i,r),i.prototype.byteAt=function(o){return this.data.charCodeAt(this.zero+o)},i.prototype.lastIndexOfSignature=function(o){return this.data.lastIndexOf(o)-this.zero},i.prototype.readAndCheckSignature=function(o){return o===this.readData(4)},i.prototype.readData=function(o){this.checkOffset(o);var l=this.data.slice(this.zero+this.index,this.zero+this.index+o);return this.index+=o,l},s.exports=i},{"../utils":32,"./DataReader":18}],21:[function(e,s,a){var r=e("./ArrayReader");function i(o){r.call(this,o)}e("../utils").inherits(i,r),i.prototype.readData=function(o){if(this.checkOffset(o),o===0)return new Uint8Array(0);var l=this.data.subarray(this.zero+this.index,this.zero+this.index+o);return this.index+=o,l},s.exports=i},{"../utils":32,"./ArrayReader":17}],22:[function(e,s,a){var r=e("../utils"),i=e("../support"),o=e("./ArrayReader"),l=e("./StringReader"),c=e("./NodeBufferReader"),p=e("./Uint8ArrayReader");s.exports=function(m){var g=r.getTypeOf(m);return r.checkSupport(g),g!=="string"||i.uint8array?g==="nodebuffer"?new c(m):i.uint8array?new p(r.transformTo("uint8array",m)):new o(r.transformTo("array",m)):new l(m)}},{"../support":30,"../utils":32,"./ArrayReader":17,"./NodeBufferReader":19,"./StringReader":20,"./Uint8ArrayReader":21}],23:[function(e,s,a){a.LOCAL_FILE_HEADER="PK",a.CENTRAL_FILE_HEADER="PK",a.CENTRAL_DIRECTORY_END="PK",a.ZIP64_CENTRAL_DIRECTORY_LOCATOR="PK\x07",a.ZIP64_CENTRAL_DIRECTORY_END="PK",a.DATA_DESCRIPTOR="PK\x07\b"},{}],24:[function(e,s,a){var r=e("./GenericWorker"),i=e("../utils");function o(l){r.call(this,"ConvertWorker to "+l),this.destType=l}i.inherits(o,r),o.prototype.processChunk=function(l){this.push({data:i.transformTo(this.destType,l.data),meta:l.meta})},s.exports=o},{"../utils":32,"./GenericWorker":28}],25:[function(e,s,a){var r=e("./GenericWorker"),i=e("../crc32");function o(){r.call(this,"Crc32Probe"),this.withStreamInfo("crc32",0)}e("../utils").inherits(o,r),o.prototype.processChunk=function(l){this.streamInfo.crc32=i(l.data,this.streamInfo.crc32||0),this.push(l)},s.exports=o},{"../crc32":4,"../utils":32,"./GenericWorker":28}],26:[function(e,s,a){var r=e("../utils"),i=e("./GenericWorker");function o(l){i.call(this,"DataLengthProbe for "+l),this.propName=l,this.withStreamInfo(l,0)}r.inherits(o,i),o.prototype.processChunk=function(l){if(l){var c=this.streamInfo[this.propName]||0;this.streamInfo[this.propName]=c+l.data.length}i.prototype.processChunk.call(this,l)},s.exports=o},{"../utils":32,"./GenericWorker":28}],27:[function(e,s,a){var r=e("../utils"),i=e("./GenericWorker");function o(l){i.call(this,"DataWorker");var c=this;this.dataIsReady=!1,this.index=0,this.max=0,this.data=null,this.type="",this._tickScheduled=!1,l.then(function(p){c.dataIsReady=!0,c.data=p,c.max=p&&p.length||0,c.type=r.getTypeOf(p),c.isPaused||c._tickAndRepeat()},function(p){c.error(p)})}r.inherits(o,i),o.prototype.cleanUp=function(){i.prototype.cleanUp.call(this),this.data=null},o.prototype.resume=function(){return!!i.prototype.resume.call(this)&&(!this._tickScheduled&&this.dataIsReady&&(this._tickScheduled=!0,r.delay(this._tickAndRepeat,[],this)),!0)},o.prototype._tickAndRepeat=function(){this._tickScheduled=!1,this.isPaused||this.isFinished||(this._tick(),this.isFinished||(r.delay(this._tickAndRepeat,[],this),this._tickScheduled=!0))},o.prototype._tick=function(){if(this.isPaused||this.isFinished)return!1;var l=null,c=Math.min(this.max,this.index+16384);if(this.index>=this.max)return this.end();switch(this.type){case"string":l=this.data.substring(this.index,c);break;case"uint8array":l=this.data.subarray(this.index,c);break;case"array":case"nodebuffer":l=this.data.slice(this.index,c)}return this.index=c,this.push({data:l,meta:{percent:this.max?this.index/this.max*100:0}})},s.exports=o},{"../utils":32,"./GenericWorker":28}],28:[function(e,s,a){function r(i){this.name=i||"default",this.streamInfo={},this.generatedError=null,this.extraStreamInfo={},this.isPaused=!0,this.isFinished=!1,this.isLocked=!1,this._listeners={data:[],end:[],error:[]},this.previous=null}r.prototype={push:function(i){this.emit("data",i)},end:function(){if(this.isFinished)return!1;this.flush();try{this.emit("end"),this.cleanUp(),this.isFinished=!0}catch(i){this.emit("error",i)}return!0},error:function(i){return!this.isFinished&&(this.isPaused?this.generatedError=i:(this.isFinished=!0,this.emit("error",i),this.previous&&this.previous.error(i),this.cleanUp()),!0)},on:function(i,o){return this._listeners[i].push(o),this},cleanUp:function(){this.streamInfo=this.generatedError=this.extraStreamInfo=null,this._listeners=[]},emit:function(i,o){if(this._listeners[i])for(var l=0;l<this._listeners[i].length;l++)this._listeners[i][l].call(this,o)},pipe:function(i){return i.registerPrevious(this)},registerPrevious:function(i){if(this.isLocked)throw new Error("The stream '"+this+"' has already been used.");this.streamInfo=i.streamInfo,this.mergeStreamInfo(),this.previous=i;var o=this;return i.on("data",function(l){o.processChunk(l)}),i.on("end",function(){o.end()}),i.on("error",function(l){o.error(l)}),this},pause:function(){return!this.isPaused&&!this.isFinished&&(this.isPaused=!0,this.previous&&this.previous.pause(),!0)},resume:function(){if(!this.isPaused||this.isFinished)return!1;var i=this.isPaused=!1;return this.generatedError&&(this.error(this.generatedError),i=!0),this.previous&&this.previous.resume(),!i},flush:function(){},processChunk:function(i){this.push(i)},withStreamInfo:function(i,o){return this.extraStreamInfo[i]=o,this.mergeStreamInfo(),this},mergeStreamInfo:function(){for(var i in this.extraStreamInfo)Object.prototype.hasOwnProperty.call(this.extraStreamInfo,i)&&(this.streamInfo[i]=this.extraStreamInfo[i])},lock:function(){if(this.isLocked)throw new Error("The stream '"+this+"' has already been used.");this.isLocked=!0,this.previous&&this.previous.lock()},toString:function(){var i="Worker "+this.name;return this.previous?this.previous+" -> "+i:i}},s.exports=r},{}],29:[function(e,s,a){var r=e("../utils"),i=e("./ConvertWorker"),o=e("./GenericWorker"),l=e("../base64"),c=e("../support"),p=e("../external"),m=null;if(c.nodestream)try{m=e("../nodejs/NodejsStreamOutputAdapter")}catch{}function g(y,u){return new p.Promise(function(x,T){var b=[],S=y._internalType,E=y._outputType,A=y._mimeType;y.on("data",function(w,k){b.push(w),u&&u(k)}).on("error",function(w){b=[],T(w)}).on("end",function(){try{var w=(function(k,N,B){switch(k){case"blob":return r.newBlob(r.transformTo("arraybuffer",N),B);case"base64":return l.encode(N);default:return r.transformTo(k,N)}})(E,(function(k,N){var B,I=0,P=null,v=0;for(B=0;B<N.length;B++)v+=N[B].length;switch(k){case"string":return N.join("");case"array":return Array.prototype.concat.apply([],N);case"uint8array":for(P=new Uint8Array(v),B=0;B<N.length;B++)P.set(N[B],I),I+=N[B].length;return P;case"nodebuffer":return Buffer.concat(N);default:throw new Error("concat : unsupported type '"+k+"'")}})(S,b),A);x(w)}catch(k){T(k)}b=[]}).resume()})}function d(y,u,x){var T=u;switch(u){case"blob":case"arraybuffer":T="uint8array";break;case"base64":T="string"}try{this._internalType=T,this._outputType=u,this._mimeType=x,r.checkSupport(T),this._worker=y.pipe(new i(T)),y.lock()}catch(b){this._worker=new o("error"),this._worker.error(b)}}d.prototype={accumulate:function(y){return g(this,y)},on:function(y,u){var x=this;return y==="data"?this._worker.on(y,function(T){u.call(x,T.data,T.meta)}):this._worker.on(y,function(){r.delay(u,arguments,x)}),this},resume:function(){return r.delay(this._worker.resume,[],this._worker),this},pause:function(){return this._worker.pause(),this},toNodejsStream:function(y){if(r.checkSupport("nodestream"),this._outputType!=="nodebuffer")throw new Error(this._outputType+" is not supported by this method");return new m(this,{objectMode:this._outputType!=="nodebuffer"},y)}},s.exports=d},{"../base64":1,"../external":6,"../nodejs/NodejsStreamOutputAdapter":13,"../support":30,"../utils":32,"./ConvertWorker":24,"./GenericWorker":28}],30:[function(e,s,a){if(a.base64=!0,a.array=!0,a.string=!0,a.arraybuffer=typeof ArrayBuffer<"u"&&typeof Uint8Array<"u",a.nodebuffer=typeof Buffer<"u",a.uint8array=typeof Uint8Array<"u",typeof ArrayBuffer>"u")a.blob=!1;else{var r=new ArrayBuffer(0);try{a.blob=new Blob([r],{type:"application/zip"}).size===0}catch{try{var i=new(self.BlobBuilder||self.WebKitBlobBuilder||self.MozBlobBuilder||self.MSBlobBuilder);i.append(r),a.blob=i.getBlob("application/zip").size===0}catch{a.blob=!1}}}try{a.nodestream=!!e("readable-stream").Readable}catch{a.nodestream=!1}},{"readable-stream":16}],31:[function(e,s,a){for(var r=e("./utils"),i=e("./support"),o=e("./nodejsUtils"),l=e("./stream/GenericWorker"),c=new Array(256),p=0;p<256;p++)c[p]=252<=p?6:248<=p?5:240<=p?4:224<=p?3:192<=p?2:1;c[254]=c[254]=1;function m(){l.call(this,"utf-8 decode"),this.leftOver=null}function g(){l.call(this,"utf-8 encode")}a.utf8encode=function(d){return i.nodebuffer?o.newBufferFrom(d,"utf-8"):(function(y){var u,x,T,b,S,E=y.length,A=0;for(b=0;b<E;b++)(64512&(x=y.charCodeAt(b)))==55296&&b+1<E&&(64512&(T=y.charCodeAt(b+1)))==56320&&(x=65536+(x-55296<<10)+(T-56320),b++),A+=x<128?1:x<2048?2:x<65536?3:4;for(u=i.uint8array?new Uint8Array(A):new Array(A),b=S=0;S<A;b++)(64512&(x=y.charCodeAt(b)))==55296&&b+1<E&&(64512&(T=y.charCodeAt(b+1)))==56320&&(x=65536+(x-55296<<10)+(T-56320),b++),x<128?u[S++]=x:(x<2048?u[S++]=192|x>>>6:(x<65536?u[S++]=224|x>>>12:(u[S++]=240|x>>>18,u[S++]=128|x>>>12&63),u[S++]=128|x>>>6&63),u[S++]=128|63&x);return u})(d)},a.utf8decode=function(d){return i.nodebuffer?r.transformTo("nodebuffer",d).toString("utf-8"):(function(y){var u,x,T,b,S=y.length,E=new Array(2*S);for(u=x=0;u<S;)if((T=y[u++])<128)E[x++]=T;else if(4<(b=c[T]))E[x++]=65533,u+=b-1;else{for(T&=b===2?31:b===3?15:7;1<b&&u<S;)T=T<<6|63&y[u++],b--;1<b?E[x++]=65533:T<65536?E[x++]=T:(T-=65536,E[x++]=55296|T>>10&1023,E[x++]=56320|1023&T)}return E.length!==x&&(E.subarray?E=E.subarray(0,x):E.length=x),r.applyFromCharCode(E)})(d=r.transformTo(i.uint8array?"uint8array":"array",d))},r.inherits(m,l),m.prototype.processChunk=function(d){var y=r.transformTo(i.uint8array?"uint8array":"array",d.data);if(this.leftOver&&this.leftOver.length){if(i.uint8array){var u=y;(y=new Uint8Array(u.length+this.leftOver.length)).set(this.leftOver,0),y.set(u,this.leftOver.length)}else y=this.leftOver.concat(y);this.leftOver=null}var x=(function(b,S){var E;for((S=S||b.length)>b.length&&(S=b.length),E=S-1;0<=E&&(192&b[E])==128;)E--;return E<0||E===0?S:E+c[b[E]]>S?E:S})(y),T=y;x!==y.length&&(i.uint8array?(T=y.subarray(0,x),this.leftOver=y.subarray(x,y.length)):(T=y.slice(0,x),this.leftOver=y.slice(x,y.length))),this.push({data:a.utf8decode(T),meta:d.meta})},m.prototype.flush=function(){this.leftOver&&this.leftOver.length&&(this.push({data:a.utf8decode(this.leftOver),meta:{}}),this.leftOver=null)},a.Utf8DecodeWorker=m,r.inherits(g,l),g.prototype.processChunk=function(d){this.push({data:a.utf8encode(d.data),meta:d.meta})},a.Utf8EncodeWorker=g},{"./nodejsUtils":14,"./stream/GenericWorker":28,"./support":30,"./utils":32}],32:[function(e,s,a){var r=e("./support"),i=e("./base64"),o=e("./nodejsUtils"),l=e("./external");function c(u){return u}function p(u,x){for(var T=0;T<u.length;++T)x[T]=255&u.charCodeAt(T);return x}e("setimmediate"),a.newBlob=function(u,x){a.checkSupport("blob");try{return new Blob([u],{type:x})}catch{try{var T=new(self.BlobBuilder||self.WebKitBlobBuilder||self.MozBlobBuilder||self.MSBlobBuilder);return T.append(u),T.getBlob(x)}catch{throw new Error("Bug : can't construct the Blob.")}}};var m={stringifyByChunk:function(u,x,T){var b=[],S=0,E=u.length;if(E<=T)return String.fromCharCode.apply(null,u);for(;S<E;)x==="array"||x==="nodebuffer"?b.push(String.fromCharCode.apply(null,u.slice(S,Math.min(S+T,E)))):b.push(String.fromCharCode.apply(null,u.subarray(S,Math.min(S+T,E)))),S+=T;return b.join("")},stringifyByChar:function(u){for(var x="",T=0;T<u.length;T++)x+=String.fromCharCode(u[T]);return x},applyCanBeUsed:{uint8array:(function(){try{return r.uint8array&&String.fromCharCode.apply(null,new Uint8Array(1)).length===1}catch{return!1}})(),nodebuffer:(function(){try{return r.nodebuffer&&String.fromCharCode.apply(null,o.allocBuffer(1)).length===1}catch{return!1}})()}};function g(u){var x=65536,T=a.getTypeOf(u),b=!0;if(T==="uint8array"?b=m.applyCanBeUsed.uint8array:T==="nodebuffer"&&(b=m.applyCanBeUsed.nodebuffer),b)for(;1<x;)try{return m.stringifyByChunk(u,T,x)}catch{x=Math.floor(x/2)}return m.stringifyByChar(u)}function d(u,x){for(var T=0;T<u.length;T++)x[T]=u[T];return x}a.applyFromCharCode=g;var y={};y.string={string:c,array:function(u){return p(u,new Array(u.length))},arraybuffer:function(u){return y.string.uint8array(u).buffer},uint8array:function(u){return p(u,new Uint8Array(u.length))},nodebuffer:function(u){return p(u,o.allocBuffer(u.length))}},y.array={string:g,array:c,arraybuffer:function(u){return new Uint8Array(u).buffer},uint8array:function(u){return new Uint8Array(u)},nodebuffer:function(u){return o.newBufferFrom(u)}},y.arraybuffer={string:function(u){return g(new Uint8Array(u))},array:function(u){return d(new Uint8Array(u),new Array(u.byteLength))},arraybuffer:c,uint8array:function(u){return new Uint8Array(u)},nodebuffer:function(u){return o.newBufferFrom(new Uint8Array(u))}},y.uint8array={string:g,array:function(u){return d(u,new Array(u.length))},arraybuffer:function(u){return u.buffer},uint8array:c,nodebuffer:function(u){return o.newBufferFrom(u)}},y.nodebuffer={string:g,array:function(u){return d(u,new Array(u.length))},arraybuffer:function(u){return y.nodebuffer.uint8array(u).buffer},uint8array:function(u){return d(u,new Uint8Array(u.length))},nodebuffer:c},a.transformTo=function(u,x){if(x=x||"",!u)return x;a.checkSupport(u);var T=a.getTypeOf(x);return y[T][u](x)},a.resolve=function(u){for(var x=u.split("/"),T=[],b=0;b<x.length;b++){var S=x[b];S==="."||S===""&&b!==0&&b!==x.length-1||(S===".."?T.pop():T.push(S))}return T.join("/")},a.getTypeOf=function(u){return typeof u=="string"?"string":Object.prototype.toString.call(u)==="[object Array]"?"array":r.nodebuffer&&o.isBuffer(u)?"nodebuffer":r.uint8array&&u instanceof Uint8Array?"uint8array":r.arraybuffer&&u instanceof ArrayBuffer?"arraybuffer":void 0},a.checkSupport=function(u){if(!r[u.toLowerCase()])throw new Error(u+" is not supported by this platform")},a.MAX_VALUE_16BITS=65535,a.MAX_VALUE_32BITS=-1,a.pretty=function(u){var x,T,b="";for(T=0;T<(u||"").length;T++)b+="\\x"+((x=u.charCodeAt(T))<16?"0":"")+x.toString(16).toUpperCase();return b},a.delay=function(u,x,T){setImmediate(function(){u.apply(T||null,x||[])})},a.inherits=function(u,x){function T(){}T.prototype=x.prototype,u.prototype=new T},a.extend=function(){var u,x,T={};for(u=0;u<arguments.length;u++)for(x in arguments[u])Object.prototype.hasOwnProperty.call(arguments[u],x)&&T[x]===void 0&&(T[x]=arguments[u][x]);return T},a.prepareContent=function(u,x,T,b,S){return l.Promise.resolve(x).then(function(E){return r.blob&&(E instanceof Blob||["[object File]","[object Blob]"].indexOf(Object.prototype.toString.call(E))!==-1)&&typeof FileReader<"u"?new l.Promise(function(A,w){var k=new FileReader;k.onload=function(N){A(N.target.result)},k.onerror=function(N){w(N.target.error)},k.readAsArrayBuffer(E)}):E}).then(function(E){var A=a.getTypeOf(E);return A?(A==="arraybuffer"?E=a.transformTo("uint8array",E):A==="string"&&(S?E=i.decode(E):T&&b!==!0&&(E=(function(w){return p(w,r.uint8array?new Uint8Array(w.length):new Array(w.length))})(E))),E):l.Promise.reject(new Error("Can't read the data of '"+u+"'. Is it in a supported JavaScript type (String, Blob, ArrayBuffer, etc) ?"))})}},{"./base64":1,"./external":6,"./nodejsUtils":14,"./support":30,setimmediate:54}],33:[function(e,s,a){var r=e("./reader/readerFor"),i=e("./utils"),o=e("./signature"),l=e("./zipEntry"),c=e("./support");function p(m){this.files=[],this.loadOptions=m}p.prototype={checkSignature:function(m){if(!this.reader.readAndCheckSignature(m)){this.reader.index-=4;var g=this.reader.readString(4);throw new Error("Corrupted zip or bug: unexpected signature ("+i.pretty(g)+", expected "+i.pretty(m)+")")}},isSignature:function(m,g){var d=this.reader.index;this.reader.setIndex(m);var y=this.reader.readString(4)===g;return this.reader.setIndex(d),y},readBlockEndOfCentral:function(){this.diskNumber=this.reader.readInt(2),this.diskWithCentralDirStart=this.reader.readInt(2),this.centralDirRecordsOnThisDisk=this.reader.readInt(2),this.centralDirRecords=this.reader.readInt(2),this.centralDirSize=this.reader.readInt(4),this.centralDirOffset=this.reader.readInt(4),this.zipCommentLength=this.reader.readInt(2);var m=this.reader.readData(this.zipCommentLength),g=c.uint8array?"uint8array":"array",d=i.transformTo(g,m);this.zipComment=this.loadOptions.decodeFileName(d)},readBlockZip64EndOfCentral:function(){this.zip64EndOfCentralSize=this.reader.readInt(8),this.reader.skip(4),this.diskNumber=this.reader.readInt(4),this.diskWithCentralDirStart=this.reader.readInt(4),this.centralDirRecordsOnThisDisk=this.reader.readInt(8),this.centralDirRecords=this.reader.readInt(8),this.centralDirSize=this.reader.readInt(8),this.centralDirOffset=this.reader.readInt(8),this.zip64ExtensibleData={};for(var m,g,d,y=this.zip64EndOfCentralSize-44;0<y;)m=this.reader.readInt(2),g=this.reader.readInt(4),d=this.reader.readData(g),this.zip64ExtensibleData[m]={id:m,length:g,value:d}},readBlockZip64EndOfCentralLocator:function(){if(this.diskWithZip64CentralDirStart=this.reader.readInt(4),this.relativeOffsetEndOfZip64CentralDir=this.reader.readInt(8),this.disksCount=this.reader.readInt(4),1<this.disksCount)throw new Error("Multi-volumes zip are not supported")},readLocalFiles:function(){var m,g;for(m=0;m<this.files.length;m++)g=this.files[m],this.reader.setIndex(g.localHeaderOffset),this.checkSignature(o.LOCAL_FILE_HEADER),g.readLocalPart(this.reader),g.handleUTF8(),g.processAttributes()},readCentralDir:function(){var m;for(this.reader.setIndex(this.centralDirOffset);this.reader.readAndCheckSignature(o.CENTRAL_FILE_HEADER);)(m=new l({zip64:this.zip64},this.loadOptions)).readCentralPart(this.reader),this.files.push(m);if(this.centralDirRecords!==this.files.length&&this.centralDirRecords!==0&&this.files.length===0)throw new Error("Corrupted zip or bug: expected "+this.centralDirRecords+" records in central dir, got "+this.files.length)},readEndOfCentral:function(){var m=this.reader.lastIndexOfSignature(o.CENTRAL_DIRECTORY_END);if(m<0)throw this.isSignature(0,o.LOCAL_FILE_HEADER)?new Error("Corrupted zip: can't find end of central directory"):new Error("Can't find end of central directory : is this a zip file ? If it is, see https://stuk.github.io/jszip/documentation/howto/read_zip.html");this.reader.setIndex(m);var g=m;if(this.checkSignature(o.CENTRAL_DIRECTORY_END),this.readBlockEndOfCentral(),this.diskNumber===i.MAX_VALUE_16BITS||this.diskWithCentralDirStart===i.MAX_VALUE_16BITS||this.centralDirRecordsOnThisDisk===i.MAX_VALUE_16BITS||this.centralDirRecords===i.MAX_VALUE_16BITS||this.centralDirSize===i.MAX_VALUE_32BITS||this.centralDirOffset===i.MAX_VALUE_32BITS){if(this.zip64=!0,(m=this.reader.lastIndexOfSignature(o.ZIP64_CENTRAL_DIRECTORY_LOCATOR))<0)throw new Error("Corrupted zip: can't find the ZIP64 end of central directory locator");if(this.reader.setIndex(m),this.checkSignature(o.ZIP64_CENTRAL_DIRECTORY_LOCATOR),this.readBlockZip64EndOfCentralLocator(),!this.isSignature(this.relativeOffsetEndOfZip64CentralDir,o.ZIP64_CENTRAL_DIRECTORY_END)&&(this.relativeOffsetEndOfZip64CentralDir=this.reader.lastIndexOfSignature(o.ZIP64_CENTRAL_DIRECTORY_END),this.relativeOffsetEndOfZip64CentralDir<0))throw new Error("Corrupted zip: can't find the ZIP64 end of central directory");this.reader.setIndex(this.relativeOffsetEndOfZip64CentralDir),this.checkSignature(o.ZIP64_CENTRAL_DIRECTORY_END),this.readBlockZip64EndOfCentral()}var d=this.centralDirOffset+this.centralDirSize;this.zip64&&(d+=20,d+=12+this.zip64EndOfCentralSize);var y=g-d;if(0<y)this.isSignature(g,o.CENTRAL_FILE_HEADER)||(this.reader.zero=y);else if(y<0)throw new Error("Corrupted zip: missing "+Math.abs(y)+" bytes.")},prepareReader:function(m){this.reader=r(m)},load:function(m){this.prepareReader(m),this.readEndOfCentral(),this.readCentralDir(),this.readLocalFiles()}},s.exports=p},{"./reader/readerFor":22,"./signature":23,"./support":30,"./utils":32,"./zipEntry":34}],34:[function(e,s,a){var r=e("./reader/readerFor"),i=e("./utils"),o=e("./compressedObject"),l=e("./crc32"),c=e("./utf8"),p=e("./compressions"),m=e("./support");function g(d,y){this.options=d,this.loadOptions=y}g.prototype={isEncrypted:function(){return(1&this.bitFlag)==1},useUTF8:function(){return(2048&this.bitFlag)==2048},readLocalPart:function(d){var y,u;if(d.skip(22),this.fileNameLength=d.readInt(2),u=d.readInt(2),this.fileName=d.readData(this.fileNameLength),d.skip(u),this.compressedSize===-1||this.uncompressedSize===-1)throw new Error("Bug or corrupted zip : didn't get enough information from the central directory (compressedSize === -1 || uncompressedSize === -1)");if((y=(function(x){for(var T in p)if(Object.prototype.hasOwnProperty.call(p,T)&&p[T].magic===x)return p[T];return null})(this.compressionMethod))===null)throw new Error("Corrupted zip : compression "+i.pretty(this.compressionMethod)+" unknown (inner file : "+i.transformTo("string",this.fileName)+")");this.decompressed=new o(this.compressedSize,this.uncompressedSize,this.crc32,y,d.readData(this.compressedSize))},readCentralPart:function(d){this.versionMadeBy=d.readInt(2),d.skip(2),this.bitFlag=d.readInt(2),this.compressionMethod=d.readString(2),this.date=d.readDate(),this.crc32=d.readInt(4),this.compressedSize=d.readInt(4),this.uncompressedSize=d.readInt(4);var y=d.readInt(2);if(this.extraFieldsLength=d.readInt(2),this.fileCommentLength=d.readInt(2),this.diskNumberStart=d.readInt(2),this.internalFileAttributes=d.readInt(2),this.externalFileAttributes=d.readInt(4),this.localHeaderOffset=d.readInt(4),this.isEncrypted())throw new Error("Encrypted zip are not supported");d.skip(y),this.readExtraFields(d),this.parseZIP64ExtraField(d),this.fileComment=d.readData(this.fileCommentLength)},processAttributes:function(){this.unixPermissions=null,this.dosPermissions=null;var d=this.versionMadeBy>>8;this.dir=!!(16&this.externalFileAttributes),d==0&&(this.dosPermissions=63&this.externalFileAttributes),d==3&&(this.unixPermissions=this.externalFileAttributes>>16&65535),this.dir||this.fileNameStr.slice(-1)!=="/"||(this.dir=!0)},parseZIP64ExtraField:function(){if(this.extraFields[1]){var d=r(this.extraFields[1].value);this.uncompressedSize===i.MAX_VALUE_32BITS&&(this.uncompressedSize=d.readInt(8)),this.compressedSize===i.MAX_VALUE_32BITS&&(this.compressedSize=d.readInt(8)),this.localHeaderOffset===i.MAX_VALUE_32BITS&&(this.localHeaderOffset=d.readInt(8)),this.diskNumberStart===i.MAX_VALUE_32BITS&&(this.diskNumberStart=d.readInt(4))}},readExtraFields:function(d){var y,u,x,T=d.index+this.extraFieldsLength;for(this.extraFields||(this.extraFields={});d.index+4<T;)y=d.readInt(2),u=d.readInt(2),x=d.readData(u),this.extraFields[y]={id:y,length:u,value:x};d.setIndex(T)},handleUTF8:function(){var d=m.uint8array?"uint8array":"array";if(this.useUTF8())this.fileNameStr=c.utf8decode(this.fileName),this.fileCommentStr=c.utf8decode(this.fileComment);else{var y=this.findExtraFieldUnicodePath();if(y!==null)this.fileNameStr=y;else{var u=i.transformTo(d,this.fileName);this.fileNameStr=this.loadOptions.decodeFileName(u)}var x=this.findExtraFieldUnicodeComment();if(x!==null)this.fileCommentStr=x;else{var T=i.transformTo(d,this.fileComment);this.fileCommentStr=this.loadOptions.decodeFileName(T)}}},findExtraFieldUnicodePath:function(){var d=this.extraFields[28789];if(d){var y=r(d.value);return y.readInt(1)!==1||l(this.fileName)!==y.readInt(4)?null:c.utf8decode(y.readData(d.length-5))}return null},findExtraFieldUnicodeComment:function(){var d=this.extraFields[25461];if(d){var y=r(d.value);return y.readInt(1)!==1||l(this.fileComment)!==y.readInt(4)?null:c.utf8decode(y.readData(d.length-5))}return null}},s.exports=g},{"./compressedObject":2,"./compressions":3,"./crc32":4,"./reader/readerFor":22,"./support":30,"./utf8":31,"./utils":32}],35:[function(e,s,a){function r(y,u,x){this.name=y,this.dir=x.dir,this.date=x.date,this.comment=x.comment,this.unixPermissions=x.unixPermissions,this.dosPermissions=x.dosPermissions,this._data=u,this._dataBinary=x.binary,this.options={compression:x.compression,compressionOptions:x.compressionOptions}}var i=e("./stream/StreamHelper"),o=e("./stream/DataWorker"),l=e("./utf8"),c=e("./compressedObject"),p=e("./stream/GenericWorker");r.prototype={internalStream:function(y){var u=null,x="string";try{if(!y)throw new Error("No output type specified.");var T=(x=y.toLowerCase())==="string"||x==="text";x!=="binarystring"&&x!=="text"||(x="string"),u=this._decompressWorker();var b=!this._dataBinary;b&&!T&&(u=u.pipe(new l.Utf8EncodeWorker)),!b&&T&&(u=u.pipe(new l.Utf8DecodeWorker))}catch(S){(u=new p("error")).error(S)}return new i(u,x,"")},async:function(y,u){return this.internalStream(y).accumulate(u)},nodeStream:function(y,u){return this.internalStream(y||"nodebuffer").toNodejsStream(u)},_compressWorker:function(y,u){if(this._data instanceof c&&this._data.compression.magic===y.magic)return this._data.getCompressedWorker();var x=this._decompressWorker();return this._dataBinary||(x=x.pipe(new l.Utf8EncodeWorker)),c.createWorkerFrom(x,y,u)},_decompressWorker:function(){return this._data instanceof c?this._data.getContentWorker():this._data instanceof p?this._data:new o(this._data)}};for(var m=["asText","asBinary","asNodeBuffer","asUint8Array","asArrayBuffer"],g=function(){throw new Error("This method has been removed in JSZip 3.0, please check the upgrade guide.")},d=0;d<m.length;d++)r.prototype[m[d]]=g;s.exports=r},{"./compressedObject":2,"./stream/DataWorker":27,"./stream/GenericWorker":28,"./stream/StreamHelper":29,"./utf8":31}],36:[function(e,s,a){(function(r){var i,o,l=r.MutationObserver||r.WebKitMutationObserver;if(l){var c=0,p=new l(y),m=r.document.createTextNode("");p.observe(m,{characterData:!0}),i=function(){m.data=c=++c%2}}else if(r.setImmediate||r.MessageChannel===void 0)i="document"in r&&"onreadystatechange"in r.document.createElement("script")?function(){var u=r.document.createElement("script");u.onreadystatechange=function(){y(),u.onreadystatechange=null,u.parentNode.removeChild(u),u=null},r.document.documentElement.appendChild(u)}:function(){setTimeout(y,0)};else{var g=new r.MessageChannel;g.port1.onmessage=y,i=function(){g.port2.postMessage(0)}}var d=[];function y(){var u,x;o=!0;for(var T=d.length;T;){for(x=d,d=[],u=-1;++u<T;)x[u]();T=d.length}o=!1}s.exports=function(u){d.push(u)!==1||o||i()}}).call(this,typeof ve<"u"?ve:typeof self<"u"?self:typeof window<"u"?window:{})},{}],37:[function(e,s,a){var r=e("immediate");function i(){}var o={},l=["REJECTED"],c=["FULFILLED"],p=["PENDING"];function m(T){if(typeof T!="function")throw new TypeError("resolver must be a function");this.state=p,this.queue=[],this.outcome=void 0,T!==i&&u(this,T)}function g(T,b,S){this.promise=T,typeof b=="function"&&(this.onFulfilled=b,this.callFulfilled=this.otherCallFulfilled),typeof S=="function"&&(this.onRejected=S,this.callRejected=this.otherCallRejected)}function d(T,b,S){r(function(){var E;try{E=b(S)}catch(A){return o.reject(T,A)}E===T?o.reject(T,new TypeError("Cannot resolve promise with itself")):o.resolve(T,E)})}function y(T){var b=T&&T.then;if(T&&(typeof T=="object"||typeof T=="function")&&typeof b=="function")return function(){b.apply(T,arguments)}}function u(T,b){var S=!1;function E(k){S||(S=!0,o.reject(T,k))}function A(k){S||(S=!0,o.resolve(T,k))}var w=x(function(){b(A,E)});w.status==="error"&&E(w.value)}function x(T,b){var S={};try{S.value=T(b),S.status="success"}catch(E){S.status="error",S.value=E}return S}(s.exports=m).prototype.finally=function(T){if(typeof T!="function")return this;var b=this.constructor;return this.then(function(S){return b.resolve(T()).then(function(){return S})},function(S){return b.resolve(T()).then(function(){throw S})})},m.prototype.catch=function(T){return this.then(null,T)},m.prototype.then=function(T,b){if(typeof T!="function"&&this.state===c||typeof b!="function"&&this.state===l)return this;var S=new this.constructor(i);return this.state!==p?d(S,this.state===c?T:b,this.outcome):this.queue.push(new g(S,T,b)),S},g.prototype.callFulfilled=function(T){o.resolve(this.promise,T)},g.prototype.otherCallFulfilled=function(T){d(this.promise,this.onFulfilled,T)},g.prototype.callRejected=function(T){o.reject(this.promise,T)},g.prototype.otherCallRejected=function(T){d(this.promise,this.onRejected,T)},o.resolve=function(T,b){var S=x(y,b);if(S.status==="error")return o.reject(T,S.value);var E=S.value;if(E)u(T,E);else{T.state=c,T.outcome=b;for(var A=-1,w=T.queue.length;++A<w;)T.queue[A].callFulfilled(b)}return T},o.reject=function(T,b){T.state=l,T.outcome=b;for(var S=-1,E=T.queue.length;++S<E;)T.queue[S].callRejected(b);return T},m.resolve=function(T){return T instanceof this?T:o.resolve(new this(i),T)},m.reject=function(T){var b=new this(i);return o.reject(b,T)},m.all=function(T){var b=this;if(Object.prototype.toString.call(T)!=="[object Array]")return this.reject(new TypeError("must be an array"));var S=T.length,E=!1;if(!S)return this.resolve([]);for(var A=new Array(S),w=0,k=-1,N=new this(i);++k<S;)B(T[k],k);return N;function B(I,P){b.resolve(I).then(function(v){A[P]=v,++w!==S||E||(E=!0,o.resolve(N,A))},function(v){E||(E=!0,o.reject(N,v))})}},m.race=function(T){var b=this;if(Object.prototype.toString.call(T)!=="[object Array]")return this.reject(new TypeError("must be an array"));var S=T.length,E=!1;if(!S)return this.resolve([]);for(var A=-1,w=new this(i);++A<S;)k=T[A],b.resolve(k).then(function(N){E||(E=!0,o.resolve(w,N))},function(N){E||(E=!0,o.reject(w,N))});var k;return w}},{immediate:36}],38:[function(e,s,a){var r={};(0,e("./lib/utils/common").assign)(r,e("./lib/deflate"),e("./lib/inflate"),e("./lib/zlib/constants")),s.exports=r},{"./lib/deflate":39,"./lib/inflate":40,"./lib/utils/common":41,"./lib/zlib/constants":44}],39:[function(e,s,a){var r=e("./zlib/deflate"),i=e("./utils/common"),o=e("./utils/strings"),l=e("./zlib/messages"),c=e("./zlib/zstream"),p=Object.prototype.toString,m=0,g=-1,d=0,y=8;function u(T){if(!(this instanceof u))return new u(T);this.options=i.assign({level:g,method:y,chunkSize:16384,windowBits:15,memLevel:8,strategy:d,to:""},T||{});var b=this.options;b.raw&&0<b.windowBits?b.windowBits=-b.windowBits:b.gzip&&0<b.windowBits&&b.windowBits<16&&(b.windowBits+=16),this.err=0,this.msg="",this.ended=!1,this.chunks=[],this.strm=new c,this.strm.avail_out=0;var S=r.deflateInit2(this.strm,b.level,b.method,b.windowBits,b.memLevel,b.strategy);if(S!==m)throw new Error(l[S]);if(b.header&&r.deflateSetHeader(this.strm,b.header),b.dictionary){var E;if(E=typeof b.dictionary=="string"?o.string2buf(b.dictionary):p.call(b.dictionary)==="[object ArrayBuffer]"?new Uint8Array(b.dictionary):b.dictionary,(S=r.deflateSetDictionary(this.strm,E))!==m)throw new Error(l[S]);this._dict_set=!0}}function x(T,b){var S=new u(b);if(S.push(T,!0),S.err)throw S.msg||l[S.err];return S.result}u.prototype.push=function(T,b){var S,E,A=this.strm,w=this.options.chunkSize;if(this.ended)return!1;E=b===~~b?b:b===!0?4:0,typeof T=="string"?A.input=o.string2buf(T):p.call(T)==="[object ArrayBuffer]"?A.input=new Uint8Array(T):A.input=T,A.next_in=0,A.avail_in=A.input.length;do{if(A.avail_out===0&&(A.output=new i.Buf8(w),A.next_out=0,A.avail_out=w),(S=r.deflate(A,E))!==1&&S!==m)return this.onEnd(S),!(this.ended=!0);A.avail_out!==0&&(A.avail_in!==0||E!==4&&E!==2)||(this.options.to==="string"?this.onData(o.buf2binstring(i.shrinkBuf(A.output,A.next_out))):this.onData(i.shrinkBuf(A.output,A.next_out)))}while((0<A.avail_in||A.avail_out===0)&&S!==1);return E===4?(S=r.deflateEnd(this.strm),this.onEnd(S),this.ended=!0,S===m):E!==2||(this.onEnd(m),!(A.avail_out=0))},u.prototype.onData=function(T){this.chunks.push(T)},u.prototype.onEnd=function(T){T===m&&(this.options.to==="string"?this.result=this.chunks.join(""):this.result=i.flattenChunks(this.chunks)),this.chunks=[],this.err=T,this.msg=this.strm.msg},a.Deflate=u,a.deflate=x,a.deflateRaw=function(T,b){return(b=b||{}).raw=!0,x(T,b)},a.gzip=function(T,b){return(b=b||{}).gzip=!0,x(T,b)}},{"./utils/common":41,"./utils/strings":42,"./zlib/deflate":46,"./zlib/messages":51,"./zlib/zstream":53}],40:[function(e,s,a){var r=e("./zlib/inflate"),i=e("./utils/common"),o=e("./utils/strings"),l=e("./zlib/constants"),c=e("./zlib/messages"),p=e("./zlib/zstream"),m=e("./zlib/gzheader"),g=Object.prototype.toString;function d(u){if(!(this instanceof d))return new d(u);this.options=i.assign({chunkSize:16384,windowBits:0,to:""},u||{});var x=this.options;x.raw&&0<=x.windowBits&&x.windowBits<16&&(x.windowBits=-x.windowBits,x.windowBits===0&&(x.windowBits=-15)),!(0<=x.windowBits&&x.windowBits<16)||u&&u.windowBits||(x.windowBits+=32),15<x.windowBits&&x.windowBits<48&&(15&x.windowBits)==0&&(x.windowBits|=15),this.err=0,this.msg="",this.ended=!1,this.chunks=[],this.strm=new p,this.strm.avail_out=0;var T=r.inflateInit2(this.strm,x.windowBits);if(T!==l.Z_OK)throw new Error(c[T]);this.header=new m,r.inflateGetHeader(this.strm,this.header)}function y(u,x){var T=new d(x);if(T.push(u,!0),T.err)throw T.msg||c[T.err];return T.result}d.prototype.push=function(u,x){var T,b,S,E,A,w,k=this.strm,N=this.options.chunkSize,B=this.options.dictionary,I=!1;if(this.ended)return!1;b=x===~~x?x:x===!0?l.Z_FINISH:l.Z_NO_FLUSH,typeof u=="string"?k.input=o.binstring2buf(u):g.call(u)==="[object ArrayBuffer]"?k.input=new Uint8Array(u):k.input=u,k.next_in=0,k.avail_in=k.input.length;do{if(k.avail_out===0&&(k.output=new i.Buf8(N),k.next_out=0,k.avail_out=N),(T=r.inflate(k,l.Z_NO_FLUSH))===l.Z_NEED_DICT&&B&&(w=typeof B=="string"?o.string2buf(B):g.call(B)==="[object ArrayBuffer]"?new Uint8Array(B):B,T=r.inflateSetDictionary(this.strm,w)),T===l.Z_BUF_ERROR&&I===!0&&(T=l.Z_OK,I=!1),T!==l.Z_STREAM_END&&T!==l.Z_OK)return this.onEnd(T),!(this.ended=!0);k.next_out&&(k.avail_out!==0&&T!==l.Z_STREAM_END&&(k.avail_in!==0||b!==l.Z_FINISH&&b!==l.Z_SYNC_FLUSH)||(this.options.to==="string"?(S=o.utf8border(k.output,k.next_out),E=k.next_out-S,A=o.buf2string(k.output,S),k.next_out=E,k.avail_out=N-E,E&&i.arraySet(k.output,k.output,S,E,0),this.onData(A)):this.onData(i.shrinkBuf(k.output,k.next_out)))),k.avail_in===0&&k.avail_out===0&&(I=!0)}while((0<k.avail_in||k.avail_out===0)&&T!==l.Z_STREAM_END);return T===l.Z_STREAM_END&&(b=l.Z_FINISH),b===l.Z_FINISH?(T=r.inflateEnd(this.strm),this.onEnd(T),this.ended=!0,T===l.Z_OK):b!==l.Z_SYNC_FLUSH||(this.onEnd(l.Z_OK),!(k.avail_out=0))},d.prototype.onData=function(u){this.chunks.push(u)},d.prototype.onEnd=function(u){u===l.Z_OK&&(this.options.to==="string"?this.result=this.chunks.join(""):this.result=i.flattenChunks(this.chunks)),this.chunks=[],this.err=u,this.msg=this.strm.msg},a.Inflate=d,a.inflate=y,a.inflateRaw=function(u,x){return(x=x||{}).raw=!0,y(u,x)},a.ungzip=y},{"./utils/common":41,"./utils/strings":42,"./zlib/constants":44,"./zlib/gzheader":47,"./zlib/inflate":49,"./zlib/messages":51,"./zlib/zstream":53}],41:[function(e,s,a){var r=typeof Uint8Array<"u"&&typeof Uint16Array<"u"&&typeof Int32Array<"u";a.assign=function(l){for(var c=Array.prototype.slice.call(arguments,1);c.length;){var p=c.shift();if(p){if(typeof p!="object")throw new TypeError(p+"must be non-object");for(var m in p)p.hasOwnProperty(m)&&(l[m]=p[m])}}return l},a.shrinkBuf=function(l,c){return l.length===c?l:l.subarray?l.subarray(0,c):(l.length=c,l)};var i={arraySet:function(l,c,p,m,g){if(c.subarray&&l.subarray)l.set(c.subarray(p,p+m),g);else for(var d=0;d<m;d++)l[g+d]=c[p+d]},flattenChunks:function(l){var c,p,m,g,d,y;for(c=m=0,p=l.length;c<p;c++)m+=l[c].length;for(y=new Uint8Array(m),c=g=0,p=l.length;c<p;c++)d=l[c],y.set(d,g),g+=d.length;return y}},o={arraySet:function(l,c,p,m,g){for(var d=0;d<m;d++)l[g+d]=c[p+d]},flattenChunks:function(l){return[].concat.apply([],l)}};a.setTyped=function(l){l?(a.Buf8=Uint8Array,a.Buf16=Uint16Array,a.Buf32=Int32Array,a.assign(a,i)):(a.Buf8=Array,a.Buf16=Array,a.Buf32=Array,a.assign(a,o))},a.setTyped(r)},{}],42:[function(e,s,a){var r=e("./common"),i=!0,o=!0;try{String.fromCharCode.apply(null,[0])}catch{i=!1}try{String.fromCharCode.apply(null,new Uint8Array(1))}catch{o=!1}for(var l=new r.Buf8(256),c=0;c<256;c++)l[c]=252<=c?6:248<=c?5:240<=c?4:224<=c?3:192<=c?2:1;function p(m,g){if(g<65537&&(m.subarray&&o||!m.subarray&&i))return String.fromCharCode.apply(null,r.shrinkBuf(m,g));for(var d="",y=0;y<g;y++)d+=String.fromCharCode(m[y]);return d}l[254]=l[254]=1,a.string2buf=function(m){var g,d,y,u,x,T=m.length,b=0;for(u=0;u<T;u++)(64512&(d=m.charCodeAt(u)))==55296&&u+1<T&&(64512&(y=m.charCodeAt(u+1)))==56320&&(d=65536+(d-55296<<10)+(y-56320),u++),b+=d<128?1:d<2048?2:d<65536?3:4;for(g=new r.Buf8(b),u=x=0;x<b;u++)(64512&(d=m.charCodeAt(u)))==55296&&u+1<T&&(64512&(y=m.charCodeAt(u+1)))==56320&&(d=65536+(d-55296<<10)+(y-56320),u++),d<128?g[x++]=d:(d<2048?g[x++]=192|d>>>6:(d<65536?g[x++]=224|d>>>12:(g[x++]=240|d>>>18,g[x++]=128|d>>>12&63),g[x++]=128|d>>>6&63),g[x++]=128|63&d);return g},a.buf2binstring=function(m){return p(m,m.length)},a.binstring2buf=function(m){for(var g=new r.Buf8(m.length),d=0,y=g.length;d<y;d++)g[d]=m.charCodeAt(d);return g},a.buf2string=function(m,g){var d,y,u,x,T=g||m.length,b=new Array(2*T);for(d=y=0;d<T;)if((u=m[d++])<128)b[y++]=u;else if(4<(x=l[u]))b[y++]=65533,d+=x-1;else{for(u&=x===2?31:x===3?15:7;1<x&&d<T;)u=u<<6|63&m[d++],x--;1<x?b[y++]=65533:u<65536?b[y++]=u:(u-=65536,b[y++]=55296|u>>10&1023,b[y++]=56320|1023&u)}return p(b,y)},a.utf8border=function(m,g){var d;for((g=g||m.length)>m.length&&(g=m.length),d=g-1;0<=d&&(192&m[d])==128;)d--;return d<0||d===0?g:d+l[m[d]]>g?d:g}},{"./common":41}],43:[function(e,s,a){s.exports=function(r,i,o,l){for(var c=65535&r|0,p=r>>>16&65535|0,m=0;o!==0;){for(o-=m=2e3<o?2e3:o;p=p+(c=c+i[l++]|0)|0,--m;);c%=65521,p%=65521}return c|p<<16|0}},{}],44:[function(e,s,a){s.exports={Z_NO_FLUSH:0,Z_PARTIAL_FLUSH:1,Z_SYNC_FLUSH:2,Z_FULL_FLUSH:3,Z_FINISH:4,Z_BLOCK:5,Z_TREES:6,Z_OK:0,Z_STREAM_END:1,Z_NEED_DICT:2,Z_ERRNO:-1,Z_STREAM_ERROR:-2,Z_DATA_ERROR:-3,Z_BUF_ERROR:-5,Z_NO_COMPRESSION:0,Z_BEST_SPEED:1,Z_BEST_COMPRESSION:9,Z_DEFAULT_COMPRESSION:-1,Z_FILTERED:1,Z_HUFFMAN_ONLY:2,Z_RLE:3,Z_FIXED:4,Z_DEFAULT_STRATEGY:0,Z_BINARY:0,Z_TEXT:1,Z_UNKNOWN:2,Z_DEFLATED:8}},{}],45:[function(e,s,a){var r=(function(){for(var i,o=[],l=0;l<256;l++){i=l;for(var c=0;c<8;c++)i=1&i?3988292384^i>>>1:i>>>1;o[l]=i}return o})();s.exports=function(i,o,l,c){var p=r,m=c+l;i^=-1;for(var g=c;g<m;g++)i=i>>>8^p[255&(i^o[g])];return-1^i}},{}],46:[function(e,s,a){var r,i=e("../utils/common"),o=e("./trees"),l=e("./adler32"),c=e("./crc32"),p=e("./messages"),m=0,g=4,d=0,y=-2,u=-1,x=4,T=2,b=8,S=9,E=286,A=30,w=19,k=2*E+1,N=15,B=3,I=258,P=I+B+1,v=42,R=113,h=1,F=2,q=3,G=4;function tt(f,Z){return f.msg=p[Z],Z}function V(f){return(f<<1)-(4<f?9:0)}function Q(f){for(var Z=f.length;0<=--Z;)f[Z]=0}function L(f){var Z=f.state,z=Z.pending;z>f.avail_out&&(z=f.avail_out),z!==0&&(i.arraySet(f.output,Z.pending_buf,Z.pending_out,z,f.next_out),f.next_out+=z,Z.pending_out+=z,f.total_out+=z,f.avail_out-=z,Z.pending-=z,Z.pending===0&&(Z.pending_out=0))}function D(f,Z){o._tr_flush_block(f,0<=f.block_start?f.block_start:-1,f.strstart-f.block_start,Z),f.block_start=f.strstart,L(f.strm)}function et(f,Z){f.pending_buf[f.pending++]=Z}function J(f,Z){f.pending_buf[f.pending++]=Z>>>8&255,f.pending_buf[f.pending++]=255&Z}function K(f,Z){var z,M,C=f.max_chain_length,_=f.strstart,W=f.prev_length,Y=f.nice_match,O=f.strstart>f.w_size-P?f.strstart-(f.w_size-P):0,$=f.window,j=f.w_mask,U=f.prev,X=f.strstart+I,at=$[_+W-1],it=$[_+W];f.prev_length>=f.good_match&&(C>>=2),Y>f.lookahead&&(Y=f.lookahead);do if($[(z=Z)+W]===it&&$[z+W-1]===at&&$[z]===$[_]&&$[++z]===$[_+1]){_+=2,z++;do;while($[++_]===$[++z]&&$[++_]===$[++z]&&$[++_]===$[++z]&&$[++_]===$[++z]&&$[++_]===$[++z]&&$[++_]===$[++z]&&$[++_]===$[++z]&&$[++_]===$[++z]&&_<X);if(M=I-(X-_),_=X-I,W<M){if(f.match_start=Z,Y<=(W=M))break;at=$[_+W-1],it=$[_+W]}}while((Z=U[Z&j])>O&&--C!=0);return W<=f.lookahead?W:f.lookahead}function ot(f){var Z,z,M,C,_,W,Y,O,$,j,U=f.w_size;do{if(C=f.window_size-f.lookahead-f.strstart,f.strstart>=U+(U-P)){for(i.arraySet(f.window,f.window,U,U,0),f.match_start-=U,f.strstart-=U,f.block_start-=U,Z=z=f.hash_size;M=f.head[--Z],f.head[Z]=U<=M?M-U:0,--z;);for(Z=z=U;M=f.prev[--Z],f.prev[Z]=U<=M?M-U:0,--z;);C+=U}if(f.strm.avail_in===0)break;if(W=f.strm,Y=f.window,O=f.strstart+f.lookahead,$=C,j=void 0,j=W.avail_in,$<j&&(j=$),z=j===0?0:(W.avail_in-=j,i.arraySet(Y,W.input,W.next_in,j,O),W.state.wrap===1?W.adler=l(W.adler,Y,j,O):W.state.wrap===2&&(W.adler=c(W.adler,Y,j,O)),W.next_in+=j,W.total_in+=j,j),f.lookahead+=z,f.lookahead+f.insert>=B)for(_=f.strstart-f.insert,f.ins_h=f.window[_],f.ins_h=(f.ins_h<<f.hash_shift^f.window[_+1])&f.hash_mask;f.insert&&(f.ins_h=(f.ins_h<<f.hash_shift^f.window[_+B-1])&f.hash_mask,f.prev[_&f.w_mask]=f.head[f.ins_h],f.head[f.ins_h]=_,_++,f.insert--,!(f.lookahead+f.insert<B)););}while(f.lookahead<P&&f.strm.avail_in!==0)}function lt(f,Z){for(var z,M;;){if(f.lookahead<P){if(ot(f),f.lookahead<P&&Z===m)return h;if(f.lookahead===0)break}if(z=0,f.lookahead>=B&&(f.ins_h=(f.ins_h<<f.hash_shift^f.window[f.strstart+B-1])&f.hash_mask,z=f.prev[f.strstart&f.w_mask]=f.head[f.ins_h],f.head[f.ins_h]=f.strstart),z!==0&&f.strstart-z<=f.w_size-P&&(f.match_length=K(f,z)),f.match_length>=B)if(M=o._tr_tally(f,f.strstart-f.match_start,f.match_length-B),f.lookahead-=f.match_length,f.match_length<=f.max_lazy_match&&f.lookahead>=B){for(f.match_length--;f.strstart++,f.ins_h=(f.ins_h<<f.hash_shift^f.window[f.strstart+B-1])&f.hash_mask,z=f.prev[f.strstart&f.w_mask]=f.head[f.ins_h],f.head[f.ins_h]=f.strstart,--f.match_length!=0;);f.strstart++}else f.strstart+=f.match_length,f.match_length=0,f.ins_h=f.window[f.strstart],f.ins_h=(f.ins_h<<f.hash_shift^f.window[f.strstart+1])&f.hash_mask;else M=o._tr_tally(f,0,f.window[f.strstart]),f.lookahead--,f.strstart++;if(M&&(D(f,!1),f.strm.avail_out===0))return h}return f.insert=f.strstart<B-1?f.strstart:B-1,Z===g?(D(f,!0),f.strm.avail_out===0?q:G):f.last_lit&&(D(f,!1),f.strm.avail_out===0)?h:F}function rt(f,Z){for(var z,M,C;;){if(f.lookahead<P){if(ot(f),f.lookahead<P&&Z===m)return h;if(f.lookahead===0)break}if(z=0,f.lookahead>=B&&(f.ins_h=(f.ins_h<<f.hash_shift^f.window[f.strstart+B-1])&f.hash_mask,z=f.prev[f.strstart&f.w_mask]=f.head[f.ins_h],f.head[f.ins_h]=f.strstart),f.prev_length=f.match_length,f.prev_match=f.match_start,f.match_length=B-1,z!==0&&f.prev_length<f.max_lazy_match&&f.strstart-z<=f.w_size-P&&(f.match_length=K(f,z),f.match_length<=5&&(f.strategy===1||f.match_length===B&&4096<f.strstart-f.match_start)&&(f.match_length=B-1)),f.prev_length>=B&&f.match_length<=f.prev_length){for(C=f.strstart+f.lookahead-B,M=o._tr_tally(f,f.strstart-1-f.prev_match,f.prev_length-B),f.lookahead-=f.prev_length-1,f.prev_length-=2;++f.strstart<=C&&(f.ins_h=(f.ins_h<<f.hash_shift^f.window[f.strstart+B-1])&f.hash_mask,z=f.prev[f.strstart&f.w_mask]=f.head[f.ins_h],f.head[f.ins_h]=f.strstart),--f.prev_length!=0;);if(f.match_available=0,f.match_length=B-1,f.strstart++,M&&(D(f,!1),f.strm.avail_out===0))return h}else if(f.match_available){if((M=o._tr_tally(f,0,f.window[f.strstart-1]))&&D(f,!1),f.strstart++,f.lookahead--,f.strm.avail_out===0)return h}else f.match_available=1,f.strstart++,f.lookahead--}return f.match_available&&(M=o._tr_tally(f,0,f.window[f.strstart-1]),f.match_available=0),f.insert=f.strstart<B-1?f.strstart:B-1,Z===g?(D(f,!0),f.strm.avail_out===0?q:G):f.last_lit&&(D(f,!1),f.strm.avail_out===0)?h:F}function nt(f,Z,z,M,C){this.good_length=f,this.max_lazy=Z,this.nice_length=z,this.max_chain=M,this.func=C}function st(){this.strm=null,this.status=0,this.pending_buf=null,this.pending_buf_size=0,this.pending_out=0,this.pending=0,this.wrap=0,this.gzhead=null,this.gzindex=0,this.method=b,this.last_flush=-1,this.w_size=0,this.w_bits=0,this.w_mask=0,this.window=null,this.window_size=0,this.prev=null,this.head=null,this.ins_h=0,this.hash_size=0,this.hash_bits=0,this.hash_mask=0,this.hash_shift=0,this.block_start=0,this.match_length=0,this.prev_match=0,this.match_available=0,this.strstart=0,this.match_start=0,this.lookahead=0,this.prev_length=0,this.max_chain_length=0,this.max_lazy_match=0,this.level=0,this.strategy=0,this.good_match=0,this.nice_match=0,this.dyn_ltree=new i.Buf16(2*k),this.dyn_dtree=new i.Buf16(2*(2*A+1)),this.bl_tree=new i.Buf16(2*(2*w+1)),Q(this.dyn_ltree),Q(this.dyn_dtree),Q(this.bl_tree),this.l_desc=null,this.d_desc=null,this.bl_desc=null,this.bl_count=new i.Buf16(N+1),this.heap=new i.Buf16(2*E+1),Q(this.heap),this.heap_len=0,this.heap_max=0,this.depth=new i.Buf16(2*E+1),Q(this.depth),this.l_buf=0,this.lit_bufsize=0,this.last_lit=0,this.d_buf=0,this.opt_len=0,this.static_len=0,this.matches=0,this.insert=0,this.bi_buf=0,this.bi_valid=0}function ct(f){var Z;return f&&f.state?(f.total_in=f.total_out=0,f.data_type=T,(Z=f.state).pending=0,Z.pending_out=0,Z.wrap<0&&(Z.wrap=-Z.wrap),Z.status=Z.wrap?v:R,f.adler=Z.wrap===2?0:1,Z.last_flush=m,o._tr_init(Z),d):tt(f,y)}function mt(f){var Z=ct(f);return Z===d&&(function(z){z.window_size=2*z.w_size,Q(z.head),z.max_lazy_match=r[z.level].max_lazy,z.good_match=r[z.level].good_length,z.nice_match=r[z.level].nice_length,z.max_chain_length=r[z.level].max_chain,z.strstart=0,z.block_start=0,z.lookahead=0,z.insert=0,z.match_length=z.prev_length=B-1,z.match_available=0,z.ins_h=0})(f.state),Z}function xt(f,Z,z,M,C,_){if(!f)return y;var W=1;if(Z===u&&(Z=6),M<0?(W=0,M=-M):15<M&&(W=2,M-=16),C<1||S<C||z!==b||M<8||15<M||Z<0||9<Z||_<0||x<_)return tt(f,y);M===8&&(M=9);var Y=new st;return(f.state=Y).strm=f,Y.wrap=W,Y.gzhead=null,Y.w_bits=M,Y.w_size=1<<Y.w_bits,Y.w_mask=Y.w_size-1,Y.hash_bits=C+7,Y.hash_size=1<<Y.hash_bits,Y.hash_mask=Y.hash_size-1,Y.hash_shift=~~((Y.hash_bits+B-1)/B),Y.window=new i.Buf8(2*Y.w_size),Y.head=new i.Buf16(Y.hash_size),Y.prev=new i.Buf16(Y.w_size),Y.lit_bufsize=1<<C+6,Y.pending_buf_size=4*Y.lit_bufsize,Y.pending_buf=new i.Buf8(Y.pending_buf_size),Y.d_buf=1*Y.lit_bufsize,Y.l_buf=3*Y.lit_bufsize,Y.level=Z,Y.strategy=_,Y.method=z,mt(f)}r=[new nt(0,0,0,0,function(f,Z){var z=65535;for(z>f.pending_buf_size-5&&(z=f.pending_buf_size-5);;){if(f.lookahead<=1){if(ot(f),f.lookahead===0&&Z===m)return h;if(f.lookahead===0)break}f.strstart+=f.lookahead,f.lookahead=0;var M=f.block_start+z;if((f.strstart===0||f.strstart>=M)&&(f.lookahead=f.strstart-M,f.strstart=M,D(f,!1),f.strm.avail_out===0)||f.strstart-f.block_start>=f.w_size-P&&(D(f,!1),f.strm.avail_out===0))return h}return f.insert=0,Z===g?(D(f,!0),f.strm.avail_out===0?q:G):(f.strstart>f.block_start&&(D(f,!1),f.strm.avail_out),h)}),new nt(4,4,8,4,lt),new nt(4,5,16,8,lt),new nt(4,6,32,32,lt),new nt(4,4,16,16,rt),new nt(8,16,32,32,rt),new nt(8,16,128,128,rt),new nt(8,32,128,256,rt),new nt(32,128,258,1024,rt),new nt(32,258,258,4096,rt)],a.deflateInit=function(f,Z){return xt(f,Z,b,15,8,0)},a.deflateInit2=xt,a.deflateReset=mt,a.deflateResetKeep=ct,a.deflateSetHeader=function(f,Z){return f&&f.state?f.state.wrap!==2?y:(f.state.gzhead=Z,d):y},a.deflate=function(f,Z){var z,M,C,_;if(!f||!f.state||5<Z||Z<0)return f?tt(f,y):y;if(M=f.state,!f.output||!f.input&&f.avail_in!==0||M.status===666&&Z!==g)return tt(f,f.avail_out===0?-5:y);if(M.strm=f,z=M.last_flush,M.last_flush=Z,M.status===v)if(M.wrap===2)f.adler=0,et(M,31),et(M,139),et(M,8),M.gzhead?(et(M,(M.gzhead.text?1:0)+(M.gzhead.hcrc?2:0)+(M.gzhead.extra?4:0)+(M.gzhead.name?8:0)+(M.gzhead.comment?16:0)),et(M,255&M.gzhead.time),et(M,M.gzhead.time>>8&255),et(M,M.gzhead.time>>16&255),et(M,M.gzhead.time>>24&255),et(M,M.level===9?2:2<=M.strategy||M.level<2?4:0),et(M,255&M.gzhead.os),M.gzhead.extra&&M.gzhead.extra.length&&(et(M,255&M.gzhead.extra.length),et(M,M.gzhead.extra.length>>8&255)),M.gzhead.hcrc&&(f.adler=c(f.adler,M.pending_buf,M.pending,0)),M.gzindex=0,M.status=69):(et(M,0),et(M,0),et(M,0),et(M,0),et(M,0),et(M,M.level===9?2:2<=M.strategy||M.level<2?4:0),et(M,3),M.status=R);else{var W=b+(M.w_bits-8<<4)<<8;W|=(2<=M.strategy||M.level<2?0:M.level<6?1:M.level===6?2:3)<<6,M.strstart!==0&&(W|=32),W+=31-W%31,M.status=R,J(M,W),M.strstart!==0&&(J(M,f.adler>>>16),J(M,65535&f.adler)),f.adler=1}if(M.status===69)if(M.gzhead.extra){for(C=M.pending;M.gzindex<(65535&M.gzhead.extra.length)&&(M.pending!==M.pending_buf_size||(M.gzhead.hcrc&&M.pending>C&&(f.adler=c(f.adler,M.pending_buf,M.pending-C,C)),L(f),C=M.pending,M.pending!==M.pending_buf_size));)et(M,255&M.gzhead.extra[M.gzindex]),M.gzindex++;M.gzhead.hcrc&&M.pending>C&&(f.adler=c(f.adler,M.pending_buf,M.pending-C,C)),M.gzindex===M.gzhead.extra.length&&(M.gzindex=0,M.status=73)}else M.status=73;if(M.status===73)if(M.gzhead.name){C=M.pending;do{if(M.pending===M.pending_buf_size&&(M.gzhead.hcrc&&M.pending>C&&(f.adler=c(f.adler,M.pending_buf,M.pending-C,C)),L(f),C=M.pending,M.pending===M.pending_buf_size)){_=1;break}_=M.gzindex<M.gzhead.name.length?255&M.gzhead.name.charCodeAt(M.gzindex++):0,et(M,_)}while(_!==0);M.gzhead.hcrc&&M.pending>C&&(f.adler=c(f.adler,M.pending_buf,M.pending-C,C)),_===0&&(M.gzindex=0,M.status=91)}else M.status=91;if(M.status===91)if(M.gzhead.comment){C=M.pending;do{if(M.pending===M.pending_buf_size&&(M.gzhead.hcrc&&M.pending>C&&(f.adler=c(f.adler,M.pending_buf,M.pending-C,C)),L(f),C=M.pending,M.pending===M.pending_buf_size)){_=1;break}_=M.gzindex<M.gzhead.comment.length?255&M.gzhead.comment.charCodeAt(M.gzindex++):0,et(M,_)}while(_!==0);M.gzhead.hcrc&&M.pending>C&&(f.adler=c(f.adler,M.pending_buf,M.pending-C,C)),_===0&&(M.status=103)}else M.status=103;if(M.status===103&&(M.gzhead.hcrc?(M.pending+2>M.pending_buf_size&&L(f),M.pending+2<=M.pending_buf_size&&(et(M,255&f.adler),et(M,f.adler>>8&255),f.adler=0,M.status=R)):M.status=R),M.pending!==0){if(L(f),f.avail_out===0)return M.last_flush=-1,d}else if(f.avail_in===0&&V(Z)<=V(z)&&Z!==g)return tt(f,-5);if(M.status===666&&f.avail_in!==0)return tt(f,-5);if(f.avail_in!==0||M.lookahead!==0||Z!==m&&M.status!==666){var Y=M.strategy===2?(function(O,$){for(var j;;){if(O.lookahead===0&&(ot(O),O.lookahead===0)){if($===m)return h;break}if(O.match_length=0,j=o._tr_tally(O,0,O.window[O.strstart]),O.lookahead--,O.strstart++,j&&(D(O,!1),O.strm.avail_out===0))return h}return O.insert=0,$===g?(D(O,!0),O.strm.avail_out===0?q:G):O.last_lit&&(D(O,!1),O.strm.avail_out===0)?h:F})(M,Z):M.strategy===3?(function(O,$){for(var j,U,X,at,it=O.window;;){if(O.lookahead<=I){if(ot(O),O.lookahead<=I&&$===m)return h;if(O.lookahead===0)break}if(O.match_length=0,O.lookahead>=B&&0<O.strstart&&(U=it[X=O.strstart-1])===it[++X]&&U===it[++X]&&U===it[++X]){at=O.strstart+I;do;while(U===it[++X]&&U===it[++X]&&U===it[++X]&&U===it[++X]&&U===it[++X]&&U===it[++X]&&U===it[++X]&&U===it[++X]&&X<at);O.match_length=I-(at-X),O.match_length>O.lookahead&&(O.match_length=O.lookahead)}if(O.match_length>=B?(j=o._tr_tally(O,1,O.match_length-B),O.lookahead-=O.match_length,O.strstart+=O.match_length,O.match_length=0):(j=o._tr_tally(O,0,O.window[O.strstart]),O.lookahead--,O.strstart++),j&&(D(O,!1),O.strm.avail_out===0))return h}return O.insert=0,$===g?(D(O,!0),O.strm.avail_out===0?q:G):O.last_lit&&(D(O,!1),O.strm.avail_out===0)?h:F})(M,Z):r[M.level].func(M,Z);if(Y!==q&&Y!==G||(M.status=666),Y===h||Y===q)return f.avail_out===0&&(M.last_flush=-1),d;if(Y===F&&(Z===1?o._tr_align(M):Z!==5&&(o._tr_stored_block(M,0,0,!1),Z===3&&(Q(M.head),M.lookahead===0&&(M.strstart=0,M.block_start=0,M.insert=0))),L(f),f.avail_out===0))return M.last_flush=-1,d}return Z!==g?d:M.wrap<=0?1:(M.wrap===2?(et(M,255&f.adler),et(M,f.adler>>8&255),et(M,f.adler>>16&255),et(M,f.adler>>24&255),et(M,255&f.total_in),et(M,f.total_in>>8&255),et(M,f.total_in>>16&255),et(M,f.total_in>>24&255)):(J(M,f.adler>>>16),J(M,65535&f.adler)),L(f),0<M.wrap&&(M.wrap=-M.wrap),M.pending!==0?d:1)},a.deflateEnd=function(f){var Z;return f&&f.state?(Z=f.state.status)!==v&&Z!==69&&Z!==73&&Z!==91&&Z!==103&&Z!==R&&Z!==666?tt(f,y):(f.state=null,Z===R?tt(f,-3):d):y},a.deflateSetDictionary=function(f,Z){var z,M,C,_,W,Y,O,$,j=Z.length;if(!f||!f.state||(_=(z=f.state).wrap)===2||_===1&&z.status!==v||z.lookahead)return y;for(_===1&&(f.adler=l(f.adler,Z,j,0)),z.wrap=0,j>=z.w_size&&(_===0&&(Q(z.head),z.strstart=0,z.block_start=0,z.insert=0),$=new i.Buf8(z.w_size),i.arraySet($,Z,j-z.w_size,z.w_size,0),Z=$,j=z.w_size),W=f.avail_in,Y=f.next_in,O=f.input,f.avail_in=j,f.next_in=0,f.input=Z,ot(z);z.lookahead>=B;){for(M=z.strstart,C=z.lookahead-(B-1);z.ins_h=(z.ins_h<<z.hash_shift^z.window[M+B-1])&z.hash_mask,z.prev[M&z.w_mask]=z.head[z.ins_h],z.head[z.ins_h]=M,M++,--C;);z.strstart=M,z.lookahead=B-1,ot(z)}return z.strstart+=z.lookahead,z.block_start=z.strstart,z.insert=z.lookahead,z.lookahead=0,z.match_length=z.prev_length=B-1,z.match_available=0,f.next_in=Y,f.input=O,f.avail_in=W,z.wrap=_,d},a.deflateInfo="pako deflate (from Nodeca project)"},{"../utils/common":41,"./adler32":43,"./crc32":45,"./messages":51,"./trees":52}],47:[function(e,s,a){s.exports=function(){this.text=0,this.time=0,this.xflags=0,this.os=0,this.extra=null,this.extra_len=0,this.name="",this.comment="",this.hcrc=0,this.done=!1}},{}],48:[function(e,s,a){s.exports=function(r,i){var o,l,c,p,m,g,d,y,u,x,T,b,S,E,A,w,k,N,B,I,P,v,R,h,F;o=r.state,l=r.next_in,h=r.input,c=l+(r.avail_in-5),p=r.next_out,F=r.output,m=p-(i-r.avail_out),g=p+(r.avail_out-257),d=o.dmax,y=o.wsize,u=o.whave,x=o.wnext,T=o.window,b=o.hold,S=o.bits,E=o.lencode,A=o.distcode,w=(1<<o.lenbits)-1,k=(1<<o.distbits)-1;t:do{S<15&&(b+=h[l++]<<S,S+=8,b+=h[l++]<<S,S+=8),N=E[b&w];e:for(;;){if(b>>>=B=N>>>24,S-=B,(B=N>>>16&255)===0)F[p++]=65535&N;else{if(!(16&B)){if((64&B)==0){N=E[(65535&N)+(b&(1<<B)-1)];continue e}if(32&B){o.mode=12;break t}r.msg="invalid literal/length code",o.mode=30;break t}I=65535&N,(B&=15)&&(S<B&&(b+=h[l++]<<S,S+=8),I+=b&(1<<B)-1,b>>>=B,S-=B),S<15&&(b+=h[l++]<<S,S+=8,b+=h[l++]<<S,S+=8),N=A[b&k];n:for(;;){if(b>>>=B=N>>>24,S-=B,!(16&(B=N>>>16&255))){if((64&B)==0){N=A[(65535&N)+(b&(1<<B)-1)];continue n}r.msg="invalid distance code",o.mode=30;break t}if(P=65535&N,S<(B&=15)&&(b+=h[l++]<<S,(S+=8)<B&&(b+=h[l++]<<S,S+=8)),d<(P+=b&(1<<B)-1)){r.msg="invalid distance too far back",o.mode=30;break t}if(b>>>=B,S-=B,(B=p-m)<P){if(u<(B=P-B)&&o.sane){r.msg="invalid distance too far back",o.mode=30;break t}if(R=T,(v=0)===x){if(v+=y-B,B<I){for(I-=B;F[p++]=T[v++],--B;);v=p-P,R=F}}else if(x<B){if(v+=y+x-B,(B-=x)<I){for(I-=B;F[p++]=T[v++],--B;);if(v=0,x<I){for(I-=B=x;F[p++]=T[v++],--B;);v=p-P,R=F}}}else if(v+=x-B,B<I){for(I-=B;F[p++]=T[v++],--B;);v=p-P,R=F}for(;2<I;)F[p++]=R[v++],F[p++]=R[v++],F[p++]=R[v++],I-=3;I&&(F[p++]=R[v++],1<I&&(F[p++]=R[v++]))}else{for(v=p-P;F[p++]=F[v++],F[p++]=F[v++],F[p++]=F[v++],2<(I-=3););I&&(F[p++]=F[v++],1<I&&(F[p++]=F[v++]))}break}}break}}while(l<c&&p<g);l-=I=S>>3,b&=(1<<(S-=I<<3))-1,r.next_in=l,r.next_out=p,r.avail_in=l<c?c-l+5:5-(l-c),r.avail_out=p<g?g-p+257:257-(p-g),o.hold=b,o.bits=S}},{}],49:[function(e,s,a){var r=e("../utils/common"),i=e("./adler32"),o=e("./crc32"),l=e("./inffast"),c=e("./inftrees"),p=1,m=2,g=0,d=-2,y=1,u=852,x=592;function T(v){return(v>>>24&255)+(v>>>8&65280)+((65280&v)<<8)+((255&v)<<24)}function b(){this.mode=0,this.last=!1,this.wrap=0,this.havedict=!1,this.flags=0,this.dmax=0,this.check=0,this.total=0,this.head=null,this.wbits=0,this.wsize=0,this.whave=0,this.wnext=0,this.window=null,this.hold=0,this.bits=0,this.length=0,this.offset=0,this.extra=0,this.lencode=null,this.distcode=null,this.lenbits=0,this.distbits=0,this.ncode=0,this.nlen=0,this.ndist=0,this.have=0,this.next=null,this.lens=new r.Buf16(320),this.work=new r.Buf16(288),this.lendyn=null,this.distdyn=null,this.sane=0,this.back=0,this.was=0}function S(v){var R;return v&&v.state?(R=v.state,v.total_in=v.total_out=R.total=0,v.msg="",R.wrap&&(v.adler=1&R.wrap),R.mode=y,R.last=0,R.havedict=0,R.dmax=32768,R.head=null,R.hold=0,R.bits=0,R.lencode=R.lendyn=new r.Buf32(u),R.distcode=R.distdyn=new r.Buf32(x),R.sane=1,R.back=-1,g):d}function E(v){var R;return v&&v.state?((R=v.state).wsize=0,R.whave=0,R.wnext=0,S(v)):d}function A(v,R){var h,F;return v&&v.state?(F=v.state,R<0?(h=0,R=-R):(h=1+(R>>4),R<48&&(R&=15)),R&&(R<8||15<R)?d:(F.window!==null&&F.wbits!==R&&(F.window=null),F.wrap=h,F.wbits=R,E(v))):d}function w(v,R){var h,F;return v?(F=new b,(v.state=F).window=null,(h=A(v,R))!==g&&(v.state=null),h):d}var k,N,B=!0;function I(v){if(B){var R;for(k=new r.Buf32(512),N=new r.Buf32(32),R=0;R<144;)v.lens[R++]=8;for(;R<256;)v.lens[R++]=9;for(;R<280;)v.lens[R++]=7;for(;R<288;)v.lens[R++]=8;for(c(p,v.lens,0,288,k,0,v.work,{bits:9}),R=0;R<32;)v.lens[R++]=5;c(m,v.lens,0,32,N,0,v.work,{bits:5}),B=!1}v.lencode=k,v.lenbits=9,v.distcode=N,v.distbits=5}function P(v,R,h,F){var q,G=v.state;return G.window===null&&(G.wsize=1<<G.wbits,G.wnext=0,G.whave=0,G.window=new r.Buf8(G.wsize)),F>=G.wsize?(r.arraySet(G.window,R,h-G.wsize,G.wsize,0),G.wnext=0,G.whave=G.wsize):(F<(q=G.wsize-G.wnext)&&(q=F),r.arraySet(G.window,R,h-F,q,G.wnext),(F-=q)?(r.arraySet(G.window,R,h-F,F,0),G.wnext=F,G.whave=G.wsize):(G.wnext+=q,G.wnext===G.wsize&&(G.wnext=0),G.whave<G.wsize&&(G.whave+=q))),0}a.inflateReset=E,a.inflateReset2=A,a.inflateResetKeep=S,a.inflateInit=function(v){return w(v,15)},a.inflateInit2=w,a.inflate=function(v,R){var h,F,q,G,tt,V,Q,L,D,et,J,K,ot,lt,rt,nt,st,ct,mt,xt,f,Z,z,M,C=0,_=new r.Buf8(4),W=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15];if(!v||!v.state||!v.output||!v.input&&v.avail_in!==0)return d;(h=v.state).mode===12&&(h.mode=13),tt=v.next_out,q=v.output,Q=v.avail_out,G=v.next_in,F=v.input,V=v.avail_in,L=h.hold,D=h.bits,et=V,J=Q,Z=g;t:for(;;)switch(h.mode){case y:if(h.wrap===0){h.mode=13;break}for(;D<16;){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}if(2&h.wrap&&L===35615){_[h.check=0]=255&L,_[1]=L>>>8&255,h.check=o(h.check,_,2,0),D=L=0,h.mode=2;break}if(h.flags=0,h.head&&(h.head.done=!1),!(1&h.wrap)||(((255&L)<<8)+(L>>8))%31){v.msg="incorrect header check",h.mode=30;break}if((15&L)!=8){v.msg="unknown compression method",h.mode=30;break}if(D-=4,f=8+(15&(L>>>=4)),h.wbits===0)h.wbits=f;else if(f>h.wbits){v.msg="invalid window size",h.mode=30;break}h.dmax=1<<f,v.adler=h.check=1,h.mode=512&L?10:12,D=L=0;break;case 2:for(;D<16;){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}if(h.flags=L,(255&h.flags)!=8){v.msg="unknown compression method",h.mode=30;break}if(57344&h.flags){v.msg="unknown header flags set",h.mode=30;break}h.head&&(h.head.text=L>>8&1),512&h.flags&&(_[0]=255&L,_[1]=L>>>8&255,h.check=o(h.check,_,2,0)),D=L=0,h.mode=3;case 3:for(;D<32;){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}h.head&&(h.head.time=L),512&h.flags&&(_[0]=255&L,_[1]=L>>>8&255,_[2]=L>>>16&255,_[3]=L>>>24&255,h.check=o(h.check,_,4,0)),D=L=0,h.mode=4;case 4:for(;D<16;){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}h.head&&(h.head.xflags=255&L,h.head.os=L>>8),512&h.flags&&(_[0]=255&L,_[1]=L>>>8&255,h.check=o(h.check,_,2,0)),D=L=0,h.mode=5;case 5:if(1024&h.flags){for(;D<16;){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}h.length=L,h.head&&(h.head.extra_len=L),512&h.flags&&(_[0]=255&L,_[1]=L>>>8&255,h.check=o(h.check,_,2,0)),D=L=0}else h.head&&(h.head.extra=null);h.mode=6;case 6:if(1024&h.flags&&(V<(K=h.length)&&(K=V),K&&(h.head&&(f=h.head.extra_len-h.length,h.head.extra||(h.head.extra=new Array(h.head.extra_len)),r.arraySet(h.head.extra,F,G,K,f)),512&h.flags&&(h.check=o(h.check,F,K,G)),V-=K,G+=K,h.length-=K),h.length))break t;h.length=0,h.mode=7;case 7:if(2048&h.flags){if(V===0)break t;for(K=0;f=F[G+K++],h.head&&f&&h.length<65536&&(h.head.name+=String.fromCharCode(f)),f&&K<V;);if(512&h.flags&&(h.check=o(h.check,F,K,G)),V-=K,G+=K,f)break t}else h.head&&(h.head.name=null);h.length=0,h.mode=8;case 8:if(4096&h.flags){if(V===0)break t;for(K=0;f=F[G+K++],h.head&&f&&h.length<65536&&(h.head.comment+=String.fromCharCode(f)),f&&K<V;);if(512&h.flags&&(h.check=o(h.check,F,K,G)),V-=K,G+=K,f)break t}else h.head&&(h.head.comment=null);h.mode=9;case 9:if(512&h.flags){for(;D<16;){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}if(L!==(65535&h.check)){v.msg="header crc mismatch",h.mode=30;break}D=L=0}h.head&&(h.head.hcrc=h.flags>>9&1,h.head.done=!0),v.adler=h.check=0,h.mode=12;break;case 10:for(;D<32;){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}v.adler=h.check=T(L),D=L=0,h.mode=11;case 11:if(h.havedict===0)return v.next_out=tt,v.avail_out=Q,v.next_in=G,v.avail_in=V,h.hold=L,h.bits=D,2;v.adler=h.check=1,h.mode=12;case 12:if(R===5||R===6)break t;case 13:if(h.last){L>>>=7&D,D-=7&D,h.mode=27;break}for(;D<3;){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}switch(h.last=1&L,D-=1,3&(L>>>=1)){case 0:h.mode=14;break;case 1:if(I(h),h.mode=20,R!==6)break;L>>>=2,D-=2;break t;case 2:h.mode=17;break;case 3:v.msg="invalid block type",h.mode=30}L>>>=2,D-=2;break;case 14:for(L>>>=7&D,D-=7&D;D<32;){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}if((65535&L)!=(L>>>16^65535)){v.msg="invalid stored block lengths",h.mode=30;break}if(h.length=65535&L,D=L=0,h.mode=15,R===6)break t;case 15:h.mode=16;case 16:if(K=h.length){if(V<K&&(K=V),Q<K&&(K=Q),K===0)break t;r.arraySet(q,F,G,K,tt),V-=K,G+=K,Q-=K,tt+=K,h.length-=K;break}h.mode=12;break;case 17:for(;D<14;){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}if(h.nlen=257+(31&L),L>>>=5,D-=5,h.ndist=1+(31&L),L>>>=5,D-=5,h.ncode=4+(15&L),L>>>=4,D-=4,286<h.nlen||30<h.ndist){v.msg="too many length or distance symbols",h.mode=30;break}h.have=0,h.mode=18;case 18:for(;h.have<h.ncode;){for(;D<3;){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}h.lens[W[h.have++]]=7&L,L>>>=3,D-=3}for(;h.have<19;)h.lens[W[h.have++]]=0;if(h.lencode=h.lendyn,h.lenbits=7,z={bits:h.lenbits},Z=c(0,h.lens,0,19,h.lencode,0,h.work,z),h.lenbits=z.bits,Z){v.msg="invalid code lengths set",h.mode=30;break}h.have=0,h.mode=19;case 19:for(;h.have<h.nlen+h.ndist;){for(;nt=(C=h.lencode[L&(1<<h.lenbits)-1])>>>16&255,st=65535&C,!((rt=C>>>24)<=D);){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}if(st<16)L>>>=rt,D-=rt,h.lens[h.have++]=st;else{if(st===16){for(M=rt+2;D<M;){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}if(L>>>=rt,D-=rt,h.have===0){v.msg="invalid bit length repeat",h.mode=30;break}f=h.lens[h.have-1],K=3+(3&L),L>>>=2,D-=2}else if(st===17){for(M=rt+3;D<M;){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}D-=rt,f=0,K=3+(7&(L>>>=rt)),L>>>=3,D-=3}else{for(M=rt+7;D<M;){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}D-=rt,f=0,K=11+(127&(L>>>=rt)),L>>>=7,D-=7}if(h.have+K>h.nlen+h.ndist){v.msg="invalid bit length repeat",h.mode=30;break}for(;K--;)h.lens[h.have++]=f}}if(h.mode===30)break;if(h.lens[256]===0){v.msg="invalid code -- missing end-of-block",h.mode=30;break}if(h.lenbits=9,z={bits:h.lenbits},Z=c(p,h.lens,0,h.nlen,h.lencode,0,h.work,z),h.lenbits=z.bits,Z){v.msg="invalid literal/lengths set",h.mode=30;break}if(h.distbits=6,h.distcode=h.distdyn,z={bits:h.distbits},Z=c(m,h.lens,h.nlen,h.ndist,h.distcode,0,h.work,z),h.distbits=z.bits,Z){v.msg="invalid distances set",h.mode=30;break}if(h.mode=20,R===6)break t;case 20:h.mode=21;case 21:if(6<=V&&258<=Q){v.next_out=tt,v.avail_out=Q,v.next_in=G,v.avail_in=V,h.hold=L,h.bits=D,l(v,J),tt=v.next_out,q=v.output,Q=v.avail_out,G=v.next_in,F=v.input,V=v.avail_in,L=h.hold,D=h.bits,h.mode===12&&(h.back=-1);break}for(h.back=0;nt=(C=h.lencode[L&(1<<h.lenbits)-1])>>>16&255,st=65535&C,!((rt=C>>>24)<=D);){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}if(nt&&(240&nt)==0){for(ct=rt,mt=nt,xt=st;nt=(C=h.lencode[xt+((L&(1<<ct+mt)-1)>>ct)])>>>16&255,st=65535&C,!(ct+(rt=C>>>24)<=D);){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}L>>>=ct,D-=ct,h.back+=ct}if(L>>>=rt,D-=rt,h.back+=rt,h.length=st,nt===0){h.mode=26;break}if(32&nt){h.back=-1,h.mode=12;break}if(64&nt){v.msg="invalid literal/length code",h.mode=30;break}h.extra=15&nt,h.mode=22;case 22:if(h.extra){for(M=h.extra;D<M;){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}h.length+=L&(1<<h.extra)-1,L>>>=h.extra,D-=h.extra,h.back+=h.extra}h.was=h.length,h.mode=23;case 23:for(;nt=(C=h.distcode[L&(1<<h.distbits)-1])>>>16&255,st=65535&C,!((rt=C>>>24)<=D);){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}if((240&nt)==0){for(ct=rt,mt=nt,xt=st;nt=(C=h.distcode[xt+((L&(1<<ct+mt)-1)>>ct)])>>>16&255,st=65535&C,!(ct+(rt=C>>>24)<=D);){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}L>>>=ct,D-=ct,h.back+=ct}if(L>>>=rt,D-=rt,h.back+=rt,64&nt){v.msg="invalid distance code",h.mode=30;break}h.offset=st,h.extra=15&nt,h.mode=24;case 24:if(h.extra){for(M=h.extra;D<M;){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}h.offset+=L&(1<<h.extra)-1,L>>>=h.extra,D-=h.extra,h.back+=h.extra}if(h.offset>h.dmax){v.msg="invalid distance too far back",h.mode=30;break}h.mode=25;case 25:if(Q===0)break t;if(K=J-Q,h.offset>K){if((K=h.offset-K)>h.whave&&h.sane){v.msg="invalid distance too far back",h.mode=30;break}ot=K>h.wnext?(K-=h.wnext,h.wsize-K):h.wnext-K,K>h.length&&(K=h.length),lt=h.window}else lt=q,ot=tt-h.offset,K=h.length;for(Q<K&&(K=Q),Q-=K,h.length-=K;q[tt++]=lt[ot++],--K;);h.length===0&&(h.mode=21);break;case 26:if(Q===0)break t;q[tt++]=h.length,Q--,h.mode=21;break;case 27:if(h.wrap){for(;D<32;){if(V===0)break t;V--,L|=F[G++]<<D,D+=8}if(J-=Q,v.total_out+=J,h.total+=J,J&&(v.adler=h.check=h.flags?o(h.check,q,J,tt-J):i(h.check,q,J,tt-J)),J=Q,(h.flags?L:T(L))!==h.check){v.msg="incorrect data check",h.mode=30;break}D=L=0}h.mode=28;case 28:if(h.wrap&&h.flags){for(;D<32;){if(V===0)break t;V--,L+=F[G++]<<D,D+=8}if(L!==(4294967295&h.total)){v.msg="incorrect length check",h.mode=30;break}D=L=0}h.mode=29;case 29:Z=1;break t;case 30:Z=-3;break t;case 31:return-4;default:return d}return v.next_out=tt,v.avail_out=Q,v.next_in=G,v.avail_in=V,h.hold=L,h.bits=D,(h.wsize||J!==v.avail_out&&h.mode<30&&(h.mode<27||R!==4))&&P(v,v.output,v.next_out,J-v.avail_out)?(h.mode=31,-4):(et-=v.avail_in,J-=v.avail_out,v.total_in+=et,v.total_out+=J,h.total+=J,h.wrap&&J&&(v.adler=h.check=h.flags?o(h.check,q,J,v.next_out-J):i(h.check,q,J,v.next_out-J)),v.data_type=h.bits+(h.last?64:0)+(h.mode===12?128:0)+(h.mode===20||h.mode===15?256:0),(et==0&&J===0||R===4)&&Z===g&&(Z=-5),Z)},a.inflateEnd=function(v){if(!v||!v.state)return d;var R=v.state;return R.window&&(R.window=null),v.state=null,g},a.inflateGetHeader=function(v,R){var h;return v&&v.state?(2&(h=v.state).wrap)==0?d:((h.head=R).done=!1,g):d},a.inflateSetDictionary=function(v,R){var h,F=R.length;return v&&v.state?(h=v.state).wrap!==0&&h.mode!==11?d:h.mode===11&&i(1,R,F,0)!==h.check?-3:P(v,R,F,F)?(h.mode=31,-4):(h.havedict=1,g):d},a.inflateInfo="pako inflate (from Nodeca project)"},{"../utils/common":41,"./adler32":43,"./crc32":45,"./inffast":48,"./inftrees":50}],50:[function(e,s,a){var r=e("../utils/common"),i=[3,4,5,6,7,8,9,10,11,13,15,17,19,23,27,31,35,43,51,59,67,83,99,115,131,163,195,227,258,0,0],o=[16,16,16,16,16,16,16,16,17,17,17,17,18,18,18,18,19,19,19,19,20,20,20,20,21,21,21,21,16,72,78],l=[1,2,3,4,5,7,9,13,17,25,33,49,65,97,129,193,257,385,513,769,1025,1537,2049,3073,4097,6145,8193,12289,16385,24577,0,0],c=[16,16,16,16,17,17,18,18,19,19,20,20,21,21,22,22,23,23,24,24,25,25,26,26,27,27,28,28,29,29,64,64];s.exports=function(p,m,g,d,y,u,x,T){var b,S,E,A,w,k,N,B,I,P=T.bits,v=0,R=0,h=0,F=0,q=0,G=0,tt=0,V=0,Q=0,L=0,D=null,et=0,J=new r.Buf16(16),K=new r.Buf16(16),ot=null,lt=0;for(v=0;v<=15;v++)J[v]=0;for(R=0;R<d;R++)J[m[g+R]]++;for(q=P,F=15;1<=F&&J[F]===0;F--);if(F<q&&(q=F),F===0)return y[u++]=20971520,y[u++]=20971520,T.bits=1,0;for(h=1;h<F&&J[h]===0;h++);for(q<h&&(q=h),v=V=1;v<=15;v++)if(V<<=1,(V-=J[v])<0)return-1;if(0<V&&(p===0||F!==1))return-1;for(K[1]=0,v=1;v<15;v++)K[v+1]=K[v]+J[v];for(R=0;R<d;R++)m[g+R]!==0&&(x[K[m[g+R]]++]=R);if(k=p===0?(D=ot=x,19):p===1?(D=i,et-=257,ot=o,lt-=257,256):(D=l,ot=c,-1),v=h,w=u,tt=R=L=0,E=-1,A=(Q=1<<(G=q))-1,p===1&&852<Q||p===2&&592<Q)return 1;for(;;){for(N=v-tt,I=x[R]<k?(B=0,x[R]):x[R]>k?(B=ot[lt+x[R]],D[et+x[R]]):(B=96,0),b=1<<v-tt,h=S=1<<G;y[w+(L>>tt)+(S-=b)]=N<<24|B<<16|I|0,S!==0;);for(b=1<<v-1;L&b;)b>>=1;if(b!==0?(L&=b-1,L+=b):L=0,R++,--J[v]==0){if(v===F)break;v=m[g+x[R]]}if(q<v&&(L&A)!==E){for(tt===0&&(tt=q),w+=h,V=1<<(G=v-tt);G+tt<F&&!((V-=J[G+tt])<=0);)G++,V<<=1;if(Q+=1<<G,p===1&&852<Q||p===2&&592<Q)return 1;y[E=L&A]=q<<24|G<<16|w-u|0}}return L!==0&&(y[w+L]=v-tt<<24|64<<16|0),T.bits=q,0}},{"../utils/common":41}],51:[function(e,s,a){s.exports={2:"need dictionary",1:"stream end",0:"","-1":"file error","-2":"stream error","-3":"data error","-4":"insufficient memory","-5":"buffer error","-6":"incompatible version"}},{}],52:[function(e,s,a){var r=e("../utils/common"),i=0,o=1;function l(C){for(var _=C.length;0<=--_;)C[_]=0}var c=0,p=29,m=256,g=m+1+p,d=30,y=19,u=2*g+1,x=15,T=16,b=7,S=256,E=16,A=17,w=18,k=[0,0,0,0,0,0,0,0,1,1,1,1,2,2,2,2,3,3,3,3,4,4,4,4,5,5,5,5,0],N=[0,0,0,0,1,1,2,2,3,3,4,4,5,5,6,6,7,7,8,8,9,9,10,10,11,11,12,12,13,13],B=[0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,2,3,7],I=[16,17,18,0,8,7,9,6,10,5,11,4,12,3,13,2,14,1,15],P=new Array(2*(g+2));l(P);var v=new Array(2*d);l(v);var R=new Array(512);l(R);var h=new Array(256);l(h);var F=new Array(p);l(F);var q,G,tt,V=new Array(d);function Q(C,_,W,Y,O){this.static_tree=C,this.extra_bits=_,this.extra_base=W,this.elems=Y,this.max_length=O,this.has_stree=C&&C.length}function L(C,_){this.dyn_tree=C,this.max_code=0,this.stat_desc=_}function D(C){return C<256?R[C]:R[256+(C>>>7)]}function et(C,_){C.pending_buf[C.pending++]=255&_,C.pending_buf[C.pending++]=_>>>8&255}function J(C,_,W){C.bi_valid>T-W?(C.bi_buf|=_<<C.bi_valid&65535,et(C,C.bi_buf),C.bi_buf=_>>T-C.bi_valid,C.bi_valid+=W-T):(C.bi_buf|=_<<C.bi_valid&65535,C.bi_valid+=W)}function K(C,_,W){J(C,W[2*_],W[2*_+1])}function ot(C,_){for(var W=0;W|=1&C,C>>>=1,W<<=1,0<--_;);return W>>>1}function lt(C,_,W){var Y,O,$=new Array(x+1),j=0;for(Y=1;Y<=x;Y++)$[Y]=j=j+W[Y-1]<<1;for(O=0;O<=_;O++){var U=C[2*O+1];U!==0&&(C[2*O]=ot($[U]++,U))}}function rt(C){var _;for(_=0;_<g;_++)C.dyn_ltree[2*_]=0;for(_=0;_<d;_++)C.dyn_dtree[2*_]=0;for(_=0;_<y;_++)C.bl_tree[2*_]=0;C.dyn_ltree[2*S]=1,C.opt_len=C.static_len=0,C.last_lit=C.matches=0}function nt(C){8<C.bi_valid?et(C,C.bi_buf):0<C.bi_valid&&(C.pending_buf[C.pending++]=C.bi_buf),C.bi_buf=0,C.bi_valid=0}function st(C,_,W,Y){var O=2*_,$=2*W;return C[O]<C[$]||C[O]===C[$]&&Y[_]<=Y[W]}function ct(C,_,W){for(var Y=C.heap[W],O=W<<1;O<=C.heap_len&&(O<C.heap_len&&st(_,C.heap[O+1],C.heap[O],C.depth)&&O++,!st(_,Y,C.heap[O],C.depth));)C.heap[W]=C.heap[O],W=O,O<<=1;C.heap[W]=Y}function mt(C,_,W){var Y,O,$,j,U=0;if(C.last_lit!==0)for(;Y=C.pending_buf[C.d_buf+2*U]<<8|C.pending_buf[C.d_buf+2*U+1],O=C.pending_buf[C.l_buf+U],U++,Y===0?K(C,O,_):(K(C,($=h[O])+m+1,_),(j=k[$])!==0&&J(C,O-=F[$],j),K(C,$=D(--Y),W),(j=N[$])!==0&&J(C,Y-=V[$],j)),U<C.last_lit;);K(C,S,_)}function xt(C,_){var W,Y,O,$=_.dyn_tree,j=_.stat_desc.static_tree,U=_.stat_desc.has_stree,X=_.stat_desc.elems,at=-1;for(C.heap_len=0,C.heap_max=u,W=0;W<X;W++)$[2*W]!==0?(C.heap[++C.heap_len]=at=W,C.depth[W]=0):$[2*W+1]=0;for(;C.heap_len<2;)$[2*(O=C.heap[++C.heap_len]=at<2?++at:0)]=1,C.depth[O]=0,C.opt_len--,U&&(C.static_len-=j[2*O+1]);for(_.max_code=at,W=C.heap_len>>1;1<=W;W--)ct(C,$,W);for(O=X;W=C.heap[1],C.heap[1]=C.heap[C.heap_len--],ct(C,$,1),Y=C.heap[1],C.heap[--C.heap_max]=W,C.heap[--C.heap_max]=Y,$[2*O]=$[2*W]+$[2*Y],C.depth[O]=(C.depth[W]>=C.depth[Y]?C.depth[W]:C.depth[Y])+1,$[2*W+1]=$[2*Y+1]=O,C.heap[1]=O++,ct(C,$,1),2<=C.heap_len;);C.heap[--C.heap_max]=C.heap[1],(function(it,pt){var Mt,Ct,Dt,ft,bt,At,St=pt.dyn_tree,Et=pt.max_code,Fe=pt.stat_desc.static_tree,Be=pt.stat_desc.has_stree,se=pt.stat_desc.extra_bits,oe=pt.stat_desc.extra_base,Lt=pt.stat_desc.max_length,Nt=0;for(ft=0;ft<=x;ft++)it.bl_count[ft]=0;for(St[2*it.heap[it.heap_max]+1]=0,Mt=it.heap_max+1;Mt<u;Mt++)Lt<(ft=St[2*St[2*(Ct=it.heap[Mt])+1]+1]+1)&&(ft=Lt,Nt++),St[2*Ct+1]=ft,Et<Ct||(it.bl_count[ft]++,bt=0,oe<=Ct&&(bt=se[Ct-oe]),At=St[2*Ct],it.opt_len+=At*(ft+bt),Be&&(it.static_len+=At*(Fe[2*Ct+1]+bt)));if(Nt!==0){do{for(ft=Lt-1;it.bl_count[ft]===0;)ft--;it.bl_count[ft]--,it.bl_count[ft+1]+=2,it.bl_count[Lt]--,Nt-=2}while(0<Nt);for(ft=Lt;ft!==0;ft--)for(Ct=it.bl_count[ft];Ct!==0;)Et<(Dt=it.heap[--Mt])||(St[2*Dt+1]!==ft&&(it.opt_len+=(ft-St[2*Dt+1])*St[2*Dt],St[2*Dt+1]=ft),Ct--)}})(C,_),lt($,at,C.bl_count)}function f(C,_,W){var Y,O,$=-1,j=_[1],U=0,X=7,at=4;for(j===0&&(X=138,at=3),_[2*(W+1)+1]=65535,Y=0;Y<=W;Y++)O=j,j=_[2*(Y+1)+1],++U<X&&O===j||(U<at?C.bl_tree[2*O]+=U:O!==0?(O!==$&&C.bl_tree[2*O]++,C.bl_tree[2*E]++):U<=10?C.bl_tree[2*A]++:C.bl_tree[2*w]++,$=O,at=(U=0)===j?(X=138,3):O===j?(X=6,3):(X=7,4))}function Z(C,_,W){var Y,O,$=-1,j=_[1],U=0,X=7,at=4;for(j===0&&(X=138,at=3),Y=0;Y<=W;Y++)if(O=j,j=_[2*(Y+1)+1],!(++U<X&&O===j)){if(U<at)for(;K(C,O,C.bl_tree),--U!=0;);else O!==0?(O!==$&&(K(C,O,C.bl_tree),U--),K(C,E,C.bl_tree),J(C,U-3,2)):U<=10?(K(C,A,C.bl_tree),J(C,U-3,3)):(K(C,w,C.bl_tree),J(C,U-11,7));$=O,at=(U=0)===j?(X=138,3):O===j?(X=6,3):(X=7,4)}}l(V);var z=!1;function M(C,_,W,Y){J(C,(c<<1)+(Y?1:0),3),(function(O,$,j,U){nt(O),et(O,j),et(O,~j),r.arraySet(O.pending_buf,O.window,$,j,O.pending),O.pending+=j})(C,_,W)}a._tr_init=function(C){z||((function(){var _,W,Y,O,$,j=new Array(x+1);for(O=Y=0;O<p-1;O++)for(F[O]=Y,_=0;_<1<<k[O];_++)h[Y++]=O;for(h[Y-1]=O,O=$=0;O<16;O++)for(V[O]=$,_=0;_<1<<N[O];_++)R[$++]=O;for($>>=7;O<d;O++)for(V[O]=$<<7,_=0;_<1<<N[O]-7;_++)R[256+$++]=O;for(W=0;W<=x;W++)j[W]=0;for(_=0;_<=143;)P[2*_+1]=8,_++,j[8]++;for(;_<=255;)P[2*_+1]=9,_++,j[9]++;for(;_<=279;)P[2*_+1]=7,_++,j[7]++;for(;_<=287;)P[2*_+1]=8,_++,j[8]++;for(lt(P,g+1,j),_=0;_<d;_++)v[2*_+1]=5,v[2*_]=ot(_,5);q=new Q(P,k,m+1,g,x),G=new Q(v,N,0,d,x),tt=new Q(new Array(0),B,0,y,b)})(),z=!0),C.l_desc=new L(C.dyn_ltree,q),C.d_desc=new L(C.dyn_dtree,G),C.bl_desc=new L(C.bl_tree,tt),C.bi_buf=0,C.bi_valid=0,rt(C)},a._tr_stored_block=M,a._tr_flush_block=function(C,_,W,Y){var O,$,j=0;0<C.level?(C.strm.data_type===2&&(C.strm.data_type=(function(U){var X,at=4093624447;for(X=0;X<=31;X++,at>>>=1)if(1&at&&U.dyn_ltree[2*X]!==0)return i;if(U.dyn_ltree[18]!==0||U.dyn_ltree[20]!==0||U.dyn_ltree[26]!==0)return o;for(X=32;X<m;X++)if(U.dyn_ltree[2*X]!==0)return o;return i})(C)),xt(C,C.l_desc),xt(C,C.d_desc),j=(function(U){var X;for(f(U,U.dyn_ltree,U.l_desc.max_code),f(U,U.dyn_dtree,U.d_desc.max_code),xt(U,U.bl_desc),X=y-1;3<=X&&U.bl_tree[2*I[X]+1]===0;X--);return U.opt_len+=3*(X+1)+5+5+4,X})(C),O=C.opt_len+3+7>>>3,($=C.static_len+3+7>>>3)<=O&&(O=$)):O=$=W+5,W+4<=O&&_!==-1?M(C,_,W,Y):C.strategy===4||$===O?(J(C,2+(Y?1:0),3),mt(C,P,v)):(J(C,4+(Y?1:0),3),(function(U,X,at,it){var pt;for(J(U,X-257,5),J(U,at-1,5),J(U,it-4,4),pt=0;pt<it;pt++)J(U,U.bl_tree[2*I[pt]+1],3);Z(U,U.dyn_ltree,X-1),Z(U,U.dyn_dtree,at-1)})(C,C.l_desc.max_code+1,C.d_desc.max_code+1,j+1),mt(C,C.dyn_ltree,C.dyn_dtree)),rt(C),Y&&nt(C)},a._tr_tally=function(C,_,W){return C.pending_buf[C.d_buf+2*C.last_lit]=_>>>8&255,C.pending_buf[C.d_buf+2*C.last_lit+1]=255&_,C.pending_buf[C.l_buf+C.last_lit]=255&W,C.last_lit++,_===0?C.dyn_ltree[2*W]++:(C.matches++,_--,C.dyn_ltree[2*(h[W]+m+1)]++,C.dyn_dtree[2*D(_)]++),C.last_lit===C.lit_bufsize-1},a._tr_align=function(C){J(C,2,3),K(C,S,P),(function(_){_.bi_valid===16?(et(_,_.bi_buf),_.bi_buf=0,_.bi_valid=0):8<=_.bi_valid&&(_.pending_buf[_.pending++]=255&_.bi_buf,_.bi_buf>>=8,_.bi_valid-=8)})(C)}},{"../utils/common":41}],53:[function(e,s,a){s.exports=function(){this.input=null,this.next_in=0,this.avail_in=0,this.total_in=0,this.output=null,this.next_out=0,this.avail_out=0,this.total_out=0,this.msg="",this.state=null,this.data_type=2,this.adler=0}},{}],54:[function(e,s,a){(function(r){(function(i,o){if(!i.setImmediate){var l,c,p,m,g=1,d={},y=!1,u=i.document,x=Object.getPrototypeOf&&Object.getPrototypeOf(i);x=x&&x.setTimeout?x:i,l={}.toString.call(i.process)==="[object process]"?function(E){process.nextTick(function(){b(E)})}:(function(){if(i.postMessage&&!i.importScripts){var E=!0,A=i.onmessage;return i.onmessage=function(){E=!1},i.postMessage("","*"),i.onmessage=A,E}})()?(m="setImmediate$"+Math.random()+"$",i.addEventListener?i.addEventListener("message",S,!1):i.attachEvent("onmessage",S),function(E){i.postMessage(m+E,"*")}):i.MessageChannel?((p=new MessageChannel).port1.onmessage=function(E){b(E.data)},function(E){p.port2.postMessage(E)}):u&&"onreadystatechange"in u.createElement("script")?(c=u.documentElement,function(E){var A=u.createElement("script");A.onreadystatechange=function(){b(E),A.onreadystatechange=null,c.removeChild(A),A=null},c.appendChild(A)}):function(E){setTimeout(b,0,E)},x.setImmediate=function(E){typeof E!="function"&&(E=new Function(""+E));for(var A=new Array(arguments.length-1),w=0;w<A.length;w++)A[w]=arguments[w+1];var k={callback:E,args:A};return d[g]=k,l(g),g++},x.clearImmediate=T}function T(E){delete d[E]}function b(E){if(y)setTimeout(b,0,E);else{var A=d[E];if(A){y=!0;try{(function(w){var k=w.callback,N=w.args;switch(N.length){case 0:k();break;case 1:k(N[0]);break;case 2:k(N[0],N[1]);break;case 3:k(N[0],N[1],N[2]);break;default:k.apply(o,N)}})(A)}finally{T(E),y=!1}}}}function S(E){E.source===i&&typeof E.data=="string"&&E.data.indexOf(m)===0&&b(+E.data.slice(m.length))}})(typeof self>"u"?r===void 0?this:r:self)}).call(this,typeof ve<"u"?ve:typeof self<"u"?self:typeof window<"u"?window:{})},{}]},{},[10])(10)})})(He)),He.exports}var Ja=Ka();const an=Qa(Ja);function ts(n){if(n.length===0)return new Float32Array(0);if(n.length%4!==0)throw new Error(`Byte-shuffled float32 payload has invalid length (${n.length}).`);const t=n.length/4,e=new Uint8Array(n.length);for(let s=0;s<4;s+=1){const a=s*t;let r=s;for(let i=0;i<t;i+=1)e[r]=n[a+i],r+=4}return new Float32Array(e.buffer)}function es(n){if(n.length===0)return new Float32Array(0);if(n.length%4!==0)throw new Error(`XOR-delta byte-shuffled float32 payload has invalid length (${n.length}).`);const t=n.length/4,e=rs(n,t),s=new Uint32Array(e.buffer),a=new Uint32Array(t);let r=0;for(let i=0;i<t;i+=1){const o=s[i]^r;a[i]=o,r=o}return new Float32Array(a.buffer)}function ns(n){if(n.length===0)return new Uint8Array(0);if(n.length%4!==0)throw new Error(`Channel-major float32 source length must be divisible by 4 (${n.length}).`);const t=n.length/4,e=new Float32Array(n.length);for(let s=0;s<4;s+=1){const a=s*t;let r=s;for(let i=0;i<t;i+=1)e[a+i]=n[r],r+=4}return new Uint8Array(e.buffer)}function is(n){if(n.length===0)return new Float32Array(0);if(n.length%16!==0)throw new Error(`Channel-major float32 payload has invalid length (${n.length}).`);const t=new Float32Array(n.buffer,n.byteOffset,n.byteLength/4),e=t.length/4,s=new Float32Array(t.length);for(let a=0;a<4;a+=1){const r=a*e;let i=a;for(let o=0;o<e;o+=1)s[i]=t[r+o],i+=4}return s}function rs(n,t){const e=new Uint8Array(n.length);for(let s=0;s<4;s+=1){const a=s*t;let r=s;for(let i=0;i<t;i+=1)e[r]=n[a+i],r+=4}return e}async function Qs(n,t,e,s,a,r,i={}){const o=i.encodeRasterImages??!0,l=i.zipCompression??"DEFLATE",c=i.zipDeflateLevel??9,p=new an,m=as(n,t,a),d=!!s&&s.length>0&&n.imagePaintOpCount>0&&r.length===0,y=d?[]:r,u=y[0]??null,x=d?"source/source.pdf":void 0;for(const A of m){const w=Cs(A);p.file(A.filePath,w)}x&&s&&p.file(x,s);const T=[];for(let A=0;A<y.length;A+=1){const w=y[A],k=w.width*w.height*4,N=w.data.subarray(0,k);let B=`raster/layer-${A}.rgba`,I="rgba",P=N;if(o){const v=await xs(w.width,w.height,N);v&&(B=`raster/layer-${A}.${v.extension}`,I=v.encoding,P=v.bytes)}p.file(B,P,{compression:"STORE"}),T.push({width:w.width,height:w.height,matrix:Array.from(w.matrix),file:B,encoding:I})}const b={formatVersion:3,sourceFile:e,sourcePdfFile:x,sourcePdfSizeBytes:d?s?.length??0:0,generatedAt:new Date().toISOString(),scene:{bounds:n.bounds,pageBounds:n.pageBounds,pageRects:Array.from(n.pageRects),pageTextRanges:Array.from(n.pageTextRanges),pageCount:n.pageCount,pagesPerRow:n.pagesPerRow,maxHalfWidth:n.maxHalfWidth,operatorCount:n.operatorCount,imagePaintOpCount:n.imagePaintOpCount,pathCount:n.pathCount,sourceSegmentCount:n.sourceSegmentCount,mergedSegmentCount:n.mergedSegmentCount,segmentCount:n.segmentCount,fillPathCount:n.fillPathCount,fillSegmentCount:n.fillSegmentCount,textInstanceCount:n.textInstanceCount,textGlyphCount:n.textGlyphCount,textGlyphPrimitiveCount:n.textGlyphSegmentCount,rasterLayers:T,rasterLayerWidth:u?.width??0,rasterLayerHeight:u?.height??0,rasterLayerMatrix:u?Array.from(u.matrix):void 0,rasterLayerFile:T[0]?.file},textures:m.map(A=>({name:A.name,file:A.filePath,width:A.width,height:A.height,channels:4,componentType:A.componentType,layout:A.layout,quantizationMin:A.quantizationMin,quantizationMax:A.quantizationMax,byteShuffle:!1,predictor:"none",logicalItemCount:A.logicalItemCount,logicalFloatCount:A.logicalFloatCount,byteLength:A.data.byteLength,paddedFloatCount:A.logicalFloatCount}))};p.file("manifest.json",JSON.stringify(b,null,2));const S=l==="DEFLATE"?{type:"blob",compression:"DEFLATE",compressionOptions:{level:c}}:{type:"blob",compression:"STORE"},E=await p.generateAsync(S);return{blob:E,byteLength:E.size,textureCount:m.length,rasterLayerCount:y.length,layout:a}}function as(n,t,e){return[Rt("fill-path-meta-a",n.fillPathMetaA,t.fillPathTextureWidth,t.fillPathTextureHeight,n.fillPathCount,e),Rt("fill-path-meta-b",n.fillPathMetaB,t.fillPathTextureWidth,t.fillPathTextureHeight,n.fillPathCount,e),Rt("fill-path-meta-c",n.fillPathMetaC,t.fillPathTextureWidth,t.fillPathTextureHeight,n.fillPathCount,e),Rt("fill-primitives-a",n.fillSegmentsA,t.fillSegmentTextureWidth,t.fillSegmentTextureHeight,n.fillSegmentCount,e),Rt("fill-primitives-b",n.fillSegmentsB,t.fillSegmentTextureWidth,t.fillSegmentTextureHeight,n.fillSegmentCount,e),Rt("stroke-primitives-a",n.endpoints,t.textureWidth,t.textureHeight,n.segmentCount,e),Rt("stroke-primitives-b",n.primitiveMeta,t.textureWidth,t.textureHeight,n.segmentCount,e),Rt("stroke-styles",n.styles,t.textureWidth,t.textureHeight,n.segmentCount,e),Rt("text-instance-a",n.textInstanceA,t.textInstanceTextureWidth,t.textInstanceTextureHeight,n.textInstanceCount,e),Rt("text-instance-b",n.textInstanceB,t.textInstanceTextureWidth,t.textInstanceTextureHeight,n.textInstanceCount,e),Rt("text-instance-c",n.textInstanceC,t.textInstanceTextureWidth,t.textInstanceTextureHeight,n.textInstanceCount,e),Rt("text-glyph-meta-a",n.textGlyphMetaA,t.textGlyphTextureWidth,t.textGlyphTextureHeight,n.textGlyphCount,e),Rt("text-glyph-meta-b",n.textGlyphMetaB,t.textGlyphTextureWidth,t.textGlyphTextureHeight,n.textGlyphCount,e),Rt("text-glyph-primitives-a",n.textGlyphSegmentsA,t.textSegmentTextureWidth,t.textSegmentTextureHeight,n.textGlyphSegmentCount,e),Rt("text-glyph-primitives-b",n.textGlyphSegmentsB,t.textSegmentTextureWidth,t.textSegmentTextureHeight,n.textGlyphSegmentCount,e)]}async function Ks(n,t={}){const e=we(t.onProgress),s=await e.child(0,.16,{sourceType:"zip"}).withIndeterminateProgress(an.loadAsync(n),{stage:"zip-open",sourceType:"zip"}),a=s.file("manifest.json");if(!a)throw new Error("Parsed data zip is missing manifest.json.");const r=await e.child(.16,.22,{sourceType:"zip"}).withIndeterminateProgress(a.async("string"),{stage:"zip-manifest",sourceType:"zip"});let i;try{i=JSON.parse(r)}catch(bt){const At=bt instanceof Error?bt.message:String(bt);throw new Error(`Invalid manifest.json: ${At}`)}const o=typeof i.scene=="object"&&i.scene?i.scene:{},l=Array.isArray(i.textures)?i.textures:[],c=new Map,p=16;let m=0;const g=()=>{e.report(.22+m/p*.58,{stage:"zip-file",sourceType:"zip",unit:"files",processed:m,total:p})};for(const bt of l){const At=typeof bt.name=="string"?bt.name:null;At&&c.set(At,bt)}const d=async(bt,At)=>{try{g();for(const St of bt){const Et=c.get(St);if(!Et)continue;const Fe=Et.componentType==="uint8-normalized"?".rgba8":Et.componentType==="uint16-normalized-range"?".q16":Et.componentType==="stroke-primitive-b-u16-packed"?".spb16":typeof Et.layout=="string"&&Et.layout==="channel-major"?".f32cm":Et.byteShuffle===!0?".f32bs":".f32",Be=typeof Et.file=="string"?Et.file:`textures/${St}${Fe}`,se=s.file(Be);if(!se)continue;const oe=await se.async("arraybuffer"),Lt=Es(oe,Et,St),Nt=ut(Et.logicalFloatCount,Lt.length);if(Nt>Lt.length)throw new Error(`Texture ${St} logical float count exceeds file length.`);const _i=ut(Et.logicalItemCount,Math.floor(Nt/4));return{data:Lt.slice(0,Nt),logicalItemCount:_i}}return null}finally{m+=1,g()}},y=await d(["fill-path-meta-a"],!1),u=await d(["fill-path-meta-b"],!1),x=await d(["fill-path-meta-c"],!1),T=await d(["fill-primitives-a","fill-segments"],!1),b=await d(["fill-primitives-b"],!1),S=await d(["stroke-primitives-a","stroke-endpoints"],!1),E=await d(["stroke-primitives-b"],!1),A=await d(["stroke-styles"],!1),w=await d(["stroke-primitive-bounds"],!1),k=await d(["text-instance-a"],!1),N=await d(["text-instance-b"],!1),B=await d(["text-instance-c"],!1),I=await d(["text-glyph-meta-a"],!1),P=await d(["text-glyph-meta-b"],!1),v=await d(["text-glyph-primitives-a"],!1),R=await d(["text-glyph-primitives-b"],!1),h=ut(o.fillPathCount,y?.logicalItemCount??0),F=ut(o.fillSegmentCount,T?.logicalItemCount??0),q=ut(o.segmentCount,A?.logicalItemCount??S?.logicalItemCount??0),G=ut(o.textInstanceCount,k?.logicalItemCount??0),tt=ut(o.textGlyphCount,I?.logicalItemCount??0),V=ut(o.textGlyphPrimitiveCount,ut(o.textGlyphSegmentCount,v?.logicalItemCount??0));if(q>0&&(!S||!A))throw new Error("Parsed data zip is missing stroke geometry textures.");const Q=_t(y?.data??new Float32Array(0),h,"fill-path-meta-a"),L=_t(u?.data??new Float32Array(0),h,"fill-path-meta-b"),D=_t(x?.data??new Float32Array(0),h,"fill-path-meta-c"),et=_t(T?.data??new Float32Array(0),F,"fill-primitives-a"),J=b?_t(b.data,F,"fill-primitives-b"):Vn(et,F),K=_t(S?.data??new Float32Array(0),q,"stroke-primitives-a"),ot=_t(A?.data??new Float32Array(0),q,"stroke-styles"),lt=E?_t(E.data,q,"stroke-primitives-b"):Vn(K,q),rt=w?_t(w.data,q,"stroke-primitive-bounds"):us(K,lt,q),nt=_t(k?.data??new Float32Array(0),G,"text-instance-a"),st=_t(N?.data??new Float32Array(0),G,"text-instance-b"),ct=B?_t(B.data,G,"text-instance-c"):os(st,G),mt=_t(I?.data??new Float32Array(0),tt,"text-glyph-meta-a"),xt=_t(P?.data??new Float32Array(0),tt,"text-glyph-meta-b"),f=_t(v?.data??new Float32Array(0),V,"text-glyph-primitives-a"),Z=_t(R?.data??new Float32Array(0),V,"text-glyph-primitives-b");ls(lt,ot,q),cs(L,D,h);const z=ut(o.sourceSegmentCount,q),M=ut(o.mergedSegmentCount,q),C=ut(o.sourceTextCount,G),_=ut(o.textInPageCount,G),W=ut(o.textOutOfPageCount,Math.max(0,C-_)),Y=Math.max(1,ut(o.pageCount,1)),O=Math.max(1,ut(o.pagesPerRow,1));e.report(.82,{stage:"zip-file",sourceType:"zip",unit:"files"});let $=await vs(s,o);if(e.report(.88,{stage:"compile",sourceType:"zip"}),$.length===0){const bt=await gs(s,i);if(bt)try{const At=await Kr(Ds(bt),{maxPages:Y,maxPagesPerRow:O});$=ss(At),$.length>0&&console.log(`[Parsed data load] Restored ${$.length.toLocaleString()} raster layer(s) from embedded source PDF.`)}catch(At){const St=At instanceof Error?At.message:String(At);console.warn(`[Parsed data load] Failed to restore raster layers from source PDF: ${St}`)}}const j=$[0]??null,U=ie(o.maxHalfWidth,Number.NaN)||bs(ot,q),X=Yn(o.bounds),at=Yn(o.pageBounds),it=fs(hs(rt,q),ds(Q,L,h))??{minX:0,minY:0,maxX:1,maxY:1},pt=X??it,Mt=at??pt,Ct=ms(o.pageRects,Mt),Dt=ps(o.pageTextRanges,Math.max(1,Math.floor(Ct.length/4)),G)??yi(Ct,st,G);e.report(.96,{stage:"compile",sourceType:"zip"});const ft=xi({pageRects:Ct,pageTextRanges:Dt,fillPathCount:h,fillSegmentCount:F,fillPathMetaA:Q,fillPathMetaB:L,fillPathMetaC:D,fillSegmentsA:et,fillSegmentsB:J,segmentCount:q,sourceSegmentCount:z,mergedSegmentCount:M,sourceTextCount:C,textInstanceCount:G,textGlyphCount:tt,textGlyphSegmentCount:V,textInPageCount:_,textOutOfPageCount:W,textInstanceA:nt,textInstanceB:st,textInstanceC:ct,textGlyphMetaA:mt,textGlyphMetaB:xt,textGlyphSegmentsA:f,textGlyphSegmentsB:Z,rasterLayers:$,rasterLayerWidth:j?.width??0,rasterLayerHeight:j?.height??0,rasterLayerData:j?.data??new Uint8Array(0),rasterLayerMatrix:j?.matrix??new Float32Array([1,0,0,1,0,0]),endpoints:K,primitiveMeta:lt,primitiveBounds:rt,styles:ot,bounds:pt,pageBounds:Mt,pageCount:Y,pagesPerRow:O,maxHalfWidth:U,imagePaintOpCount:ut(o.imagePaintOpCount,0),operatorCount:ut(o.operatorCount,0),pathCount:ut(o.pathCount,0),discardedTransparentCount:ut(o.discardedTransparentCount,0),discardedDegenerateCount:ut(o.discardedDegenerateCount,0),discardedDuplicateCount:ut(o.discardedDuplicateCount,0),discardedContainedCount:ut(o.discardedContainedCount,0)});return e.complete({sourceType:"zip"}),ft}function ss(n){const t=[];if(Array.isArray(n.rasterLayers))for(const a of n.rasterLayers){const r=Math.max(0,Math.trunc(a?.width??0)),i=Math.max(0,Math.trunc(a?.height??0));if(r<=0||i<=0||!(a.data instanceof Uint8Array)||a.data.length<r*i*4)continue;const o=a.matrix instanceof Float32Array?a.matrix:new Float32Array(a.matrix);t.push({width:r,height:i,data:a.data,matrix:o})}if(t.length>0)return t;const e=Math.max(0,Math.trunc(n.rasterLayerWidth)),s=Math.max(0,Math.trunc(n.rasterLayerHeight));return e<=0||s<=0||n.rasterLayerData.length<e*s*4||t.push({width:e,height:s,data:n.rasterLayerData,matrix:n.rasterLayerMatrix}),t}function _t(n,t,e){const s=t*4;if(s===0)return new Float32Array(0);if(n.length<s)throw new Error(`Texture ${e} has insufficient data (${n.length} < ${s}).`);return n.length===s?n:n.slice(0,s)}function Vn(n,t){const e=new Float32Array(t*4);for(let s=0;s<t;s+=1){const a=s*4;e[a]=n[a+2],e[a+1]=n[a+3],e[a+2]=0,e[a+3]=0}return e}function os(n,t){const e=new Float32Array(t*4);for(let s=0;s<t;s+=1){const a=s*4,r=Ot(n[a+3]);e[a]=r,e[a+1]=r,e[a+2]=r,e[a+3]=1}return e}function Ot(n){return!Number.isFinite(n)||n<0?0:n>1?1:n}function ls(n,t,e){if(e<=0)return;let s=!1;for(let a=0;a<e;a+=1)if(Math.abs(n[a*4+3])>1e-6){s=!0;break}if(!s)for(let a=0;a<e;a+=1){const r=a*4,i=Ot(t[r+1]),o=Ot(t[r+2]),l=t[r+3]>=.5?1:0;t[r+1]=i,t[r+2]=i,t[r+3]=i,n[r+3]=o+l*2}}function cs(n,t,e){if(e<=0)return;let s=!1;for(let a=0;a<e;a+=1)if(Math.abs(t[a*4+3])>1e-6){s=!0;break}if(!s)for(let a=0;a<e;a+=1){const r=a*4,i=Ot(n[r+2]),o=Ot(n[r+3]);n[r+2]=i,n[r+3]=i,t[r+2]=i,t[r+3]=o}}function us(n,t,e){const s=new Float32Array(e*4);for(let a=0;a<e;a+=1){const r=a*4,i=n[r],o=n[r+1],l=n[r+2],c=n[r+3],p=t[r],m=t[r+1];s[r]=Math.min(i,l,p),s[r+1]=Math.min(o,c,m),s[r+2]=Math.max(i,l,p),s[r+3]=Math.max(o,c,m)}return s}function hs(n,t){if(t<=0||n.length<t*4)return null;let e=Number.POSITIVE_INFINITY,s=Number.POSITIVE_INFINITY,a=Number.NEGATIVE_INFINITY,r=Number.NEGATIVE_INFINITY;for(let i=0;i<t;i+=1){const o=i*4;e=Math.min(e,n[o]),s=Math.min(s,n[o+1]),a=Math.max(a,n[o+2]),r=Math.max(r,n[o+3])}return{minX:e,minY:s,maxX:a,maxY:r}}function ds(n,t,e){if(e<=0||n.length<e*4||t.length<e*4)return null;let s=Number.POSITIVE_INFINITY,a=Number.POSITIVE_INFINITY,r=Number.NEGATIVE_INFINITY,i=Number.NEGATIVE_INFINITY;for(let o=0;o<e;o+=1){const l=o*4;s=Math.min(s,n[l+2]),a=Math.min(a,n[l+3]),r=Math.max(r,t[l]),i=Math.max(i,t[l+1])}return{minX:s,minY:a,maxX:r,maxY:i}}function fs(n,t){return!n&&!t?null:n?t?{minX:Math.min(n.minX,t.minX),minY:Math.min(n.minY,t.minY),maxX:Math.max(n.maxX,t.maxX),maxY:Math.max(n.maxY,t.maxY)}:{...n}:t?{...t}:null}function Yn(n){if(!n||typeof n!="object")return null;const t=n,e=ie(t.minX,Number.NaN),s=ie(t.minY,Number.NaN),a=ie(t.maxX,Number.NaN),r=ie(t.maxY,Number.NaN);return[e,s,a,r].every(Number.isFinite)?{minX:e,minY:s,maxX:a,maxY:r}:null}function ms(n,t){if(Array.isArray(n)){const e=Math.floor(n.length/4);if(e>0){const s=new Float32Array(e*4);let a=0;for(let r=0;r<e;r+=1){const i=r*4,o=Number(n[i]),l=Number(n[i+1]),c=Number(n[i+2]),p=Number(n[i+3]);[o,l,c,p].every(Number.isFinite)&&(s[a]=o,s[a+1]=l,s[a+2]=c,s[a+3]=p,a+=4)}if(a>0)return s.slice(0,a)}}return new Float32Array([t.minX,t.minY,t.maxX,t.maxY])}function ps(n,t,e){if(!Array.isArray(n))return null;const s=Math.max(1,t|0);if(n.length<s*2)return null;const a=Math.max(0,e|0),r=new Uint32Array(s*2);let i=0;for(let o=0;o<s;o+=1){const l=o*2,c=ut(n[l],i),p=ut(n[l+1],0),m=Math.min(Math.max(c,i),a),g=Math.min(p,Math.max(0,a-m));r[l]=m,r[l+1]=g,i=m+g}return r}function Wn(n){if(!Array.isArray(n)||n.length<6)return null;const t=new Float32Array(6);for(let e=0;e<6;e+=1){const s=Number(n[e]);if(!Number.isFinite(s))return null;t[e]=s}return t}async function gs(n,t){const e=Ke(t.sourcePdfFile),s=Ke(t.sourcePdfUrl),a=[e,"source/source.pdf","source.pdf"];for(const r of a){if(!r)continue;const i=n.file(r);if(!i)continue;const o=await i.async("arraybuffer");if(!(o.byteLength<=0))return new Uint8Array(o)}if(s)try{const r=await fetch(ks(s));if(r.ok){const i=await r.arrayBuffer();if(i.byteLength>0)return new Uint8Array(i)}}catch{}return null}async function xs(n,t,e){const[s,a]=await Promise.all([Hn(n,t,e,"image/webp"),Hn(n,t,e,"image/png")]);return!s&&!a?null:s&&!a?{bytes:s,encoding:"webp",extension:"webp"}:a&&!s?{bytes:a,encoding:"png",extension:"png"}:!s||!a?null:s.byteLength<a.byteLength?{bytes:s,encoding:"webp",extension:"webp"}:{bytes:a,encoding:"png",extension:"png"}}async function Hn(n,t,e,s){if(typeof document>"u")return null;const a=n*t*4;if(n<=0||t<=0||e.length<a)return null;const r=document.createElement("canvas");r.width=n,r.height=t;const i=r.getContext("2d",{alpha:!0});if(!i)return r.width=0,r.height=0,null;const o=new Uint8ClampedArray(a);o.set(e.subarray(0,a));const l=new ImageData(o,n,t);i.putImageData(l,0,0);const c=await new Promise(m=>{r.toBlob(m,s)});if(r.width=0,r.height=0,!c)return null;const p=await c.arrayBuffer();return new Uint8Array(p)}function ys(n){const t=n.toLowerCase();return t.endsWith(".png")?"image/png":t.endsWith(".webp")?"image/webp":t.endsWith(".jpg")||t.endsWith(".jpeg")?"image/jpeg":null}async function Ts(n,t){if(typeof document>"u")return null;const e=ys(n);if(!e)return null;const s=new Uint8Array(t.length);s.set(t);const a=new Blob([s],{type:e}),r=await createImageBitmap(a);try{const i=r.width,o=r.height;if(i<=0||o<=0)return null;const l=document.createElement("canvas");l.width=i,l.height=o;const c=l.getContext("2d",{alpha:!0,willReadFrequently:!0});if(!c)return l.width=0,l.height=0,null;c.drawImage(r,0,0);const p=c.getImageData(0,0,i,o),m=new Uint8Array(p.data);return l.width=0,l.height=0,{width:i,height:o,data:m}}finally{r.close()}}async function Js(n){try{const t=await an.loadAsync(n),e=t.file("manifest.json");let s=null;if(e){const r=await e.async("string");try{const i=JSON.parse(r);s=Ke(i.sourcePdfFile)}catch{s=null}}const a=[s,"source/source.pdf","source.pdf"];for(const r of a){if(!r)continue;const i=t.file(r);if(!i)continue;const o=await i.async("arraybuffer");if(!(o.byteLength<=0))return new Uint8Array(o)}}catch{}return null}async function vs(n,t){const e=[],s=Array.isArray(t.rasterLayers)?t.rasterLayers:[];for(let c=0;c<s.length;c+=1){const p=s[c];if(!p||typeof p!="object")continue;const m=p,g=ut(m.width,0),d=ut(m.height,0),y=typeof m.file=="string"?m.file:`raster/layer-${c}.rgba`,u=Wn(m.matrix)??new Float32Array([1,0,0,1,0,0]),x=await qn(n,y,g,d);!x||x.width<=0||x.height<=0||x.data.length<x.width*x.height*4||e.push({width:x.width,height:x.height,matrix:u,data:x.data})}if(e.length>0)return e;const a=ut(t.rasterLayerWidth,0),r=ut(t.rasterLayerHeight,0),i=Wn(t.rasterLayerMatrix)??new Float32Array([1,0,0,1,0,0]),o=n.file("raster/layer-0.webp")?"raster/layer-0.webp":n.file("raster/layer-0.png")?"raster/layer-0.png":n.file("raster/layer-0.rgba")?"raster/layer-0.rgba":n.file("raster/layer.webp")?"raster/layer.webp":n.file("raster/layer.png")?"raster/layer.png":"raster/layer.rgba",l=await qn(n,typeof t.rasterLayerFile=="string"?t.rasterLayerFile:o,a,r);return l&&l.width>0&&l.height>0&&l.data.length>=l.width*l.height*4&&e.push({width:l.width,height:l.height,data:l.data,matrix:i}),e}async function qn(n,t,e,s){const a=n.file(t);if(!a)return null;const r=await a.async("arraybuffer"),i=new Uint8Array(r),o=await Ts(t,i);if(o)return o;if(e<=0||s<=0)return null;const l=e*s*4;if(i.length<l)throw new Error(`Raster layer data is truncated (${i.length} < ${l}).`);return{width:e,height:s,data:i.length===l?i:i.slice(0,l)}}function bs(n,t){let e=0;for(let s=0;s<t;s+=1)e=Math.max(e,n[s*4]);return e}function ie(n,t){const e=Number(n);return Number.isFinite(e)?e:t}function ut(n,t){const e=Number(n);return Number.isFinite(e)?Math.max(0,Math.trunc(e)):Math.max(0,Math.trunc(t))}function Ke(n){if(typeof n!="string")return null;const t=n.trim();return t.length>0?t:null}function Rt(n,t,e,s,a,r){const i=a*4;if(t.length<i)throw new Error(`Texture ${n} has insufficient data (${t.length} < ${i}).`);const o=t.subarray(0,i),l=As(n,o,r);return{name:n,filePath:`textures/${n}${l.suffix}`,width:e,height:s,logicalItemCount:a,logicalFloatCount:i,data:l.data,componentType:l.componentType,layout:l.layout,quantizationMin:l.quantizationMin,quantizationMax:l.quantizationMax}}function Cs(n){return n.data}function As(n,t,e){if(n==="text-instance-c")return{data:ws(t),componentType:"uint8-normalized",layout:"interleaved",suffix:".rgba8"};if(n==="stroke-primitives-b"){const a=Ms(t);return{data:a.data,componentType:"stroke-primitive-b-u16-packed",layout:"interleaved",suffix:".spb16",quantizationMin:Array.from(a.min),quantizationMax:Array.from(a.max)}}if(Ss(n)){const a=_s(t);return{data:a.data,componentType:"uint16-normalized-range",layout:"interleaved",suffix:".q16",quantizationMin:Array.from(a.min),quantizationMax:Array.from(a.max)}}return{data:e==="channel-major"?ns(t):new Uint8Array(t.buffer,t.byteOffset,t.byteLength).slice(),componentType:"float32",layout:e,suffix:e==="channel-major"?".f32cm":".f32"}}function Ss(n){return n==="fill-primitives-a"||n==="fill-primitives-b"||n==="stroke-primitives-a"||n==="text-glyph-primitives-a"||n==="text-glyph-primitives-b"}function ws(n){const t=new Uint8Array(n.length);for(let e=0;e<n.length;e+=1){const s=Number.isFinite(n[e])?n[e]:0;t[e]=Math.round(Ot(s)*255)}return t}function _s(n){const t=Math.floor(n.length/4),e=new Float32Array([Number.POSITIVE_INFINITY,Number.POSITIVE_INFINITY,Number.POSITIVE_INFINITY,Number.POSITIVE_INFINITY]),s=new Float32Array([Number.NEGATIVE_INFINITY,Number.NEGATIVE_INFINITY,Number.NEGATIVE_INFINITY,Number.NEGATIVE_INFINITY]);for(let r=0;r<t;r+=1){const i=r*4;for(let o=0;o<4;o+=1){const l=n[i+o];Number.isFinite(l)&&(e[o]=Math.min(e[o],l),s[o]=Math.max(s[o],l))}}for(let r=0;r<4;r+=1)(!Number.isFinite(e[r])||!Number.isFinite(s[r]))&&(e[r]=0,s[r]=0);const a=new Uint16Array(n.length);for(let r=0;r<t;r+=1){const i=r*4;for(let o=0;o<4;o+=1){const l=s[o]-e[o];if(Math.abs(l)<=1e-20){a[i+o]=0;continue}const p=((Number.isFinite(n[i+o])?n[i+o]:e[o])-e[o])/l;a[i+o]=Math.round(Ot(p)*65535)}}return{data:new Uint8Array(a.buffer),min:e,max:s}}function Ms(n){const t=Math.floor(n.length/4),e=new Float32Array([Number.POSITIVE_INFINITY,Number.POSITIVE_INFINITY,0,0]),s=new Float32Array([Number.NEGATIVE_INFINITY,Number.NEGATIVE_INFINITY,1,0]);for(let r=0;r<t;r+=1){const i=r*4,o=n[i],l=n[i+1];Number.isFinite(o)&&(e[0]=Math.min(e[0],o),s[0]=Math.max(s[0],o)),Number.isFinite(l)&&(e[1]=Math.min(e[1],l),s[1]=Math.max(s[1],l))}for(let r=0;r<2;r+=1)(!Number.isFinite(e[r])||!Number.isFinite(s[r]))&&(e[r]=0,s[r]=0);const a=new Uint16Array(n.length);for(let r=0;r<t;r+=1){const i=r*4;a[i]=Zn(n[i],e[0],s[0]),a[i+1]=Zn(n[i+1],e[1],s[1]),a[i+2]=n[i+2]>=.5?1:0;const o=Number.isFinite(n[i+3])?n[i+3]:0,l=Math.min(15,Math.max(0,Math.floor(o/2+1e-6))),c=Ot(o-l*2),p=Math.round(c*4095);a[i+3]=l<<12|p}return{data:new Uint8Array(a.buffer),min:e,max:s}}function Zn(n,t,e){const s=e-t;if(Math.abs(s)<=1e-20)return 0;const a=Number.isFinite(n)?n:t;return Math.round(Ot((a-t)/s)*65535)}function Es(n,t,e){const s=typeof t.componentType=="string"?t.componentType:"float32";if(s==="uint8-normalized")return Rs(new Uint8Array(n));if(s==="uint16-normalized-range")return Is(new Uint8Array(n),t,e);if(s==="stroke-primitive-b-u16-packed")return Ps(new Uint8Array(n),t,e);if(s!=="float32")throw new Error(`Texture ${e} has unsupported componentType ${String(s)}.`);const a=typeof t.layout=="string"?t.layout:"interleaved";if(a!=="interleaved"&&a!=="channel-major")throw new Error(`Texture ${e} has unsupported layout ${String(a)}.`);if(a==="channel-major")return is(new Uint8Array(n));const r=t.byteShuffle===!0,i=typeof t.predictor=="string"?t.predictor:"none";if(i!=="none"&&i!=="xor-delta-u32")throw new Error(`Texture ${e} has unsupported predictor ${String(i)}.`);if(r)return i==="xor-delta-u32"?es(new Uint8Array(n)):ts(new Uint8Array(n));if(i!=="none")throw new Error(`Texture ${e} declares predictor ${i} without byteShuffle.`);if(n.byteLength%4!==0)throw new Error(`Texture ${e} has invalid byte length (${n.byteLength}).`);return new Float32Array(n)}function Rs(n){const t=new Float32Array(n.length);for(let e=0;e<n.length;e+=1)t[e]=n[e]/255;return t}function Is(n,t,e){if(n.byteLength%2!==0)throw new Error(`Texture ${e} has invalid uint16 byte length (${n.byteLength}).`);const s=Se(t.quantizationMin,e,"quantizationMin"),a=Se(t.quantizationMax,e,"quantizationMax"),r=new Uint16Array(n.buffer,n.byteOffset,n.byteLength/2),i=new Float32Array(r.length);for(let o=0;o<r.length;o+=1){const l=o&3,c=a[l]-s[l];i[o]=Math.abs(c)<=1e-20?s[l]:s[l]+r[o]/65535*c}return i}function Ps(n,t,e){if(n.byteLength%8!==0)throw new Error(`Texture ${e} has invalid packed stroke primitive byte length (${n.byteLength}).`);const s=Se(t.quantizationMin,e,"quantizationMin"),a=Se(t.quantizationMax,e,"quantizationMax"),r=new Uint16Array(n.buffer,n.byteOffset,n.byteLength/2),i=new Float32Array(r.length),o=a[0]-s[0],l=a[1]-s[1];for(let c=0;c<r.length;c+=4){i[c]=Math.abs(o)<=1e-20?s[0]:s[0]+r[c]/65535*o,i[c+1]=Math.abs(l)<=1e-20?s[1]:s[1]+r[c+1]/65535*l,i[c+2]=r[c+2]>=1?1:0;const p=r[c+3],m=p>>>12,g=(p&4095)/4095;i[c+3]=g+m*2}return i}function Se(n,t,e){if(!Array.isArray(n)||n.length<4)throw new Error(`Texture ${t} is missing ${e}.`);const s=new Float32Array(4);for(let a=0;a<4;a+=1){const r=Number(n[a]);if(!Number.isFinite(r))throw new Error(`Texture ${t} has invalid ${e}[${a}].`);s[a]=r}return s}const Fs=/^[a-z][a-z\d+.-]*:/i,Bs=new URL("./",window.location.href);function ks(n){const t=n.trim();if(Fs.test(t))return t;const e=t.replace(/^\/+/,"");return new URL(e,Bs).toString()}function Ds(n){return n.slice().buffer}const Ls=/^[a-z][a-z\d+.-]*:/i;function jn(n){const t=n.trim();if(Ls.test(t))return t;const e=t.replace(/^\/+/,""),s=new URL("./",window.location.href);return new URL(e,s).toString()}function to(n){const t=Array.isArray(n.examples)?n.examples:[],e=[];for(let s=0;s<t.length;s+=1){const a=t[s],r=Ce(a?.name);if(!r)continue;const i=Ce(a?.id)??`example-${s+1}`,o=Ce(a?.pdf?.path),l=Ce(a?.parsedZip?.path),c=o?jn(o):null,p=l?jn(l):null;!c||!p||e.push({id:i,name:r,pdfPath:c,pdfSizeBytes:$n(a?.pdf?.sizeBytes,0),zipPath:p,zipSizeBytes:$n(a?.parsedZip?.sizeBytes,0)})}return e}function $n(n,t){const e=Number(n);return Number.isFinite(e)?Math.max(0,Math.trunc(e)):Math.max(0,Math.trunc(t))}function Ce(n){if(typeof n!="string")return null;const t=n.trim();return t.length>0?t:null}export{zs as C,Hs as W,js as a,Ks as b,we as c,Qs as d,Zs as e,$s as f,qs as g,oi as h,Us as i,Ws as j,Ys as k,ss as l,Gs as m,to as n,Ns as o,Os as p,Kn as q,jn as r,Vs as s,Js as t,Xs as u};
