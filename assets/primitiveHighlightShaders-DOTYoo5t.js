import{t as e}from"./colorInput-CmUnBn5h.js";import{i as t,n,p as r,r as i,t as a}from"./gradientSampling-gSAS7Ld3.js";import{t as o}from"./vectorFillCoverage-BUaiD7x0.js";import{_ as s,y as c}from"./structureData-eNj79wS5.js";import{a as l,c as u,f as d,n as f}from"./scenePrimitives-BNAERvAx.js";import{t as p}from"./editorScenePreview-C3Xe9kDC.js";function m(e,t){let n=r(e,t);if(n>65536)throw RangeError(`Mesh highlighting exceeds its triangle budget.`);let i=e.gradientMeshPositions,a=e.gradientMeshIndices,o=e.gradientMeshRanges[t*2],s=new Map,c=(e,t,n,r,i)=>{let a=n-e,o=r-t;if(!a&&!o)return;let c=Math.abs(a)>=Math.abs(o)?0:1,l=c?t:e,u=c?r:n,d=c?a/o:o/a,f=(l<u?c?e:t:c?n:r)-d*Math.min(l,u),p=`${c}:${d}:${f}`,m=s.get(p);m||s.set(p,m={axis:c,slope:d,offset:f,events:[]});let h=(u>l?1:-1)*i;m.events.push({position:Math.min(l,u),delta:h},{position:Math.max(l,u),delta:-h})};for(let e=0;e<n;e++){let t=a[o+e*3]*2,n=a[o+e*3+1]*2,r=a[o+e*3+2]*2,s=i[t],l=i[t+1],u=i[n],d=i[n+1],f=i[r],p=i[r+1],m=(u-s)*(p-l)-(d-l)*(f-s);if(!m)continue;let h=Math.sign(m);c(s,l,u,d,h),c(u,d,f,p,h),c(f,p,s,l,h)}let l=t*4,u=e.gradientMetaB,d=e.gradientMetaC,f=u[l]*u[l+3]-u[l+1]*u[l+2],p=(e,t)=>{let n=e-d[l],r=t-d[l+1];return[(u[l+3]*n-u[l+2]*r)/f,(-u[l+1]*n+u[l]*r)/f]},m=[];for(let e of s.values()){e.events.sort((e,t)=>e.position-t.position);let t=0,n=0;for(let r=0;r<e.events.length;){let i=e.events[r].position,a=t;do t+=e.events[r++].delta;while(r<e.events.length&&e.events[r].position===i);if(!a&&t&&(n=i),a&&!t){let t=e.axis?p(e.slope*n+e.offset,n):p(n,e.slope*n+e.offset),r=e.axis?p(e.slope*i+e.offset,i):p(i,e.slope*i+e.offset);m.push(...t,...r)}}}let h;if(e.gradientMetaA[l+1]>=.5){let t=e.gradientMetaE,n=[p(t[l],t[l+1]),p(t[l+2],t[l+1]),p(t[l+2],t[l+3]),p(t[l],t[l+3])];h=Float32Array.from(n.flatMap((e,t)=>[...e,...n[(t+1)%4]]))}return{edges:Float32Array.from(m),...h?{domainClip:h}:{}}}var h=[.15,.45,1],g=[1,.65,.05];function _(e){return`${e.kind}:${e.index}`}var v=class{colors=new Map;selected=[];hover=null;annotationSelected=[];annotationHovered=[];annotationFallback=null;highlights=null;disposed=!1;scene;callbacks;constructor(e,t={}){this.scene=e,this.callbacks=t}getSelection(){return this.selected.map(e=>({...e}))}getHover(){return this.hover&&{...this.hover}}getOverrideColor(e){d(this.scene,e);let t=this.colors.get(_(e))?.color;return t?[...t]:null}getHighlights(){return this.highlights}getColorUpdates(){return[...this.colors.values()].map(({ref:e,color:t})=>({ref:{...e},color:t&&[...t]}))}hasAnyOverrides(){return this.colors.size>0}hasOverrides(e){for(let t of this.colors.values())if(t.ref.kind===e)return!0;return!1}setHover(e){if(this.assertLive(),e&&d(this.scene,e),e?this.hover&&_(e)===_(this.hover):!this.hover)return;let t=e&&{...e},n=this.buildHighlights(this.selected,t);this.hover=t,this.highlights=n,this.callbacks.onHighlights?.(n)}setSelection(e){this.assertLive();let t=this.validateRefs(e);if(t.length===this.selected.length&&t.every((e,t)=>_(e)===_(this.selected[t])))return;let n=this.buildHighlights(t,this.hover);this.selected=t,this.highlights=n,this.callbacks.onHighlights?.(n)}setAnnotationHighlights(e,t,n){this.assertLive();let r=this.validateRefs(e),i=this.validateRefs(t),a=b(y(this.scene,[...this.selected,...r],[...this.hover?[this.hover]:[],...i],r.length||i.length?262144:1/0,!!(r.length||i.length||n)),n);this.annotationSelected=r,this.annotationHovered=i,this.annotationFallback=n,this.highlights=a,this.callbacks.onHighlights?.(a)}buildHighlights(e,t){return b(y(this.scene,[...e,...this.annotationSelected],[...t?[t]:[],...this.annotationHovered],1/0,!!(this.annotationSelected.length||this.annotationHovered.length||this.annotationFallback)),this.annotationFallback)}setOverrides(t,n){this.assertLive();let r=this.validateRefs(t);if(r.some(e=>e.kind===`raster`))throw TypeError(`Raster layers support highlighting, but not color overrides.`);let i=e(n?.color),a=r.filter(e=>{let t=this.colors.get(_(e))?.color;return!t||t.some((e,t)=>e!==i[t])}).map(e=>({ref:e,color:[...i]}));for(let e of a)this.colors.set(_(e.ref),e);a.length&&this.callbacks.onColors?.(a)}clearOverrides(e){this.assertLive();let t=e===void 0?[...this.colors.values()].map(e=>e.ref):this.validateRefs(e),n=[];for(let e of t)this.colors.delete(_(e))&&n.push({ref:e,color:null});n.length&&this.callbacks.onColors?.(n)}clear(){this.assertLive(),this.clearOverrides();let e=this.highlights!==null;this.selected=[],this.hover=null,this.annotationSelected=[],this.annotationHovered=[],this.annotationFallback=null,this.highlights=null,e&&this.callbacks.onHighlights?.(null)}dispose(){this.disposed||=(this.clear(),!0)}assertLive(){if(this.disposed)throw Error(`Primitive appearance state has been disposed.`)}validateRefs(e){if(!Array.isArray(e))throw TypeError(`Primitive references must be an array.`);let t=new Map;for(let n of e)d(this.scene,n),t.set(_(n),{...n});return[...t.values()]}};function y(e,t,n,r=1/0,i=!1){let a=n?Array.isArray(n)?n:[n]:[],o=[...t,...a];if(i){let e=new Map;for(let n of t)e.set(_(n),n);t=[...e.values()],o=[...t];for(let t of a)e.has(_(t))||(e.set(_(t),t),o.push(t))}if(!o.length)return null;let s=new Map,c=0,d=0;for(let n=0;n<o.length;n++){let i=_(o[n]),a=s.get(i);if(!a){let t=u(e,o[n]),r=t.kind===`gradient-fill`&&t.shadingKind===`mesh`?m(e,t.gradientIndex):void 0;s.set(i,a={primitive:t,...r?{mesh:r}:{}})}if(c+=a.mesh?a.mesh.edges.length/4:a.primitive.segmentCount,c>r)throw RangeError(`Annotation highlight trace exceeds its segment budget.`);n===t.length-1&&(d=c)}if(!c)return null;let p=new Float32Array(c*8),h=[],g=new Map,v=new Map,y=t=>{if(t<0)return-1;let n=g.get(t);if(n!==void 0)return n;let r=e.clipPaths?.[t];if(!r)throw RangeError(`Invalid primitive clip reference.`);let i=y(r.parent),a=h.length;return h.push({parent:i,fillRule:r.fillRule,edges:r.edges.slice()}),g.set(t,a),a},b=(e,t)=>{if(!t)return e;let{minX:n,minY:r,maxX:i,maxY:a}=t,o=`${e}:${n}:${r}:${i}:${a}`,s=v.get(o);if(s!==void 0)return s;let c=h.length;return h.push({parent:e,fillRule:0,edges:Float32Array.of(n,r,i,r,i,r,i,a,i,a,n,a,n,a,n,r)}),v.set(o,c),c},S=0,C=new Map;for(let t of o){let n=_(t),{primitive:r,mesh:i}=s.get(n),a=f(e,t),o=b(y(a.clipIndex),a.rect);if(i){let e=C.get(n);e===void 0&&(e=h.length,h.push({parent:o,fillRule:+(r.fillRule===`evenodd`),edges:x(r)}),i.domainClip&&(h.push({parent:e,fillRule:0,edges:i.domainClip}),e=h.length-1),C.set(n,e));for(let t=0;t<i.edges.length;t+=4){let n=i.edges[t],r=i.edges[t+1],a=i.edges[t+2],o=i.edges[t+3];p.set([n,r,a,o,a,o,0,e],S),S+=8}continue}for(let n=0;n<r.segmentCount;n++){let i=r.getSegment(n),a=i.control??i.end,s=t.kind===`gradient-stroke`?b(o,l(e,t,n)):o;p.set([i.start.x,i.start.y,a.x,a.y,i.end.x,i.end.y,+!!i.control,s],S),S+=8}}return{segments:p,clipPaths:h,selectionCount:d,count:c}}function b(e,t){if(!e)return t;if(!t)return e;let n=new Float32Array((e.count+t.count)*8),r=[...e.clipPaths,...t.clipPaths.map(t=>({...t,parent:t.parent<0?-1:t.parent+e.clipPaths.length}))],i=0,a=(e,t,r,a)=>{for(let o=t;o<r;o++)n.set(e.segments.subarray(o*8,o*8+8),i),n[i+7]>=0&&(n[i+7]+=a),i+=8};return a(e,0,e.selectionCount,0),a(t,0,t.selectionCount,e.clipPaths.length),a(e,e.selectionCount,e.count,0),a(t,t.selectionCount,t.count,e.clipPaths.length),{segments:n,clipPaths:r,selectionCount:e.selectionCount+t.selectionCount,count:e.count+t.count}}function x(e){let t=[],n=(e,n,r,i)=>{if(![e,n,r,i].every(Number.isFinite))throw RangeError(`Non-finite mesh highlight clip coordinates.`);(e!==r||n!==i)&&t.push(e,n,r,i)},r=(e,t,r,i,a,o)=>{let s=[e,t,r,i,a,o];if(!s.every(Number.isFinite))throw RangeError(`Non-finite mesh highlight clip coordinates.`);let c=[s];for(;c.length;){let e=c.pop(),[t,r,i,a,o,s]=e,l=o-t,u=s-r,d=Math.max(0,Math.min(1,((i-t)*l+(a-r)*u)/(l*l+u*u||1)));if(Math.hypot(i-t-d*l,a-r-d*u)<=1e-4||e[6]===1){n(t,r,o,s);continue}let f=t/2+i/2,p=r/2+a/2,m=i/2+o/2,h=a/2+s/2,g=f/2+m/2,_=p/2+h/2,v=[t,r,f,p,g,_],y=[g,_,m,h,o,s];v.push(+!!v.every((t,n)=>t===e[n])),y.push(+!!y.every((t,n)=>t===e[n])),c.push(y,v)}};for(let t=0;t<e.segmentCount;t++){let{start:i,control:a,end:o}=e.getSegment(t);a?r(i.x,i.y,a.x,a.y,o.x,o.y):n(i.x,i.y,o.x,o.y)}return Float32Array.from(t)}var S=[`float heprStrokeCross(vec2 a, vec2 b) {
  return a.x * b.y - a.y * b.x;
}`,`float heprStrokeCdf(float t, float a, float b) {
  float wide = max(abs(a), abs(b));
  float narrow = min(abs(a), abs(b));
  float support = 0.5 * (wide + narrow);
  if (t <= -support) { return 0.0; }
  if (t >= support) { return 1.0; }
  if (abs(t) <= 0.5 * (wide - narrow)) { return 0.5 + t / wide; }
  float tail = support - abs(t);
  float area = tail * tail / (2.0 * wide * narrow);
  if (t < 0.0) { return area; }
  return 1.0 - area;
}`,`float heprStrokeLineArea(vec2 a, vec2 b) {
  float ya = clamp(a.y, 0.0, 1.0);
  float yb = clamp(b.y, 0.0, 1.0);
  if (ya == yb || max(a.x, b.x) <= 0.0) { return 0.0; }
  if (min(a.x, b.x) >= 1.0) { return yb - ya; }
  float xa = a.x + (b.x - a.x) * ((ya - a.y) / (b.y - a.y));
  float xb = a.x + (b.x - a.x) * ((yb - a.y) / (b.y - a.y));
  float lo = min(xa, xb);
  float hi = max(xa, xb);
  float span = hi - lo;
  if (span == 0.0) { return (yb - ya) * clamp(xa, 0.0, 1.0); }
  
  
  float start = clamp(lo, 0.0, 1.0);
  float end = clamp(hi, 0.0, 1.0);
  float ramp = 0.5 * (start + end) * (end - start);
  return (yb - ya) * (ramp + max(hi - max(lo, 1.0), 0.0)) / span;
}`,`vec2 heprStrokePixelPoint(vec2 p, vec2 dx, vec2 dy, float determinant) {
  return vec2(0.5 + heprStrokeCross(p, dy) / determinant,
    0.5 + heprStrokeCross(dx, p) / determinant);
}`,`float heprStrokeCircleEdge(vec2 a, vec2 b, float radius) {
  float crossValue = heprStrokeCross(a, b);
  
  if (crossValue == 0.0) { return 0.0; }
  float radius2 = radius * radius;
  float aa = a.x * a.x + a.y * a.y;
  float bb = b.x * b.x + b.y * b.y;
  if (max(aa, bb) <= radius2) { return 0.5 * crossValue; }
  vec2 delta = vec2(b.x - a.x, b.y - a.y);
  float length2 = delta.x * delta.x + delta.y * delta.y;
  float projection = -(a.x * delta.x + a.y * delta.y) / length2;
  float height2 = radius2 - crossValue * crossValue / length2;
  float sector = 0.5 * radius2 * atan(crossValue, a.x * b.x + a.y * b.y);
  if (height2 <= 0.0) { return sector; }
  float reach = sqrt(height2 / length2);
  float t0 = clamp(projection - reach, 0.0, 1.0);
  float t1 = clamp(projection + reach, 0.0, 1.0);
  if (t1 <= t0) { return sector; }
  vec2 entry = vec2(a.x + delta.x * t0, a.y + delta.y * t0);
  vec2 exitPoint = vec2(a.x + delta.x * t1, a.y + delta.y * t1);
  float insideCross = heprStrokeCross(entry, exitPoint);
  float insideAngle = atan(insideCross, entry.x * exitPoint.x + entry.y * exitPoint.y);
  return sector + 0.5 * (insideCross - radius2 * insideAngle);
}`,`float heprStrokeCapEdge(vec2 a, vec2 b, float radius, float side) {
  if (side * a.x < 0.0 && side * b.x < 0.0) { return 0.0; }
  vec2 start = a;
  vec2 end = b;
  if (side * a.x < 0.0) {
    start = vec2(0.0, a.y + (b.y - a.y) * (-a.x / (b.x - a.x)));
  } else if (side * b.x < 0.0) {
    end = vec2(0.0, a.y + (b.y - a.y) * (-a.x / (b.x - a.x)));
  }
  return heprStrokeCircleEdge(start, end, radius);
}`,`float heprStrokeCapArea(vec2 center, float radius, float side, vec2 dx, vec2 dy, float determinant) {
  float extentX = 0.5 * (abs(dx.x) + abs(dy.x));
  if (side * center.x >= extentX) { return 0.0; }
  float pixelRadius = 0.5 * (sqrt(dx.x * dx.x + dx.y * dx.y) + sqrt(dy.x * dy.x + dy.y * dy.y));
  if (center.x * center.x + center.y * center.y >= (radius + pixelRadius) * (radius + pixelRadius)) { return 0.0; }
  vec2 pixelCenter = heprStrokePixelPoint(center, dx, dy, determinant);
  float footprintArea = abs(determinant);
  float extentU = radius * sqrt(dy.x * dy.x + dy.y * dy.y) / footprintArea;
  float extentV = radius * sqrt(dx.x * dx.x + dx.y * dx.y) / footprintArea;
  if (abs(pixelCenter.x - 0.5) >= 0.5 + extentU || abs(pixelCenter.y - 0.5) >= 0.5 + extentV) {
    return 0.0;
  }
  if (abs(pixelCenter.x - 0.5) + extentU <= 0.5 && abs(pixelCenter.y - 0.5) + extentV <= 0.5) {
    return 1.5707963267948966 * radius * radius / footprintArea;
  }
  vec2 a = vec2(-0.5 * (dx.x + dy.x) - center.x, -0.5 * (dx.y + dy.y) - center.y);
  vec2 b = vec2(0.5 * (dx.x - dy.x) - center.x, 0.5 * (dx.y - dy.y) - center.y);
  vec2 c = vec2(0.5 * (dx.x + dy.x) - center.x, 0.5 * (dx.y + dy.y) - center.y);
  vec2 d = vec2(0.5 * (dy.x - dx.x) - center.x, 0.5 * (dy.y - dx.y) - center.y);
  float area = heprStrokeCapEdge(a, b, radius, side) + heprStrokeCapEdge(b, c, radius, side)
    + heprStrokeCapEdge(c, d, radius, side) + heprStrokeCapEdge(d, a, radius, side);
  return abs(area / determinant);
}`,`float heprStrokeFlatCoverage(float x, float y, float lengthValue, float radius, vec2 dx, vec2 dy, float roundCap) {
  float nx = 0.0;
  float ny = 1.0;
  if (y < 0.0) { ny = -1.0; }
  float edge = abs(y) - radius;
  if (roundCap >= 0.5) {
    float along = x - clamp(x, 0.0, lengthValue);
    float distanceValue = sqrt(along * along + y * y);
    if (distanceValue == 0.0) { return 1.0; }
    nx = along / distanceValue;
    ny = y / distanceValue;
    edge = distanceValue - radius;
  } else if (max(-x, x - lengthValue) > edge) {
    edge = max(-x, x - lengthValue);
    nx = 1.0;
    if (x < 0.0) { nx = -1.0; }
    ny = 0.0;
  }
  return heprStrokeCdf(-edge, nx * dx.x + ny * dx.y, nx * dy.x + ny * dy.y);
}`,`float heprLinearStrokeCoverage(vec2 point, vec2 p0, vec2 p2, float halfWidth, vec2 pixelDx, vec2 pixelDy, float roundCap) {
  if (halfWidth <= 0.0) { return 0.0; }
  float scale = max(max(abs(pixelDx.x), abs(pixelDx.y)), max(abs(pixelDy.x), abs(pixelDy.y)));
  if (scale <= 0.0) { return 0.0; }
  vec2 axis = vec2(p2.x - p0.x, p2.y - p0.y);
  float axisLength = sqrt(axis.x * axis.x + axis.y * axis.y);
  if (axisLength == 0.0 && roundCap < 0.5) { return 0.0; }
  vec2 tangent = vec2(1.0, 0.0);
  if (axisLength > 0.0) { tangent = vec2(axis.x / axisLength, axis.y / axisLength); }
  vec2 offset = vec2((point.x - p0.x) / scale, (point.y - p0.y) / scale);
  float x = offset.x * tangent.x + offset.y * tangent.y;
  float y = offset.y * tangent.x - offset.x * tangent.y;
  float lengthValue = axisLength / scale;
  float radius = halfWidth / scale;
  vec2 dx = vec2((pixelDx.x * tangent.x + pixelDx.y * tangent.y) / scale,
    (pixelDx.y * tangent.x - pixelDx.x * tangent.y) / scale);
  vec2 dy = vec2((pixelDy.x * tangent.x + pixelDy.y * tangent.y) / scale,
    (pixelDy.y * tangent.x - pixelDy.x * tangent.y) / scale);
  float determinant = heprStrokeCross(dx, dy);
  
  
  if (abs(determinant) <= 1e-12) {
    return heprStrokeFlatCoverage(x, y, lengthValue, radius, dx, dy, roundCap);
  }
  float extentX = 0.5 * (abs(dx.x) + abs(dy.x));
  float extentY = 0.5 * (abs(dx.y) + abs(dy.y));
  if (abs(y) >= radius + extentY) { return 0.0; }
  if (roundCap < 0.5 && (x >= lengthValue + extentX || x <= -extentX)) { return 0.0; }
  
  if (x >= extentX && x <= lengthValue - extentX) {
    return clamp(heprStrokeCdf(radius - y, dx.y, dy.y) - heprStrokeCdf(-radius - y, dx.y, dy.y), 0.0, 1.0);
  }
  float closestX = clamp(x, 0.0, lengthValue);
  float distanceValue = sqrt((x - closestX) * (x - closestX) + y * y);
  float pixelRadius = 0.5 * (sqrt(dx.x * dx.x + dx.y * dx.y) + sqrt(dy.x * dy.x + dy.y * dy.y));
  if (roundCap >= 0.5) {
    if (distanceValue >= radius + pixelRadius) { return 0.0; }
    if (distanceValue + pixelRadius <= radius) { return 1.0; }
    
    
    if (radius > 128.0 * pixelRadius) {
      return heprStrokeFlatCoverage(x, y, lengthValue, radius, dx, dy, roundCap);
    }
  }
  
  
  float left = clamp(-x, -extentX, extentX);
  float right = clamp(lengthValue - x, -extentX, extentX);
  float bottom = clamp(-radius - y, -extentY, extentY);
  float top = clamp(radius - y, -extentY, extentY);
  float area = 0.0;
  if (right > left && top > bottom) {
    vec2 a = heprStrokePixelPoint(vec2(left, bottom), dx, dy, determinant);
    vec2 b = heprStrokePixelPoint(vec2(right, bottom), dx, dy, determinant);
    vec2 c = heprStrokePixelPoint(vec2(right, top), dx, dy, determinant);
    vec2 d = heprStrokePixelPoint(vec2(left, top), dx, dy, determinant);
    area = abs(heprStrokeLineArea(a, b) + heprStrokeLineArea(b, c)
      + heprStrokeLineArea(c, d) + heprStrokeLineArea(d, a));
  }
  if (roundCap >= 0.5) {
    area += heprStrokeCapArea(vec2(-x, -y), radius, -1.0, dx, dy, determinant);
    area += heprStrokeCapArea(vec2(lengthValue - x, -y), radius, 1.0, dx, dy, determinant);
  }
  return clamp(area, 0.0, 1.0);
}`];function C(e){let t={float:`f32`,vec2:`vec2<f32>`};return e.replace(/(float|vec2) (hepr\w+)\(([^)]*)\) \{/g,(e,n,r,i)=>`fn ${r}(${i.split(`,`).map(e=>{let[n,r]=e.trim().split(/\s+/);return`${r}: ${t[n]}`}).join(`, `)}) -> ${t[n]} {`).replace(/\b(?:float|vec2) (\w+) =/g,`var $1 =`).replace(/\bvec2\(/g,`vec2<f32>(`).replace(/\batan\(/g,`atan2(`)}var w=S.join(`

`),T=S.map(C),E=T.join(`

`),D=`
  return max(halfWidth, 0.5 * localUnitsPerPixel * minimumWidthPx);
`,O=`
float heprMinimumStrokeHalfWidth(float halfWidth, float localUnitsPerPixel, float minimumWidthPx) {
${D}}
`,k=`
fn heprMinimumStrokeHalfWidth(halfWidth: f32, localUnitsPerPixel: f32, minimumWidthPx: f32) -> f32 {
${D}}
`,A=`
  return smoothstep(-aaWorld, aaWorld, halfWidth - distanceValue)
    - smoothstep(-aaWorld, aaWorld, -halfWidth - distanceValue);
`,j=`
float heprStrokeCoverage(float distanceValue, float halfWidth, float aaWorld) {
${A}}
`,M=`
fn heprStrokeCoverage(distanceValue: f32, halfWidth: f32, aaWorld: f32) -> f32 {
${A}}
`,N=`
  if (primitiveType >= 0.0) { return alpha; }
  return 1.0 - pow(1.0 - clamp(alpha, 0.0, 1.0), max(1.0, 1.0 - primitiveType));
`,P=`
float heprStrokeLodAlpha(float alpha, float primitiveType) {
${N}}
`,ee=`
fn heprStrokeLodAlpha(alpha: f32, primitiveType: f32) -> f32 {
${N}}
`,te=`
float heprCoverageRamp(float u) {
  float inside = clamp(u, 0.0, 1.0);
  return 0.5 * inside * inside + max(u - 1.0, 0.0);
}

float heprLineCoverage(vec2 a, vec2 b, float low, float high) {
  float va = clamp(a.y, low, high);
  float vb = clamp(b.y, low, high);
  if (va == vb) {
    return 0.0;
  }
  if (min(a.x, b.x) >= 1.0) {
    return vb - va;
  }
  if (max(a.x, b.x) <= 0.0) {
    return 0.0;
  }
  float dy = b.y - a.y;
  float ua = a.x + (b.x - a.x) * ((va - a.y) / dy);
  float ub = a.x + (b.x - a.x) * ((vb - a.y) / dy);
  float du = ub - ua;
  float mean = abs(du) < 0.0001
    ? clamp(0.5 * (ua + ub), 0.0, 1.0)
    : (heprCoverageRamp(ub) - heprCoverageRamp(ua)) / du;
  return (vb - va) * mean;
}

vec2 heprQuadraticPoint(vec2 a, vec2 b, vec2 c, float t) {
  float s = 1.0 - t;
  return vec2(
    s * s * a.x + 2.0 * s * t * b.x + t * t * c.x,
    s * s * a.y + 2.0 * s * t * b.y + t * t * c.y
  );
}



float heprQuadraticIntegral(vec2 a, vec2 b, vec2 c) {
  float dx = c.x - a.x;
  float dy = c.y - a.y;
  return (a.x + 0.5 * dx) * dy +
    ((b.x - a.x) * dy - (b.y - a.y) * dx) / 3.0;
}

float heprQuadraticRoot(float qa, float qb, float qc, float t0, float t1) {
  float root = t0;
  if (qa == 0.0) {
    if (qb != 0.0) {
      root = -qc / qb;
    }
  } else {
    float q = -0.5 * (qb + (qb < 0.0 ? -1.0 : 1.0) * sqrt(max(qb * qb - 4.0 * qa * qc, 0.0)));
    float rootA = q / qa;
    float rootB = q == 0.0 ? rootA : qc / q;
    float missA = max(max(t0 - rootA, rootA - t1), 0.0);
    float missB = max(max(t0 - rootB, rootB - t1), 0.0);
    root = missB < missA ? rootB : rootA;
  }
  return clamp(root, t0, t1);
}

float heprQuadraticPieceCoverage(vec2 a, vec2 b, vec2 c, float t0, float t1, float low, float high) {
  if (t1 <= t0) {
    return 0.0;
  }
  vec2 startPoint = heprQuadraticPoint(a, b, c, t0);
  vec2 endPoint = heprQuadraticPoint(a, b, c, t1);
  float vStart = clamp(startPoint.y, low, high);
  float vEnd = clamp(endPoint.y, low, high);
  if (vStart == vEnd) {
    return 0.0;
  }
  float qa = a.y - 2.0 * b.y + c.y;
  float qb = 2.0 * (b.y - a.y);
  float ts = vStart == startPoint.y ? t0 : heprQuadraticRoot(qa, qb, a.y - vStart, t0, t1);
  float te = vEnd == endPoint.y ? t1 : heprQuadraticRoot(qa, qb, a.y - vEnd, t0, t1);
  float span = te - ts;
  vec2 previous = heprQuadraticPoint(a, b, c, ts);
  previous.y = vStart;
  vec2 clippedEnd = heprQuadraticPoint(a, b, c, te);
  clippedEnd.y = vEnd;
  float startWeight = 1.0 - ts;
  float endWeight = 1.0 - te;
  float clippedBlend = startWeight * te + ts * endWeight;
  vec2 clippedControl = vec2(
    startWeight * endWeight * a.x + clippedBlend * b.x + ts * te * c.x,
    startWeight * endWeight * a.y + clippedBlend * b.y + ts * te * c.y
  );
  
  
  if (min(min(previous.x, clippedEnd.x), clippedControl.x) >= 0.0 &&
      max(max(previous.x, clippedEnd.x), clippedControl.x) <= 1.0) {
    return heprQuadraticIntegral(previous, clippedControl, clippedEnd);
  }
  float deviation = 0.25 * max(abs(a.x - 2.0 * b.x + c.x), abs(qa)) * span * span;
  int pieces = int(clamp(ceil(8.0 * sqrt(deviation)), 1.0, 8.0));
  float tPrevious = ts;
  float coverage = 0.0;
  for (int piece = 1; piece <= 8; piece += 1) {
    if (piece > pieces) {
      break;
    }
    float tNext = piece == pieces ? te : ts + span * float(piece) / float(pieces);
    vec2 next = heprQuadraticPoint(a, b, c, tNext);
    if (piece == pieces) {
      next.y = vEnd;
    }
    coverage += heprLineCoverage(previous, next, low, high);
    float sa = 1.0 - tPrevious;
    float sb = 1.0 - tNext;
    float blend = sa * tNext + tPrevious * sb;
    vec2 control = vec2(
      sa * sb * a.x + blend * b.x + tPrevious * tNext * c.x,
      sa * sb * a.y + blend * b.y + tPrevious * tNext * c.y
    );
    if (min(min(previous.x, next.x), control.x) >= 0.0 && max(max(previous.x, next.x), control.x) <= 1.0) {
      coverage += ((control.x - previous.x) * (next.y - previous.y) - (control.y - previous.y) * (next.x - previous.x)) / 3.0;
    }
    previous = next;
    tPrevious = tNext;
  }
  return coverage;
}

float heprQuadraticCoverage(vec2 a, vec2 b, vec2 c, float low, float high) {
  if (max(max(a.y, b.y), c.y) <= low || min(min(a.y, b.y), c.y) >= high || max(max(a.x, b.x), c.x) <= 0.0) {
    return 0.0;
  }
  
  if (min(min(a.x, b.x), c.x) >= 0.0 && max(max(a.x, b.x), c.x) <= 1.0 &&
      min(min(a.y, b.y), c.y) >= low && max(max(a.y, b.y), c.y) <= high) {
    return heprQuadraticIntegral(a, b, c);
  }
  float qa = a.y - 2.0 * b.y + c.y;
  float turn = qa == 0.0 ? 0.0 : clamp((a.y - b.y) / qa, 0.0, 1.0);
  if (min(min(a.x, b.x), c.x) >= 1.0) {
    float middle = clamp(heprQuadraticPoint(a, b, c, turn).y, low, high);
    return middle - clamp(a.y, low, high) + clamp(c.y, low, high) - middle;
  }
  return heprQuadraticPieceCoverage(a, b, c, 0.0, turn, low, high) +
    heprQuadraticPieceCoverage(a, b, c, turn, 1.0, low, high);
}

float heprSegmentCoverage(vec2 p0, vec2 p1, vec2 p2, bool quadratic, vec4 box, float low, float high) {
  vec2 a = vec2((p0.x - box.x) * box.z, (p0.y - box.y) * box.w);
  vec2 c = vec2((p2.x - box.x) * box.z, (p2.y - box.y) * box.w);
  
  
  float coverage = 0.0;
  if (quadratic) {
    vec2 b = vec2((p1.x - box.x) * box.z, (p1.y - box.y) * box.w);
    coverage = heprQuadraticCoverage(a, b, c, low, high);
  } else {
    coverage = heprLineCoverage(a, c, low, high);
  }
  return coverage;
}

vec2 heprBandRows(vec4 bandInfo, int band, int bandCount, vec4 box) {
  if (bandCount <= 0) {
    return vec2(0.0, 1.0);
  }
  float bandLow = bandInfo.z + float(band) * bandInfo.w;
  vec2 rows = vec2(
    clamp((bandLow - box.y) * box.w, 0.0, 1.0),
    clamp((bandLow + bandInfo.w - box.y) * box.w, 0.0, 1.0)
  );
  if (band == 0) {
    rows.x = 0.0;
  }
  if (band == bandCount - 1) {
    rows.y = 1.0;
  }
  return rows;
}

float heprFillCoverage(float winding, bool evenOdd) {
  float magnitude = abs(winding);
  return evenOdd
    ? abs(magnitude - 2.0 * floor(0.5 * magnitude + 0.5))
    : min(magnitude, 1.0);
}







float heprHullAreaWinding(float signedArea, vec2 lower, vec2 upper, vec4 box, vec2 footprint) {
  float spanX = upper.x - lower.x;
  float spanY = upper.y - lower.y;
  float overlapX = min(box.x + footprint.x, upper.x) - max(box.x, lower.x);
  float overlapY = min(box.y + footprint.y, upper.y) - max(box.y, lower.y);
  float shareX = overlapX >= spanX ? 1.0 : max(overlapX, 0.0) / max(spanX, 1e-30);
  float shareY = overlapY >= spanY ? 1.0 : max(overlapY, 0.0) / max(spanY, 1e-30);
  return signedArea * box.z * box.w * shareX * shareY;
}
`,ne=`
fn heprCoverageRamp(u: f32) -> f32 {
  let inside = clamp(u, 0.0, 1.0);
  return 0.5 * inside * inside + max(u - 1.0, 0.0);
}

fn heprLineCoverage(a: vec2<f32>, b: vec2<f32>, low: f32, high: f32) -> f32 {
  let va = clamp(a.y, low, high);
  let vb = clamp(b.y, low, high);
  if (va == vb) {
    return 0.0;
  }
  if (min(a.x, b.x) >= 1.0) {
    return vb - va;
  }
  if (max(a.x, b.x) <= 0.0) {
    return 0.0;
  }
  let dy = b.y - a.y;
  let ua = a.x + (b.x - a.x) * ((va - a.y) / dy);
  let ub = a.x + (b.x - a.x) * ((vb - a.y) / dy);
  let du = ub - ua;
  var mean = clamp(0.5 * (ua + ub), 0.0, 1.0);
  if (abs(du) >= 0.0001) {
    mean = (heprCoverageRamp(ub) - heprCoverageRamp(ua)) / du;
  }
  return (vb - va) * mean;
}

fn heprQuadraticPoint(a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, t: f32) -> vec2<f32> {
  let s = 1.0 - t;
  return vec2<f32>(
    s * s * a.x + 2.0 * s * t * b.x + t * t * c.x,
    s * s * a.y + 2.0 * s * t * b.y + t * t * c.y
  );
}



fn heprQuadraticIntegral(a: vec2<f32>, b: vec2<f32>, c: vec2<f32>) -> f32 {
  let dx = c.x - a.x;
  let dy = c.y - a.y;
  return (a.x + 0.5 * dx) * dy +
    ((b.x - a.x) * dy - (b.y - a.y) * dx) / 3.0;
}

fn heprQuadraticRoot(qa: f32, qb: f32, qc: f32, t0: f32, t1: f32) -> f32 {
  var root = t0;
  if (qa == 0.0) {
    if (qb != 0.0) {
      root = -qc / qb;
    }
  } else {
    let q = -0.5 * (qb + select(1.0, -1.0, qb < 0.0) * sqrt(max(qb * qb - 4.0 * qa * qc, 0.0)));
    let rootA = q / qa;
    var rootB = rootA;
    if (q != 0.0) {
      rootB = qc / q;
    }
    let missA = max(max(t0 - rootA, rootA - t1), 0.0);
    let missB = max(max(t0 - rootB, rootB - t1), 0.0);
    root = select(rootA, rootB, missB < missA);
  }
  return clamp(root, t0, t1);
}

fn heprQuadraticPieceCoverage(a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, t0: f32, t1: f32, low: f32, high: f32) -> f32 {
  if (t1 <= t0) {
    return 0.0;
  }
  let startPoint = heprQuadraticPoint(a, b, c, t0);
  let endPoint = heprQuadraticPoint(a, b, c, t1);
  let vStart = clamp(startPoint.y, low, high);
  let vEnd = clamp(endPoint.y, low, high);
  if (vStart == vEnd) {
    return 0.0;
  }
  let qa = a.y - 2.0 * b.y + c.y;
  let qb = 2.0 * (b.y - a.y);
  var ts = t0;
  if (vStart != startPoint.y) {
    ts = heprQuadraticRoot(qa, qb, a.y - vStart, t0, t1);
  }
  var te = t1;
  if (vEnd != endPoint.y) {
    te = heprQuadraticRoot(qa, qb, a.y - vEnd, t0, t1);
  }
  let span = te - ts;
  var previous = heprQuadraticPoint(a, b, c, ts);
  previous.y = vStart;
  var clippedEnd = heprQuadraticPoint(a, b, c, te);
  clippedEnd.y = vEnd;
  let startWeight = 1.0 - ts;
  let endWeight = 1.0 - te;
  let clippedBlend = startWeight * te + ts * endWeight;
  let clippedControl = vec2<f32>(
    startWeight * endWeight * a.x + clippedBlend * b.x + ts * te * c.x,
    startWeight * endWeight * a.y + clippedBlend * b.y + ts * te * c.y
  );
  
  
  if (min(min(previous.x, clippedEnd.x), clippedControl.x) >= 0.0 &&
      max(max(previous.x, clippedEnd.x), clippedControl.x) <= 1.0) {
    return heprQuadraticIntegral(previous, clippedControl, clippedEnd);
  }
  let deviation = 0.25 * max(abs(a.x - 2.0 * b.x + c.x), abs(qa)) * span * span;
  let pieces = i32(clamp(ceil(8.0 * sqrt(deviation)), 1.0, 8.0));
  var tPrevious = ts;
  var coverage = 0.0;
  for (var piece = 1; piece <= 8; piece = piece + 1) {
    if (piece > pieces) {
      break;
    }
    let tNext = select(ts + span * f32(piece) / f32(pieces), te, piece == pieces);
    var next = heprQuadraticPoint(a, b, c, tNext);
    if (piece == pieces) {
      next.y = vEnd;
    }
    coverage = coverage + heprLineCoverage(previous, next, low, high);
    let sa = 1.0 - tPrevious;
    let sb = 1.0 - tNext;
    let blend = sa * tNext + tPrevious * sb;
    let control = vec2<f32>(
      sa * sb * a.x + blend * b.x + tPrevious * tNext * c.x,
      sa * sb * a.y + blend * b.y + tPrevious * tNext * c.y
    );
    if (min(min(previous.x, next.x), control.x) >= 0.0 && max(max(previous.x, next.x), control.x) <= 1.0) {
      coverage = coverage + ((control.x - previous.x) * (next.y - previous.y) - (control.y - previous.y) * (next.x - previous.x)) / 3.0;
    }
    previous = next;
    tPrevious = tNext;
  }
  return coverage;
}

fn heprQuadraticCoverage(a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, low: f32, high: f32) -> f32 {
  if (max(max(a.y, b.y), c.y) <= low || min(min(a.y, b.y), c.y) >= high || max(max(a.x, b.x), c.x) <= 0.0) {
    return 0.0;
  }
  
  if (min(min(a.x, b.x), c.x) >= 0.0 && max(max(a.x, b.x), c.x) <= 1.0 &&
      min(min(a.y, b.y), c.y) >= low && max(max(a.y, b.y), c.y) <= high) {
    return heprQuadraticIntegral(a, b, c);
  }
  let qa = a.y - 2.0 * b.y + c.y;
  var turn = 0.0;
  if (qa != 0.0) {
    turn = clamp((a.y - b.y) / qa, 0.0, 1.0);
  }
  if (min(min(a.x, b.x), c.x) >= 1.0) {
    let middle = clamp(heprQuadraticPoint(a, b, c, turn).y, low, high);
    return middle - clamp(a.y, low, high) + clamp(c.y, low, high) - middle;
  }
  return heprQuadraticPieceCoverage(a, b, c, 0.0, turn, low, high) +
    heprQuadraticPieceCoverage(a, b, c, turn, 1.0, low, high);
}

fn heprSegmentCoverage(p0: vec2<f32>, p1: vec2<f32>, p2: vec2<f32>, quadratic: bool, box: vec4<f32>, low: f32, high: f32) -> f32 {
  let a = vec2<f32>((p0.x - box.x) * box.z, (p0.y - box.y) * box.w);
  let c = vec2<f32>((p2.x - box.x) * box.z, (p2.y - box.y) * box.w);
  if (!quadratic) {
    return heprLineCoverage(a, c, low, high);
  }
  let b = vec2<f32>((p1.x - box.x) * box.z, (p1.y - box.y) * box.w);
  return heprQuadraticCoverage(a, b, c, low, high);
}

fn heprBandRows(bandInfo: vec4<f32>, band: i32, bandCount: i32, box: vec4<f32>) -> vec2<f32> {
  if (bandCount <= 0) {
    return vec2<f32>(0.0, 1.0);
  }
  let bandLow = bandInfo.z + f32(band) * bandInfo.w;
  var rows = vec2<f32>(
    clamp((bandLow - box.y) * box.w, 0.0, 1.0),
    clamp((bandLow + bandInfo.w - box.y) * box.w, 0.0, 1.0)
  );
  if (band == 0) {
    rows.x = 0.0;
  }
  if (band == bandCount - 1) {
    rows.y = 1.0;
  }
  return rows;
}

fn heprFillCoverage(winding: f32, evenOdd: bool) -> f32 {
  let magnitude = abs(winding);
  return select(min(magnitude, 1.0), abs(magnitude - 2.0 * floor(0.5 * magnitude + 0.5)), evenOdd);
}







fn heprHullAreaWinding(signedArea: f32, lower: vec2<f32>, upper: vec2<f32>, box: vec4<f32>, footprint: vec2<f32>) -> f32 {
  let spanX = upper.x - lower.x;
  let spanY = upper.y - lower.y;
  let overlapX = min(box.x + footprint.x, upper.x) - max(box.x, lower.x);
  let overlapY = min(box.y + footprint.y, upper.y) - max(box.y, lower.y);
  let shareX = select(max(overlapX, 0.0) / max(spanX, 1e-30), 1.0, overlapX >= spanX);
  let shareY = select(max(overlapY, 0.0) / max(spanY, 1e-30), 1.0, overlapY >= spanY);
  return signedArea * box.z * box.w * shareX * shareY;
}
`,re=`
mat2 heprPathToPixel(vec2 world, float useLocalToClip, mat4 localToClip, float zoom, vec2 viewport) {
  if (useLocalToClip < 0.5) {
    return mat2(zoom, 0.0, 0.0, zoom);
  }
  vec4 clip = localToClip * vec4(world, 0.0, 1.0);
  float w = abs(clip.w) > 1e-6 ? clip.w : 1e-6;
  vec2 ndc = clip.xy / w;
  vec2 halfViewport = 0.5 * viewport;
  return mat2(
    (localToClip[0].xy - ndc * localToClip[0].w) / w * halfViewport,
    (localToClip[1].xy - ndc * localToClip[1].w) / w * halfViewport
  );
}

vec2 heprCoverageMargin(mat2 pathToPixel) {
  float det = abs(pathToPixel[0][0] * pathToPixel[1][1] - pathToPixel[1][0] * pathToPixel[0][1]);
  if (!(det > 1e-30)) {
    return vec2(0.0);
  }
  return vec2(length(pathToPixel[1]), length(pathToPixel[0])) * (${1 .toFixed(1)} / det);
}




float heprCoverageExpansionScale(vec4 clip, vec4 deltaX, vec4 deltaY, vec2 viewport) {
  float w = abs(clip.w);
  if (!(w > 1e-6)) return 0.0;
  float relativeW = (abs(deltaX.w) + abs(deltaY.w)) / w;
  float pixelX = (abs(deltaX.x - clip.x / clip.w * deltaX.w) +
    abs(deltaY.x - clip.x / clip.w * deltaY.w)) * (0.5 * viewport.x / w);
  float pixelY = (abs(deltaX.y - clip.y / clip.w * deltaX.w) +
    abs(deltaY.y - clip.y / clip.w * deltaY.w)) * (0.5 * viewport.y / w);
  
  float demand = max(pixelX, pixelY) + 2.0 * relativeW;
  if (!(demand < 1e30) || !(relativeW < 1e30)) return 0.0;
  return min(1.0, min(0.25 / max(relativeW, 1e-30), 2.0 / max(demand, 1e-30)));
}

vec2 heprBoundCoverageMargin(vec2 world, vec2 margin, mat2 pathToWorld,
    float useLocalToClip, mat4 localToClip, vec2 viewport) {
  if (useLocalToClip < 0.5) return margin;
  vec4 clip = localToClip * vec4(world, 0.0, 1.0);
  vec4 deltaX = localToClip * vec4(pathToWorld[0] * margin.x, 0.0, 0.0);
  vec4 deltaY = localToClip * vec4(pathToWorld[1] * margin.y, 0.0, 0.0);
  float scale = heprCoverageExpansionScale(clip, deltaX, deltaY, viewport);
  
  if (!(scale > 0.0)) return vec2(0.0);
  return margin * scale;
}



float heprPixelCoverageExpansionScale(vec4 pathToPixel, vec2 margin, vec2 relativeDepth) {
  float relativeW = abs(relativeDepth.x) * margin.x + abs(relativeDepth.y) * margin.y;
  float pixelX = abs(pathToPixel.x) * margin.x + abs(pathToPixel.z) * margin.y;
  float pixelY = abs(pathToPixel.y) * margin.x + abs(pathToPixel.w) * margin.y;
  float demand = max(pixelX, pixelY) + 2.0 * relativeW;
  if (!(demand < 1e30) || !(relativeW < 1e30)) return 0.0;
  return min(1.0, min(0.25 / max(relativeW, 1e-30), 2.0 / max(demand, 1e-30)));
}

vec2 heprBoundCoverageMarginFromPixel(vec2 world, vec2 margin, mat2 pathToWorld, mat2 pathToPixel,
    float useLocalToClip, mat4 localToClip) {
  if (useLocalToClip < 0.5) return margin;
  vec2 depthSlope = vec2(localToClip[0].w, localToClip[1].w);
  float w = dot(depthSlope, world) + localToClip[3].w;
  if (!(abs(w) > 1e-6)) return vec2(0.0);
  vec2 relativeDepth = vec2(dot(depthSlope, pathToWorld[0]), dot(depthSlope, pathToWorld[1])) / w;
  float scale = heprPixelCoverageExpansionScale(vec4(pathToPixel[0], pathToPixel[1]), margin, relativeDepth);
  if (!(scale > 0.0)) return vec2(0.0);
  return margin * scale;
}



float heprTightFillMarginSupported(vec4 clip, vec4 extent, vec4 expansion, vec2 viewport) {
  float w = clip.w - extent.w;
  if (!(w > 1e-6) || !(abs(clip.x) + extent.x <= w) || !(abs(clip.y) + extent.y <= w)) return 0.0;
  float relativeW = expansion.w / w;
  float pixels = max((expansion.x + expansion.w) * viewport.x,
    (expansion.y + expansion.w) * viewport.y) * (0.5 / w);
  return relativeW * 1.00001 <= 0.25 && (pixels + 2.0 * relativeW) * 1.00001 <= 2.0 ? 1.0 : 0.0;
}

vec4 heprFillInverseMarginBounds(vec2 size, vec2 originalMargin, float minW, float maxW, float w, vec2 depthSlope) {
  float slope = (abs(depthSlope.x) * originalMargin.x + abs(depthSlope.y) * originalMargin.y) / w;
  float lowerFactor = minW / (w * 1.00001);
  float upperFactor = maxW / w * 1.00001;
  return vec4(max(originalMargin.x - slope * size.x, 0.0) * lowerFactor,
    max(originalMargin.y - slope * size.y, 0.0) * lowerFactor,
    (originalMargin.x + slope * size.x) * upperFactor, (originalMargin.y + slope * size.y) * upperFactor);
}

vec2 heprProjectedClosedFillMargin(vec2 low, vec2 high, vec2 corner, vec2 originalMargin,
    vec2 footprint, float aaPixels, mat4 projection, vec2 viewport) {
  if (!(footprint.x > 0.0) || !(footprint.y > 0.0)) return vec2(-1.0);
  vec2 margin = max(footprint * (0.5 * aaPixels), vec2(5e-5)) + footprint * 1e-5;
  vec2 size = high - low;
  vec4 clip = projection * vec4(low + size * 0.5, 0.0, 1.0);
  vec4 extent = abs(projection[0]) * (size.x * 0.5) + abs(projection[1]) * (size.y * 0.5);
  vec2 world = mix(low, high, corner);
  float w = abs(projection[0].w * world.x + projection[1].w * world.y + projection[3].w);
  if (!(w > 1e-6)) return vec2(-1.0);
  
  
  vec4 bounds = heprFillInverseMarginBounds(size, originalMargin, clip.w - extent.w, clip.w + extent.w, w,
    vec2(projection[0].w, projection[1].w));
  if (!(margin.x <= bounds.x) || !(margin.y <= bounds.y)) return vec2(-1.0);
  vec4 expansion = abs(projection[0]) * bounds.z + abs(projection[1]) * bounds.w;
  if (heprTightFillMarginSupported(clip, extent, expansion, viewport) < 0.5) return vec2(-1.0);
  return margin;
}
`,ie=`
fn heprPathToPixel(world: vec2<f32>, useLocalToClip: f32, localToClip: mat4x4<f32>, zoom: f32, viewport: vec2<f32>) -> mat2x2<f32> {
  if (useLocalToClip < 0.5) {
    return mat2x2<f32>(zoom, 0.0, 0.0, zoom);
  }
  let clip = localToClip * vec4<f32>(world, 0.0, 1.0);
  let w = select(0.000001, clip.w, abs(clip.w) > 0.000001);
  let ndc = clip.xy / w;
  let halfViewport = 0.5 * viewport;
  return mat2x2<f32>(
    (localToClip[0].xy - ndc * localToClip[0].w) / w * halfViewport,
    (localToClip[1].xy - ndc * localToClip[1].w) / w * halfViewport
  );
}

fn heprCoverageMargin(pathToPixel: mat2x2<f32>) -> vec2<f32> {
  let det = abs(pathToPixel[0].x * pathToPixel[1].y - pathToPixel[1].x * pathToPixel[0].y);
  if (!(det > 1e-30)) {
    return vec2<f32>(0.0);
  }
  return vec2<f32>(length(pathToPixel[1]), length(pathToPixel[0])) * (${1 .toFixed(1)} / det);
}


fn heprCoverageExpansionScale(clip: vec4<f32>, deltaX: vec4<f32>, deltaY: vec4<f32>, viewport: vec2<f32>) -> f32 {
  let w = abs(clip.w);
  if (!(w > 0.000001)) { return 0.0; }
  let relativeW = (abs(deltaX.w) + abs(deltaY.w)) / w;
  let pixelX = (abs(deltaX.x - clip.x / clip.w * deltaX.w) +
    abs(deltaY.x - clip.x / clip.w * deltaY.w)) * (0.5 * viewport.x / w);
  let pixelY = (abs(deltaX.y - clip.y / clip.w * deltaX.w) +
    abs(deltaY.y - clip.y / clip.w * deltaY.w)) * (0.5 * viewport.y / w);
  let demand = max(pixelX, pixelY) + 2.0 * relativeW;
  if (!(demand < 1e30) || !(relativeW < 1e30)) { return 0.0; }
  return min(1.0, min(0.25 / max(relativeW, 1e-30), 2.0 / max(demand, 1e-30)));
}

fn heprBoundCoverageMargin(world: vec2<f32>, margin: vec2<f32>, pathToWorld: mat2x2<f32>,
    useLocalToClip: f32, localToClip: mat4x4<f32>, viewport: vec2<f32>) -> vec2<f32> {
  if (useLocalToClip < 0.5) { return margin; }
  let clip = localToClip * vec4<f32>(world, 0.0, 1.0);
  let deltaX = localToClip * vec4<f32>(pathToWorld[0] * margin.x, 0.0, 0.0);
  let deltaY = localToClip * vec4<f32>(pathToWorld[1] * margin.y, 0.0, 0.0);
  let scale = heprCoverageExpansionScale(clip, deltaX, deltaY, viewport);
  if (!(scale > 0.0)) { return vec2<f32>(0.0); }
  return margin * scale;
}


fn heprPixelCoverageExpansionScale(pathToPixel: vec4<f32>, margin: vec2<f32>, relativeDepth: vec2<f32>) -> f32 {
  let relativeW = abs(relativeDepth.x) * margin.x + abs(relativeDepth.y) * margin.y;
  let pixelX = abs(pathToPixel.x) * margin.x + abs(pathToPixel.z) * margin.y;
  let pixelY = abs(pathToPixel.y) * margin.x + abs(pathToPixel.w) * margin.y;
  let demand = max(pixelX, pixelY) + 2.0 * relativeW;
  if (!(demand < 1e30) || !(relativeW < 1e30)) { return 0.0; }
  return min(1.0, min(0.25 / max(relativeW, 1e-30), 2.0 / max(demand, 1e-30)));
}

fn heprBoundCoverageMarginFromPixel(world: vec2<f32>, margin: vec2<f32>, pathToWorld: mat2x2<f32>, pathToPixel: mat2x2<f32>,
    useLocalToClip: f32, localToClip: mat4x4<f32>) -> vec2<f32> {
  if (useLocalToClip < 0.5) { return margin; }
  let depthSlope = vec2<f32>(localToClip[0].w, localToClip[1].w);
  let w = dot(depthSlope, world) + localToClip[3].w;
  if (!(abs(w) > 0.000001)) { return vec2<f32>(0.0); }
  let relativeDepth = vec2<f32>(dot(depthSlope, pathToWorld[0]), dot(depthSlope, pathToWorld[1])) / w;
  let scale = heprPixelCoverageExpansionScale(vec4<f32>(pathToPixel[0], pathToPixel[1]), margin, relativeDepth);
  if (!(scale > 0.0)) { return vec2<f32>(0.0); }
  return margin * scale;
}

fn heprTightFillMarginSupported(clip: vec4<f32>, extent: vec4<f32>, expansion: vec4<f32>, viewport: vec2<f32>) -> f32 {
  let w = clip.w - extent.w;
  if (!(w > 0.000001) || !(abs(clip.x) + extent.x <= w) || !(abs(clip.y) + extent.y <= w)) { return 0.0; }
  let relativeW = expansion.w / w;
  let pixels = max((expansion.x + expansion.w) * viewport.x,
    (expansion.y + expansion.w) * viewport.y) * (0.5 / w);
  return select(0.0, 1.0, relativeW * 1.00001 <= 0.25 && (pixels + 2.0 * relativeW) * 1.00001 <= 2.0);
}

fn heprFillInverseMarginBounds(size: vec2<f32>, originalMargin: vec2<f32>, minW: f32, maxW: f32, w: f32, depthSlope: vec2<f32>) -> vec4<f32> {
  let slope = (abs(depthSlope.x) * originalMargin.x + abs(depthSlope.y) * originalMargin.y) / w;
  let lowerFactor = minW / (w * 1.00001);
  let upperFactor = maxW / w * 1.00001;
  return vec4<f32>(max(originalMargin.x - slope * size.x, 0.0) * lowerFactor,
    max(originalMargin.y - slope * size.y, 0.0) * lowerFactor,
    (originalMargin.x + slope * size.x) * upperFactor, (originalMargin.y + slope * size.y) * upperFactor);
}

fn heprProjectedClosedFillMargin(low: vec2<f32>, high: vec2<f32>, corner: vec2<f32>, originalMargin: vec2<f32>,
    footprint: vec2<f32>, aaPixels: f32, projection: mat4x4<f32>, viewport: vec2<f32>) -> vec2<f32> {
  if (!(footprint.x > 0.0) || !(footprint.y > 0.0)) { return vec2<f32>(-1.0); }
  let margin = max(footprint * (0.5 * aaPixels), vec2<f32>(0.00005)) + footprint * 0.00001;
  let size = high - low;
  let clip = projection * vec4<f32>(low + size * 0.5, 0.0, 1.0);
  let extent = abs(projection[0]) * (size.x * 0.5) + abs(projection[1]) * (size.y * 0.5);
  let world = low + size * corner;
  let w = abs(projection[0].w * world.x + projection[1].w * world.y + projection[3].w);
  if (!(w > 0.000001)) { return vec2<f32>(-1.0); }
  let bounds = heprFillInverseMarginBounds(size, originalMargin, clip.w - extent.w, clip.w + extent.w, w,
    vec2<f32>(projection[0].w, projection[1].w));
  if (!(margin.x <= bounds.x) || !(margin.y <= bounds.y)) { return vec2<f32>(-1.0); }
  let expansion = abs(projection[0]) * bounds.z + abs(projection[1]) * bounds.w;
  if (heprTightFillMarginSupported(clip, extent, expansion, viewport) < 0.5) { return vec2<f32>(-1.0); }
  return margin;
}
`,ae=`
vec4 heprClippedPaintQuad(vec2 minBounds, vec2 maxBounds, vec4 clipBounds, float useLocalToClip,
    mat4 localToClip, float zoom, vec2 viewport) {
  vec2 low = max(minBounds, clipBounds.xy);
  vec2 high = min(maxBounds, clipBounds.zw);
  vec2 a = min(low, high);
  vec2 b = max(low, high);
  vec2 margin = max(
    max(heprCoverageMargin(heprPathToPixel(a, useLocalToClip, localToClip, zoom, viewport)),
      heprCoverageMargin(heprPathToPixel(b, useLocalToClip, localToClip, zoom, viewport))),
    max(heprCoverageMargin(heprPathToPixel(vec2(a.x, b.y), useLocalToClip, localToClip, zoom, viewport)),
      heprCoverageMargin(heprPathToPixel(vec2(b.x, a.y), useLocalToClip, localToClip, zoom, viewport))));
  margin = min(
    min(heprBoundCoverageMargin(a, margin, mat2(1.0), useLocalToClip, localToClip, viewport),
      heprBoundCoverageMargin(b, margin, mat2(1.0), useLocalToClip, localToClip, viewport)),
    min(heprBoundCoverageMargin(vec2(a.x, b.y), margin, mat2(1.0), useLocalToClip, localToClip, viewport),
      heprBoundCoverageMargin(vec2(b.x, a.y), margin, mat2(1.0), useLocalToClip, localToClip, viewport)));
  return vec4(low - margin, high + margin);
}
`,oe=`
fn heprClippedPaintQuad(minBounds: vec2<f32>, maxBounds: vec2<f32>, clipBounds: vec4<f32>, useLocalToClip: f32,
    localToClip: mat4x4<f32>, zoom: f32, viewport: vec2<f32>) -> vec4<f32> {
  let low = max(minBounds, clipBounds.xy);
  let high = min(maxBounds, clipBounds.zw);
  let a = min(low, high);
  let b = max(low, high);
  var margin = max(
    max(heprCoverageMargin(heprPathToPixel(a, useLocalToClip, localToClip, zoom, viewport)),
      heprCoverageMargin(heprPathToPixel(b, useLocalToClip, localToClip, zoom, viewport))),
    max(heprCoverageMargin(heprPathToPixel(vec2<f32>(a.x, b.y), useLocalToClip, localToClip, zoom, viewport)),
      heprCoverageMargin(heprPathToPixel(vec2<f32>(b.x, a.y), useLocalToClip, localToClip, zoom, viewport))));
  let identity = mat2x2<f32>(1.0, 0.0, 0.0, 1.0);
  margin = min(
    min(heprBoundCoverageMargin(a, margin, identity, useLocalToClip, localToClip, viewport),
      heprBoundCoverageMargin(b, margin, identity, useLocalToClip, localToClip, viewport)),
    min(heprBoundCoverageMargin(vec2<f32>(a.x, b.y), margin, identity, useLocalToClip, localToClip, viewport),
      heprBoundCoverageMargin(vec2<f32>(b.x, a.y), margin, identity, useLocalToClip, localToClip, viewport)));
  return vec4<f32>(low - margin, high + margin);
}
`,se=`
float heprCellWinding(vec4 cells, vec2 origin, vec4 box, vec2 footprint) {
  float reach = 0.5 * max(footprint.x, footprint.y);
  float level = clamp(ceil(log2(max(reach / cells.z, 1.0)) / cells.w), 0.0, cells.y - 1.0);
  float size = cells.z * exp2(level * cells.w);
  if (size < reach && level < cells.y - 1.0) {
    level = level + 1.0;
    size = cells.z * exp2(level * cells.w);
  }
  vec4 grid = heprCellFetchA(int(cells.x + level));
  float right = box.x + footprint.x;
  int firstColumn = int(clamp(floor((box.x - origin.x) / size), 0.0, grid.y - 1.0));
  int lastColumn = int(clamp(floor((right - origin.x) / size), 0.0, grid.y - 1.0));
  int firstRow = int(clamp(floor((box.y - origin.y) / size), 0.0, grid.z - 1.0));
  int lastRow = int(clamp(floor((box.y + footprint.y - origin.y) / size), 0.0, grid.z - 1.0));
  vec4 rowGrid = vec4(0.0, 0.0, origin.y, size);
  float winding = 0.0;
  
  
  
  
  for (int row = firstRow; row <= lastRow; row += 1) {
    vec2 rows = heprBandRows(rowGrid, row, int(grid.z), box);
    int rowBase = int(grid.x + float(row) * grid.y);
    vec4 nextCell = heprCellFetchA(rowBase + firstColumn);
    for (int column = firstColumn; column <= lastColumn; column += 1) {
      vec4 cell = nextCell;
      nextCell = heprCellFetchA(rowBase + min(column + 1, lastColumn));
      
      float low = column == 0 ? box.x : max(box.x, origin.x + float(column) * size);
      float high = column == int(grid.y) - 1 ? right : min(right, origin.x + float(column + 1) * size);
      if (high > low) {
        vec4 part = vec4(low, box.y, 1.0 / (high - low), box.w);
        float cellWinding = 0.0;
        int first = int(cell.x);
        int count = int(abs(cell.y));
        int last = first + count - 1;
        if (cell.y > 0.0) {
          
          
          for (int piece = 0; piece < count; piece += 4) {
            vec4 l0 = heprCellFetchA(first + piece);
            vec4 l1 = heprCellFetchA(min(first + piece + 1, last));
            vec4 l2 = heprCellFetchA(min(first + piece + 2, last));
            vec4 l3 = heprCellFetchA(min(first + piece + 3, last));
            cellWinding += heprSegmentCoverage(vec2(l0.x, l0.y), vec2(l0.x, l0.y), vec2(l0.z, l0.w), false,
              part, rows.x, rows.y);
            cellWinding += heprSegmentCoverage(vec2(l1.x, l1.y), vec2(l1.x, l1.y), vec2(l1.z, l1.w), false,
              part, rows.x, piece + 1 < count ? rows.y : rows.x);
            cellWinding += heprSegmentCoverage(vec2(l2.x, l2.y), vec2(l2.x, l2.y), vec2(l2.z, l2.w), false,
              part, rows.x, piece + 2 < count ? rows.y : rows.x);
            cellWinding += heprSegmentCoverage(vec2(l3.x, l3.y), vec2(l3.x, l3.y), vec2(l3.z, l3.w), false,
              part, rows.x, piece + 3 < count ? rows.y : rows.x);
          }
        } else if (count > 0) {
          vec4 nextA = heprCellFetchA(first);
          vec4 nextB = heprCellFetchB(first);
          for (int piece = 0; piece < count; piece += 1) {
            vec4 a = nextA;
            vec4 b = nextB;
            int following = min(first + piece + 1, last);
            nextA = heprCellFetchA(following);
            nextB = heprCellFetchB(following);
            cellWinding += heprSegmentCoverage(vec2(a.x, a.y), vec2(b.x, b.y), vec2(a.z, a.w), b.z >= 0.5,
              part, rows.x, rows.y);
          }
        }
        int closures = int(cell.z);
        int closureCount = int(cell.w);
        for (int closure = 0; closure < closureCount; closure += 2) {
          vec4 pair = heprCellFetchA(closures + closure);
          vec4 pair2 = heprCellFetchA(closures + min(closure + 1, closureCount - 1));
          float more = closure + 1 < closureCount ? 1.0 : 0.0;
          cellWinding += pair.y * (clamp((pair.x - box.y) * box.w, rows.x, rows.y) - rows.y);
          cellWinding += pair.w * (clamp((pair.z - box.y) * box.w, rows.x, rows.y) - rows.y);
          cellWinding += more * pair2.y * (clamp((pair2.x - box.y) * box.w, rows.x, rows.y) - rows.y);
          cellWinding += more * pair2.w * (clamp((pair2.z - box.y) * box.w, rows.x, rows.y) - rows.y);
        }
        winding += cellWinding * (high - low) / footprint.x;
      }
    }
  }
  return winding;
}
`,ce=`
fn heprCellWinding(cells: vec4<f32>, origin: vec2<f32>, box: vec4<f32>, footprint: vec2<f32>,
    segmentsA: texture_2d<f32>, segmentsB: texture_2d<f32>) -> f32 {
  let reach = 0.5 * max(footprint.x, footprint.y);
  var level = clamp(ceil(log2(max(reach / cells.z, 1.0)) / cells.w), 0.0, cells.y - 1.0);
  var size = cells.z * exp2(level * cells.w);
  if (size < reach && level < cells.y - 1.0) {
    level = level + 1.0;
    size = cells.z * exp2(level * cells.w);
  }
  let grid = heprCellTexel(segmentsA, i32(cells.x + level));
  let right = box.x + footprint.x;
  let firstColumn = i32(clamp(floor((box.x - origin.x) / size), 0.0, grid.y - 1.0));
  let lastColumn = i32(clamp(floor((right - origin.x) / size), 0.0, grid.y - 1.0));
  let firstRow = i32(clamp(floor((box.y - origin.y) / size), 0.0, grid.z - 1.0));
  let lastRow = i32(clamp(floor((box.y + footprint.y - origin.y) / size), 0.0, grid.z - 1.0));
  let rowGrid = vec4<f32>(0.0, 0.0, origin.y, size);
  var winding = 0.0;
  
  for (var row = firstRow; row <= lastRow; row = row + 1) {
    let rows = heprBandRows(rowGrid, row, i32(grid.z), box);
    let rowBase = i32(grid.x + f32(row) * grid.y);
    var nextCell = heprCellTexel(segmentsA, rowBase + firstColumn);
    for (var column = firstColumn; column <= lastColumn; column = column + 1) {
      let cell = nextCell;
      nextCell = heprCellTexel(segmentsA, rowBase + min(column + 1, lastColumn));
      
      var low = max(box.x, origin.x + f32(column) * size);
      if (column == 0) {
        low = box.x;
      }
      var high = min(right, origin.x + f32(column + 1) * size);
      if (column == i32(grid.y) - 1) {
        high = right;
      }
      if (high > low) {
        let part = vec4<f32>(low, box.y, 1.0 / (high - low), box.w);
        var cellWinding = 0.0;
        let first = i32(cell.x);
        let count = i32(abs(cell.y));
        let last = first + count - 1;
        if (cell.y > 0.0) {
          
          
          for (var piece = 0; piece < count; piece = piece + 4) {
            let l0 = heprCellTexel(segmentsA, first + piece);
            let l1 = heprCellTexel(segmentsA, min(first + piece + 1, last));
            let l2 = heprCellTexel(segmentsA, min(first + piece + 2, last));
            let l3 = heprCellTexel(segmentsA, min(first + piece + 3, last));
            cellWinding = cellWinding + heprCellLine(l0, part, rows.x, rows.y) +
              heprCellLine(l1, part, rows.x, select(rows.x, rows.y, piece + 1 < count)) +
              heprCellLine(l2, part, rows.x, select(rows.x, rows.y, piece + 2 < count)) +
              heprCellLine(l3, part, rows.x, select(rows.x, rows.y, piece + 3 < count));
          }
        } else if (count > 0) {
          var nextA = heprCellTexel(segmentsA, first);
          var nextB = heprCellTexel(segmentsB, first);
          for (var piece = 0; piece < count; piece = piece + 1) {
            let a = nextA;
            let b = nextB;
            let following = min(first + piece + 1, last);
            nextA = heprCellTexel(segmentsA, following);
            nextB = heprCellTexel(segmentsB, following);
            cellWinding = cellWinding + heprSegmentCoverage(vec2<f32>(a.x, a.y), vec2<f32>(b.x, b.y),
              vec2<f32>(a.z, a.w), b.z >= 0.5, part, rows.x, rows.y);
          }
        }
        let closures = i32(cell.z);
        let closureCount = i32(cell.w);
        for (var closure = 0; closure < closureCount; closure = closure + 2) {
          let pair = heprCellTexel(segmentsA, closures + closure);
          let pair2 = heprCellTexel(segmentsA, closures + min(closure + 1, closureCount - 1));
          let more = select(0.0, 1.0, closure + 1 < closureCount);
          cellWinding = cellWinding + pair.y * (clamp((pair.x - box.y) * box.w, rows.x, rows.y) - rows.y) +
            pair.w * (clamp((pair.z - box.y) * box.w, rows.x, rows.y) - rows.y) +
            more * pair2.y * (clamp((pair2.x - box.y) * box.w, rows.x, rows.y) - rows.y) +
            more * pair2.w * (clamp((pair2.z - box.y) * box.w, rows.x, rows.y) - rows.y);
        }
        winding = winding + cellWinding * (high - low) / footprint.x;
      }
    }
  }
  return winding;
}

fn heprCellTexel(segments: texture_2d<f32>, index: i32) -> vec4<f32> {
  let width = i32(textureDimensions(segments).x);
  return textureLoad(segments, vec2<i32>(index % width, index / width), 0);
}

fn heprCellLine(line: vec4<f32>, part: vec4<f32>, low: f32, high: f32) -> f32 {
  return heprSegmentCoverage(vec2<f32>(line.x, line.y), vec2<f32>(line.x, line.y), vec2<f32>(line.z, line.w), false,
    part, low, high);
}
`,le=`
fn heprFillCellInfo(pathIndex: f32, headers: f32, segments: texture_2d<f32>) -> vec4<f32> {
  if (headers <= 0.0) { return vec4<f32>(0.0); }
  let width = i32(textureDimensions(segments).x);
  let index = i32(headers - 1.0 + pathIndex);
  return textureLoad(segments, vec2<i32>(index % width, index / width), 0);
}
`,F=`
uniform highp sampler2D uVectorClipTex;
uniform float uVectorClipIndex;
vec4 heprClipTexel(highp int index) {
  highp int width = textureSize(uVectorClipTex, 0).x;
  return texelFetch(uVectorClipTex, ivec2(index % width, index / width), 0);
}


float heprClipCellLevel(vec4 cells, float reach) {
  float level = clamp(ceil(log2(max(reach / cells.z, 1.0)) / cells.w), 0.0, cells.y - 1.0);
  if (cells.z * exp2(level * cells.w) < reach && level < cells.y - 1.0) level += 1.0;
  return level;
}

float heprVectorClip(vec2 point) {
  highp int index = int(uVectorClipIndex);
  
  while (index >= 0) {
    vec4 node = heprClipTexel(index);
    if (node.z < 0.0) {
      vec4 bounds = heprClipTexel(int(node.y));
      
      if (any(lessThan(point, bounds.xy)) || any(greaterThanEqual(point, bounds.zw))) return 0.0;
      index = int(node.x);
      continue;
    }
    highp int flags = int(node.w);
    highp int winding = 0;
    if ((flags & 4) != 0) {
      vec4 cells = heprClipTexel(int(node.y));
      vec4 origin = heprClipTexel(int(node.y) + 1);
      vec4 grid = heprClipTexel(int(cells.x));
      vec2 home = clamp(floor((point - origin.xy) / cells.z), vec2(0.0), grid.yz - 1.0);
      vec4 cell = heprClipTexel(int(grid.x + home.y * grid.y + home.x));
      for (highp int piece = 0; piece < int(cell.y); piece++) {
        vec4 line = heprClipTexel(int(cell.x) + piece);
        if ((line.y > point.y) != (line.w > point.y)) {
          float x = line.x + (point.y - line.y) / (line.w - line.y) * (line.z - line.x);
          if (x > point.x) winding += line.w > line.y ? 1 : -1;
        }
      }
      for (highp int closure = 0; closure < int(cell.w); closure++) {
        vec4 pair = heprClipTexel(int(cell.z) + closure);
        if (pair.x <= point.y) winding -= int(pair.y);
        if (pair.z <= point.y) winding -= int(pair.w);
      }
    } else {
      highp int firstEdge = int(node.y);
      highp int edgeCount = int(node.z);
      if ((flags & 2) != 0) {
        vec4 bands = heprClipTexel(int(node.y));
        
        highp int band = int(clamp(floor((point.y - bands.y) / bands.z), 0.0, bands.w - 1.0));
        vec4 range = heprClipTexel(int(bands.x) + band);
        firstEdge = int(range.x);
        edgeCount = int(range.y);
      }
      for (highp int edge = 0; edge < edgeCount; edge++) {
        vec4 line = heprClipTexel(firstEdge + edge);
        if ((line.y > point.y) != (line.w > point.y)) {
          float x = line.x + (point.y - line.y) / (line.w - line.y) * (line.z - line.x);
          if (x > point.x) winding += line.w > line.y ? 1 : -1;
        }
      }
    }
    bool inside = (flags & 1) != 0 ? (abs(winding) % 2 != 0) : winding != 0;
    if (!inside) return 0.0;
    index = int(node.x);
  }
  return 1.0;
}


const vec4 VECTOR_CLIP_SAMPLE_OFFSETS = vec4(-0.375, -0.125, 0.125, 0.375);

uint heprSampleBits(vec4 inside) {
  return (inside.x > 0.5 ? 1u : 0u) | (inside.y > 0.5 ? 2u : 0u) |
    (inside.z > 0.5 ? 4u : 0u) | (inside.w > 0.5 ? 8u : 0u);
}

uint heprSampleGrid(uint row0, uint row1, uint row2, uint row3) {
  return row0 | (row1 << 4) | (row2 << 8) | (row3 << 12);
}

float heprSampleCoverage(uint samples) {
  uint count = samples - ((samples >> 1) & 0x5555u);
  count = (count & 0x3333u) + ((count >> 2) & 0x3333u);
  count = (count + (count >> 4)) & 0x0F0Fu;
  return float((count + (count >> 8)) & 0x1Fu) * 0.0625;
}


uint heprClipRectSamples(vec4 bounds, vec4 sampleX, vec4 sampleY) {
  uint columns = heprSampleBits(step(bounds.xxxx, sampleX) * (1.0 - step(bounds.zzzz, sampleX)));
  vec4 rows = step(bounds.yyyy, sampleY) * (1.0 - step(bounds.wwww, sampleY));
  return heprSampleGrid(rows.x > 0.5 ? columns : 0u, rows.y > 0.5 ? columns : 0u,
    rows.z > 0.5 ? columns : 0u, rows.w > 0.5 ? columns : 0u);
}



void heprClipSampleCrossings(vec4 line, vec4 sampleX, vec4 sampleY, vec4 rows, vec4 columns,
    inout vec4 winding0, inout vec4 winding1, inout vec4 winding2, inout vec4 winding3) {
  vec4 crossing = abs(vec4(greaterThan(vec4(line.y), sampleY)) - vec4(greaterThan(vec4(line.w), sampleY))) * rows;
  if (any(greaterThan(crossing, vec4(0.0)))) {
    vec4 x = line.x + (sampleY - line.y) / (line.w - line.y) * (line.z - line.x);
    crossing *= line.w > line.y ? 1.0 : -1.0;
    winding0 += crossing.x * columns * vec4(greaterThan(x.xxxx, sampleX));
    winding1 += crossing.y * columns * vec4(greaterThan(x.yyyy, sampleX));
    winding2 += crossing.z * columns * vec4(greaterThan(x.zzzz, sampleX));
    winding3 += crossing.w * columns * vec4(greaterThan(x.wwww, sampleX));
  }
}



void heprClipSampleEdges(highp int first, highp int count, vec4 sampleX, vec4 sampleY, vec4 rows, vec4 columns,
    inout vec4 winding0, inout vec4 winding1, inout vec4 winding2, inout vec4 winding3) {
  for (highp int edge = 0; edge < count; edge += 4) {
    highp int last = first + count - 1;
    vec4 line0 = heprClipTexel(first + edge);
    vec4 line1 = heprClipTexel(min(first + edge + 1, last));
    vec4 line2 = heprClipTexel(min(first + edge + 2, last));
    vec4 line3 = heprClipTexel(min(first + edge + 3, last));
    heprClipSampleCrossings(line0, sampleX, sampleY, rows, columns, winding0, winding1, winding2, winding3);
    heprClipSampleCrossings(line1, sampleX, sampleY, edge + 1 < count ? rows : vec4(0.0), columns,
      winding0, winding1, winding2, winding3);
    heprClipSampleCrossings(line2, sampleX, sampleY, edge + 2 < count ? rows : vec4(0.0), columns,
      winding0, winding1, winding2, winding3);
    heprClipSampleCrossings(line3, sampleX, sampleY, edge + 3 < count ? rows : vec4(0.0), columns,
      winding0, winding1, winding2, winding3);
  }
}



vec4 heprClipClosuresBelow(vec4 pair, vec4 sampleY) {
  return pair.y * step(vec4(pair.x), sampleY) + pair.w * step(vec4(pair.z), sampleY);
}

uint heprSampleInside(vec4 winding, bool evenOdd) {
  return heprSampleBits(evenOdd ? mod(abs(winding), 2.0) : abs(winding));
}


uint heprClipPolygonSamples(vec4 node, vec4 sampleX, vec4 sampleY, float span) {
  highp int flags = int(node.w);
  vec4 winding0 = vec4(0.0);
  vec4 winding1 = vec4(0.0);
  vec4 winding2 = vec4(0.0);
  vec4 winding3 = vec4(0.0);
  if ((flags & 4) != 0) {
    vec4 cells = heprClipTexel(int(node.y));
    vec4 origin = heprClipTexel(int(node.y) + 1);
    float level = heprClipCellLevel(cells, span);
    float size = cells.z * exp2(level * cells.w);
    vec4 grid = heprClipTexel(int(cells.x + level));
    
    vec4 columnOf = clamp(floor((sampleX - origin.x) / size), 0.0, grid.y - 1.0);
    vec4 rowOf = clamp(floor((sampleY - origin.y) / size), 0.0, grid.z - 1.0);
    for (highp int row = int(rowOf.x); row <= int(rowOf.w); row++) {
      vec4 rows = vec4(equal(rowOf, vec4(float(row))));
      for (highp int column = int(columnOf.x); column <= int(columnOf.w); column++) {
        vec4 columns = vec4(equal(columnOf, vec4(float(column))));
        vec4 cell = heprClipTexel(int(grid.x) + row * int(grid.y) + column);
        heprClipSampleEdges(int(cell.x), int(cell.y), sampleX, sampleY, rows, columns,
          winding0, winding1, winding2, winding3);
        highp int closures = int(cell.z);
        highp int closureCount = int(cell.w);
        for (highp int closure = 0; closure < closureCount; closure += 2) {
          vec4 pair0 = heprClipTexel(closures + closure);
          vec4 pair1 = heprClipTexel(closures + min(closure + 1, closureCount - 1));
          vec4 below = (heprClipClosuresBelow(pair0, sampleY) +
            (closure + 1 < closureCount ? heprClipClosuresBelow(pair1, sampleY) : vec4(0.0))) * rows;
          winding0 -= below.x * columns;
          winding1 -= below.y * columns;
          winding2 -= below.z * columns;
          winding3 -= below.w * columns;
        }
      }
    }
  } else {
    vec4 bands = vec4(0.0);
    vec4 bandOf = vec4(0.0);
    if ((flags & 2) != 0) {
      bands = heprClipTexel(int(node.y));
      bandOf = clamp(floor((sampleY - bands.y) / bands.z), 0.0, bands.w - 1.0);
    }
    for (highp int band = int(bandOf.x); band <= int(bandOf.w); band++) {
      highp int firstEdge = int(node.y);
      highp int edgeCount = int(node.z);
      if ((flags & 2) != 0) {
        vec4 range = heprClipTexel(int(bands.x) + band);
        firstEdge = int(range.x);
        edgeCount = int(range.y);
      }
      
      heprClipSampleEdges(firstEdge, edgeCount, sampleX, sampleY, vec4(equal(bandOf, vec4(float(band)))),
        vec4(1.0), winding0, winding1, winding2, winding3);
    }
  }
  bool evenOdd = (flags & 1) != 0;
  return heprSampleGrid(heprSampleInside(winding0, evenOdd), heprSampleInside(winding1, evenOdd),
    heprSampleInside(winding2, evenOdd), heprSampleInside(winding3, evenOdd));
}

float heprVectorClipAA(vec2 point, float aaWidth) {
  vec4 sampleX = point.x + VECTOR_CLIP_SAMPLE_OFFSETS * aaWidth;
  vec4 sampleY = point.y + VECTOR_CLIP_SAMPLE_OFFSETS * aaWidth;
  float span = 0.75 * aaWidth;
  uint samples = 0xFFFFu;
  highp int index = int(uVectorClipIndex);
  while (index >= 0) {
    vec4 node = heprClipTexel(index);
    samples &= node.z < 0.0 ? heprClipRectSamples(heprClipTexel(int(node.y)), sampleX, sampleY)
      : heprClipPolygonSamples(node, sampleX, sampleY, span);
    if (samples == 0u) return 0.0;
    index = int(node.x);
  }
  return heprSampleCoverage(samples);
}
`,I=`
fn heprVectorClip(point: vec2<f32>, clipIndex: f32, clipTexture: texture_2d<f32>) -> f32 {
  var index = i32(clipIndex);
  
  while (index >= 0) {
    let node = heprClipTexel(clipTexture, index);
    if (node.z < 0.0) {
      let bounds = heprClipTexel(clipTexture, i32(node.y));
      
      if (any(point < bounds.xy) || any(point >= bounds.zw)) { return 0.0; }
      index = i32(node.x);
      continue;
    }
    let flags = i32(node.w);
    var winding = 0;
    if ((flags & 4) != 0) {
      let cells = heprClipTexel(clipTexture, i32(node.y));
      let origin = heprClipTexel(clipTexture, i32(node.y) + 1);
      let grid = heprClipTexel(clipTexture, i32(cells.x));
      let home = clamp(floor((point - origin.xy) / cells.z), vec2<f32>(0.0), grid.yz - vec2<f32>(1.0));
      let cell = heprClipTexel(clipTexture, i32(grid.x + home.y * grid.y + home.x));
      for (var piece = 0; piece < i32(cell.y); piece++) {
        let line = heprClipTexel(clipTexture, i32(cell.x) + piece);
        if ((line.y > point.y) != (line.w > point.y)) {
          let x = line.x + (point.y - line.y) / (line.w - line.y) * (line.z - line.x);
          if (x > point.x) { winding += select(-1, 1, line.w > line.y); }
        }
      }
      for (var closure = 0; closure < i32(cell.w); closure++) {
        let pair = heprClipTexel(clipTexture, i32(cell.z) + closure);
        if (pair.x <= point.y) { winding -= i32(pair.y); }
        if (pair.z <= point.y) { winding -= i32(pair.w); }
      }
    } else {
      var firstEdge = i32(node.y);
      var edgeCount = i32(node.z);
      if ((flags & 2) != 0) {
        let bands = heprClipTexel(clipTexture, i32(node.y));
        
        let band = i32(clamp(floor((point.y - bands.y) / bands.z), 0.0, bands.w - 1.0));
        let range = heprClipTexel(clipTexture, i32(bands.x) + band);
        firstEdge = i32(range.x);
        edgeCount = i32(range.y);
      }
      for (var edge = 0; edge < edgeCount; edge++) {
        let line = heprClipTexel(clipTexture, firstEdge + edge);
        if ((line.y > point.y) != (line.w > point.y)) {
          let x = line.x + (point.y - line.y) / (line.w - line.y) * (line.z - line.x);
          if (x > point.x) { winding += select(-1, 1, line.w > line.y); }
        }
      }
    }
    let inside = select(winding != 0, abs(winding) % 2 != 0, (flags & 1) != 0);
    if (!inside) { return 0.0; }
    index = i32(node.x);
  }
  return 1.0;
}

fn heprClipTexel(clipTexture: texture_2d<f32>, index: i32) -> vec4<f32> {
  let width = i32(textureDimensions(clipTexture).x);
  return textureLoad(clipTexture, vec2<i32>(index % width, index / width), 0);
}
`,L=`
fn heprVectorClipAA(point: vec2<f32>, clipIndex: f32, clipTexture: texture_2d<f32>, aaWidth: f32) -> f32 {
  
  let offsets = vec4<f32>(-0.375, -0.125, 0.125, 0.375);
  let sampleX = point.x + offsets * aaWidth;
  let sampleY = point.y + offsets * aaWidth;
  let span = 0.75 * aaWidth;
  var samples = 0xFFFFu;
  var index = i32(clipIndex);
  while (index >= 0) {
    let node = heprClipTexel(clipTexture, index);
    if (node.z < 0.0) {
      samples &= heprClipRectSamples(heprClipTexel(clipTexture, i32(node.y)), sampleX, sampleY);
    } else {
      samples &= heprClipPolygonSamples(clipTexture, node, sampleX, sampleY, span);
    }
    if (samples == 0u) { return 0.0; }
    index = i32(node.x);
  }
  return f32(countOneBits(samples)) * 0.0625;
}

fn heprClipSampleBits(inside: vec4<bool>) -> u32 {
  return select(0u, 1u, inside.x) | select(0u, 2u, inside.y) | select(0u, 4u, inside.z) | select(0u, 8u, inside.w);
}

fn heprClipSampleGrid(row0: u32, row1: u32, row2: u32, row3: u32) -> u32 {
  return row0 | (row1 << 4u) | (row2 << 8u) | (row3 << 12u);
}


fn heprClipRectSamples(bounds: vec4<f32>, sampleX: vec4<f32>, sampleY: vec4<f32>) -> u32 {
  let columns = heprClipSampleBits((sampleX >= vec4<f32>(bounds.x)) & (sampleX < vec4<f32>(bounds.z)));
  let rows = (sampleY >= vec4<f32>(bounds.y)) & (sampleY < vec4<f32>(bounds.w));
  return heprClipSampleGrid(select(0u, columns, rows.x), select(0u, columns, rows.y),
    select(0u, columns, rows.z), select(0u, columns, rows.w));
}


fn heprClipCellLevel(cells: vec4<f32>, reach: f32) -> f32 {
  var level = clamp(ceil(log2(max(reach / cells.z, 1.0)) / cells.w), 0.0, cells.y - 1.0);
  if (cells.z * exp2(level * cells.w) < reach && level < cells.y - 1.0) { level += 1.0; }
  return level;
}

fn heprClipMask(condition: vec4<bool>) -> vec4<f32> {
  return select(vec4<f32>(0.0), vec4<f32>(1.0), condition);
}



fn heprClipSampleCrossings(line: vec4<f32>, sampleX: vec4<f32>, sampleY: vec4<f32>, rows: vec4<f32>,
    columns: vec4<f32>, winding0: ptr<function, vec4<f32>>, winding1: ptr<function, vec4<f32>>,
    winding2: ptr<function, vec4<f32>>, winding3: ptr<function, vec4<f32>>) {
  var crossing = abs(heprClipMask(vec4<f32>(line.y) > sampleY) - heprClipMask(vec4<f32>(line.w) > sampleY)) * rows;
  if (any(crossing > vec4<f32>(0.0))) {
    let x = line.x + (sampleY - line.y) / (line.w - line.y) * (line.z - line.x);
    crossing *= select(-1.0, 1.0, line.w > line.y);
    *winding0 += crossing.x * columns * heprClipMask(vec4<f32>(x.x) > sampleX);
    *winding1 += crossing.y * columns * heprClipMask(vec4<f32>(x.y) > sampleX);
    *winding2 += crossing.z * columns * heprClipMask(vec4<f32>(x.z) > sampleX);
    *winding3 += crossing.w * columns * heprClipMask(vec4<f32>(x.w) > sampleX);
  }
}



fn heprClipSampleEdges(clipTexture: texture_2d<f32>, first: i32, count: i32, sampleX: vec4<f32>,
    sampleY: vec4<f32>, rows: vec4<f32>, columns: vec4<f32>, winding0: ptr<function, vec4<f32>>,
    winding1: ptr<function, vec4<f32>>, winding2: ptr<function, vec4<f32>>, winding3: ptr<function, vec4<f32>>) {
  let last = first + count - 1;
  for (var edge = 0; edge < count; edge += 4) {
    let line0 = heprClipTexel(clipTexture, first + edge);
    let line1 = heprClipTexel(clipTexture, min(first + edge + 1, last));
    let line2 = heprClipTexel(clipTexture, min(first + edge + 2, last));
    let line3 = heprClipTexel(clipTexture, min(first + edge + 3, last));
    heprClipSampleCrossings(line0, sampleX, sampleY, rows, columns, winding0, winding1, winding2, winding3);
    heprClipSampleCrossings(line1, sampleX, sampleY, select(vec4<f32>(0.0), rows, edge + 1 < count), columns,
      winding0, winding1, winding2, winding3);
    heprClipSampleCrossings(line2, sampleX, sampleY, select(vec4<f32>(0.0), rows, edge + 2 < count), columns,
      winding0, winding1, winding2, winding3);
    heprClipSampleCrossings(line3, sampleX, sampleY, select(vec4<f32>(0.0), rows, edge + 3 < count), columns,
      winding0, winding1, winding2, winding3);
  }
}



fn heprClipClosuresBelow(pair: vec4<f32>, sampleY: vec4<f32>) -> vec4<f32> {
  return pair.y * step(vec4<f32>(pair.x), sampleY) + pair.w * step(vec4<f32>(pair.z), sampleY);
}

fn heprClipSampleInside(winding: vec4<f32>, evenOdd: bool) -> u32 {
  var value = abs(winding);
  if (evenOdd) { value -= 2.0 * floor(0.5 * value); }
  return heprClipSampleBits(value > vec4<f32>(0.5));
}


fn heprClipPolygonSamples(clipTexture: texture_2d<f32>, node: vec4<f32>, sampleX: vec4<f32>, sampleY: vec4<f32>,
    span: f32) -> u32 {
  let flags = i32(node.w);
  var winding0 = vec4<f32>(0.0);
  var winding1 = vec4<f32>(0.0);
  var winding2 = vec4<f32>(0.0);
  var winding3 = vec4<f32>(0.0);
  if ((flags & 4) != 0) {
    let cells = heprClipTexel(clipTexture, i32(node.y));
    let origin = heprClipTexel(clipTexture, i32(node.y) + 1);
    let level = heprClipCellLevel(cells, span);
    let size = cells.z * exp2(level * cells.w);
    let grid = heprClipTexel(clipTexture, i32(cells.x + level));
    
    let columnOf = clamp(floor((sampleX - origin.x) / size), vec4<f32>(0.0), vec4<f32>(grid.y - 1.0));
    let rowOf = clamp(floor((sampleY - origin.y) / size), vec4<f32>(0.0), vec4<f32>(grid.z - 1.0));
    for (var row = i32(rowOf.x); row <= i32(rowOf.w); row++) {
      let rows = heprClipMask(rowOf == vec4<f32>(f32(row)));
      for (var column = i32(columnOf.x); column <= i32(columnOf.w); column++) {
        let columns = heprClipMask(columnOf == vec4<f32>(f32(column)));
        let cell = heprClipTexel(clipTexture, i32(grid.x) + row * i32(grid.y) + column);
        heprClipSampleEdges(clipTexture, i32(cell.x), i32(cell.y), sampleX, sampleY, rows, columns,
          &winding0, &winding1, &winding2, &winding3);
        let closures = i32(cell.z);
        let closureCount = i32(cell.w);
        for (var closure = 0; closure < closureCount; closure += 2) {
          let pair0 = heprClipTexel(clipTexture, closures + closure);
          let pair1 = heprClipTexel(clipTexture, closures + min(closure + 1, closureCount - 1));
          var below = heprClipClosuresBelow(pair0, sampleY);
          if (closure + 1 < closureCount) { below += heprClipClosuresBelow(pair1, sampleY); }
          below *= rows;
          winding0 -= below.x * columns;
          winding1 -= below.y * columns;
          winding2 -= below.z * columns;
          winding3 -= below.w * columns;
        }
      }
    }
  } else {
    let banded = (flags & 2) != 0;
    var bands = vec4<f32>(0.0);
    var bandOf = vec4<f32>(0.0);
    if (banded) {
      bands = heprClipTexel(clipTexture, i32(node.y));
      bandOf = clamp(floor((sampleY - bands.y) / bands.z), vec4<f32>(0.0), vec4<f32>(bands.w - 1.0));
    }
    for (var band = i32(bandOf.x); band <= i32(bandOf.w); band++) {
      var firstEdge = i32(node.y);
      var edgeCount = i32(node.z);
      if (banded) {
        let range = heprClipTexel(clipTexture, i32(bands.x) + band);
        firstEdge = i32(range.x);
        edgeCount = i32(range.y);
      }
      
      heprClipSampleEdges(clipTexture, firstEdge, edgeCount, sampleX, sampleY,
        heprClipMask(bandOf == vec4<f32>(f32(band))), vec4<f32>(1.0), &winding0, &winding1, &winding2, &winding3);
    }
  }
  let evenOdd = (flags & 1) != 0;
  return heprClipSampleGrid(heprClipSampleInside(winding0, evenOdd), heprClipSampleInside(winding1, evenOdd),
    heprClipSampleInside(winding2, evenOdd), heprClipSampleInside(winding3, evenOdd));
}
`+I,ue=`flat in float vVectorClipIndex;
`+F.replaceAll(`int(uVectorClipIndex)`,`int(uVectorClipIndex < -1.5 ? vVectorClipIndex : uVectorClipIndex)`),de=`
uint heprRasterClipRectSamples(vec4 bounds, vec2 point) {
  bool inside = point.x >= bounds.x && point.y >= bounds.y && point.x < bounds.z && point.y < bounds.w;
  return inside ? 0xFFFFu : 0u;
}
`+F.replace(`heprClipRectSamples(heprClipTexel(int(node.y)), sampleX, sampleY)`,`heprRasterClipRectSamples(heprClipTexel(int(node.y)), point)`).replace(`heprClipPolygonSamples(node, sampleX, sampleY, span);`,`heprRasterClipPolygonSamples(node, point, sampleX, sampleY, span);`).replace(`float heprVectorClipAA(vec2 point, float aaWidth)`,`
uint heprRasterClipPolygonSamples(vec4 node, vec2 point, vec4 sampleX, vec4 sampleY, float span) {
  bool tileRect = node.z == 4.0 && (int(node.w) & 6) == 0;
  if (tileRect) {
    for (int edge = 0; edge < 4; edge++) {
      vec4 line = heprClipTexel(int(node.y) + edge);
      tileRect = tileRect && min(abs(line.x - line.z), abs(line.y - line.w)) <= 0.002;
    }
  }
  if (tileRect) {
    sampleX = vec4(point.x);
    sampleY = vec4(point.y);
    span = 0.0;
  }
  return heprClipPolygonSamples(node, sampleX, sampleY, span);
}
float heprVectorClipAA(vec2 point, float aaWidth)`),fe=L.replace(`heprClipRectSamples(heprClipTexel(clipTexture, i32(node.y)), sampleX, sampleY)`,`heprRasterClipRectSamples(heprClipTexel(clipTexture, i32(node.y)), point)`).replace(`heprClipPolygonSamples(clipTexture, node, sampleX, sampleY, span);`,`heprRasterClipPolygonSamples(clipTexture, node, point, sampleX, sampleY, span);`)+`
fn heprRasterClipRectSamples(bounds: vec4<f32>, point: vec2<f32>) -> u32 {
  let inside = point.x >= bounds.x && point.y >= bounds.y && point.x < bounds.z && point.y < bounds.w;
  return select(0u, 0xFFFFu, inside);
}

fn heprRasterClipPolygonSamples(clipTexture: texture_2d<f32>, node: vec4<f32>, point: vec2<f32>,
    sampleX: vec4<f32>, sampleY: vec4<f32>, span: f32) -> u32 {
  var tileRect = node.z == 4.0 && (i32(node.w) & 6) == 0;
  if (tileRect) {
    for (var edge = 0; edge < 4; edge++) {
      let line = heprClipTexel(clipTexture, i32(node.y) + edge);
      tileRect = tileRect && min(abs(line.x - line.z), abs(line.y - line.w)) <= 0.002;
    }
  }
  if (tileRect) { return heprClipPolygonSamples(clipTexture, node, vec4<f32>(point.x), vec4<f32>(point.y), 0.0); }
  return heprClipPolygonSamples(clipTexture, node, sampleX, sampleY, span);
}
`,pe=`styles.textInstanceA.textInstanceC.textGlyphMetaA.textGlyphMetaB.textGlyphSegmentsA.textGlyphSegmentsB.fillPathMetaC.pageRects.pageTextRanges.drawRuns.paintGraph.optionalContent.rasterLayers.retainedPages.gradientMetaA.gradientMetaB.gradientMetaC.gradientMetaD.gradientMetaE.gradientLut.gradientMeshRanges.gradientMeshPositions.gradientMeshColors.gradientMeshIndices.gradientFillPathMetaA.gradientFillPathMetaB.gradientFillPathMetaC.gradientFillPaintMeta.gradientFillSegmentsA.gradientFillSegmentsB.gradientStrokeRunMetaA.gradientStrokeRunMetaB.gradientStrokeEndpoints.gradientStrokePrimitiveMeta.gradientStrokePrimitiveBounds.gradientStrokeStyles`.split(`.`),me=[`endpoints`,`primitiveMeta`,`primitiveBounds`,`fillPathMetaA`,`fillPathMetaB`,`fillSegmentsA`,`fillSegmentsB`,`textInstanceB`];function he(e,t){let n=p(t),r=p(e);if(!n||!Number.isFinite(n.dx)||!Number.isFinite(n.dy)||n.source!==(r?.source??e)||!t.drawRuns||t.pageCount!==e.pageCount||t.segmentCount!==e.segmentCount||t.fillPathCount!==e.fillPathCount||t.fillSegmentCount!==e.fillSegmentCount||t.textInstanceCount!==e.textInstanceCount||t.textGlyphCount!==e.textGlyphCount||t.textGlyphSegmentCount!==e.textGlyphSegmentCount||t.maxHalfWidth!==e.maxHalfWidth||t.gradientCount!==e.gradientCount||t.gradientFillPathCount!==e.gradientFillPathCount||t.gradientFillSegmentCount!==e.gradientFillSegmentCount||t.gradientStrokeRunCount!==e.gradientStrokeRunCount||t.gradientStrokeSegmentCount!==e.gradientStrokeSegmentCount||pe.some(n=>t[n]!==e[n])||me.some(n=>t[n].length!==e[n].length)||(t.textClipRects?.length??0)!==(e.textClipRects?.length??0)||(t.clipPaths?.length??0)!==(e.clipPaths?.length??0))return null;let i=new Set(n.changedClips);for(let n=0;n<(t.clipPaths?.length??0);n++){let r=t.clipPaths[n],a=e.clipPaths[n];if(r.parent!==a.parent||r.fillRule!==a.fillRule||!i.has(n)&&r.edges!==a.edges||i.has(n)&&(!s(r.edges)||!s(a.edges)))return null}let a=new Set,o=new Set,c=new Set,l=new Set;for(let r of n.changed){let n=r.kind===`stroke`?t.segmentCount:r.kind===`fill`?t.fillPathCount:r.kind===`text`?t.textInstanceCount:-1;if(!Number.isInteger(r.index)||r.index<0||r.index>=n)return null;if(r.kind===`stroke`)a.add(r.index);else if(r.kind===`fill`){let n=r.index*4;if(t.fillPathMetaA[n]!==e.fillPathMetaA[n]||t.fillPathMetaA[n+1]!==e.fillPathMetaA[n+1])return null;o.add(r.index)}else if(r.kind===`text`){let n=r.index*4,i=t.textInstanceB[n+3];if(t.textInstanceB[n+2]!==e.textInstanceB[n+2]||i!==e.textInstanceB[n+3])return null;if(c.add(r.index),i>0){if(!Number.isInteger(i)||i*4>(t.textClipRects?.length??0))return null;l.add(i-1)}}}return{hint:n,strokes:[...a],fills:[...o],texts:[...c],textClips:[...l]}}function ge(e,t){let n=o(t.hint.source);if(!t.fills.length)return n;let r=e=>Float32Array.from(t.fills.flatMap(t=>Array.from(e.subarray(t*4,t*4+4)))),i=o({...e,fillPathCount:t.fills.length,fillPathMetaA:r(e.fillPathMetaA),fillPathMetaB:r(e.fillPathMetaB),fillPathMetaC:r(e.fillPathMetaC)}),a={pathMetaA:n.pathMetaA.slice(),pathMetaB:n.pathMetaB.slice(),pathMetaC:n.pathMetaC.slice()};return t.fills.forEach((e,t)=>{a.pathMetaA.set(i.pathMetaA.subarray(t*4,t*4+4),e*4),a.pathMetaB.set(i.pathMetaB.subarray(t*4,t*4+4),e*4),a.pathMetaC.set(i.pathMetaC.subarray(t*4,t*4+4),e*4)}),a}function _e(e,t,n,r){if(!t.fills.length)return r;let i=r.pathMetaA.length===n.pathMetaA.length?n:{pathMetaA:r.pathMetaA.slice(),pathMetaB:r.pathMetaB.slice(),pathMetaC:r.pathMetaC.slice()};if(i!==n)for(let e of[`pathMetaA`,`pathMetaB`,`pathMetaC`])for(let r of t.fills)i[e].set(n[e].subarray(r*4,r*4+4),r*4);return{...r,...i,segmentsA:e.fillSegmentsA,segmentsB:e.fillSegmentsB}}function ve(e,t,n){let r=t.hint.changedClips??[];if(!r.length)return{patches:[]};let i=e.clipPaths??[];if(!n||n.length!==i.length*4)return null;let a=[];for(let e of r){let t=i[e],r=t&&s(t.edges),o=n[e*4+1];if(!r||n[e*4+2]!==-1||!Number.isSafeInteger(o)||o<i.length)return null;for(let t=0;t<i.length;t++)if(t!==e&&n[t*4+1]===o)return null;let c=t.parent;for(;c>=0;){let e=s(i[c].edges);if(!e)break;r[0]=Math.max(r[0],e[0]),r[1]=Math.max(r[1],e[1]),r[2]=Math.min(r[2],e[2]),r[3]=Math.min(r[3],e[3]),c=i[c].parent}if(n[e*4]!==c)return null;a.push({index:o,pixels:Float32Array.from(r)})}return{patches:a,bounds:c(i)}}function ye(e,t,n){let r=[],i=(e,t,n)=>{r.push({kind:e,index:t,pixels:n.subarray(t*4,t*4+4)})};for(let n of t.strokes)i(`strokeA`,n,e.endpoints),i(`strokeB`,n,e.primitiveMeta),i(`strokeBounds`,n,e.primitiveBounds);for(let r of t.fills){i(`fillA`,r,n.pathMetaA),i(`fillB`,r,n.pathMetaB),i(`fillC`,r,n.pathMetaC);let t=r*4,a=e.fillPathMetaA[t],o=e.fillPathMetaA[t+1];for(let t=a;t<a+o;t++)i(`fillSegmentsA`,t,e.fillSegmentsA),i(`fillSegmentsB`,t,e.fillSegmentsB)}for(let n of t.texts){let t=e.textInstanceB.slice(n*4,n*4+4);t[3]>0&&(t[3]+=e.textGlyphCount),r.push({kind:`textB`,index:n,pixels:t})}for(let n of t.textClips)r.push({kind:`glyphA`,index:e.textGlyphCount+n,pixels:e.textClipRects.subarray(n*4,n*4+4)});return r}function be(e,t){let n=new Map;for(let t of e){let e=n.get(t.kind);e||n.set(t.kind,e=new Map),e.set(t.index,t.pixels)}let r=[];for(let[e,i]of n){let n=[...i.keys()].sort((e,t)=>e-t),a=t[e];for(let t=0;t<n.length;){let o=t+1;for(;o<n.length&&n[o]===n[o-1]+1&&Math.floor(n[o]/a)===Math.floor(n[t]/a);)o++;let s=o-t,c=s===1?i.get(n[t]):new Float32Array(s*4);if(s>1)for(let e=t;e<o;e++)c.set(i.get(n[e]),(e-t)*4);r.push({kind:e,index:n[t],count:s,pixels:c}),t=o}}return r}var R=`
fn heprCompactWord(image: texture_2d<f32>, offset: u32) -> u32 {
  let width = textureDimensions(image).x;
  let bytes = vec4u(round(textureLoad(image, vec2i(i32(offset % width), i32(offset / width)), 0) * 255.0));
  return bytes.r | (bytes.g << 8u) | (bytes.b << 16u) | (bytes.a << 24u);
}`,z=`
fn heprCompactBlock(image: texture_2d<f32>, entry: u32, pixel: vec2u, bits: u32) -> f32 {
  if ((entry & 0x80000000u) != 0u) { return f32(entry & 255u); }
  let bit = ((pixel.y & 31u) * 32u + (pixel.x & 31u)) * bits;
  return f32((heprCompactWord(image, entry + bit / 32u) >> (bit & 31u)) & ((1u << bits) - 1u));
}`,B=`
fn heprCompactTexel(image: texture_2d<f32>, size: vec2i, level: u32, pixel: vec2i) -> f32 {
  let p = vec2u(clamp(pixel, vec2i(0), size - vec2i(1)));
  let bits = select(4u, heprCompactWord(image, 4u), level == 0u);
  let map = heprCompactWord(image, 5u + level);
  let entry = heprCompactWord(image, map + (p.y / 32u) * ((u32(size.x) + 31u) / 32u) + p.x / 32u);
  if ((entry & 0xc0000000u) != 0x40000000u) {
    return heprCompactBlock(image, entry, p, bits) / f32((1u << bits) - 1u);
  }
  let list = entry & 0x3fffffffu;
  var value = heprCompactBlock(image, heprCompactWord(image, list), p, 1u);
  let count = heprCompactWord(image, list + 1u);
  for (var i = 0u; i < 8u; i++) {
    if (i >= count) { break; }
    let record = list + 2u + 3u * i;
    let glyph = heprCompactWord(image, record);
    let origin = vec2i(bitcast<i32>(heprCompactWord(image, record + 1u)), bitcast<i32>(heprCompactWord(image, record + 2u)));
    let local = vec2i(p) - origin;
    let glyphSize = vec2i(i32(heprCompactWord(image, glyph)), i32(heprCompactWord(image, glyph + 1u)));
    if (all(local >= vec2i(0)) && all(local < glyphSize)) {
      let byte = u32(local.y) * ((u32(glyphSize.x) + 7u) / 8u) + u32(local.x) / 8u;
      let word = heprCompactWord(image, glyph + 2u + byte / 4u);
      let ink = (word >> ((byte & 3u) * 8u + 7u - (u32(local.x) & 7u))) & 1u;
      value = min(value, 1.0 - f32(ink));
    }
  }
  return value;
}`,V=`
fn heprCompactBilinear(image: texture_2d<f32>, size: vec2i, level: u32, uv: vec2f) -> f32 {
  let position = uv * vec2f(size) - vec2f(0.5);
  let pixel = vec2i(floor(position)); let weight = fract(position);
  return mix(mix(heprCompactTexel(image, size, level, pixel), heprCompactTexel(image, size, level, pixel + vec2i(1,0)), weight.x),
    mix(heprCompactTexel(image, size, level, pixel + vec2i(0,1)), heprCompactTexel(image, size, level, pixel + vec2i(1,1)), weight.x), weight.y);
}`,H=`
fn heprCompactSample(image: texture_2d<f32>, baseSize: vec2i, uv: vec2f, lod: f32) -> f32 {
  let bounded = clamp(lod, 0.0, f32(heprCompactWord(image, 2u) - 1u));
  let level = u32(floor(bounded)); var size = baseSize;
  for (var i = 0u; i < 32u; i++) { if (i >= level) { break; } size = max(size / 2, vec2i(1)); }
  let first = heprCompactBilinear(image, size, level, uv);
  let next = min(level + 1u, heprCompactWord(image, 2u) - 1u);
  return mix(first, heprCompactBilinear(image, max(size / 2, vec2i(1)), next, uv), fract(bounded));
}`,xe=[R,z,B,V,H].join(`
`),Se=`
uint heprCompactWord(sampler2D image, uint offset) {
  uint width = uint(textureSize(image, 0).x);
  uvec4 bytes = uvec4(round(texelFetch(image, ivec2(offset % width, offset / width), 0) * 255.0));
  return bytes.r | (bytes.g << 8u) | (bytes.b << 16u) | (bytes.a << 24u);
}
float heprCompactBlock(sampler2D image, uint entry, uvec2 pixel, uint bits) {
  if ((entry & 0x80000000u) != 0u) return float(entry & 255u);
  uint bit = ((pixel.y & 31u) * 32u + (pixel.x & 31u)) * bits;
  return float((heprCompactWord(image, entry + bit / 32u) >> (bit & 31u)) & ((1u << bits) - 1u));
}
float heprCompactTexel(sampler2D image, ivec2 size, uint level, ivec2 pixel) {
  uvec2 p = uvec2(clamp(pixel, ivec2(0), size - 1));
  uint bits = level == 0u ? heprCompactWord(image, 4u) : 4u;
  uint map = heprCompactWord(image, 5u + level);
  uint entry = heprCompactWord(image, map + (p.y / 32u) * ((uint(size.x) + 31u) / 32u) + p.x / 32u);
  float value = 0.0;
  if ((entry & 0xc0000000u) != 0x40000000u) {
    value = heprCompactBlock(image, entry, p, bits) / float((1u << bits) - 1u);
  } else {
    uint list = entry & 0x3fffffffu;
    value = heprCompactBlock(image, heprCompactWord(image, list), p, 1u);
    uint count = heprCompactWord(image, list + 1u);
    for (uint i = 0u; i < 8u; i++) {
      if (i >= count) break;
      uint record = list + 2u + 3u * i;
      uint glyph = heprCompactWord(image, record);
      ivec2 local = ivec2(p) - ivec2(int(heprCompactWord(image, record + 1u)), int(heprCompactWord(image, record + 2u)));
      ivec2 glyphSize = ivec2(heprCompactWord(image, glyph), heprCompactWord(image, glyph + 1u));
      if (all(greaterThanEqual(local, ivec2(0))) && all(lessThan(local, glyphSize))) {
        uint byteOffset = uint(local.y) * ((uint(glyphSize.x) + 7u) / 8u) + uint(local.x) / 8u;
        uint word = heprCompactWord(image, glyph + 2u + byteOffset / 4u);
        uint ink = (word >> ((byteOffset & 3u) * 8u + 7u - (uint(local.x) & 7u))) & 1u;
        value = min(value, 1.0 - float(ink));
      }
    }
  }
  return value;
}
float heprCompactBilinear(sampler2D image, ivec2 size, uint level, vec2 uv) {
  vec2 position = uv * vec2(size) - 0.5;
  ivec2 pixel = ivec2(floor(position)); vec2 weight = fract(position);
  return mix(mix(heprCompactTexel(image, size, level, pixel), heprCompactTexel(image, size, level, pixel + ivec2(1,0)), weight.x),
    mix(heprCompactTexel(image, size, level, pixel + ivec2(0,1)), heprCompactTexel(image, size, level, pixel + ivec2(1,1)), weight.x), weight.y);
}
float heprCompactSample(sampler2D image, ivec2 baseSize, vec2 uv, float lod) {
  float bounded = clamp(lod, 0.0, float(heprCompactWord(image, 2u) - 1u));
  uint level = uint(floor(bounded)); ivec2 size = baseSize;
  for (uint i = 0u; i < 32u; i++) { if (i >= level) break; size = max(size / 2, ivec2(1)); }
  float first = heprCompactBilinear(image, size, level, uv);
  uint next = min(level + 1u, heprCompactWord(image, 2u) - 1u);
  return mix(first, heprCompactBilinear(image, max(size / 2, ivec2(1)), next, uv), fract(bounded));
}`,Ce=`
float heprCoverageTexel(sampler2D image, ivec2 size, int offset, ivec2 pixel) {
  ivec2 p = clamp(pixel, ivec2(0), size - 1);
  int index = offset + p.y * ((size.x + 1) / 2) + p.x / 2;
  int atlasWidth = textureSize(image, 0).x;
  uint packed = uint(round(texelFetch(image, ivec2(index % atlasWidth, index / atlasWidth), 0).r * 255.0));
  return float((packed >> uint((p.x & 1) == 0 ? 4 : 0)) & 15u) / 15.0;
}

float heprCoverageBilinear(sampler2D image, ivec2 size, int offset, vec2 uv) {
  vec2 position = uv * vec2(size) - 0.5;
  ivec2 pixel = ivec2(floor(position));
  vec2 weight = fract(position);
  return mix(mix(heprCoverageTexel(image, size, offset, pixel),
    heprCoverageTexel(image, size, offset, pixel + ivec2(1, 0)), weight.x),
    mix(heprCoverageTexel(image, size, offset, pixel + ivec2(0, 1)),
    heprCoverageTexel(image, size, offset, pixel + ivec2(1, 1)), weight.x), weight.y);
}

float heprPackedCoverage(sampler2D image, ivec2 baseSize, vec2 uv, float lod) {
  float level = clamp(lod, 0.0, max(0.0, floor(log2(float(max(baseSize.x, baseSize.y)))) - 1.0));
  int target = int(floor(level));
  ivec2 size = max(ivec2(1), baseSize / 2);
  int offset = 0;
  for (int i = 0; i < 32; i++) {
    if (i == target) {
      float first = heprCoverageBilinear(image, size, offset, uv);
      float fraction = fract(level);
      if (fraction == 0.0) return first;
      offset += ((size.x + 1) / 2) * size.y;
      size = max(ivec2(1), size / 2);
      return mix(first, heprCoverageBilinear(image, size, offset, uv), fraction);
    }
    offset += ((size.x + 1) / 2) * size.y;
    size = max(ivec2(1), size / 2);
  }
  return 0.0;
}
`,U=`
fn heprCoverageTexel(image: texture_2d<f32>, size: vec2i, offset: i32, pixel: vec2i) -> f32 {
  let p = clamp(pixel, vec2i(0), size - vec2i(1));
  let index = offset + p.y * ((size.x + 1) / 2) + p.x / 2;
  let atlasWidth = i32(textureDimensions(image).x);
  let packed = u32(round(textureLoad(image, vec2i(index % atlasWidth, index / atlasWidth), 0).r * 255.0));
  let shift = select(0u, 4u, (u32(p.x) & 1u) == 0u);
  return f32((packed >> shift) & 15u) / 15.0;
}`,W=`
fn heprCoverageBilinear(image: texture_2d<f32>, size: vec2i, offset: i32, uv: vec2f) -> f32 {
  let position = uv * vec2f(size) - vec2f(0.5);
  let pixel = vec2i(floor(position));
  let weight = fract(position);
  return mix(mix(heprCoverageTexel(image, size, offset, pixel),
    heprCoverageTexel(image, size, offset, pixel + vec2i(1, 0)), weight.x),
    mix(heprCoverageTexel(image, size, offset, pixel + vec2i(0, 1)),
    heprCoverageTexel(image, size, offset, pixel + vec2i(1, 1)), weight.x), weight.y);
}`,G=`
fn heprPackedCoverage(image: texture_2d<f32>, baseSize: vec2i, uv: vec2f, lod: f32) -> f32 {
  let level = clamp(lod, 0.0, max(0.0, floor(log2(f32(max(baseSize.x, baseSize.y)))) - 1.0));
  let targetLevel = i32(floor(level));
  var size = max(vec2i(1), baseSize / vec2i(2));
  var offset = 0;
  for (var i = 0; i < 32; i++) {
    if (i == targetLevel) {
      let first = heprCoverageBilinear(image, size, offset, uv);
      let fraction = fract(level);
      if (fraction == 0.0) { return first; }
      offset += ((size.x + 1) / 2) * size.y;
      size = max(vec2i(1), size / vec2i(2));
      return mix(first, heprCoverageBilinear(image, size, offset, uv), fraction);
    }
    offset += ((size.x + 1) / 2) * size.y;
    size = max(vec2i(1), size / vec2i(2));
  }
  return 0.0;
}`,we=U+W+G;function K(){try{return!globalThis.matchMedia?.(`(prefers-reduced-motion: reduce)`).matches}catch{return!0}}function Te(e=performance.now()){return K()?e/1e3%2.4:1.2}function Ee(e,t){if(!e.pendingPagePreviews||!(t.width>0&&t.height>0&&t.zoom>0))return!1;let n=e.pageRects;for(let r=0;r<e.pendingPagePreviews.length;r++){if(!e.pendingPagePreviews[r])continue;let i=r*4,a=t.projection?t.projection(r):t.localToClip;if(a===null)continue;if(!a){let e=t.width/t.zoom/2,r=t.height/t.zoom/2;if(Math.max(n[i],n[i+2])>=t.cameraCenterX-e&&Math.min(n[i],n[i+2])<=t.cameraCenterX+e&&Math.max(n[i+1],n[i+3])>=t.cameraCenterY-r&&Math.min(n[i+1],n[i+3])<=t.cameraCenterY+r)return!0;continue}let o=1/0,s=1/0,c=1/0,l=-1/0,u=-1/0,d=-1/0,f=0;for(let[e,t]of[[n[i],n[i+1]],[n[i+2],n[i+1]],[n[i],n[i+3]],[n[i+2],n[i+3]]]){let n=a[3]*e+a[7]*t+a[15];if(!(n>1e-8))continue;f++;let r=(a[0]*e+a[4]*t+a[12])/n,i=(a[1]*e+a[5]*t+a[13])/n,p=(a[2]*e+a[6]*t+a[14])/n;o=Math.min(o,r),l=Math.max(l,r),s=Math.min(s,i),u=Math.max(u,i),c=Math.min(c,p),d=Math.max(d,p)}if(f&&(f<4||l>=-1&&o<=1&&u>=-1&&s<=1&&d>=(t.clipDepth??-1)&&c<=1))return!0}return!1}var De=`
float heprPlaceholderBar(vec2 uv, vec2 center, vec2 halfSize) {
  vec2 d = abs(uv - center) - halfSize + vec2(0.003);
  return length(max(d, vec2(0.0))) + min(max(d.x,d.y),0.0) - 0.003;
}
vec4 heprPagePlaceholder(vec4 paper, vec2 uv, float pending, float time) {
  float aa = max(max(length(vec2(dFdx(uv.x),dFdy(uv.x))),
    length(vec2(dFdx(uv.y),dFdy(uv.y)))), 1e-6);
  if (pending < 0.5) return paper;
  float distance = min(heprPlaceholderBar(uv,vec2(0.35,0.14),vec2(0.23,0.009)),
    heprPlaceholderBar(uv,vec2(0.27,0.185),vec2(0.15,0.004)));
  float row = floor((uv.y - 0.27)/0.028);
  if (row >= 0.0 && row < 18.0 && mod(row,6.0) < 5.0) {
    float end = mod(row,6.0) > 3.5 ? 0.64 : 0.88 - mod(row,3.0)*0.055;
    distance = min(distance,heprPlaceholderBar(uv,vec2((0.12+end)*0.5,0.27+(row+0.5)*0.028),
      vec2((end-0.12)*0.5,0.004)));
  }
  distance = min(distance,heprPlaceholderBar(uv,vec2(0.5,0.915),vec2(0.025,0.003)));
  float mask = 1.0 - smoothstep(-aa,aa,distance);
  float highlight = 1.0 - smoothstep(0.0,0.22,abs(uv.x+uv.y*0.25-(time/2.4*1.8-0.4)));
  float luminance = dot(paper.rgb,vec3(0.2126,0.7152,0.0722));
  vec3 ink = vec3(luminance < paper.a*0.4 ? paper.a : 0.0);
  return vec4(mix(paper.rgb,ink,mask*mix(0.16,0.065,highlight)),paper.a);
}`,q=`
fn heprPlaceholderBar(uv: vec2f, center: vec2f, halfSize: vec2f) -> f32 {
  let d = abs(uv - center) - halfSize + vec2f(0.003);
  return length(max(d,vec2f(0.0))) + min(max(d.x,d.y),0.0) - 0.003;
}`,J=`
fn heprPagePlaceholder(paper: vec4f, uv: vec2f, pending: f32, time: f32) -> vec4f {
  let aa = max(max(length(vec2f(dpdx(uv.x),dpdy(uv.x))),
    length(vec2f(dpdx(uv.y),dpdy(uv.y)))),1e-6);
  if (pending < 0.5) { return paper; }
  var distance = min(heprPlaceholderBar(uv,vec2f(0.35,0.14),vec2f(0.23,0.009)),
    heprPlaceholderBar(uv,vec2f(0.27,0.185),vec2f(0.15,0.004)));
  let row = floor((uv.y - 0.27)/0.028);
  if (row >= 0.0 && row < 18.0 && row % 6.0 < 5.0) {
    let end = select(0.88 - (row % 3.0)*0.055,0.64,row % 6.0 > 3.5);
    distance = min(distance,heprPlaceholderBar(uv,vec2f((0.12+end)*0.5,0.27+(row+0.5)*0.028),
      vec2f((end-0.12)*0.5,0.004)));
  }
  distance = min(distance,heprPlaceholderBar(uv,vec2f(0.5,0.915),vec2f(0.025,0.003)));
  let mask = 1.0 - smoothstep(-aa,aa,distance);
  let highlight = 1.0 - smoothstep(0.0,0.22,abs(uv.x+uv.y*0.25-(time/2.4*1.8-0.4)));
  let luminance = dot(paper.rgb,vec3f(0.2126,0.7152,0.0722));
  let ink = vec3f(select(0.0,paper.a,luminance < paper.a*0.4));
  return vec4f(mix(paper.rgb,ink,mask*mix(0.16,0.065,highlight)),paper.a);
}`,Oe=q+J;function ke(e){return e.replace(`layout(location = 1) in vec4 aPageRect;`,`layout(location = 1) in vec4 aPageRect;
layout(location = 4) in float aPageLoading;
flat out float vPageLoading;`).replace(`vec2 world = aPageRect.xy + aPageRect.zw * localTopDown;`,`vec2 world = aPageRect.xy + aPageRect.zw * localTopDown;
  vPageLoading = aPageLoading;`)}function Ae(e){return e.replace(`void main() {`,`uniform float uPagePlaceholderTime;\nflat in float vPageLoading;\n${De}\nvoid main() {`).replace(`if (color.a <= 0.001)`,`color = heprPagePlaceholder(color,vUv,vPageLoading,uPagePlaceholderTime);
  if (color.a <= 0.001)`)}function je(e,t,n,r,i,a,o,s,c){if(!r)return null;let l=r({minX:0,minY:0,maxX:1,maxY:1});if(!l)return null;let u=i/o,d=a/s,f=c?-1:1;return X(e,t,n,[l.width*u,0,l.x*u,0,l.height*d*f,c?a-l.y*d:l.y*d,0,0,1])}var Me=7,Ne=256;function Y(e,t,n){for(let r=t??-1,i=0;r>=0&&i<Ne;i++){if(r===n)return!0;r=e.clipPaths?.[r]?.parent??-1}return!1}function X(e,t,n,r){let i=t.first,a=e.gradientFillPaintMeta,o=e.gradientFillPathMetaA;if(t.kind!==`gradient-fill`||t.count!==1||!a||!o||!e.gradientFillPathMetaC||i<0||i*4+3>=a.length)return null;let s=a[i*4],c=s*4;if(!(s>=0&&s<e.gradientCount)||a[i*4+1]>=0)return null;let{gradientMetaA:l,gradientMetaB:u,gradientMetaC:d,gradientMetaD:f,gradientMetaE:p}=e;if(!l||!u||!d||!f||!p||c+3>=l.length||l[c]>1.5)return null;let m=[],h=[],g=e.gradientFillSegmentsA,_=e.gradientFillSegmentsB;for(let e=o[i*4],t=e+o[i*4+1];e<t;e++){let t=e*4;if(!g||!_||t+3>=g.length||_[t+2]>=1)return null;h.push(g[t],g[t+1],_[t],_[t+1])}m.push(h);let v=t.clipIndex??-1;if(v>=0&&!Y(e,n,v)){let t=e.clipPaths?.[v];if(!t||t.parent>=0&&!Y(e,n,t.parent))return null;m.push(Array.from(t.edges))}let y=(e,t)=>{let n=r[6]*e+r[7]*t+r[8];return n>1e-6?[(r[0]*e+r[1]*t+r[2])/n,(r[3]*e+r[4]*t+r[5])/n]:null},b=new Float32Array(60),x=Me;for(let e of m){let t=[];for(let n=0;n<e.length;n+=4){let r=y(e[n],e[n+1]),i=(n+4)%e.length;if(!r||Math.hypot(e[n+2]-e[i],e[n+3]-e[i+1])>1e-5*(1+Math.abs(e[i])+Math.abs(e[i+1])))return null;t.push(r)}if(t.length<3)return null;let n=t.reduce((e,n)=>[e[0]+n[0]/t.length,e[1]+n[1]/t.length],[0,0]),r=0;for(let e=0;e<t.length;e++){let[n,i]=t[e],[a,o]=t[(e+1)%t.length],[s,c]=t[(e+2)%t.length],l=(a-n)*(c-o)-(o-i)*(s-a),u=Math.hypot(a-n,o-i)*Math.hypot(s-a,c-o);if(!(Math.abs(l)<=1e-6*u)){if(r&&Math.sign(l)!==r)return null;r=Math.sign(l)}}if(!r)return null;for(let e=0;e<t.length;e++){let[r,i]=t[e],[a,o]=t[(e+1)%t.length],s=Math.hypot(a-r,o-i);if(s<1e-9)continue;if(x>=15)return null;let c=(i-o)/s,l=(a-r)/s,u=-(c*r+l*i);c*n[0]+l*n[1]+u<0&&(c=-c,l=-l,u=-u),b.set([c,l,u,0],x++*4)}}for(;x<15;x++)b.set([0,0,1,0],x*4);let[S,C,w,T,E,D,O,k,A]=r,j=[E*A-D*k,w*k-C*A,C*D-w*E,D*O-T*A,S*A-w*O,w*T-S*D,T*k-E*O,C*O-S*k,S*E-C*T],M=S*j[0]+C*j[3]+w*j[6];if(!(Math.abs(M)>0)||!Number.isFinite(M))return null;for(let e=0;e<9;e++)j[e]/=M;let N=[...[0,1,2].map(e=>u[c]*j[e]+u[c+2]*j[e+3]+d[c]*j[e+6]),...[0,1,2].map(e=>u[c+1]*j[e]+u[c+3]*j[e+3]+d[c+1]*j[e+6]),...j.slice(6)],P=Math.max(...N.map(Math.abs));if(!(P>0)||!Number.isFinite(P))return null;for(let e=0;e<3;e++)b.set([N[e*3]/P,N[e*3+1]/P,N[e*3+2]/P,0],e*4);return b.set(l.subarray(c,c+4),12),b.set([d[c+2],d[c+3],f[c],f[c+1]],16),b.set([f[c+2],f[c+3],e.gradientFillPathMetaC[i*4+3],s],20),b.set(p.subarray(c,c+4),24),b}function Z(e){let t=e===`wgsl`,n=e=>({F:`f32`,I:`i32`,V3:`vec3f`,V4:`vec4f`})[e]??e,r=e=>t?e.replace(/\b(F|I|V3|V4)\b/g,n):e.replace(/\bF\b/g,`float`).replace(/\bI\b/g,`int`).replace(/\bV3\b/g,`vec3`).replace(/\bV4\b/g,`vec4`),i=(e,n,i,a)=>{let o=n.split(`,`).map(e=>e.trim().split(` `));return r(t?`fn ${e}(${o.map(([e,t])=>`${t}: ${e}`).join(`, `)}) -> ${i} {${a}}`:`${i} ${e}(${n}) {${a}}`)},a=(e,n,r)=>t?`var ${n}: ${e} = ${r};`:`${e} ${n} = ${r};`;return[i(`pdfLum`,`V3 c`,`F`,`return dot(c, V3(0.3, 0.59, 0.11));`),i(`pdfSat`,`V3 c`,`F`,`return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);`),i(`pdfSetSat`,`V3 c, F s`,`V3`,`${a(`F`,`n`,`min(min(c.r,c.g),c.b)`)}${a(`F`,`d`,`pdfSat(c)`)}
      if (d <= 0.0) { return V3(0.0); } return (c - V3(n)) * s / d;`),i(`pdfSetLum`,`V3 c, F l`,`V3`,`${a(`V3`,`r`,`c + V3(l - pdfLum(c))`)}
      ${a(`F`,`n`,`min(min(r.r,r.g),r.b)`)}${a(`F`,`x`,`max(max(r.r,r.g),r.b)`)}
      if (n < 0.0) { r = V3(l) + (r-V3(l))*l/(l-n); }
      if (x > 1.0) { r = V3(l) + (r-V3(l))*(1.0-l)/(x-l); } return r;`),i(`pdfBlendChannel`,`F b, F s, I mode`,`F`,`
      if (mode == 1) { return b*s; }
      if (mode == 2) { return b+s-b*s; }
      if (mode == 3) { if (b <= 0.5) { return 2.0*b*s; } return 1.0-2.0*(1.0-b)*(1.0-s); }
      if (mode == 4) { return min(b,s); }
      if (mode == 5) { return max(b,s); }
      if (mode == 6) { if (b <= 0.0) { return 0.0; } if (s >= 1.0) { return 1.0; } return min(1.0,b/(1.0-s)); }
      if (mode == 7) { if (b >= 1.0) { return 1.0; } if (s <= 0.0) { return 0.0; } return 1.0-min(1.0,(1.0-b)/s); }
      if (mode == 8) { if (s <= 0.5) { return 2.0*b*s; } return 1.0-2.0*(1.0-b)*(1.0-s); }
      if (mode == 9) { if (s <= 0.5) { return b-(1.0-2.0*s)*b*(1.0-b); }
        ${a(`F`,`d`,`sqrt(b)`)} if (b <= 0.25) { d=((16.0*b-12.0)*b+4.0)*b; } return b+(2.0*s-1.0)*(d-b); }
      if (mode == 10) { return abs(b-s); }
      if (mode == 11) { return b+s-2.0*b*s; } return s;`),i(`pdfBlend`,`V3 b, V3 s, I mode`,`V3`,`
      if (mode == 12) { return pdfSetLum(pdfSetSat(s,pdfSat(b)),pdfLum(b)); }
      if (mode == 13) { return pdfSetLum(pdfSetSat(b,pdfSat(s)),pdfLum(b)); }
      if (mode == 14) { return pdfSetLum(s,pdfLum(b)); }
      if (mode == 15) { return pdfSetLum(b,pdfLum(s)); }
      return V3(pdfBlendChannel(b.r,s.r,mode),pdfBlendChannel(b.g,s.g,mode),pdfBlendChannel(b.b,s.b,mode));`),i(`pdfOver`,`V4 b, V4 s, I mode`,`V4`,`
      ${a(`V3`,`cb`,`b.rgb / max(b.a, 0.0000001)`)}${a(`V3`,`cs`,`s.rgb / max(s.a, 0.0000001)`)}
      return V4((1.0-s.a)*b.rgb+(1.0-b.a)*s.rgb+b.a*s.a*pdfBlend(cb,cs,mode),s.a+b.a*(1.0-s.a));`),i(`pdfCompositePass`,`V4 source, V4 shape, V4 current, V4 stats, V4 initial, V4 mask, V4 p, V4 q`,`V4`,`
      ${a(`I`,`operation`,`I(p.x)`)}
      // A group accumulated into a single isolated surface is already its own
      // extracted layer, so its opacity and soft mask are a uniform scale of
      // premultiplied color. Applying it here, where the layer is read anyway,
      // spares that group an extraction pass and a surface of its own.
      ${a(`V4`,`src`,`source`)} if (q.w > 0.5) { src=source*(p.w*mask.r); }
      // Operation 6 emits the layer itself, for a destination whose blender
      // performs the source-over that operation 0 would compute here.
      // One exit: D3D's FXC (under ANGLE) cannot prove that early returns
      // here cover every path and warns X4000 about the result.
      ${a(`V4`,`result`,`src`)}
      if (operation == 0) {
        ${a(`V4`,`backdrop`,`current`)} if (p.z > 0.5) { backdrop=initial; }
        result=pdfOver(backdrop,src,I(p.y));
        if (p.z > 0.5) { result=result+(1.0-shape.a)*(current-initial); }
        result=clamp(result,V4(0.0),V4(1.0));
      } else if (operation == 1) {
        ${a(`F`,`previousWeight`,`1.0-src.a`)} if (p.z > 0.5) { previousWeight=1.0-shape.a; }
        result=V4(src.a+previousWeight*stats.r,shape.a+(1.0-shape.a)*stats.g,0.0,1.0);
      } else if (operation == 2) {
        ${a(`F`,`opacity`,`p.w*mask.r`)}
        result=V4(clamp(current.rgb-initial.rgb*(1.0-stats.r),V3(0.0),V3(1.0))*opacity,stats.r*opacity);
      } else if (operation == 3) {
        ${a(`F`,`coverage`,`stats.g`)} if (q.x > 0.5) { coverage=coverage*p.w*mask.r; }
        result=V4(coverage);
      }
      return result;
    `)].join(`
`)}var Pe=`#version 300 es
precision highp float;
void main() {
  vec2 p=vec2(float((gl_VertexID << 1) & 2),float(gl_VertexID & 2));
  gl_Position=vec4(p*2.0-1.0,0.0,1.0);
}`,Fe=`#version 300 es
precision highp float;
precision highp sampler2D;
uniform sampler2D uSource;
uniform sampler2D uShape;
uniform sampler2D uCurrent;
uniform sampler2D uStats;
uniform sampler2D uInitial;
uniform sampler2D uMask;
uniform sampler2D uTransfer;
uniform vec4 uParams;
uniform vec4 uExtra;
uniform vec3 uMaskBackdrop;
out vec4 outColor;
${Z(`glsl`)}


vec4 pdfCompositeLoad(sampler2D inputTexture, ivec2 point) {
  return texelFetch(inputTexture,clamp(point,ivec2(0),textureSize(inputTexture,0)-ivec2(1)),0);
}
float pdfTransferSample(int index) {
  int width=textureSize(uTransfer,0).x;
  return texelFetch(uTransfer,ivec2(index%width,index/width),0).r;
}
void main() {
  ivec2 p=ivec2(gl_FragCoord.xy);
  vec4 source=pdfCompositeLoad(uSource,p);
  if (uParams.x==4.0) {
    float value=source.a;
    if (uExtra.y>0.5) value=pdfLum(source.rgb+(1.0-source.a)*uMaskBackdrop);
    value=clamp(value,0.0,1.0);
    if (uExtra.z>1.0) {
      float at=value*(uExtra.z-1.0); int first=int(floor(at));
      value=mix(pdfTransferSample(first),pdfTransferSample(min(first+1,int(uExtra.z)-1)),fract(at));
    }
    outColor=vec4(value); return;
  }
  outColor=pdfCompositePass(source,pdfCompositeLoad(uShape,p),pdfCompositeLoad(uCurrent,p),pdfCompositeLoad(uStats,p),
    pdfCompositeLoad(uInitial,p),pdfCompositeLoad(uMask,p),uParams,uExtra);
}`,Ie=`
struct Params { p:vec4f, q:vec4f, backdrop:vec4f }
@group(0) @binding(0) var<uniform> params:Params;
@group(0) @binding(1) var sourceTex:texture_2d<f32>;
@group(0) @binding(2) var shapeTex:texture_2d<f32>;
@group(0) @binding(3) var currentTex:texture_2d<f32>;
@group(0) @binding(4) var statsTex:texture_2d<f32>;
@group(0) @binding(5) var initialTex:texture_2d<f32>;
@group(0) @binding(6) var maskTex:texture_2d<f32>;
@group(0) @binding(7) var transferTex:texture_2d<f32>;
${Z(`wgsl`)}

fn pdfCompositeLoad(inputTexture:texture_2d<f32>, point:vec2i)->vec4f {
  return textureLoad(inputTexture,clamp(point,vec2i(0),vec2i(textureDimensions(inputTexture))-vec2i(1)),0);
}
fn pdfTransferSample(index:i32)->f32 {
  let width=i32(textureDimensions(transferTex).x);
  return textureLoad(transferTex,vec2i(index%width,index/width),0).r;
}
@vertex fn vs(@builtin(vertex_index) index:u32)->@builtin(position) vec4f {
  let p=vec2f(f32((index << 1u) & 2u),f32(index & 2u));
  return vec4f(p*2.0-vec2f(1.0),0.0,1.0);
}
@fragment fn fs(@builtin(position) position:vec4f)->@location(0) vec4f {
  if (params.p.x==5.0) {
    let dimensions=vec2i(textureDimensions(sourceTex));
    let point=position.xy/max(params.backdrop.xy,vec2f(1.0))*vec2f(dimensions)-vec2f(0.5);
    let low=vec2i(floor(point)); let fraction=fract(point);
    let a=textureLoad(sourceTex,clamp(low,vec2i(0),dimensions-vec2i(1)),0);
    let b=textureLoad(sourceTex,clamp(low+vec2i(1,0),vec2i(0),dimensions-vec2i(1)),0);
    let c=textureLoad(sourceTex,clamp(low+vec2i(0,1),vec2i(0),dimensions-vec2i(1)),0);
    let d=textureLoad(sourceTex,clamp(low+vec2i(1,1),vec2i(0),dimensions-vec2i(1)),0);
    return mix(mix(a,b,fraction.x),mix(c,d,fraction.x),fraction.y);
  }
  let p=vec2i(position.xy); let source=pdfCompositeLoad(sourceTex,p);
  if (params.p.x==4.0) {
    var value=source.a;
    if (params.q.y>0.5) { value=pdfLum(source.rgb+(1.0-source.a)*params.backdrop.rgb); }
    value=clamp(value,0.0,1.0);
    if (params.q.z>1.0) {
      let at=value*(params.q.z-1.0); let first=i32(floor(at));
      value=mix(pdfTransferSample(first),pdfTransferSample(min(first+1,i32(params.q.z)-1)),fract(at));
    }
    return vec4f(value);
  }
  return pdfCompositePass(source,pdfCompositeLoad(shapeTex,p),pdfCompositeLoad(currentTex,p),pdfCompositeLoad(statsTex,p),
    pdfCompositeLoad(initialTex,p),pdfCompositeLoad(maskTex,p),params.p,params.q);
}`,Q=7;function Le(e){if(!e)return[1,0,0,0,0];if(e.subtype!==`Luminosity`)return[0,0,0,1,0];let[t,n,r]=e.backdrop??[0,0,0],i=.3*t+.59*n+.11*r;return[.3,.59,.11,-i,i]}var Re=(i+a).replace(/heprGradient/g,`heprFoldGradient`),$=(t+n).replace(/heprGradient/g,`heprFoldGradient`);function ze(e,t=!1){let n=/void\s+main\s*\(\s*\)/;if(!n.test(e))throw Error(`Folded paint shader has no main function.`);let r=Array.from({length:8},(e,t)=>`  coverage *= clamp(0.5 + dot(uPaintMaskGradient[${Q+t}].xyz, p), 0.0, 1.0);`).join(`
`);return e.replace(n,`void heprUnfoldedPaint()`)+`
uniform vec4 uPaintFold;
uniform vec4 uPaintMaskWeights;
uniform vec4 uPaintMaskGradient[15];
uniform highp sampler2D uPaintMask;
${Re}
vec4 heprFoldGradientMask(vec2 pixel) {
  vec3 p = vec3(pixel, 1.0);
  vec3 h = vec3(dot(uPaintMaskGradient[0].xyz, p), dot(uPaintMaskGradient[1].xyz, p), dot(uPaintMaskGradient[2].xyz, p));
  vec2 q = h.xy / h.z;
  vec4 a = uPaintMaskGradient[3], ends = uPaintMaskGradient[4], extra = uPaintMaskGradient[5], box = uPaintMaskGradient[6];
  vec4 color = vec4(0.0);
  if (a.y < 0.5 || (q.x >= box.x && q.y >= box.y && q.x <= box.z && q.y <= box.w)) {
    vec2 parameter = heprFoldGradientParameter(a, vec4(0.0, 0.0, ends.xy), vec4(ends.zw, extra.xy), q);
    if (parameter.y < 0.5) {
      color = heprFoldGradientBackground(a.w);
    } else {
      float x = clamp(parameter.x, 0.0, 1.0) * 1023.0;
      int x0 = int(floor(x));
      int row = int(extra.w + 0.5);
      color = mix(texelFetch(uPaintMask, ivec2(x0, row), 0), texelFetch(uPaintMask, ivec2(min(x0 + 1, 1023), row), 0),
        x - float(x0));
    }
  }
  float coverage = extra.z;
${r}
  vec3 rgb = clamp(color.rgb, 0.0, 1.0);
  if (uPaintFold.y > 2.5) rgb = mix(pow((rgb + 0.055) / 1.055, vec3(2.4)), rgb / 12.92, lessThanEqual(rgb, vec3(0.04045)));
  float alpha = coverage * color.a;
  return vec4(rgb * alpha, alpha);
}
void main() {
  heprUnfoldedPaint();
  if (uPaintFold.y < 0.5) {
    ${t?`outColor`:`outColor.a`} *= uPaintFold.x;
    return;
  }
  vec4 mask = uPaintFold.y < 1.5 ? texelFetch(uPaintMask, ivec2(gl_FragCoord.xy), 0) : heprFoldGradientMask(gl_FragCoord.xy);
  ${t?`outColor`:`outColor.a`} *= uPaintFold.x * clamp(dot(mask, uPaintMaskWeights) + uPaintFold.z, 0.0, 1.0);
}
`}var Be=`
fn heprPaintFoldScale(pixel: vec2f, mask: texture_2d<f32>, fold: vec4f, weights: vec4f, ${Array.from({length:15},(e,t)=>`d${t}: vec4f`).join(`, `)}) -> f32 {
  if (fold.y < 0.5) { return fold.x; }
  var value: vec4f;
  if (fold.y < 1.5) {
    
    let size = vec2<i32>(textureDimensions(mask));
    value = textureLoad(mask, clamp(vec2<i32>(pixel), vec2<i32>(0), size - vec2<i32>(1)), 0);
  } else {
    let p = vec3f(pixel, 1.0);
    let h = vec3f(dot(d0.xyz, p), dot(d1.xyz, p), dot(d2.xyz, p));
    let q = h.xy / h.z;
    var color = vec4f(0.0);
    if (d3.y < 0.5 || (q.x >= d6.x && q.y >= d6.y && q.x <= d6.z && q.y <= d6.w)) {
      let parameter = heprFoldGradientParameter(d3, vec4f(0.0, 0.0, d4.xy), vec4f(d4.zw, d5.xy), q);
      if (parameter.y < 0.5) {
        color = heprFoldGradientBackground(d3.w);
      } else {
        let x = clamp(parameter.x, 0.0, 1.0) * 1023.0;
        let x0 = i32(floor(x));
        let row = i32(d5.w + 0.5);
        color = mix(textureLoad(mask, vec2<i32>(x0, row), 0), textureLoad(mask, vec2<i32>(min(x0 + 1, 1023), row), 0),
          x - f32(x0));
      }
    }
    var coverage = d5.z;
${Array.from({length:8},(e,t)=>`    coverage *= clamp(0.5 + dot(d${Q+t}.xyz, p), 0.0, 1.0);`).join(`
`)}
    var rgb = clamp(color.rgb, vec3f(0.0), vec3f(1.0));
    if (fold.y > 2.5) { rgb = select(pow((rgb + 0.055) / 1.055, vec3f(2.4)), rgb / 12.92, rgb <= vec3f(0.04045)); }
    let alpha = coverage * color.a;
    value = vec4f(rgb * alpha, alpha);
  }
  return fold.x * clamp(dot(value, weights) + fold.z, 0.0, 1.0);
}
`;function Ve(e,t){let n=/@fragment\s+fn fsMain\(inData\s*:\s*(\w+)\)\s*->\s*@location\(0\)\s*vec4f/,r=e.match(n);if(!r)throw Error(`Folded paint shader has no supported fragment entry point.`);return e.replace(n,`fn heprUnfoldedPaint(inData: ${r[1]}) -> vec4f`)+`
struct HeprPaintFold { fold: vec4f, maskWeights: vec4f, gradient: array<vec4f, 15> };
${$}
${Be}
@group(${t}) @binding(0) var<uniform> uPaintFold : HeprPaintFold;
@group(${t}) @binding(1) var uPaintMask : texture_2d<f32>;

@fragment
fn fsMain(inData: ${r[1]}) -> @location(0) vec4f {
  let color = heprUnfoldedPaint(inData);
  let fold = heprPaintFoldScale(inData.position.xy, uPaintMask, uPaintFold.fold, uPaintFold.maskWeights,
    ${Array.from({length:15},(e,t)=>`uPaintFold.gradient[${t}]`).join(`, `)});
  return vec4f(color.rgb, color.a * fold);
}
`}var He=`#version 300 es
precision highp float;
layout(location=0) in vec4 aSegmentA;
layout(location=1) in vec4 aSegmentB;
layout(location=2) in float aHighlightIndex;
uniform mat4 uLocalToClip;
uniform float uLocalUnitsPerPixel;
uniform float uPixelRatio;
uniform float uSelectionCount;
out vec2 vLocal;
flat out vec4 vSegmentA;
flat out vec4 vSegmentB;
flat out vec3 vColor;
void main() {
  vec2 p0 = aSegmentA.xy;
  vec2 p1 = aSegmentB.xy;
  vec2 control = aSegmentB.z >= 0.5 ? aSegmentA.zw : (p0 + p1) * 0.5;
  float extent = max(uLocalUnitsPerPixel, 0.000001) * (uPixelRatio + 2.0);
  vec2 axis = p1 - p0;
  float axisLength = length(axis);
  vec2 u = axisLength > 0.000001 ? axis / axisLength : vec2(1.0, 0.0);
  vec2 v = vec2(-u.y, u.x);
  vec2 c = control - p0;
  vec2 low = vec2(min(0.0, dot(c, u)), min(0.0, dot(c, v))) - extent;
  vec2 high = vec2(max(axisLength, dot(c, u)), max(0.0, dot(c, v))) + extent;
  vec2 corner = vec2(float(gl_VertexID & 1), float((gl_VertexID >> 1) & 1));
  vec2 local = mix(low, high, corner);
  vLocal = p0 + u * local.x + v * local.y;
  vSegmentA = aSegmentA;
  vSegmentB = aSegmentB;
  vColor = aHighlightIndex < uSelectionCount ? vec3(${h.join(`,`)}) : vec3(${g.join(`,`)});
  gl_Position = uLocalToClip * vec4(vLocal, 0.0, 1.0);
}
`,Ue=`#version 300 es
precision highp float;
precision highp sampler2D;
uniform float uPixelRatio;
in vec2 vLocal;
flat in vec4 vSegmentA;
flat in vec4 vSegmentB;
flat in vec3 vColor;
out vec4 outColor;
${F.replace(`int(uVectorClipIndex)`,`int(vSegmentB.w)`)}
vec2 heprOffsetToLineSegment(vec2 p, vec2 a, vec2 b) {
  vec2 ab = b - a;
  float abLenSq = dot(ab, ab);
  if (abLenSq <= 1e-10) {
    return a - p;
  }
  float t = clamp(dot(p - a, ab) / abLenSq, 0.0, 1.0);
  return a + ab * t - p;
}

vec2 heprOffsetToQuadraticBezier(vec2 p, vec2 a, vec2 b, vec2 c) {
  vec2 aa = b - a;
  vec2 bb = a - 2.0 * b + c;
  vec2 cc = aa * 2.0;
  vec2 dd = a - p;

  float bbLenSq = dot(bb, bb);
  if (bbLenSq <= 1e-12) {
    return heprOffsetToLineSegment(p, a, c);
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
  vec2 bestOffset = vec2(0.0);

  if (hValue >= 0.0) {
    float hSqrt = sqrt(hValue);
    vec2 roots = (vec2(hSqrt, -hSqrt) - qValue) * 0.5;
    vec2 uv = sign(roots) * pow(abs(roots), vec2(1.0 / 3.0));
    float t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    vec2 delta = dd + (cc + bb * t) * t;
    best = dot(delta, delta);
    bestOffset = delta;
  } else {
    float z = sqrt(-pValue);
    float acosArg = clamp(qValue / (2.0 * pValue * z), -1.0, 1.0);
    float angle = acos(acosArg) / 3.0;
    float cosine = cos(angle);
    float sine = sin(angle) * 1.732050808;
    vec3 t = clamp(vec3(cosine + cosine, -sine - cosine, sine - cosine) * z - kx, 0.0, 1.0);

    vec2 delta = dd + (cc + bb * t.x) * t.x;
    if (dot(delta, delta) < best) { best = dot(delta, delta); bestOffset = delta; }
    delta = dd + (cc + bb * t.y) * t.y;
    if (dot(delta, delta) < best) { best = dot(delta, delta); bestOffset = delta; }
    delta = dd + (cc + bb * t.z) * t.z;
    if (dot(delta, delta) < best) { best = dot(delta, delta); bestOffset = delta; }
  }

  return bestOffset;
}


void main() {
  vec2 offset = vSegmentB.z >= 0.5
    ? heprOffsetToQuadraticBezier(vLocal,vSegmentA.xy,vSegmentA.zw,vSegmentB.xy)
    : heprOffsetToLineSegment(vLocal,vSegmentA.xy,vSegmentB.xy);
  float distanceValue = length(offset);
  vec2 axis = vSegmentB.xy - vSegmentA.xy;
  vec2 normal = distanceValue > 0.00000001 ? offset / distanceValue
    : (length(axis) > 0.00000001 ? normalize(vec2(-axis.y, axis.x)) : vec2(1.0, 0.0));
  float localPerPixel = max(length(vec2(dot(normal, dFdx(vLocal)), dot(normal, dFdy(vLocal)))), 0.000001);
  float alpha = 1.0 - smoothstep(max(0.0,uPixelRatio-0.75)*localPerPixel,(uPixelRatio+0.75)*localPerPixel,distanceValue);
  alpha *= heprVectorClip(vLocal);
  if (alpha <= 0.001) discard;
  outColor = vec4(vColor, alpha);
}
`,We=`
fn heprOffsetToLineSegment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  let ab = b - a;
  let abLenSq = dot(ab, ab);
  if (abLenSq <= 1e-10) {
    return a - p;
  }
  let t = clamp(dot(p - a, ab) / abLenSq, 0.0, 1.0);
  return a + ab * t - p;
}
`,Ge=`
fn heprOffsetToQuadraticBezier(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>) -> vec2<f32> {
  let aa = b - a;
  let bb = a - 2.0 * b + c;
  let cc = aa * 2.0;
  let dd = a - p;

  let bbLenSq = dot(bb, bb);
  if (bbLenSq <= 1e-12) {
    return heprOffsetToLineSegment(p, a, c);
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
  var bestOffset = vec2<f32>(0.0);

  if (hValue >= 0.0) {
    let hSqrt = sqrt(hValue);
    let roots = (vec2<f32>(hSqrt, -hSqrt) - vec2<f32>(qValue)) * 0.5;
    let uv = sign(roots) * pow(abs(roots), vec2<f32>(1.0 / 3.0));
    let t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    let delta = dd + (cc + bb * t) * t;
    best = dot(delta, delta);
    bestOffset = delta;
  } else {
    let z = sqrt(-pValue);
    let acosArg = clamp(qValue / (2.0 * pValue * z), -1.0, 1.0);
    let angle = acos(acosArg) / 3.0;
    let cosine = cos(angle);
    let sine = sin(angle) * 1.732050808;
    let t = clamp(
      vec3<f32>(cosine + cosine, -sine - cosine, sine - cosine) * z - vec3<f32>(kx),
      vec3<f32>(0.0),
      vec3<f32>(1.0)
    );

    var delta = dd + (cc + bb * t.x) * t.x;
    if (dot(delta, delta) < best) { best = dot(delta, delta); bestOffset = delta; }
    delta = dd + (cc + bb * t.y) * t.y;
    if (dot(delta, delta) < best) { best = dot(delta, delta); bestOffset = delta; }
    delta = dd + (cc + bb * t.z) * t.z;
    if (dot(delta, delta) < best) { best = dot(delta, delta); bestOffset = delta; }
  }

  return bestOffset;
}
`,Ke=`
fn heprPrimitiveHighlightCoverage(point: vec2<f32>, a: vec4<f32>, b: vec4<f32>, pixelRatio: f32) -> f32 {
  let offset = select(heprOffsetToLineSegment(point,a.xy,b.xy),heprOffsetToQuadraticBezier(point,a.xy,a.zw,b.xy),b.z >= 0.5);
  let distanceValue = length(offset);
  let axis = b.xy-a.xy;
  let fallback = select(vec2<f32>(1.0,0.0),vec2<f32>(-axis.y,axis.x)/max(length(axis),0.00000001),length(axis)>0.00000001);
  let normal = select(fallback,offset/max(distanceValue,0.00000001),distanceValue>0.00000001);
  let localPerPixel = max(length(vec2<f32>(dot(normal,dpdx(point)),dot(normal,dpdy(point)))),0.000001);
  return 1.0-smoothstep(max(0.0,pixelRatio-0.75)*localPerPixel,(pixelRatio+0.75)*localPerPixel,distanceValue);
}
`,qe=`
fn heprPrimitiveHighlightPosition(corner: vec2<f32>, a: vec4<f32>, b: vec4<f32>, localUnitsPerPixel: f32, pixelRatio: f32) -> vec2<f32> {
  let p0=a.xy;
  let p1=b.xy;
  let control=select((p0+p1)*0.5,a.zw,b.z>=0.5);
  let extent=max(localUnitsPerPixel,0.000001)*(pixelRatio+2.0);
  let axis=p1-p0;
  let axisLength=length(axis);
  let u=select(vec2<f32>(1.0,0.0),axis/max(axisLength,0.000001),axisLength>0.000001);
  let v=vec2<f32>(-u.y,u.x);
  let c=control-p0;
  let low=vec2<f32>(min(0.0,dot(c,u)),min(0.0,dot(c,v)))-vec2<f32>(extent);
  let high=vec2<f32>(max(axisLength,dot(c,u)),max(0.0,dot(c,v)))+vec2<f32>(extent);
  let xy=mix(low,high,corner);
  return p0+u*xy.x+v*xy.y;
}
`,Je=`
struct Camera { matrix: mat4x4f, params: vec4f }
struct Segment { a: vec4f, b: vec4f }
@group(0) @binding(0) var<uniform> uCamera: Camera;
@group(0) @binding(1) var<storage,read> uSegments: array<Segment>;
@group(0) @binding(2) var uClips: texture_2d<f32>;
struct Output {
  @builtin(position) position: vec4f,
  @location(0) local: vec2f,
  @location(1) @interpolate(flat) a: vec4f,
  @location(2) @interpolate(flat) b: vec4f,
  @location(3) @interpolate(flat) color: vec3f
}
${We}
${Ge}
${Ke}
${I}
@vertex fn vsMain(@builtin(vertex_index) vertex: u32,@builtin(instance_index) instance: u32) -> Output {
  let segment = uSegments[instance];
  let p0 = segment.a.xy;
  let p1 = segment.b.xy;
  let control = select((p0+p1)*0.5,segment.a.zw,segment.b.z>=0.5);
  let extent = max(uCamera.params.x,0.000001)*(uCamera.params.y+2.0);
  let axis = p1-p0;
  let axisLength = length(axis);
  let u = select(vec2f(1.0,0.0),axis/max(axisLength,0.000001),axisLength>0.000001);
  let v = vec2f(-u.y,u.x);
  let c = control-p0;
  let low = vec2f(min(0.0,dot(c,u)),min(0.0,dot(c,v)))-vec2f(extent);
  let high = vec2f(max(axisLength,dot(c,u)),max(0.0,dot(c,v)))+vec2f(extent);
  let corner = vec2f(f32(vertex & 1u),f32((vertex >> 1u) & 1u));
  let xy = mix(low,high,corner);
  var out: Output;
  out.local = p0+u*xy.x+v*xy.y;
  out.position = uCamera.matrix*vec4f(out.local,0.0,1.0);
  out.a=segment.a;
  out.b=segment.b;
  out.color=select(vec3f(${g.join(`,`)}),vec3f(${h.join(`,`)}),f32(instance)<uCamera.params.z);
  return out;
}
@fragment fn fsMain(inData: Output) -> @location(0) vec4f {
  let alpha=heprPrimitiveHighlightCoverage(inData.local,inData.a,inData.b,uCamera.params.y)*heprVectorClip(inData.local,inData.b.w,uClips);
  if(alpha<=0.001){discard;}
  return vec4f(inData.color,alpha);
}
`;export{le as $,G as A,ge as B,K as C,W as D,ke as E,xe as F,de as G,ve as H,H as I,F as J,fe as K,B as L,V as M,z as N,Ce as O,Se as P,ce as Q,R,Ee as S,Te as T,ye as U,_e as V,he as W,ue as X,I as Y,se as Z,X as _,v as _t,Ge as a,ne as at,J as b,Be as c,P as ct,Ve as d,k as dt,ae as et,Le as f,w as ft,Z as g,h as gt,Ie as h,g as ht,qe as i,ie as it,we as j,U as k,$ as l,ee as lt,Pe as m,T as mt,Ue as n,te as nt,He as o,j as ot,Fe as p,E as pt,L as q,We as r,re as rt,Je as s,M as st,Ke as t,oe as tt,ze as u,O as ut,je as v,_ as vt,Ae as w,Oe as x,q as y,be as z};