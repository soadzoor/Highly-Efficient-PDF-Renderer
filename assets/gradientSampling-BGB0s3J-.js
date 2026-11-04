function e(e,t){return e.gradientMetaA[t*4]===2?(e.gradientMeshRanges?.[t*2+1]??0)/3:0}function t(t,n,r){let i=e(t,n);if(!Number.isSafeInteger(r)||r<0||r>=i)throw RangeError(`Mesh triangle index is out of range.`);let a=[],o=[],s=t.gradientMeshRanges[n*2]+r*3,c=n*4,l=t.gradientMetaB,u=t.gradientMetaC,d=l[c]*l[c+3]-l[c+1]*l[c+2];for(let e=0;e<3;e++){let n=t.gradientMeshIndices[s+e],r=t.gradientMeshPositions[n*2]-u[c],i=t.gradientMeshPositions[n*2+1]-u[c+1];a.push({x:(l[c+3]*r-l[c+2]*i)/d,y:(-l[c+1]*r+l[c]*i)/d}),o.push(Array.from(t.gradientMeshColors.subarray(n*4,n*4+4)))}return{points:a,colors:o}}function n(e,t,n,r,i){let a=e.gradientMeshRanges,o=e.gradientMeshPositions,s=e.gradientMeshColors,c=e.gradientMeshIndices;if(!a||!o||!s||!c)return null;let l=a[t*2],u=l+a[t*2+1];for(let e=u-3;e>=l;e-=3){let t=c[e],a=c[e+1],l=c[e+2],u=o[t*2],d=o[t*2+1],f=o[a*2],p=o[a*2+1],m=o[l*2],h=o[l*2+1],g=(p-h)*(u-m)+(m-f)*(d-h);if(Math.abs(g)<1e-15)continue;let _=((p-h)*(n-m)+(m-f)*(r-h))/g,v=((h-d)*(n-m)+(u-m)*(r-h))/g,y=1-_-v;if(_>=-1e-7&&v>=-1e-7&&y>=-1e-7)return s[t*4+i]*_+s[a*4+i]*v+s[l*4+i]*y}return null}function r(n){let r=new Uint32Array(n.gradientFillPathCount*2),i=0;for(let t=0;t<n.gradientFillPathCount;t++){let r=n.gradientFillPaintMeta[t*4];r>=0&&(i+=e(n,r)*3)}let a=new Float32Array(i*6),o=0;for(let i=0;i<n.gradientFillPathCount;i++){let s=n.gradientFillPaintMeta[i*4],c=s>=0?e(n,s):0;r.set([o/6,c*3],i*2);for(let e=0;e<c;e++){let r=t(n,s,e);for(let e=0;e<3;e++)a.set([r.points[e].x,r.points[e].y,...r.colors[e]],o),o+=6}}return{vertices:a,ranges:r}}var i=1024,a=new Float32Array,o=new Uint8Array;function s(e){let t=e;return{gradientCount:f(t.gradientCount),gradientMetaA:m(t.gradientMetaA),gradientMetaB:m(t.gradientMetaB),gradientMetaC:m(t.gradientMetaC),gradientMetaD:m(t.gradientMetaD),gradientMetaE:m(t.gradientMetaE),gradientLut:h(t.gradientLut),gradientMeshRanges:t.gradientMeshRanges,gradientMeshPositions:t.gradientMeshPositions,gradientMeshColors:t.gradientMeshColors,gradientMeshIndices:t.gradientMeshIndices,gradientFillPathCount:f(t.gradientFillPathCount),gradientFillSegmentCount:f(t.gradientFillSegmentCount),gradientFillPathMetaA:m(t.gradientFillPathMetaA),gradientFillPathMetaB:m(t.gradientFillPathMetaB),gradientFillPathMetaC:m(t.gradientFillPathMetaC),gradientFillPaintMeta:m(t.gradientFillPaintMeta),gradientFillSegmentsA:m(t.gradientFillSegmentsA),gradientFillSegmentsB:m(t.gradientFillSegmentsB),gradientStrokeRunCount:f(t.gradientStrokeRunCount),gradientStrokeSegmentCount:f(t.gradientStrokeSegmentCount),gradientStrokeRunMetaA:m(t.gradientStrokeRunMetaA),gradientStrokeRunMetaB:m(t.gradientStrokeRunMetaB),gradientStrokeEndpoints:m(t.gradientStrokeEndpoints),gradientStrokePrimitiveMeta:m(t.gradientStrokePrimitiveMeta),gradientStrokePrimitiveBounds:m(t.gradientStrokePrimitiveBounds),gradientStrokeStyles:m(t.gradientStrokeStyles)}}function c(e,t){let n=[];for(let t=0;t<e.length;t+=1){let r=e[t];n.push({kind:`raster`,index:t,paintOrder:p(r.paintOrder,t),pageIndex:f(r.pageIndex)})}for(let e=0;e<t.gradientFillPathCount;e+=1){let r=e*4;n.push({kind:`gradient-fill`,index:e,paintOrder:p(t.gradientFillPaintMeta[r+2],e),pageIndex:f(t.gradientFillPaintMeta[r+3])})}for(let e=0;e<t.gradientStrokeRunCount;e+=1){let r=e*4;n.push({kind:`gradient-stroke`,index:e,paintOrder:p(t.gradientStrokeRunMetaB[r],e),pageIndex:f(t.gradientStrokeRunMetaB[r+1])})}return n.sort((e,t)=>{let n=e.pageIndex-t.pageIndex;if(n!==0)return n;let r=e.paintOrder-t.paintOrder;if(r!==0)return r;let i=d(e.kind)-d(t.kind);return i===0?e.index-t.index:i}),n}function l(e){let t=new Set;for(let n of e)if(n.kind===`raster`){if(t.has(n.pageIndex))return!0}else t.add(n.pageIndex);return!1}function u(e,t,n,r){let i=e&&t;return{splitOrderedGradientPrefix:i,includeGradientPaint:!i,hasMinifiableContent:i?n:r}}function d(e){return e===`raster`?0:e===`gradient-fill`?1:2}function f(e){let t=Number(e);return Number.isFinite(t)?Math.max(0,Math.trunc(t)):0}function p(e,t){let n=Number(e);return Number.isFinite(n)?n:t}function m(e){return e instanceof Float32Array?e:a}function h(e){return e instanceof Uint8Array?e:o}var g=`
vec2 heprGradientParameter(vec4 a, vec4 c, vec4 d, vec2 point) {
  int flags = int(a.z + 0.5);
  vec2 axis = d.xy - c.zw;
  vec2 offset = point - c.zw;
  if (a.x < 0.5) {
    float denominator = dot(axis, axis);
    if (denominator <= 1e-12) return vec2(0.0);
    float t = dot(offset, axis) / denominator;
    bool valid = (t >= 0.0 || (flags & 1) == 0) && (t <= 1.0 || (flags & 2) == 0);
    return vec2(t, valid ? 1.0 : 0.0);
  }
  float delta = d.w - d.z;
  float qa = dot(axis, axis) - delta * delta;
  float qb = -2.0 * (dot(offset, axis) + d.z * delta);
  float qc = dot(offset, offset) - d.z * d.z;
  float t0 = -1e20;
  float t1 = -1e20;
  if (abs(qa) <= 1e-10) {
    if (abs(qb) <= 1e-10) return vec2(0.0);
    t0 = -qc / qb;
  } else {
    float discriminant = qb * qb - 4.0 * qa * qc;
    if (discriminant < 0.0) return vec2(0.0);
    float root = sqrt(max(discriminant, 0.0));
    t0 = (-qb - root) / (2.0 * qa);
    t1 = (-qb + root) / (2.0 * qa);
  }
  bool valid0 = t0 > -1e19 && d.z + t0 * delta >= 0.0 &&
    (t0 >= 0.0 || (flags & 1) == 0) && (t0 <= 1.0 || (flags & 2) == 0);
  bool valid1 = t1 > -1e19 && d.z + t1 * delta >= 0.0 &&
    (t1 >= 0.0 || (flags & 1) == 0) && (t1 <= 1.0 || (flags & 2) == 0);
  if (!valid0 && !valid1) return vec2(0.0);
  return vec2(valid0 && (!valid1 || t0 >= t1) ? t0 : t1, 1.0);
}
`,_=`
fn heprGradientParameter(a: vec4f, c: vec4f, d: vec4f, point: vec2f) -> vec2f {
  let flags = i32(a.z + 0.5);
  let axis = d.xy - c.zw;
  let offset = point - c.zw;
  if (a.x < 0.5) {
    let denominator = dot(axis, axis);
    if (denominator <= 1e-12) { return vec2f(0.0); }
    let t = dot(offset, axis) / denominator;
    let valid = (t >= 0.0 || (flags & 1) == 0) && (t <= 1.0 || (flags & 2) == 0);
    return vec2f(t, select(0.0, 1.0, valid));
  }
  let delta = d.w - d.z;
  let qa = dot(axis, axis) - delta * delta;
  let qb = -2.0 * (dot(offset, axis) + d.z * delta);
  let qc = dot(offset, offset) - d.z * d.z;
  var t0 = -1e20;
  var t1 = -1e20;
  if (abs(qa) <= 1e-10) {
    if (abs(qb) <= 1e-10) { return vec2f(0.0); }
    t0 = -qc / qb;
  } else {
    let discriminant = qb * qb - 4.0 * qa * qc;
    if (discriminant < 0.0) { return vec2f(0.0); }
    let root = sqrt(max(discriminant, 0.0));
    t0 = (-qb - root) / (2.0 * qa);
    t1 = (-qb + root) / (2.0 * qa);
  }
  let valid0 = t0 > -1e19 && d.z + t0 * delta >= 0.0 &&
    (t0 >= 0.0 || (flags & 1) == 0) && (t0 <= 1.0 || (flags & 2) == 0);
  let valid1 = t1 > -1e19 && d.z + t1 * delta >= 0.0 &&
    (t1 >= 0.0 || (flags & 1) == 0) && (t1 <= 1.0 || (flags & 2) == 0);
  if (!valid0 && !valid1) { return vec2f(0.0); }
  return vec2f(select(t1, t0, valid0 && (!valid1 || t0 >= t1)), 1.0);
}
`,v=`
vec4 heprGradientBackground(float encoded) {
  if (encoded < 0.5) return vec4(0.0);
  int rgb = int(encoded) - 1;
  return vec4(float((rgb >> 16) & 255), float((rgb >> 8) & 255), float(rgb & 255), 255.0) / 255.0;
}
`,y=`
fn heprGradientBackground(encoded: f32) -> vec4f {
  if (encoded < 0.5) { return vec4f(0.0); }
  let rgb = i32(encoded) - 1;
  return vec4f(f32((rgb >> 16) & 255), f32((rgb >> 8) & 255), f32(rgb & 255), 255.0) / 255.0;
}
`;function b(e,t,r,a,o){if(t<0)return 1;if(t>=e.gradientCount)return 0;let s=t*4,c=e.gradientMetaA,l=e.gradientMetaB,u=e.gradientMetaC,d=e.gradientMetaD,f=e.gradientMetaE,p=l[s]*r+l[s+2]*a+u[s],m=l[s+1]*r+l[s+3]*a+u[s+1];if(c[s+1]>=.5&&(p<f[s]||m<f[s+1]||p>f[s+2]||m>f[s+3]))return 0;if(c[s]===2){let r=n(e,t,p,m,o);if(r!==null)return r;let i=c[s+3];return i<.5?0:o===3?1:(i-1>>>(2-o)*8&255)/255}let h=p-u[s+2],g=m-u[s+3],_=d[s]-u[s+2],v=d[s+1]-u[s+3],y=Math.round(c[s+2]),b=e=>Number.isFinite(e)&&(e>=0||!(y&1))&&(e<=1||!(y&2)),x=NaN;if(c[s]<.5){let e=_*_+v*v;e>1e-12&&(x=(h*_+g*v)/e),b(x)||(x=NaN)}else{let e=d[s+2],t=d[s+3]-e,n=_*_+v*v-t*t,r=-2*(h*_+g*v+e*t),i=h*h+g*g-e*e,a=NaN,o=NaN;if(Math.abs(n)<=1e-10)Math.abs(r)>1e-10&&(a=-i/r);else{let e=r*r-4*n*i;if(e>=0){let t=Math.sqrt(e);a=(-r-t)/(2*n),o=(-r+t)/(2*n)}}b(a)&&e+a*t>=0&&(x=a),b(o)&&e+o*t>=0&&(!Number.isFinite(x)||o>x)&&(x=o)}if(!Number.isFinite(x)){let e=c[s+3];return e<.5?0:o===3?1:(e-1>>>(2-o)*8&255)/255}let S=Math.max(0,Math.min(1,x))*(i-1),C=Math.floor(S),w=S-C,T=t*i*4,E=e.gradientLut[T+C*4+o],D=e.gradientLut[T+Math.min(C+1,i-1)*4+o];return(E*(1-w)+D*w)/255}export{b as a,l as c,r as d,t as f,_ as i,u as l,y as n,i as o,e as p,g as r,c as s,v as t,s as u};