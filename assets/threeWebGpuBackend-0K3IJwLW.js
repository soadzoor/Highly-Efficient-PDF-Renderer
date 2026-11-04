import{n as e,t}from"./three.webgpu-BF6OtKoX.js";import{n,t as r}from"./vectorFillBandShaders-CRyg2aoB.js";import{g as i}from"./structureData-B66DXokz.js";import{$ as a,A as o,D as s,I as c,K as l,L as u,M as d,N as f,Q as p,R as m,Y as h,a as g,at as _,b as v,c as y,dt as b,g as x,gt as S,ht as C,i as w,it as T,k as E,l as D,lt as O,mt as k,q as A,r as j,st as M,t as ee,tt as te,y as ne}from"./primitiveHighlightShaders-CPudfn7s.js";import{C as re,D as ie,O as N,Ur as P,Ut as ae,Vr as oe,X as se,_ as ce,a as le,f as ue,h as de,i as fe,x as pe}from"./threeRasterTextures-Dyo94IQ7.js";import{a as me,i as he,n as ge,r as _e,t as ve}from"./rasterStripWebGpuSampling-ZZGY41Kz.js";import{i as ye,n as be}from"./gradientSampling-BGB0s3J-.js";var xe=e.wgslFn(`fn heprPageProjection(document: mat4x4f, matrices: texture_2d<f32>, page: f32) -> mat4x4f {
  let p = i32(page);
  return document * mat4x4f(textureLoad(matrices,vec2i(0,p),0), textureLoad(matrices,vec2i(1,p),0),
    textureLoad(matrices,vec2i(2,p),0),textureLoad(matrices,vec2i(3,p),0));
}`),Se=e.wgslFn(`fn heprPrimitivePage(owners: texture_2d<f32>, index: f32) -> f32 {
  let width = i32(textureDimensions(owners,0).x); let i = i32(index);
  return textureLoad(owners,vec2i(i % width,i / width),0).r;
}`),Ce=e.wgslFn(`fn heprPageParameters(parameters: texture_2d<f32>, page: f32) -> vec4f {
  return textureLoad(parameters,vec2i(0,i32(page)),0);
}`),we=e.wgslFn(`fn heprPageClip(position: vec4f, parameters: vec4f) -> vec4f {
  if (parameters.y < 0.5) { return vec4f(2.0,2.0,2.0,1.0); } return position;
}`);function Te(e,t){return e(t)}function F(t,n){let r=e.uniform(t);if(!n)return{matrix:r,finish(){}};let i=n.owners?Te(Se,{owners:e.textureLoad(n.owners),index:e.attribute(n.attribute,`float`)}):n.page===void 0?e.attribute(`aPageIndex`,`float`):e.float(n.page),a=Te(Ce,{parameters:e.textureLoad(n.table.parameters),page:i});return{matrix:Te(xe,{document:r,matrices:e.textureLoad(n.table.matrices),page:i}),units:a.x,finish(e){e.vertexNode=Te(we,{position:e.vertexNode,parameters:a})}}}var Ee=2**30,I=null,De=e.wgslFn(y,[e.wgslFn(D.slice(0,D.indexOf(`fn heprFoldGradientBackground`))),e.wgslFn(D.slice(D.indexOf(`fn heprFoldGradientBackground`)))]),Oe=e.wgslFn(`
fn heprSurfacePaintFoldScale(pixel: vec2f, mask: texture_2d<f32>, fold: vec4f, weights: vec4f) -> f32 {
  if (fold.y < 0.5) { return fold.x; }
  let size = vec2<i32>(textureDimensions(mask));
  let value = textureLoad(mask, clamp(vec2<i32>(pixel), vec2<i32>(0), size - vec2<i32>(1)), 0);
  return fold.x * clamp(dot(value, weights) + fold.z, 0.0, 1.0);
}
`),ke=new WeakMap;function Ae(e){if(!(e instanceof t))return null;let n=ke.get(e);if(!n||e.fragmentNode!==n.full)return null;let r=e.clone();return r.fragmentNode=n.surface,ce(e,r),ie(e,r),r}function je(e,n,r){if(!(e instanceof t)||!(n instanceof t))return;let i=ke.get(e);i&&e.fragmentNode===i.full&&ke.set(n,{full:n.fragmentNode,surface:r(i.surface)})}function Me(n){if(!(n instanceof t)||!n.fragmentNode)throw Error(`Folded paint material has no node fragment output.`);I||(I=new se(Uint8Array.of(255,255,255,255),1,1),I.needsUpdate=!0,I.version=Ee);let r=e.uniform(new P(1,0,0,0)),i=e.uniform(new P),a=pe(),o=e.textureLoad(I);o.getUniformHash=()=>`hepr-paint-fold-mask`;let s={pixel:e.screenCoordinate,mask:o,fold:r,weights:i};a.forEach((t,n)=>{s[`d${n}`]=e.uniform(t)});let c=De(s),l=Oe({pixel:e.screenCoordinate,mask:o,fold:r,weights:i}),u=n.fragmentNode,d=t=>e.Fn(()=>{let n=e.property(`vec4`,`heprFoldSource`);return n.assign(u),e.vec4(n.rgb,e.mul(n.a,t))})();n.fragmentNode=d(c),ke.set(n,{full:n.fragmentNode,surface:d(l)}),re(n,{fold:r,weights:i,mask:o,gradient:a,neutral:I})}var Ne=new WeakMap,Pe=new WeakMap,Fe=new WeakSet,Ie=e.wgslFn(h),Le=e.wgslFn(A),Re=e.wgslFn(l),ze=e.wgslFn(`
fn heprClipPixelWidth(point: vec2<f32>) -> f32 {
  let dx = length(vec2<f32>(dpdx(point.x), dpdy(point.x)));
  let dy = length(vec2<f32>(dpdx(point.y), dpdy(point.y)));
  return max(max(dx, dy), 0.0001);
}
`);function L(e,t,n=!1,r=!1){ue(e,Ve),Ne.set(e,t),n&&Pe.set(e,n),r&&Fe.add(e)}function Be(t){return e.varying(t).setInterpolation(`flat`)}function Ve(n,r,i,a){if(!(n instanceof t)||!(r instanceof t))throw Error(`Unsupported vector clip material.`);let o=Ne.get(n);if(!o||!n.fragmentNode)throw Error(`Clipped node material has no page-space position.`);let s={point:o,clipIndex:i===null?e.sub(Be(e.attribute(le,`float`)),1):e.uniform(i),clipTexture:e.textureLoad(a)},c=Pe.get(n),l=t=>{if(c)return e.Fn(()=>{let r=e.property(`float`,`heprClipAAWidth`);r.assign(ze({point:o}));let i=e.property(`vec4`,`heprClipSource`);i.assign(t);let a=(Fe.has(n)?Re:Le)({...s,aaWidth:r});return c===`premultiplied`?e.mul(i,a):e.vec4(i.rgb,e.mul(i.a,a))})();let r=Ie(s);return e.mul(t,r)};r.fragmentNode=l(n.fragmentNode),je(n,r,l)}var He=e.wgslFn(`
fn heprThreeOutputColor(color: vec3<f32>) -> vec3<f32> {
  let safeColor = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
  let lower = safeColor / 12.92;
  let higher = pow((safeColor + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
  return select(higher, lower, safeColor <= vec3<f32>(0.04045));
}
`),Ue=e.wgslFn(`
fn heprThreeOutputColor(color: vec3<f32>) -> vec3<f32> {
  return clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
}
`);function R(t,n=[]){let r=r=>e.wgslFn(t,[r,...n]);return{linear:r(He),display:r(Ue)}}function z(e){return e}function We(e,t){return e(t)}function Ge(t,n=!1){let r=e.varying(t);return n?r.setInterpolation(`flat`):r}var Ke=e.wgslFn(r),qe=e.wgslFn(_),Je=e.wgslFn(T),Ye=e.wgslFn(a),Xe=e.wgslFn(p,[z(qe)]),Ze=e.wgslFn(`
fn heprCoordFromIndex(index: f32, width: f32) -> vec2<i32> {
  let itemIndex = i32(index);
  let safeWidth = max(i32(width), 1);
  return vec2<i32>(itemIndex % safeWidth, itemIndex / safeWidth);
}
`),Qe=e.wgslFn(`
fn heprFillVertexPack(
  corner: vec2<f32>,
  metaA: vec4<f32>,
  metaB: vec4<f32>,
  metaC: vec4<f32>,
  shapeOnly: f32,
  fillAAScreenPx: f32,
  viewport: vec2<f32>,
  zoom: f32,
  useLocalToClip: f32,
  localToClip: mat4x4<f32>,
  projectedFillFootprint: vec2<f32>
) -> vec4<f32> {
  let segmentCount = i32(metaA.y);
  let alpha = mix(metaC.w, 1.0, shapeOnly);
  if (segmentCount <= 0 || alpha <= 0.001) {
    return vec4<f32>(-2.0, -2.0, 0.0, 0.0);
  }

  let minBounds = metaA.zw;
  let maxBounds = metaB.xy;
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  
  
  var rawMargin = heprCoverageMargin(heprPathToPixel(minBounds + (maxBounds - minBounds) * corner01,
    useLocalToClip, localToClip, zoom, max(viewport, vec2<f32>(1.0))));
  
  
  if (metaC.x >= 0.0 && useLocalToClip < 0.5) {
    rawMargin = max(rawMargin * (0.5 * fillAAScreenPx), vec2<f32>(0.00005)) +
      vec2<f32>(0.00001 / max(zoom, 0.0001));
  }
  if (metaC.x >= 0.0 && useLocalToClip >= 0.5) {
    let tightMargin = heprProjectedClosedFillMargin(minBounds, maxBounds, corner01, rawMargin,
      projectedFillFootprint, fillAAScreenPx, localToClip, max(viewport, vec2<f32>(1.0)));
    if (tightMargin.x >= 0.0) { rawMargin = tightMargin; }
  }
  let margin = heprBoundCoverageMargin(minBounds + (maxBounds - minBounds) * corner01, rawMargin,
    mat2x2<f32>(1.0, 0.0, 0.0, 1.0), useLocalToClip, localToClip, max(viewport, vec2<f32>(1.0)));
  let world = minBounds - margin + (maxBounds - minBounds + 2.0 * margin) * corner01;
  return vec4<f32>(world, 1.0, 0.0);
}
`,[z(Je)]),$e=e.wgslFn(`
fn heprFillClipPosition(
  vertexPack: vec4<f32>,
  viewport: vec2<f32>,
  cameraCenter: vec2<f32>,
  zoom: f32,
  useLocalToClip: f32,
  localToClip: mat4x4<f32>
) -> vec4<f32> {
  if (vertexPack.z <= 0.0) {
    return vec4<f32>(-2.0, -2.0, 0.0, 1.0);
  }

  let world = vertexPack.xy;
  if (useLocalToClip >= 0.5) {
    return localToClip * vec4<f32>(world, 0.0, 1.0);
  }

  let safeViewport = max(viewport, vec2<f32>(1.0));
  let screen = (world - cameraCenter) * zoom + 0.5 * safeViewport;
  let clip = (screen / (0.5 * safeViewport)) - vec2<f32>(1.0);
  return vec4<f32>(clip, 0.0, 1.0);
}
`),et=e.wgslFn(`
fn heprFillIndexedWinding(
  pathIndex: i32, segmentStart: i32, segmentCount: i32,
  origin: vec2<f32>, localY: f32, box: vec4<f32>, footprint: vec2<f32>,
  segmentTexA: texture_2d<f32>, segmentTexB: texture_2d<f32>, segmentTexWidth: f32,
  bandBase: f32, bandEntries: f32, cellHeaders: f32
) -> f32 {
  
  
  var bands = vec4<f32>(0.0);
  
  
  if (segmentCount >= 24) {
    let cells = heprFillCellInfo(f32(pathIndex), cellHeaders, segmentTexA);
    if (cells.y > 0.0) {
      return heprCellWinding(cells, origin, box, footprint, segmentTexA, segmentTexB);
    }
    bands = heprFillBandInfo(f32(pathIndex), bandBase, segmentTexA);
  }
  let safeWidth = max(i32(segmentTexWidth), 1);
  var winding = 0.0;
${n({bands:`bands`,y:`localY`,radius:`0.5 * footprint.y`,count:`segmentCount`,start:`segmentStart`,texture:`segmentTexA`,entries:`bandEntries`,setup:`let rows = heprBandRows(bandInfo, band, bandCount, box);`,edge:`    let coord = vec2<i32>(segmentIndex % safeWidth, segmentIndex / safeWidth);
    let primitiveA = textureLoad(segmentTexA, coord, 0);
    let primitiveB = textureLoad(segmentTexB, coord, 0);
    winding = winding + heprSegmentCoverage(primitiveA.xy, primitiveA.zw, primitiveB.xy,
      primitiveB.z >= 1.0, box, rows.x, rows.y);`})}
  return winding;
}
`,[z(Ke),z(Ye),z(qe),z(Xe)]),tt=`
fn heprFillFragment(
  local: vec2<f32>,
  metaA: vec4<f32>,
  metaB: vec4<f32>,
  metaC: vec4<f32>,
  segmentTexA: texture_2d<f32>,
  segmentTexB: texture_2d<f32>,
  segmentTexWidth: f32,
  pathIndex: i32,
  bandBase: f32,
  bandEntries: f32,
  cellHeaders: f32,
  fillAAScreenPx: f32,
  vectorOverride: vec4<f32>,
  shapeOnly: f32
) -> vec4<f32> {
  
  let footprint = max(vec2<f32>(
    length(vec2<f32>(dpdx(local.x), dpdy(local.x))),
    length(vec2<f32>(dpdx(local.y), dpdy(local.y)))
  ) * fillAAScreenPx, vec2<f32>(0.0001));
  let segmentStart = i32(metaA.x);
  let segmentCount = i32(metaA.y);
  let alphaStyle = mix(metaC.w, 1.0, shapeOnly);
  if (segmentCount <= 0 || alphaStyle <= 0.001) {
    discard;
  }

  
  
  
  let box = vec4<f32>(local - 0.5 * footprint, 1.0 / footprint);
  var winding = 0.0;
  if (metaC.x >= 0.0 && all(metaB.xy - metaA.zw <= footprint)) {
    
    winding = heprHullAreaWinding(metaC.y, metaA.zw, metaB.xy, box, footprint);
  } else {
    winding = heprFillIndexedWinding(pathIndex, segmentStart, segmentCount, metaA.zw, local.y,
      box, footprint, segmentTexA, segmentTexB, segmentTexWidth, bandBase, bandEntries, cellHeaders);
  }
  let mixAmount = clamp(vectorOverride.a, 0.0, 1.0);
  let baseColor = vec3<f32>(metaB.z, metaB.w, metaC.z);
  let color = baseColor * (1.0 - mixAmount) + vectorOverride.rgb * mixAmount;

  
  
  let fillRule = select(metaC.x, -metaC.x - 1.0, metaC.x < 0.0);
  let alpha = heprFillCoverage(winding, fillRule >= 0.5) * alphaStyle;
  if (alpha <= 0.001) {
    discard;
  }

  return vec4<f32>(heprThreeOutputColor(color), alpha);
}
`,nt=[z(qe),z(et)],rt=R(tt,nt),it={vertex:Qe,fragmentSource:tt,fragmentDependencies:nt};function at(n){let r=new t,i=F(n.localToClip,n.pageBinding);r.transparent=!1,r.depthTest=!1,r.depthWrite=!1,r.side=2,r.toneMapped=!1,r.fog=!1,r.lights=!1,de(r);let a=e.uniform(0);N(r,a);let o=e.uniform(1),s=e.uniform(0),c=e.uniform(1),l=e.uniform(Math.max(1,n.fillPathTextureWidth)),u=e.uniform(Math.max(1,n.fillSegmentTextureWidth)),d=e.attribute(`aCorner`,`vec2`),f=e.attribute(`aFillPathIndex`,`float`),p=We(Ze,{index:f,width:l}),m=Ge(e.textureLoad(n.fillPathMetaTextureA,p,0),!0),h=Ge(e.textureLoad(n.fillPathMetaTextureB,p,0),!0),g=Ge(e.textureLoad(n.fillPathMetaTextureC,p,0),!0),_=Ge(e.int(f),!0),v=e.uniform(n.viewport),y=i.matrix,b=Ge(We(Qe,{corner:d,metaA:m,metaB:h,metaC:g,shapeOnly:a,fillAAScreenPx:c,viewport:v,zoom:o,useLocalToClip:s,localToClip:y,projectedFillFootprint:e.uniform(n.projectedFillFootprint??new oe)})),x=b;return r.vertexNode=We($e,{vertexPack:b,viewport:v,cameraCenter:e.uniform(n.cameraCenter),zoom:o,useLocalToClip:s,localToClip:y}),i.finish(r),r.fragmentNode=We(rt[n.colorCompositing],{local:x.xy,metaA:m,metaB:h,metaC:g,segmentTexA:e.textureLoad(n.fillSegmentTextureA),segmentTexB:e.textureLoad(n.fillSegmentTextureB),segmentTexWidth:u,pathIndex:_,bandBase:e.uniform(n.fillBandBase??-1),bandEntries:e.uniform(n.fillBandEntries??0),cellHeaders:e.uniform((n.fillCellBase??-1)+1),fillAAScreenPx:c,vectorOverride:e.uniform(n.vectorOverride),shapeOnly:a}),L(r,x.xy),{material:r,zoomUniform:o,useLocalToClipUniform:s}}var ot=[];for(let t of k)ot.push(e.wgslFn(t,ot.slice()));var st=ot[ot.length-1];function B(e){return e}function ct(e,t){return e(t)}function lt(t,n=!1){let r=e.varying(t);return n?r.setInterpolation(`flat`):r}var ut=e.wgslFn(`
fn heprSegmentCoord(index: f32, width: f32) -> vec2<i32> {
  let segmentIndex = i32(index);
  let safeWidth = max(i32(width), 1);
  return vec2<i32>(segmentIndex % safeWidth, segmentIndex / safeWidth);
}
`),dt=e.wgslFn(`
fn heprSplitSegmentTexel(
  headTexture: texture_2d<f32>,
  tailTexture: texture_2d<f32>,
  index: f32,
  headWidth: f32,
  tailWidth: f32,
  splitIndex: f32
) -> vec4<f32> {
  let segmentIndex = i32(index);
  let split = i32(splitIndex);
  if (segmentIndex >= split) {
    let tailIndex = segmentIndex - split;
    let width = max(i32(tailWidth), 1);
    return textureLoad(tailTexture, vec2<i32>(tailIndex % width, tailIndex / width), 0);
  }
  let width = max(i32(headWidth), 1);
  return textureLoad(headTexture, vec2<i32>(segmentIndex % width, segmentIndex / width), 0);
}
`),ft=e.wgslFn(`
fn heprFloatMod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}
`),pt=e.wgslFn(me),mt=e.wgslFn(b),ht=e.wgslFn(`
fn heprStrokeWorldPack(
  corner: vec2<f32>,
  primitiveA: vec4<f32>,
  primitiveB: vec4<f32>,
  style: vec4<f32>,
  primitiveBounds: vec4<f32>,
  zoom: f32,
  useLocalToClip: f32,
  localUnitsPerPixelInput: f32,
  aaScreenPx: f32,
  minimumStrokeWidthPx: f32,
  shapeOnly: f32
) -> vec4<f32> {
  let p0 = primitiveA.xy;
  let p1 = primitiveA.zw;
  let p2 = primitiveB.xy;
  let primitiveType = primitiveB.z;
  let isQuadratic = primitiveType >= 0.5;
  var halfWidth = style.x;
  let packedStyle = primitiveB.w;
  let styleFlags = floor(packedStyle / 2.0 + 0.000001);
  let alpha = mix(packedStyle - styleFlags * 2.0, 1.0, shapeOnly);
  let isHairline = heprFloatMod(styleFlags, 2.0) >= 0.5;
  let isRoundCap = heprFloatMod(floor(styleFlags * 0.5), 2.0) >= 0.5;

  var geometryLength: f32;
  if (isQuadratic) {
    geometryLength = length(p1 - p0) + length(p2 - p1);
  } else {
    geometryLength = length(p2 - p0);
  }

  if ((geometryLength == 0.0 && !isRoundCap) || alpha <= 0.001) {
    return vec4<f32>(-2.0, -2.0, 0.0, 0.0);
  }

  var localUnitsPerPixel: f32;
  if (useLocalToClip >= 0.5) {
    localUnitsPerPixel = max(localUnitsPerPixelInput, 0.000001);
  } else {
    localUnitsPerPixel = 1.0 / max(zoom, 0.0001);
  }

  if (isHairline) {
    halfWidth = max(0.5 * localUnitsPerPixel, 0.00001);
  }

  halfWidth = heprMinimumStrokeHalfWidth(halfWidth, select(1.0 / max(zoom, 1e-12), localUnitsPerPixel, useLocalToClip >= 0.5), minimumStrokeWidthPx);

  var aaWorld = max(localUnitsPerPixel, 0.0001) * aaScreenPx;
  if (isHairline) {
    aaWorld = max(0.35 * localUnitsPerPixel, 0.00005);
  }

  let extent = halfWidth + max(aaWorld, localUnitsPerPixel);
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  let worldPosition = heprStrokeQuadWorldPosition(corner01, p0, p1, p2, primitiveBounds, extent);

  return vec4<f32>(worldPosition, halfWidth, aaWorld);
}
`,[B(ft),B(pt),B(mt)]),gt=e.wgslFn(`
fn heprStrokeClipPosition(
  worldPack: vec4<f32>,
  viewport: vec2<f32>,
  cameraCenter: vec2<f32>,
  zoom: f32,
  useLocalToClip: f32,
  localToClip: mat4x4<f32>
) -> vec4<f32> {
  if (worldPack.w <= 0.0) {
    return vec4<f32>(-2.0, -2.0, 0.0, 1.0);
  }

  let worldPosition = worldPack.xy;
  if (useLocalToClip >= 0.5) {
    return localToClip * vec4<f32>(worldPosition, 0.0, 1.0);
  }

  let safeViewport = max(viewport, vec2<f32>(1.0));
  let screen = (worldPosition - cameraCenter) * zoom + 0.5 * safeViewport;
  let clip = (screen / (0.5 * safeViewport)) - vec2<f32>(1.0);
  return vec4<f32>(clip, 0.0, 1.0);
}
`),_t=e.wgslFn(M),vt=e.wgslFn(O),yt=e.wgslFn(_e),bt=e.wgslFn(he,[B(yt)]),xt=`
fn heprStrokeFragment(
  local: vec2<f32>,
  primitiveA: vec4<f32>,
  primitiveB: vec4<f32>,
  style: vec4<f32>,
  primitiveBounds: vec4<f32>,
  halfWidthFromVertex: f32,
  strokeCurveEnabled: f32,
  aaScreenPx: f32,
  vectorOverride: vec4<f32>,
  minimumStrokeWidthPx: f32,
  shapeOnly: f32
) -> vec4<f32> {
  let pixelDx = dpdx(local);
  let pixelDy = dpdy(local);
  let p0 = primitiveA.xy;
  let p1 = primitiveA.zw;
  let p2 = primitiveB.xy;
  let primitiveType = primitiveB.z;
  let packedStyle = primitiveB.w;
  let styleFlags = floor(packedStyle / 2.0 + 0.000001);
  let alphaStyle = mix(packedStyle - styleFlags * 2.0, 1.0, shapeOnly);
  if (alphaStyle <= 0.001) {
    discard;
  }

  let hasClipBounds = heprFloatMod(floor(styleFlags * 0.25), 2.0) >= 0.5;
  if (
    hasClipBounds &&
    (local.x < primitiveBounds.x || local.y < primitiveBounds.y ||
      local.x > primitiveBounds.z || local.y > primitiveBounds.w)
  ) {
    discard;
  }

  let pixelToLocalX = length(vec2<f32>(pixelDx.x, pixelDy.x));
  let pixelToLocalY = length(vec2<f32>(pixelDx.y, pixelDy.y));
  let localPerPixel = max(max(pixelToLocalX, pixelToLocalY), 0.000001);
  let isHairline = heprFloatMod(styleFlags, 2.0) >= 0.5;
  let aaWorld = max(localPerPixel * aaScreenPx, 0.00005);
  var halfWidth = halfWidthFromVertex;
  if (isHairline) {
    halfWidth = max(0.5 * localPerPixel, 0.00001);
  }

  halfWidth = heprMinimumStrokeHalfWidth(halfWidth, localPerPixel, minimumStrokeWidthPx);
  var coverage: f32;
  if (strokeCurveEnabled >= 0.5 && primitiveType >= 0.5) {
    coverage = heprStrokeCoverage(heprDistanceToQuadraticBezier(local, p0, p1, p2), halfWidth, aaWorld);
  } else {
    coverage = heprLinearStrokeCoverage(local, p0, p2, halfWidth, pixelDx, pixelDy, 1.0);
  }
  var alpha = coverage * alphaStyle;
  alpha = heprStrokeLodAlpha(alpha, primitiveType);
  if (alpha <= 0.0) {
    discard;
  }

  let mixAmount = clamp(vectorOverride.a, 0.0, 1.0);
  let baseColor = style.yzw;
  let color = baseColor * (1.0 - mixAmount) + vectorOverride.rgb * mixAmount;
  return vec4<f32>(heprThreeOutputColor(color), alpha);
}
`,St=[B(mt),B(ft),B(_t),B(st),B(vt),B(yt),B(bt)],Ct=R(xt,St),wt={vertex:ht,clip:gt,fragmentSource:xt,fragmentDependencies:St};function Tt(n){let r=new t,i=F(n.localToClip,n.pageBinding);r.transparent=!1,r.depthTest=!1,r.depthWrite=!1,r.side=2,r.toneMapped=!1,r.fog=!1,r.lights=!1,de(r);let a=e.uniform(0);N(r,a);let o=e.uniform(1),s=e.uniform(0),c=e.uniform(1),l=e.uniform(+!!n.strokeCurveEnabled),u=e.uniform(Math.max(1,n.segmentTextureWidth)),d=e.uniform(1),f=e.uniform(0),p=e.attribute(`aCorner`,`vec2`),m=e.attribute(`aSegmentIndex`,`float`),h=ct(ut,{index:m,width:u}),g=n.segmentTail,_=g?e.uniform(Math.max(1,g.width)):null,v=g?e.uniform(g.split):null,y=(t,n)=>n?ct(dt,{headTexture:e.textureLoad(t),tailTexture:e.textureLoad(n),index:m,headWidth:u,tailWidth:_,splitIndex:v}):e.textureLoad(t,h,0),b=lt(y(n.segmentTextureA,g?.textureA),!0),x=lt(y(n.segmentTextureB,g?.textureB),!0),S=lt(y(n.segmentStyleTexture,g?.styleTexture),!0),C=lt(y(n.segmentBoundsTexture,g?.boundsTexture),!0),w=lt(ct(ht,{corner:p,primitiveA:b,primitiveB:x,style:S,primitiveBounds:C,zoom:o,useLocalToClip:s,localUnitsPerPixelInput:i.units??c,aaScreenPx:d,minimumStrokeWidthPx:f,shapeOnly:a})),T=w,E=e.uniform(n.viewport),D=e.uniform(n.cameraCenter),O=i.matrix,k=e.uniform(n.vectorOverride);return r.vertexNode=ct(gt,{worldPack:w,viewport:E,cameraCenter:D,zoom:o,useLocalToClip:s,localToClip:O}),i.finish(r),r.fragmentNode=ct(Ct[n.colorCompositing],{local:T.xy,primitiveA:b,primitiveB:x,style:S,primitiveBounds:C,halfWidthFromVertex:T.z,strokeCurveEnabled:l,aaScreenPx:d,vectorOverride:k,minimumStrokeWidthPx:f,shapeOnly:a}),L(r,T.xy),{material:r,zoomUniform:o,useLocalToClipUniform:s,localUnitsPerPixelUniform:c,curveUniform:l,minimumStrokeWidthUniform:f}}function Et(e,t){return e(t)}function Dt(t){return e.varying(t).setInterpolation(`flat`)}function Ot(t){return e.varying(t)}var kt=e.wgslFn(`
fn heprMixedTextureField(
  kind: f32, index: f32,
  head: texture_2d<f32>, tail: texture_2d<f32>, fill: texture_2d<f32>,
  headWidth: f32, tailWidth: f32, split: f32, fillWidth: f32, fillOffset: f32
) -> vec4<f32> {
  if (kind >= 0.5) {
    if (fillOffset < 0.0) { return vec4<f32>(0.0); }
    let i = i32(index + fillOffset);
    let width = max(i32(fillWidth), 1);
    return textureLoad(fill, vec2<i32>(i % width, i / width), 0);
  }
  var i = i32(index);
  if (split >= 0.0 && index >= split) {
    i = i - i32(split);
    let width = max(i32(tailWidth), 1);
    return textureLoad(tail, vec2<i32>(i % width, i / width), 0);
  }
  let width = max(i32(headWidth), 1);
  return textureLoad(head, vec2<i32>(i % width, i / width), 0);
}
`),At=e.wgslFn(`
fn heprMixedWorldPack(
  corner: vec2<f32>, kind: f32,
  dataA: vec4<f32>, dataB: vec4<f32>, dataC: vec4<f32>, dataD: vec4<f32>,
  viewport: vec2<f32>, zoom: f32, useLocalToClip: f32,
  localToClip: mat4x4<f32>, localUnitsPerPixel: f32, aaScreenPx: f32, minimumStrokeWidthPx: f32, shapeOnly: f32,
  fillEnabled: f32, strokeEnabled: f32, projectedFillFootprint: vec2<f32>
) -> vec4<f32> {
  if (select(fillEnabled, strokeEnabled, kind < 0.5) < 0.5) {
    return vec4<f32>(-2.0, -2.0, 0.0, 0.0);
  }
  if (kind < 0.5) {
    return heprStrokeWorldPack(corner, dataA, dataB, dataC, dataD,
      zoom, useLocalToClip, localUnitsPerPixel, aaScreenPx, minimumStrokeWidthPx, shapeOnly);
  }
  let pack = heprFillVertexPack(corner, dataA, dataB, dataC, shapeOnly, aaScreenPx,
    viewport, zoom, useLocalToClip, localToClip, projectedFillFootprint);
  
  return vec4<f32>(pack.xy, 0.0, pack.z);
}
`,[wt.vertex,it.vertex]);function jt(e,t){return e.replace(/fn hepr(?:Stroke|Fill)Fragment\(/,`fn ${t}(`).replace(`shapeOnly: f32
)`,`shapeOnly: f32,
  pixelFootprint: vec2<f32>,
  pixelDxInput: vec2<f32>, pixelDyInput: vec2<f32>
)`).replaceAll(`length(vec2<f32>(dpdx(local.x), dpdy(local.x)))`,`pixelFootprint.x`).replaceAll(`length(vec2<f32>(dpdx(local.y), dpdy(local.y)))`,`pixelFootprint.y`).replaceAll(`length(vec2<f32>(pixelDx.x, pixelDy.x))`,`pixelFootprint.x`).replaceAll(`length(vec2<f32>(pixelDx.y, pixelDy.y))`,`pixelFootprint.y`).replaceAll(`dpdx(local)`,`pixelDxInput`).replaceAll(`dpdy(local)`,`pixelDyInput`)}var Mt=R(`
fn heprMixedVectorFragment(
  local: vec2<f32>, kind: f32, pathIndex: i32,
  dataA: vec4<f32>, dataB: vec4<f32>, dataC: vec4<f32>, dataD: vec4<f32>,
  halfWidth: f32, segmentTexA: texture_2d<f32>, segmentTexB: texture_2d<f32>, segmentWidth: f32,
  bandBase: f32, bandEntries: f32, cellHeaders: f32,
  fillAAScreenPx: f32, strokeAAScreenPx: f32, curveEnabled: f32,
  vectorOverride: vec4<f32>, minimumStrokeWidthPx: f32, shapeOnly: f32
) -> vec4<f32> {
  
  let pixelDx = dpdx(local);
  let pixelDy = dpdy(local);
  let pixelFootprint = vec2<f32>(length(vec2<f32>(pixelDx.x, pixelDy.x)),
    length(vec2<f32>(pixelDx.y, pixelDy.y)));
  if (kind < 0.5) {
    return heprMixedStrokeFragment(local, dataA, dataB, dataC, dataD, halfWidth,
      curveEnabled, strokeAAScreenPx, vectorOverride, minimumStrokeWidthPx, shapeOnly, pixelFootprint, pixelDx, pixelDy);
  }
  return heprMixedFillFragment(local, dataA, dataB, dataC, segmentTexA, segmentTexB,
    segmentWidth, pathIndex, bandBase, bandEntries, cellHeaders,
    fillAAScreenPx, vectorOverride, shapeOnly, pixelFootprint, pixelDx, pixelDy);
}
`,[e.wgslFn(jt(wt.fragmentSource,`heprMixedStrokeFragment`),wt.fragmentDependencies),e.wgslFn(jt(it.fragmentSource,`heprMixedFillFragment`),it.fragmentDependencies)]);function Nt(n){let r=new t;r.transparent=!1,r.depthTest=!1,r.depthWrite=!1,r.side=2,r.toneMapped=!1,r.fog=!1,r.lights=!1,de(r);let i=e.uniform(0);N(r,i);let a=e.uniform(1),o=e.uniform(0),s=e.uniform(1),c=e.uniform(+!!n.strokeCurveEnabled),l=e.uniform(0),u=e.uniform(1),d=e.uniform(1),f=F(n.localToClip,n.pageBinding),p=e.attribute(`aVectorKind`,`float`),m=e.attribute(`aVectorIndex`,`float`),h=e.uniform(n.viewport),g=e.uniform(Math.max(1,n.segmentTextureWidth)),_=e.uniform(Math.max(1,n.fillSegmentTextureWidth)),v=e.uniform(Math.max(1,n.fillPathTextureWidth)),y=n.segmentTail,b=e.uniform(Math.max(1,y?.width??n.segmentTextureWidth)),x=e.uniform(y?.split??-1),S=(t,n,r,i,a)=>Dt(Et(kt,{kind:p,index:m,head:e.textureLoad(t),tail:e.textureLoad(n??t),fill:e.textureLoad(r),headWidth:g,tailWidth:b,split:x,fillWidth:i,fillOffset:e.uniform(a)})),C=S(n.segmentTextureA,y?.textureA,n.fillPathMetaTextureA,v,0),w=S(n.segmentTextureB,y?.textureB,n.fillPathMetaTextureB,v,0),T=S(n.segmentStyleTexture,y?.styleTexture,n.fillPathMetaTextureC,v,0),E=S(n.segmentBoundsTexture,y?.boundsTexture,n.segmentBoundsTexture,g,-1),D=Ot(Et(At,{corner:e.attribute(`aCorner`,`vec2`),kind:p,dataA:C,dataB:w,dataC:T,dataD:E,viewport:h,zoom:a,useLocalToClip:o,localToClip:f.matrix,localUnitsPerPixel:f.units??s,aaScreenPx:e.uniform(1),minimumStrokeWidthPx:l,shapeOnly:i,fillEnabled:u,strokeEnabled:d,projectedFillFootprint:e.uniform(n.projectedFillFootprint??new oe)})),O=D;return r.vertexNode=Et(wt.clip,{worldPack:D,viewport:h,cameraCenter:e.uniform(n.cameraCenter),zoom:a,useLocalToClip:o,localToClip:f.matrix}),f.finish(r),r.fragmentNode=Et(Mt[n.colorCompositing],{local:O.xy,kind:Dt(p),pathIndex:Dt(e.int(m)),dataA:C,dataB:w,dataC:T,dataD:E,halfWidth:O.z,segmentTexA:e.textureLoad(n.fillSegmentTextureA),segmentTexB:e.textureLoad(n.fillSegmentTextureB),segmentWidth:_,bandBase:e.uniform(n.fillBandBase??-1),bandEntries:e.uniform(n.fillBandEntries??0),cellHeaders:e.uniform((n.fillCellBase??-1)+1),fillAAScreenPx:e.uniform(1),strokeAAScreenPx:e.uniform(1),curveEnabled:c,vectorOverride:e.uniform(n.vectorOverride),minimumStrokeWidthPx:l,shapeOnly:i}),L(r,O.xy),{material:r,zoomUniform:a,useLocalToClipUniform:o,localUnitsPerPixelUniform:s,curveUniform:c,minimumStrokeWidthUniform:l,fillRenderingUniform:u,strokeRenderingUniform:d}}function Pt(e){return e}function V(e,t){return e(t)}function H(t,n=!1){let r=e.varying(t);return n?r.setInterpolation(`flat`):r}var Ft=e.wgslFn(`
fn heprCoordFromIndex(index: f32, width: f32) -> vec2<i32> {
  let itemIndex = i32(index);
  let safeWidth = max(i32(width), 1);
  return vec2<i32>(itemIndex % safeWidth, itemIndex / safeWidth);
}
`),It=e.wgslFn(`
fn heprClipCoordFromReference(reference: f32, width: f32) -> vec2<i32> {
  let itemIndex = max(i32(reference) - 1, 0);
  let safeWidth = max(i32(width), 1);
  return vec2<i32>(itemIndex % safeWidth, itemIndex / safeWidth);
}
`),Lt=e.wgslFn(_),Rt=e.wgslFn(T),zt=e.wgslFn(`
fn heprTextVertexPack(
  corner: vec2<f32>,
  instanceA: vec4<f32>,
  instanceB: vec4<f32>,
  glyphMetaA: vec4<f32>,
  glyphMetaB: vec4<f32>,
  viewport: vec2<f32>,
  zoom: f32,
  useLocalToClip: f32,
  localToClip: mat4x4<f32>
) -> vec4<f32> {
  let segmentCount = i32(glyphMetaA.y);
  if (segmentCount <= 0) {
    return vec4<f32>(-2.0, -2.0, 0.0, 0.0);
  }

  let minBounds = glyphMetaA.zw;
  let maxBounds = glyphMetaB.xy;
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  
  
  let glyphToWorld = mat2x2<f32>(instanceA.x, instanceA.y, instanceA.z, instanceA.w);
  let cornerWorld = glyphToWorld * (minBounds + (maxBounds - minBounds) * corner01) + instanceB.xy;
  let glyphToPixel = heprPathToPixel(cornerWorld, useLocalToClip, localToClip, zoom,
    max(viewport, vec2<f32>(1.0))) * glyphToWorld;
  let rawMargin = heprCoverageMargin(glyphToPixel);
  let margin = heprBoundCoverageMarginFromPixel(cornerWorld, rawMargin, glyphToWorld, glyphToPixel, useLocalToClip, localToClip);
  let local = minBounds - margin + (maxBounds - minBounds + 2.0 * margin) * corner01;
  let world = vec2<f32>(
    instanceA.x * local.x + instanceA.z * local.y + instanceB.x,
    instanceA.y * local.x + instanceA.w * local.y + instanceB.y
  );
  return vec4<f32>(world, local);
}
`,[Pt(Rt)]),Bt=e.wgslFn(`
fn heprTextClipPosition(
  vertexPack: vec4<f32>,
  glyphMetaA: vec4<f32>,
  viewport: vec2<f32>,
  cameraCenter: vec2<f32>,
  zoom: f32,
  useLocalToClip: f32,
  localToClip: mat4x4<f32>
) -> vec4<f32> {
  
  
  
  
  if (i32(glyphMetaA.y) <= 0) {
    return vec4<f32>(-2.0, -2.0, 0.0, 1.0);
  }

  let world = vertexPack.xy;
  if (useLocalToClip >= 0.5) {
    return localToClip * vec4<f32>(world, 0.0, 1.0);
  }

  let safeViewport = max(viewport, vec2<f32>(1.0));
  let screen = (world - cameraCenter) * zoom + 0.5 * safeViewport;
  let clip = (screen / (0.5 * safeViewport)) - vec2<f32>(1.0);
  return vec4<f32>(clip, 0.0, 1.0);
}
`),Vt=e.wgslFn(`
fn heprTextNormCoord(local: vec2<f32>, glyphMetaA: vec4<f32>, glyphMetaB: vec4<f32>) -> vec2<f32> {
  let minBounds = glyphMetaA.zw;
  let maxBounds = glyphMetaB.xy;
  let span = max(maxBounds - minBounds, vec2<f32>(0.000001));
  
  return (local - minBounds) / span;
}
`),Ht=e.wgslFn(`
fn heprTextRasterAtlasPixels(
  normCoord: vec2<f32>,
  rasterRect: vec4<f32>,
  atlasSize: vec2<f32>
) -> vec2<f32> {
  let dims = max(atlasSize, vec2<f32>(1.0));
  return vec2<f32>(normCoord.x, 1.0 - normCoord.y) * (rasterRect.zw * dims);
}
`),Ut=R(`
fn heprTextFragment(
  local: vec2<f32>,
  world: vec2<f32>,
  clipReference: f32,
  clipRect: vec4<f32>,
  glyphMetaA: vec4<f32>,
  instanceColor: vec4<f32>,
  normCoord: vec2<f32>,
  atlasPixels: vec2<f32>,
  rasterRect: vec4<f32>,
  rasterAtlasTex: texture_2d<f32>,
  rasterAtlasSampler: sampler,
  rasterAtlasSize: vec2<f32>,
  vectorOnly: f32,
  segmentTexA: texture_2d<f32>,
  segmentTexB: texture_2d<f32>,
  segmentTexWidth: f32,
  textAAScreenPx: f32,
  textCurveEnabled: f32,
  vectorOverride: vec4<f32>,
  shapeOnly: f32,
  inkDensity: f32
) -> vec4<f32> {
  if (clipReference > 0.0 &&
      (world.x < clipRect.x || world.y < clipRect.y ||
       world.x > clipRect.z || world.y > clipRect.w)) {
    discard;
  }
  let localDx = dpdx(local);
  let localDy = dpdy(local);
  let pixelToLocalX = length(vec2<f32>(localDx.x, localDy.x));
  let pixelToLocalY = length(vec2<f32>(localDx.y, localDy.y));
  let glyphPixel = vec2<f32>(
    length(vec2<f32>(dpdx(normCoord.x), dpdy(normCoord.x))),
    length(vec2<f32>(dpdx(normCoord.y), dpdy(normCoord.y)))
  );
  
  
  
  let atlasPixelsDx = dpdx(atlasPixels);
  let atlasPixelsDy = dpdy(atlasPixels);
  let atlasFootprint = min(
    abs(atlasPixelsDx.x) + abs(atlasPixelsDy.x),
    abs(atlasPixelsDx.y) + abs(atlasPixelsDy.y)
  );

  let segmentStart = i32(glyphMetaA.x);
  let segmentCount = i32(glyphMetaA.y);
  if (segmentCount <= 0 || instanceColor.a <= 0.001) {
    discard;
  }

  let mixAmount = clamp(vectorOverride.a, 0.0, 1.0);
  let tintedColor = instanceColor.rgb * (1.0 - mixAmount) + vectorOverride.rgb * mixAmount;

  
  
  
  let glyphPixels = 1.0 / max(min(glyphPixel.x, glyphPixel.y), 0.000001);
  let detail = clamp((glyphPixels - 2.5) / 2.5, 0.0, 1.0);
  let halfBox = max(0.5 * textAAScreenPx * glyphPixel, vec2<f32>(0.000001));
  let boxOverlap = max(min(normCoord + halfBox, vec2<f32>(1.0)) - max(normCoord - halfBox, vec2<f32>(0.0)), vec2<f32>(0.0)) /
    (2.0 * halfBox);
  var coverage = clamp(inkDensity, 0.0, 1.0) * boxOverlap.x * boxOverlap.y;

  if (detail > 0.0) {
    var detailCoverage = 0.0;
    
    
    
    if (vectorOnly < 0.5 && rasterRect.z > 0.0 && rasterRect.w > 0.0 && atlasFootprint > 2.0) {
      let atlasDims = max(rasterAtlasSize, vec2<f32>(1.0));
      let texel = 1.0 / atlasDims;
      let uvCenter = vec2<f32>(
        rasterRect.x + normCoord.x * rasterRect.z,
        rasterRect.y + (1.0 - normCoord.y) * rasterRect.w
      );
      
      
      let padding = texel * 7.5;
      let uvMin = rasterRect.xy - padding;
      let uvMax = rasterRect.xy + rasterRect.zw + padding;
      let tapDx = atlasPixelsDx * 0.33 * texel;
      let tapDy = atlasPixelsDy * 0.33 * texel;
      
      let mipCap = min(1.0, 8.0 /
        max(max(length(atlasPixelsDx), length(atlasPixelsDy)) * 0.42044820762685725, 0.000001));
      
      
      let mipBiasedUvDx = atlasPixelsDx * texel * 0.42044820762685725 * mipCap;
      let mipBiasedUvDy = atlasPixelsDy * texel * 0.42044820762685725 * mipCap;
      detailCoverage = (1.0 / 3.0) * textureSampleGrad(
        rasterAtlasTex,
        rasterAtlasSampler,
        clamp(uvCenter, uvMin, uvMax),
        mipBiasedUvDx,
        mipBiasedUvDy
      ).r + (1.0 / 6.0) * (
        textureSampleGrad(
          rasterAtlasTex,
          rasterAtlasSampler,
          clamp(uvCenter - tapDx - tapDy, uvMin, uvMax),
          mipBiasedUvDx,
          mipBiasedUvDy
        ).r +
        textureSampleGrad(
          rasterAtlasTex,
          rasterAtlasSampler,
          clamp(uvCenter - tapDx + tapDy, uvMin, uvMax),
          mipBiasedUvDx,
          mipBiasedUvDy
        ).r +
        textureSampleGrad(
          rasterAtlasTex,
          rasterAtlasSampler,
          clamp(uvCenter + tapDx - tapDy, uvMin, uvMax),
          mipBiasedUvDx,
          mipBiasedUvDy
        ).r +
        textureSampleGrad(
          rasterAtlasTex,
          rasterAtlasSampler,
          clamp(uvCenter + tapDx + tapDy, uvMin, uvMax),
          mipBiasedUvDx,
          mipBiasedUvDy
        ).r
      );
    } else {
      
      
      let footprint = max(vec2<f32>(pixelToLocalX, pixelToLocalY) * textAAScreenPx, vec2<f32>(0.0001));
      let box = vec4<f32>(local - 0.5 * footprint, 1.0 / footprint);
      var winding = 0.0;
      let safeWidth = max(i32(segmentTexWidth), 1);
      for (var i = 0; i < segmentCount; i = i + 1) {
        let primitiveIndex = segmentStart + i;
        let coord = vec2<i32>(primitiveIndex % safeWidth, primitiveIndex / safeWidth);
        let primitiveA = textureLoad(segmentTexA, coord, 0);
        let primitiveB = textureLoad(segmentTexB, coord, 0);
        winding = winding + heprSegmentCoverage(primitiveA.xy, primitiveA.zw, primitiveB.xy,
          textCurveEnabled >= 0.5 && primitiveB.z >= 1.0, box, 0.0, 1.0);
      }
      detailCoverage = heprFillCoverage(winding, false);
    }
    coverage = mix(coverage, detailCoverage, detail);
  }

  let alpha = clamp(coverage, 0.0, 1.0) * mix(instanceColor.a, 1.0, shapeOnly);
  if (alpha <= 0.001) {
    discard;
  }

  return vec4<f32>(heprThreeOutputColor(tintedColor), alpha);
}
`,[Pt(Lt)]);function Wt(n){let r=new t,i=F(n.localToClip,n.pageBinding);r.transparent=!1,r.depthTest=!1,r.depthWrite=!1,r.side=2,r.toneMapped=!1,r.fog=!1,r.lights=!1,de(r);let a=e.uniform(0);N(r,a);let o=e.uniform(1),s=e.uniform(0),c=e.uniform(+!!n.strokeCurveEnabled),l=e.uniform(+!!n.textVectorOnly),u=e.uniform(1.25),d=e.uniform(Math.max(1,n.textInstanceTextureWidth)),f=e.uniform(Math.max(1,n.textGlyphTextureWidth)),p=e.uniform(Math.max(1,n.textSegmentTextureWidth)),m=e.attribute(`aCorner`,`vec2`),h=V(Ft,{index:e.attribute(`aTextInstanceIndex`,`float`),width:d}),g=H(e.textureLoad(n.textInstanceTextureA,h,0),!0),_=H(e.textureLoad(n.textInstanceTextureB,h,0),!0),v=H(e.textureLoad(n.textInstanceTextureC,h,0),!0),y=V(Ft,{index:_.z,width:f}),b=H(e.textureLoad(n.textGlyphMetaTextureA,y,0),!0),x=H(e.textureLoad(n.textGlyphMetaTextureB,y,0),!0),S=H(e.textureLoad(n.textGlyphRasterMetaTexture,y,0),!0),C=e.uniform(n.viewport),w=i.matrix,T=H(V(zt,{corner:m,instanceA:g,instanceB:_,glyphMetaA:b,glyphMetaB:x,viewport:C,zoom:o,useLocalToClip:s,localToClip:w})),E=T,D=V(It,{reference:_.w,width:f}),O=H(e.textureLoad(n.textGlyphMetaTextureA,D,0),!0);r.vertexNode=V(Bt,{vertexPack:T,glyphMetaA:b,viewport:C,cameraCenter:e.uniform(n.cameraCenter),zoom:o,useLocalToClip:s,localToClip:w});let k=e.uniform(n.textRasterAtlasSize),A=V(Vt,{local:E.zw,glyphMetaA:b,glyphMetaB:x}),j=V(Ht,{normCoord:A,rasterRect:S,atlasSize:k});return i.finish(r),r.fragmentNode=V(Ut[n.colorCompositing],{local:E.zw,world:T.xy,clipReference:_.w,clipRect:O,glyphMetaA:b,instanceColor:v,normCoord:A,atlasPixels:j,rasterRect:S,rasterAtlasTex:e.texture(n.textRasterAtlasTexture),rasterAtlasSampler:e.sampler(n.textRasterAtlasTexture),rasterAtlasSize:k,vectorOnly:l,segmentTexA:e.textureLoad(n.textGlyphSegmentTextureA),segmentTexB:e.textureLoad(n.textGlyphSegmentTextureB),segmentTexWidth:p,textAAScreenPx:u,textCurveEnabled:c,vectorOverride:e.uniform(n.vectorOverride),shapeOnly:a,inkDensity:x.z}),L(r,T.xy),{material:r,zoomUniform:o,useLocalToClipUniform:s,curveUniform:c,vectorOnlyUniform:l}}var Gt=[0,0,1,1],Kt=e.wgslFn(ne),qt=e.wgslFn(v,[Kt]);function U(e,t){return e(t)}function Jt(t){return e.varying(t)}var Yt=e.wgslFn(`
fn heprRasterPack(
  corner: vec2<f32>,
  matrixABCD: vec4<f32>,
  matrixEF: vec2<f32>,
  tileQuad: vec4<f32>,
  tileUv: vec4<f32>
) -> vec4<f32> {
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  let localTopDown = vec2<f32>(corner01.x, 1.0 - corner01.y);
  
  let farCorner = localTopDown > vec2<f32>(0.5);
  let tileCorner = select(tileQuad.xy, tileQuad.zw, farCorner);
  let world = vec2<f32>(
    matrixABCD.x * tileCorner.x + matrixABCD.z * tileCorner.y + matrixEF.x,
    matrixABCD.y * tileCorner.x + matrixABCD.w * tileCorner.y + matrixEF.y
  );
  return vec4<f32>(world, select(tileUv.xy, tileUv.zw, farCorner));
}
`),Xt=e.wgslFn(`
fn heprPageBackgroundPack(corner: vec2<f32>, pageRect: vec4<f32>) -> vec4<f32> {
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  let localTopDown = vec2<f32>(corner01.x, 1.0 - corner01.y);
  let world = pageRect.xy + pageRect.zw * localTopDown;
  return vec4<f32>(world, localTopDown);
}
`),Zt=e.wgslFn(`
fn heprRasterClipPosition(
  rasterPack: vec4<f32>,
  viewport: vec2<f32>,
  cameraCenter: vec2<f32>,
  zoom: f32,
  useLocalToClip: f32,
  localToClip: mat4x4<f32>
) -> vec4<f32> {
  let world = rasterPack.xy;
  if (useLocalToClip >= 0.5) {
    return localToClip * vec4<f32>(world, 0.0, 1.0);
  }

  let safeViewport = max(viewport, vec2<f32>(1.0));
  let screen = (world - cameraCenter) * zoom + 0.5 * safeViewport;
  let clip = (screen / (0.5 * safeViewport)) - vec2<f32>(1.0);
  return vec4<f32>(clip, 0.0, 1.0);
}
`),Qt=R(`
fn heprRasterFragment(inputColor: vec4<f32>, opacity: f32, shapeOnly: f32) -> vec4<f32> {
  let color = inputColor * mix(opacity, 1.0, shapeOnly);
  if (color.a <= 0.001) {
    discard;
  }
  let straightSrgb = clamp(color.rgb / color.a, vec3<f32>(0.0), vec3<f32>(1.0));
  let outputPremultiplied = heprThreeOutputColor(straightSrgb) * color.a;
  return vec4<f32>(outputPremultiplied, color.a);
}
`),$t=e.wgslFn(m),en=e.wgslFn(f,[$t]),tn=e.wgslFn(u,[$t,en]),nn=e.wgslFn(d,[tn]),rn=e.wgslFn(c,[$t,nn]),an=e.wgslFn(`
fn heprThreeRasterBit(image: texture_2d<f32>, size: vec2f, pixel: vec2i) -> f32 {
  let p = clamp(pixel, vec2i(0), vec2i(size) - vec2i(1));
  let bits = u32(round(textureLoad(image, vec2i(p.x / 8, p.y), 0).r * 255.0));
  return f32((bits >> (7u - (u32(p.x) & 7u))) & 1u);
}`),on=e.wgslFn(E),sn=e.wgslFn(s,[on]),cn=e.wgslFn(o,[sn]),ln=e.wgslFn(`
fn heprThreeRasterSample(image: texture_2d<f32>, imageSampler: sampler,
  coverageImage: texture_2d<f32>, coverageSampler: sampler,
  uv: vec2f, mode: f32, size: vec2f, color0: vec4f, color1: vec4f, opaque: f32) -> vec4f {
  let dx = dpdx(uv); let dy = dpdy(uv);
  if (mode < 0.5) {
    var color: vec4f;
    if (mode < -0.5) {
      let dimensions = vec2i(textureDimensions(image));
      let pixel = clamp(vec2i(floor(uv * vec2f(dimensions))), vec2i(0), dimensions - vec2i(1));
      color = textureLoad(image, pixel, 0);
    } else { color = textureSampleGrad(image, imageSampler, uv, dx, dy); }
    if (opaque > 0.5) { color.a = 1.0; }
    return color;
  }
  let lod = max(0.0, log2(max(1.0, max(length(dx * size), length(dy * size)))));
  var coverage: f32;
  if (mode > 4.5) {
    let pixel = clamp(vec2i(floor(uv * size)), vec2i(0), vec2i(size) - vec2i(1));
    coverage = textureLoad(image, pixel, 0).r;
  } else if (mode > 3.5) {
    coverage = heprThreeRasterBit(image, size, vec2i(floor(uv * size)));
  } else if (mode > 2.5) {
    coverage = heprCompactSample(image, vec2i(size), uv, lod);
  } else if (lod < 1.0) {
    let position = uv * size - vec2f(0.5);
    let pixel = vec2i(floor(position)); let weight = fract(position);
    var base: f32;
    if (mode > 1.5) {
      base = textureSampleLevel(image, imageSampler, uv, 0.0).r;
    } else {
      base = mix(mix(heprThreeRasterBit(image, size, pixel), heprThreeRasterBit(image, size, pixel + vec2i(1,0)), weight.x),
        mix(heprThreeRasterBit(image, size, pixel + vec2i(0,1)), heprThreeRasterBit(image, size, pixel + vec2i(1,1)), weight.x), weight.y);
    }
    coverage = mix(base, heprPackedCoverage(coverageImage, vec2i(size), uv, 0.0), lod);
  } else {
    coverage = heprPackedCoverage(coverageImage, vec2i(size), uv, lod - 1.0);
  }
  return mix(color0, color1, coverage);
}`,[an,cn,rn]);function un(n){let r=new t,i=F(n.localToClip,n.pageBinding);r.transparent=!1,r.depthTest=!1,r.depthWrite=!1,r.side=2,r.toneMapped=!1,r.fog=!1,r.lights=!1,r.blending=5,r.blendSrc=201,r.blendDst=205,r.blendSrcAlpha=201,r.blendDstAlpha=205;let a=e.uniform(0);N(r,a);let o=e.uniform(1),s=e.uniform(0),c=e.attribute(`aCorner`,`vec2`),l=new P().fromArray(n.tile?.quad??Gt),u=new P().fromArray(n.tile?.uv??Gt),d=Jt(n.instancedPageBackground?U(Xt,{corner:c,pageRect:e.attribute(`aPageRect`,`vec4`)}):U(Yt,{corner:c,matrixABCD:n.instancedRasterRepeat?e.attribute(`aRasterRepeatABCD`,`vec4`):e.uniform(n.matrixABCD),matrixEF:n.instancedRasterRepeat?e.attribute(`aRasterRepeatEF`,`vec2`):e.uniform(n.matrixEF),tileQuad:e.uniform(l),tileUv:e.uniform(u)})),f=d,p=fe(n.texture),m=e.texture(n.texture),h=e.texture(p.coverage);m.getUniformHash=()=>m.uuid,h.getUniformHash=()=>h.uuid;let g=e.uniform(p.mode),_=e.uniform(+!!p.compressionFormat),v=p.size.clone(),y=p.color0.clone(),b=p.color1.clone(),x=U(ln,{image:m,imageSampler:e.sampler(h),coverageImage:h,coverageSampler:e.sampler(h),uv:f.zw,mode:g,size:e.uniform(v),color0:e.uniform(y),color1:e.uniform(b),opaque:_}),S=e.uniform(n.opacity??1),C=e.uniform(0),w=n.instancedPageBackground?U(qt,{paper:x,uv:f.zw,pending:Jt(e.attribute(`aPageLoading`,`float`)),time:C}):x;return r.vertexNode=U(Zt,{rasterPack:d,viewport:e.uniform(n.viewport),cameraCenter:e.uniform(n.cameraCenter),zoom:o,useLocalToClip:s,localToClip:i.matrix}),i.finish(r),r.fragmentNode=U(Qt[n.colorCompositing],{inputColor:w,opacity:S,shapeOnly:a}),L(r,d.xy,`premultiplied`,!0),{material:r,zoomUniform:o,useLocalToClipUniform:s,pagePlaceholderTimeUniform:C,updateSource(e,t,r,i){m.value=e;let a=fe(e);h.value=a.coverage,g.value=a.mode,_.value=+!!a.compressionFormat,v.copy(a.size),y.copy(a.color0),b.copy(a.color1),n.matrixABCD.set(t[0],t[1],t[2],t[3]),n.matrixEF.set(t[4],t[5]),l.fromArray(i?.quad??Gt),u.fromArray(i?.uv??Gt),S.value=r}}}function dn(e,t){return e(t)}function fn(t,n=!1){let r=e.varying(t);return n?r.setInterpolation(`flat`):r}var pn=e.wgslFn(ve),mn=e.wgslFn(ge,[pn]);function hn(n){let r=new t,i=F(n.localToClip,n.pageBinding);r.transparent=!1,r.depthTest=!1,r.depthWrite=!1,r.side=2,r.toneMapped=!1,r.fog=!1,r.lights=!1,r.blending=5,r.blendSrc=201,r.blendDst=205,r.blendSrcAlpha=201,r.blendDstAlpha=205;let a=e.uniform(0);N(r,a);let o=e.uniform(1),s=e.uniform(0),c=e.attribute(`aRasterMatrixEFWidthOpacity`,`vec4`),l=e.vec4(0,0,1,1),u=fn(dn(Yt,{corner:e.attribute(`aCorner`,`vec2`),matrixABCD:e.attribute(`aRasterMatrixABCD`,`vec4`),matrixEF:c.xy,tileQuad:l,tileUv:l})),d=u;r.vertexNode=dn(Zt,{rasterPack:u,viewport:e.uniform(n.viewport),cameraCenter:e.uniform(n.cameraCenter),zoom:o,useLocalToClip:s,localToClip:i.matrix});let f=fn(c.zw,!0),p=dn(mn,{uRasterTex:e.texture(n.texture),uRasterSampler:e.sampler(n.texture),uv:d.zw,row:fn(e.instanceIndex,!0),width:f.x});return i.finish(r),r.fragmentNode=dn(Qt[n.colorCompositing],{inputColor:p,opacity:f.y,shapeOnly:a}),L(r,d.xy,`premultiplied`,!0),{material:r,zoomUniform:o,useLocalToClipUniform:s}}function W(e){return e}function G(e,t){return e(t)}function K(t,n=!1){let r=e.varying(t);return n?r.setInterpolation(`flat`):r}var gn=e.wgslFn(r),_n=e.wgslFn(a),vn=e.wgslFn(`
fn heprGradientCoordFromIndex(index: f32, width: f32) -> vec2<i32> {
  let itemIndex = i32(index);
  let safeWidth = max(i32(width), 1);
  return vec2<i32>(itemIndex % safeWidth, itemIndex / safeWidth);
}
`),yn=e.wgslFn(`
fn heprGradientFloatMod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}
`),bn=e.wgslFn(ye),xn=e.wgslFn(be),Sn=e.wgslFn(`
fn heprSamplePdfGradient(
  world: vec2<f32>,
  gradientIndexInput: f32,
  metaA: texture_2d<f32>,
  metaB: texture_2d<f32>,
  metaC: texture_2d<f32>,
  metaD: texture_2d<f32>,
  metaE: texture_2d<f32>,
  lut: texture_2d<f32>,
  metaWidthInput: f32
) -> vec4<f32> {
  if (gradientIndexInput < -0.5) {
    return vec4<f32>(1.0);
  }

  let gradientIndex = i32(gradientIndexInput);
  let metaWidth = max(i32(metaWidthInput), 1);
  let coord = vec2<i32>(gradientIndex % metaWidth, gradientIndex / metaWidth);
  let a = textureLoad(metaA, coord, 0);
  let b = textureLoad(metaB, coord, 0);
  let c = textureLoad(metaC, coord, 0);
  let d = textureLoad(metaD, coord, 0);
  let e = textureLoad(metaE, coord, 0);

  let q = vec2<f32>(
    b.x * world.x + b.z * world.y + c.x,
    b.y * world.x + b.w * world.y + c.y
  );
  if (a.y >= 0.5 && (q.x < e.x || q.y < e.y || q.x > e.z || q.y > e.w)) {
    return vec4<f32>(0.0);
  }

  if (a.x > 1.5) { return vec4<f32>(1.0); }
  let parameter = heprGradientParameter(a, c, d, q);
  if (parameter.y < 0.5) { return heprGradientBackground(a.w); }
  let t = parameter.x;

  let sampleX = clamp(t, 0.0, 1.0) * 1023.0;
  let x0 = i32(floor(sampleX));
  let x1 = min(x0 + 1, 1023);
  let amount = sampleX - f32(x0);
  let color0 = textureLoad(lut, vec2<i32>(x0, gradientIndex), 0);
  let color1 = textureLoad(lut, vec2<i32>(x1, gradientIndex), 0);
  return mix(color0, color1, amount);
}
`,[W(bn),W(xn)]),Cn=e.wgslFn(_),wn=e.wgslFn(p,[W(Cn)]),Tn=e.wgslFn(T),En=e.wgslFn(te,[W(Tn)]),Dn=e.wgslFn(`
fn heprGradientFillVertexPack(
  corner: vec2<f32>,
  metaA: vec4<f32>,
  metaB: vec4<f32>,
  metaC: vec4<f32>,
  clipBounds: vec4<f32>,
  shapeOnly: f32,
  viewport: vec2<f32>,
  zoom: f32,
  useLocalToClip: f32,
  localToClip: mat4x4<f32>
) -> vec4<f32> {
  let segmentCount = i32(metaA.y);
  let alpha = metaC.w;
  if (segmentCount <= 0 || (alpha <= 0.001 && shapeOnly < 0.5)) {
    return vec4<f32>(-2.0, -2.0, 0.0, 0.0);
  }
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  
  
  
  let quad = heprClippedPaintQuad(metaA.zw, metaB.xy, clipBounds, useLocalToClip, localToClip, zoom,
    max(viewport, vec2<f32>(1.0)));
  if (any(quad.xy > quad.zw)) {
    return vec4<f32>(-2.0, -2.0, 0.0, 0.0);
  }
  let world = quad.xy + (quad.zw - quad.xy) * corner01;
  return vec4<f32>(world, 1.0, 0.0);
}
`,[W(En)]),On=e.wgslFn(`
fn heprGradientClipPosition(
  vertexPack: vec4<f32>,
  viewport: vec2<f32>,
  cameraCenter: vec2<f32>,
  zoom: f32,
  useLocalToClip: f32,
  localToClip: mat4x4<f32>
) -> vec4<f32> {
  if (vertexPack.z <= 0.0) {
    return vec4<f32>(-2.0, -2.0, 0.0, 1.0);
  }
  let world = vertexPack.xy;
  if (useLocalToClip >= 0.5) {
    return localToClip * vec4<f32>(world, 0.0, 1.0);
  }
  let safeViewport = max(viewport, vec2<f32>(1.0));
  let screen = (world - cameraCenter) * zoom + 0.5 * safeViewport;
  let clip = screen / (0.5 * safeViewport) - vec2<f32>(1.0);
  return vec4<f32>(clip, 0.0, 1.0);
}
`),kn=e.wgslFn(`
fn heprGradientStrokeClipPosition(
  worldPack: vec4<f32>,
  viewport: vec2<f32>,
  cameraCenter: vec2<f32>,
  zoom: f32,
  useLocalToClip: f32,
  localToClip: mat4x4<f32>
) -> vec4<f32> {
  if (worldPack.w <= 0.0) {
    return vec4<f32>(-2.0, -2.0, 0.0, 1.0);
  }
  let world = worldPack.xy;
  if (useLocalToClip >= 0.5) {
    return localToClip * vec4<f32>(world, 0.0, 1.0);
  }
  let safeViewport = max(viewport, vec2<f32>(1.0));
  let screen = (world - cameraCenter) * zoom + 0.5 * safeViewport;
  let clip = screen / (0.5 * safeViewport) - vec2<f32>(1.0);
  return vec4<f32>(clip, 0.0, 1.0);
}
`),An=e.wgslFn(M),jn=e.wgslFn(_e),Mn=e.wgslFn(he,[W(jn)]),Nn=R(`
fn heprGradientFillFragment(
  local: vec2<f32>,
  metaA: vec4<f32>,
  metaB: vec4<f32>,
  metaC: vec4<f32>,
  segmentTexA: texture_2d<f32>,
  segmentTexB: texture_2d<f32>,
  segmentTexWidth: f32,
  bands: vec4<f32>,
  bandEntries: f32,
  cells: vec4<f32>,
  gradientMetaA: texture_2d<f32>,
  gradientMetaB: texture_2d<f32>,
  gradientMetaC: texture_2d<f32>,
  gradientMetaD: texture_2d<f32>,
  gradientMetaE: texture_2d<f32>,
  gradientLut: texture_2d<f32>,
  gradientMetaWidth: f32,
  sourceGradientIndex: f32,
  maskGradientIndex: f32,
  fillAAScreenPx: f32,
  meshColor: vec4<f32>,
  useMesh: f32,
  shapeOnly: f32,
  vectorOverride: vec4<f32>,
  primitiveColor: vec4<f32>
) -> vec4<f32> {
  
  
  let footprint = max(vec2<f32>(
    length(vec2<f32>(dpdx(local.x), dpdy(local.x))),
    length(vec2<f32>(dpdx(local.y), dpdy(local.y)))
  ) * fillAAScreenPx, vec2<f32>(0.0001));
  let segmentStart = i32(metaA.x);
  let segmentCount = i32(metaA.y);
  if (segmentCount <= 0 || (metaC.w <= 0.001 && shapeOnly < 0.5)) { discard; }
  
  
  
  let box = vec4<f32>(local - 0.5 * footprint, 1.0 / footprint);
  var winding = 0.0;
  let safeWidth = max(i32(segmentTexWidth), 1);
  if (cells.y > 0.0) {
    winding = heprCellWinding(cells, metaA.zw, box, footprint, segmentTexA, segmentTexB);
  } else {
${n({bands:`bands`,y:`local.y`,radius:`0.5 * footprint.y`,count:`segmentCount`,start:`segmentStart`,texture:`segmentTexA`,entries:`bandEntries`,setup:`let rows = heprBandRows(bandInfo, band, bandCount, box);`,edge:`    let coord = vec2<i32>(segmentIndex % safeWidth, segmentIndex / safeWidth);
    let primitiveA = textureLoad(segmentTexA, coord, 0);
    let primitiveB = textureLoad(segmentTexB, coord, 0);
    winding = winding + heprSegmentCoverage(primitiveA.xy, primitiveA.zw, primitiveB.xy,
      primitiveB.z >= 1.0, box, rows.x, rows.y);`})}
  }
  let coverage = heprFillCoverage(winding, metaC.x >= 0.5);

  let sampledSource = heprSamplePdfGradient(local, sourceGradientIndex, gradientMetaA, gradientMetaB, gradientMetaC, gradientMetaD, gradientMetaE, gradientLut, gradientMetaWidth);
  let source = select(sampledSource, meshColor * sampledSource.a, useMesh > 0.5);
  let mask = heprSamplePdfGradient(local, maskGradientIndex, gradientMetaA, gradientMetaB, gradientMetaC, gradientMetaD, gradientMetaE, gradientLut, gradientMetaWidth);
  let solidColor = vec3<f32>(metaB.z, metaB.w, metaC.z);
  let sourceColor = select(solidColor, source.rgb, sourceGradientIndex >= -0.5);
  let resolvedColor = mix(sourceColor, primitiveColor.rgb, primitiveColor.a);
  let mixAmount = clamp(vectorOverride.a, 0.0, 1.0);
  let color = resolvedColor * (1.0 - mixAmount) + vectorOverride.rgb * mixAmount;
  let alpha = coverage * mix(metaC.w, 1.0, shapeOnly) * source.a * mix(mask.a, 1.0, shapeOnly);
  if (alpha <= 0.001) { discard; }
  return vec4<f32>(heprThreeOutputColor(color), alpha);
}
`,[W(Sn),W(Cn),W(wn)]),Pn=e.wgslFn(me),Fn=e.wgslFn(b),In=e.wgslFn(`
fn heprGradientStrokeWorldPack(
  corner: vec2<f32>, primitiveA: vec4<f32>, primitiveB: vec4<f32>, style: vec4<f32>,
  primitiveBounds: vec4<f32>, zoom: f32, useLocalToClip: f32,
  localUnitsPerPixelInput: f32, aaScreenPx: f32, minimumStrokeWidthPx: f32, shapeOnly: f32
) -> vec4<f32> {
  let isQuadratic = primitiveB.z >= 0.5;
  var halfWidth = style.x;
  let styleFlags = floor(primitiveB.w / 2.0 + 0.000001);
  let alpha = primitiveB.w - styleFlags * 2.0;
  let isHairline = heprGradientFloatMod(styleFlags, 2.0) >= 0.5;
  let isRoundCap = heprGradientFloatMod(floor(styleFlags * 0.5), 2.0) >= 0.5;
  let geometryLength = select(length(primitiveB.xy - primitiveA.xy), length(primitiveA.zw - primitiveA.xy) + length(primitiveB.xy - primitiveA.zw), isQuadratic);
  if ((geometryLength == 0.0 && !isRoundCap) || (alpha <= 0.001 && shapeOnly < 0.5)) {
    return vec4<f32>(-2.0, -2.0, 0.0, 0.0);
  }
  let localUnitsPerPixel = select(1.0 / max(zoom, 0.0001), max(localUnitsPerPixelInput, 0.000001), useLocalToClip >= 0.5);
  if (isHairline) { halfWidth = max(0.5 * localUnitsPerPixel, 0.00001); }
  halfWidth = heprMinimumStrokeHalfWidth(halfWidth, select(1.0 / max(zoom, 1e-12), localUnitsPerPixel, useLocalToClip >= 0.5), minimumStrokeWidthPx);
  var aaWorld = max(localUnitsPerPixel, 0.0001) * aaScreenPx;
  if (isHairline) { aaWorld = max(0.35 * localUnitsPerPixel, 0.00005); }
  let extent = halfWidth + max(aaWorld, localUnitsPerPixel);
  let world = heprStrokeQuadWorldPosition(corner * 0.5 + vec2<f32>(0.5), primitiveA.xy, primitiveA.zw, primitiveB.xy, primitiveBounds, extent);
  return vec4<f32>(world, halfWidth, aaWorld);
}
`,[W(yn),W(Pn),W(Fn)]),Ln=R(`
fn heprGradientStrokeFragment(
  local: vec2<f32>, primitiveA: vec4<f32>, primitiveB: vec4<f32>, style: vec4<f32>,
  primitiveBounds: vec4<f32>, halfWidthFromVertex: f32, strokeCurveEnabled: f32,
  aaScreenPx: f32, vectorOverride: vec4<f32>, primitiveColor: vec4<f32>,
  gradientMetaA: texture_2d<f32>, gradientMetaB: texture_2d<f32>,
  gradientMetaC: texture_2d<f32>, gradientMetaD: texture_2d<f32>,
  gradientMetaE: texture_2d<f32>, gradientLut: texture_2d<f32>, gradientMetaWidth: f32,
  sourceGradientIndex: f32, maskGradientIndex: f32, minimumStrokeWidthPx: f32, shapeOnly: f32
) -> vec4<f32> {
  let pixelDx = dpdx(local);
  let pixelDy = dpdy(local);
  
  let pixelToLocalX = length(vec2<f32>(pixelDx.x, pixelDy.x));
  let pixelToLocalY = length(vec2<f32>(pixelDx.y, pixelDy.y));
  let styleFlags = floor(primitiveB.w / 2.0 + 0.000001);
  let alphaStyle = primitiveB.w - styleFlags * 2.0;
  if (alphaStyle <= 0.001 && shapeOnly < 0.5) { discard; }
  let hasClipBounds = heprGradientFloatMod(floor(styleFlags * 0.25), 2.0) >= 0.5;
  if (hasClipBounds && (local.x < primitiveBounds.x || local.y < primitiveBounds.y || local.x > primitiveBounds.z || local.y > primitiveBounds.w)) { discard; }
  let localPerPixel = max(max(pixelToLocalX, pixelToLocalY), 0.000001);
  let isHairline = heprGradientFloatMod(styleFlags, 2.0) >= 0.5;
  let halfWidth = heprMinimumStrokeHalfWidth(select(halfWidthFromVertex, max(0.5 * localPerPixel, 0.00001), isHairline), localPerPixel, minimumStrokeWidthPx);
  let aaWorld = max(localPerPixel * aaScreenPx, 0.00005);
  var coverage: f32;
  if (strokeCurveEnabled >= 0.5 && primitiveB.z >= 0.5) {
    coverage = heprStrokeCoverage(heprDistanceToQuadraticBezier(local, primitiveA.xy, primitiveA.zw, primitiveB.xy), halfWidth, aaWorld);
  } else {
    coverage = heprLinearStrokeCoverage(local, primitiveA.xy, primitiveB.xy, halfWidth, pixelDx, pixelDy, 1.0);
  }
  let source = heprSamplePdfGradient(local, sourceGradientIndex, gradientMetaA, gradientMetaB, gradientMetaC, gradientMetaD, gradientMetaE, gradientLut, gradientMetaWidth);
  let mask = heprSamplePdfGradient(local, maskGradientIndex, gradientMetaA, gradientMetaB, gradientMetaC, gradientMetaD, gradientMetaE, gradientLut, gradientMetaWidth);
  let sourceColor = select(style.yzw, source.rgb, sourceGradientIndex >= -0.5);
  let resolvedColor = mix(sourceColor, primitiveColor.rgb, primitiveColor.a);
  let mixAmount = clamp(vectorOverride.a, 0.0, 1.0);
  let color = resolvedColor * (1.0 - mixAmount) + vectorOverride.rgb * mixAmount;
  let alpha = coverage * mix(alphaStyle, 1.0, shapeOnly) * source.a * mix(mask.a, 1.0, shapeOnly);
  if (alpha <= 0.001) { discard; }
  return vec4<f32>(heprThreeOutputColor(color), alpha);
}
`,[W(yn),W(An),W(st),W(Fn),W(jn),W(Mn),W(Sn)]);function Rn(t){let n=Vn(),r=F(t.localToClip,t.pageBinding),a=e.uniform(0);N(n,a);let o=e.uniform(1),s=e.uniform(0),c=e.uniform(Math.max(1,t.fillPathTextureWidth)),l=e.uniform(Math.max(1,t.fillSegmentTextureWidth)),u=e.uniform(Math.max(1,t.gradientMetaTextureWidth)),d=e.attribute(`aFillPathIndex`,`float`),f=G(vn,{index:d,width:c}),p=K(e.textureLoad(t.fillPathMetaTextureA,f,0),!0),m=K(e.textureLoad(t.fillPathMetaTextureB,f,0),!0),h=K(e.textureLoad(t.fillPathMetaTextureC,f,0),!0),g=K(G(gn,{pathIndex:d,base:e.uniform(t.fillBandBase??-1),segments:e.textureLoad(t.fillSegmentTextureA)}),!0),_=K(G(_n,{pathIndex:d,headers:e.uniform((t.fillCellBase??-1)+1),segments:e.textureLoad(t.fillSegmentTextureA)}),!0),v=e.uniform(t.viewport),y=r.matrix,b=K(t.mesh?e.vec4(e.attribute(`aMeshPosition`,`vec2`),1,0):G(Dn,{corner:e.attribute(`aCorner`,`vec2`),metaA:p,metaB:m,metaC:h,clipBounds:e.uniform(t.clipBounds??new P().fromArray(i)),shapeOnly:a,viewport:v,zoom:o,useLocalToClip:s,localToClip:y})),x=b;return n.vertexNode=G(On,{vertexPack:b,viewport:v,cameraCenter:e.uniform(t.cameraCenter),zoom:o,useLocalToClip:s,localToClip:y}),r.finish(n),n.fragmentNode=G(Nn[t.colorCompositing],{local:x.xy,metaA:p,metaB:m,metaC:h,segmentTexA:e.textureLoad(t.fillSegmentTextureA),segmentTexB:e.textureLoad(t.fillSegmentTextureB),segmentTexWidth:l,bands:g,bandEntries:e.uniform(t.fillBandEntries??0),cells:_,...Bn(t,u),fillAAScreenPx:e.uniform(1),meshColor:t.mesh?K(e.attribute(`aMeshColor`,`vec4`)):e.vec4(0),useMesh:e.uniform(+!!t.mesh),shapeOnly:a,vectorOverride:e.uniform(t.vectorOverride),primitiveColor:e.uniform(t.primitiveColor)}),L(n,x.xy,`straight-alpha`),{material:n,zoomUniform:o,useLocalToClipUniform:s}}function zn(t){let n=Vn(),r=F(t.localToClip,t.pageBinding),i=e.uniform(0);N(n,i);let a=e.uniform(1),o=e.uniform(0),s=e.uniform(1),c=e.uniform(+!!t.strokeCurveEnabled),l=e.uniform(0),u=e.uniform(Math.max(1,t.segmentTextureWidth)),d=e.uniform(Math.max(1,t.gradientMetaTextureWidth)),f=G(vn,{index:e.attribute(`aSegmentIndex`,`float`),width:u}),p=K(e.textureLoad(t.segmentTextureA,f,0),!0),m=K(e.textureLoad(t.segmentTextureB,f,0),!0),h=K(e.textureLoad(t.segmentStyleTexture,f,0),!0),g=K(e.textureLoad(t.segmentBoundsTexture,f,0),!0),_=K(G(In,{corner:e.attribute(`aCorner`,`vec2`),primitiveA:p,primitiveB:m,style:h,primitiveBounds:g,zoom:a,useLocalToClip:o,localUnitsPerPixelInput:r.units??s,aaScreenPx:e.uniform(1),minimumStrokeWidthPx:l,shapeOnly:i})),v=_;return n.vertexNode=G(kn,{worldPack:_,viewport:e.uniform(t.viewport),cameraCenter:e.uniform(t.cameraCenter),zoom:a,useLocalToClip:o,localToClip:r.matrix}),r.finish(n),n.fragmentNode=G(Ln[t.colorCompositing],{local:v.xy,primitiveA:p,primitiveB:m,style:h,primitiveBounds:g,shapeOnly:i,halfWidthFromVertex:v.z,strokeCurveEnabled:c,minimumStrokeWidthPx:l,aaScreenPx:e.uniform(1),vectorOverride:e.uniform(t.vectorOverride),primitiveColor:e.uniform(t.primitiveColor),...Bn(t,d)}),L(n,v.xy,`straight-alpha`),{material:n,zoomUniform:a,useLocalToClipUniform:o,localUnitsPerPixelUniform:s,curveUniform:c,minimumStrokeWidthUniform:l}}function Bn(t,n){return{gradientMetaA:e.textureLoad(t.gradientMetaTextureA),gradientMetaB:e.textureLoad(t.gradientMetaTextureB),gradientMetaC:e.textureLoad(t.gradientMetaTextureC),gradientMetaD:e.textureLoad(t.gradientMetaTextureD),gradientMetaE:e.textureLoad(t.gradientMetaTextureE),gradientLut:e.textureLoad(t.gradientLutTexture),gradientMetaWidth:n,sourceGradientIndex:e.uniform(t.sourceGradientIndex),maskGradientIndex:e.uniform(t.maskGradientIndex)}}function Vn(){let e=new t;return e.transparent=!1,e.depthTest=!1,e.depthWrite=!1,e.side=2,e.toneMapped=!1,e.fog=!1,e.lights=!1,de(e),e}var Hn=e.wgslFn(j),Un=e.wgslFn(g,[Hn]),Wn=e.wgslFn(ee,[Hn,Un]),Gn=e.wgslFn(w),Kn=e.wgslFn(h),qn=R(`
fn heprThreePrimitiveHighlight(point:vec2<f32>,a:vec4<f32>,b:vec4<f32>,index:f32,
  pixelRatio:f32,selectionCount:f32,clipTexture:texture_2d<f32>) -> vec4<f32> {
  let alpha=heprPrimitiveHighlightCoverage(point,a,b,pixelRatio)*heprVectorClip(point,b.w,clipTexture);
  if (alpha<=0.001) { discard; }
  let color=select(vec3<f32>(${C.join(`,`)}),
    vec3<f32>(${S.join(`,`)}),index<selectionCount);
  return vec4<f32>(heprThreeOutputColor(color),alpha);
}`,[Wn,Kn]);function Jn(e,t){return e(t)}function Yn(n){let r=e.uniform(1),i=e.uniform(1),a=e.uniform(0),o=new t,s=e.varying(e.attribute(`aSegmentA`,`vec4`)),c=e.varying(e.attribute(`aSegmentB`,`vec4`)),l=e.varying(Jn(Gn,{corner:e.attribute(`aCorner`,`vec2`),a:s,b:c,localUnitsPerPixel:r,pixelRatio:i}));return o.vertexNode=e.mul(e.uniform(n.matrix),e.vec4(l,0,1)),o.fragmentNode=Jn(qn[n.colorCompositing],{point:l,a:s,b:c,index:e.varying(e.attribute(`aHighlightIndex`,`float`)),pixelRatio:i,selectionCount:a,clipTexture:e.textureLoad(n.clips)}),o.depthTest=o.depthWrite=!1,o.side=2,o.toneMapped=!1,{material:o,units:r,pixelRatio:i,selectionCount:a}}function Xn(e,t){return e(t)}function Zn(e,t){let n=e;return n.name=t,n.getUniformHash=()=>`hepr-composite-${t}`,e}var Qn=e.wgslFn(`
fn heprComposite(source:vec4f, shape:vec4f, current:vec4f, stats:vec4f, initial:vec4f,
  mask:vec4f, transferTex:texture_2d<f32>, p:vec4f, q:vec4f, backdrop:vec3f) -> vec4f {
  if (p.x==4.0) {
    var value=source.a;
    if (q.y>0.5) { value=pdfLum(source.rgb+(1.0-source.a)*backdrop); }
    value=clamp(value,0.0,1.0);
    if (q.z>1.0) {
      let at=value*(q.z-1.0); let first=i32(floor(at));
      let width=i32(textureDimensions(transferTex).x); let next=min(first+1,i32(q.z)-1);
      value=mix(textureLoad(transferTex,vec2i(first%width,first/width),0).r,
        textureLoad(transferTex,vec2i(next%width,next/width),0).r,fract(at));
    }
    return vec4f(value);
  }
  return pdfCompositePass(source,shape,current,stats,initial,mask,p,q);
}`,[e.wgslFn(x(`wgsl`))]),$n=e.wgslFn(`
fn heprPresentComposite(color:vec4f) -> vec4f {
  return vec4f(color.rgb/max(color.a,0.0000001),color.a);
}`);function er(n){let r=[`uSource`,`uShape`,`uCurrent`,`uStats`,`uInitial`,`uMask`,`uTransfer`],i=new t,a=r.slice(0,6).map(t=>{let r=e.textureLoad(n.zero,e.screenCoordinate),i=e.vec2(e.textureSize(r));return r.uvNode=e.clamp(e.screenCoordinate,e.vec2(0),i.sub(1)),Zn(r,t)});n.bindings.push(...a);let o=e.uniform(n.passRect);i.vertexNode=e.vec4(e.mix(o.xy,o.zw,e.positionLocal.xy),0,1);let s=Zn(e.textureLoad(n.zero),r[6]);n.bindings.push(s),i.fragmentNode=Xn(Qn,{source:a[0],shape:a[1],current:a[2],stats:a[3],initial:a[4],mask:a[5],transferTex:s,p:e.uniform(n.params),q:e.uniform(n.extra),backdrop:e.uniform(n.backdropColor)});let c=new t;c.vertexNode=Xn(e.wgslFn(`fn heprPagePresentPosition(position: vec3f, depth: vec3f) -> vec4f {
    return vec4f(position.xy, dot(depth, vec3f(position.xy, 1.0)), 1.0);
  }`),{position:e.positionLocal,depth:e.uniform(n.pageDepth)});let l=e.texture(n.presentZero,e.uv().flipY());return c.fragmentNode=Xn($n,{color:l}),{passMaterial:i,presentationBinding:l,mesh:new ae(n.geometry,c)}}var tr=2e3,nr={};function rr(e){let t=e[0];if(typeof t==`string`&&t.startsWith(`TSL:`)){let t=e[1];t&&t.isStackTrace?e[0]+=` `+t.getLocation():e[1]=`Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.`}return e}function ir(...e){e=rr(e);let t=`THREE.`+e.shift();{let n=e[0];n&&n.isStackTrace?console.warn(n.getError(t)):console.warn(t,...e)}}function ar(...e){let t=e.join(` `);t in nr||(nr[t]=!0,ir(...e))}var or=class e{static{e.prototype.isMatrix3=!0}constructor(e,t,n,r,i,a,o,s,c){this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,r,i,a,o,s,c)}set(e,t,n,r,i,a,o,s,c){let l=this.elements;return l[0]=e,l[1]=r,l[2]=o,l[3]=t,l[4]=i,l[5]=s,l[6]=n,l[7]=a,l[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,r=t.elements,i=this.elements,a=n[0],o=n[3],s=n[6],c=n[1],l=n[4],u=n[7],d=n[2],f=n[5],p=n[8],m=r[0],h=r[3],g=r[6],_=r[1],v=r[4],y=r[7],b=r[2],x=r[5],S=r[8];return i[0]=a*m+o*_+s*b,i[3]=a*h+o*v+s*x,i[6]=a*g+o*y+s*S,i[1]=c*m+l*_+u*b,i[4]=c*h+l*v+u*x,i[7]=c*g+l*y+u*S,i[2]=d*m+f*_+p*b,i[5]=d*h+f*v+p*x,i[8]=d*g+f*y+p*S,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=e[6],c=e[7],l=e[8];return t*a*l-t*o*c-n*i*l+n*o*s+r*i*c-r*a*s}invert(){let e=this.elements,t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=e[6],c=e[7],l=e[8],u=l*a-o*c,d=o*s-l*i,f=c*i-a*s,p=t*u+n*d+r*f;if(p===0)return this.set(0,0,0,0,0,0,0,0,0);let m=1/p;return e[0]=u*m,e[1]=(r*c-l*n)*m,e[2]=(o*n-r*a)*m,e[3]=d*m,e[4]=(l*t-r*s)*m,e[5]=(r*i-o*t)*m,e[6]=f*m,e[7]=(n*s-c*t)*m,e[8]=(a*t-n*i)*m,this}transpose(){let e,t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,r,i,a,o){let s=Math.cos(i),c=Math.sin(i);return this.set(n*s,n*c,-n*(s*a+c*o)+a+e,-r*c,r*s,-r*(-c*a+s*o)+o+t,0,0,1),this}scale(e,t){return ar(`Matrix3: .scale() is deprecated. Use .makeScale() instead.`),this.premultiply(sr.makeScale(e,t)),this}rotate(e){return ar(`Matrix3: .rotate() is deprecated. Use .makeRotation() instead.`),this.premultiply(sr.makeRotation(-e)),this}translate(e,t){return ar(`Matrix3: .translate() is deprecated. Use .makeTranslation() instead.`),this.premultiply(sr.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){let t=this.elements,n=e.elements;for(let e=0;e<9;e++)if(t[e]!==n[e])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}},sr=new or;function q(e,t,n){return Math.max(t,Math.min(n,e))}var cr=class{constructor(e=0,t=0,n=0,r=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=r}static slerpFlat(e,t,n,r,i,a,o){let s=n[r+0],c=n[r+1],l=n[r+2],u=n[r+3],d=i[a+0],f=i[a+1],p=i[a+2],m=i[a+3];if(u!==m||s!==d||c!==f||l!==p){let e=s*d+c*f+l*p+u*m;e<0&&(d=-d,f=-f,p=-p,m=-m,e=-e);let t=1-o;if(e<.9995){let n=Math.acos(e),r=Math.sin(n);t=Math.sin(t*n)/r,o=Math.sin(o*n)/r,s=s*t+d*o,c=c*t+f*o,l=l*t+p*o,u=u*t+m*o}else{s=s*t+d*o,c=c*t+f*o,l=l*t+p*o,u=u*t+m*o;let e=1/Math.sqrt(s*s+c*c+l*l+u*u);s*=e,c*=e,l*=e,u*=e}}e[t]=s,e[t+1]=c,e[t+2]=l,e[t+3]=u}static multiplyQuaternionsFlat(e,t,n,r,i,a){let o=n[r],s=n[r+1],c=n[r+2],l=n[r+3],u=i[a],d=i[a+1],f=i[a+2],p=i[a+3];return e[t]=o*p+l*u+s*f-c*d,e[t+1]=s*p+l*d+c*u-o*f,e[t+2]=c*p+l*f+o*d-s*u,e[t+3]=l*p-o*u-s*d-c*f,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,r){return this._x=e,this._y=t,this._z=n,this._w=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let n=e._x,r=e._y,i=e._z,a=e._order,o=Math.cos,s=Math.sin,c=o(n/2),l=o(r/2),u=o(i/2),d=s(n/2),f=s(r/2),p=s(i/2);switch(a){case`XYZ`:this._x=d*l*u+c*f*p,this._y=c*f*u-d*l*p,this._z=c*l*p+d*f*u,this._w=c*l*u-d*f*p;break;case`YXZ`:this._x=d*l*u+c*f*p,this._y=c*f*u-d*l*p,this._z=c*l*p-d*f*u,this._w=c*l*u+d*f*p;break;case`ZXY`:this._x=d*l*u-c*f*p,this._y=c*f*u+d*l*p,this._z=c*l*p+d*f*u,this._w=c*l*u-d*f*p;break;case`ZYX`:this._x=d*l*u-c*f*p,this._y=c*f*u+d*l*p,this._z=c*l*p-d*f*u,this._w=c*l*u+d*f*p;break;case`YZX`:this._x=d*l*u+c*f*p,this._y=c*f*u+d*l*p,this._z=c*l*p-d*f*u,this._w=c*l*u-d*f*p;break;case`XZY`:this._x=d*l*u-c*f*p,this._y=c*f*u-d*l*p,this._z=c*l*p+d*f*u,this._w=c*l*u+d*f*p;break;default:ir(`Quaternion: .setFromEuler() encountered an unknown order: `+a)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let n=t/2,r=Math.sin(n);return this._x=e.x*r,this._y=e.y*r,this._z=e.z*r,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,n=t[0],r=t[4],i=t[8],a=t[1],o=t[5],s=t[9],c=t[2],l=t[6],u=t[10],d=n+o+u;if(d>0){let e=.5/Math.sqrt(d+1);this._w=.25/e,this._x=(l-s)*e,this._y=(i-c)*e,this._z=(a-r)*e}else if(n>o&&n>u){let e=2*Math.sqrt(1+n-o-u);this._w=(l-s)/e,this._x=.25*e,this._y=(r+a)/e,this._z=(i+c)/e}else if(o>u){let e=2*Math.sqrt(1+o-n-u);this._w=(i-c)/e,this._x=(r+a)/e,this._y=.25*e,this._z=(s+l)/e}else{let e=2*Math.sqrt(1+u-n-o);this._w=(a-r)/e,this._x=(i+c)/e,this._y=(s+l)/e,this._z=.25*e}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<1e-8?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(q(this.dot(e),-1,1)))}rotateTowards(e,t){let n=this.angleTo(e);if(n===0)return this;let r=Math.min(1,t/n);return this.slerp(e,r),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x*=e,this._y*=e,this._z*=e,this._w*=e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let n=e._x,r=e._y,i=e._z,a=e._w,o=t._x,s=t._y,c=t._z,l=t._w;return this._x=n*l+a*o+r*c-i*s,this._y=r*l+a*s+i*o-n*c,this._z=i*l+a*c+n*s-r*o,this._w=a*l-n*o-r*s-i*c,this._onChangeCallback(),this}slerp(e,t){let n=e._x,r=e._y,i=e._z,a=e._w,o=this.dot(e);o<0&&(n=-n,r=-r,i=-i,a=-a,o=-o);let s=1-t;if(o<.9995){let e=Math.acos(o),c=Math.sin(e);s=Math.sin(s*e)/c,t=Math.sin(t*e)/c,this._x=this._x*s+n*t,this._y=this._y*s+r*t,this._z=this._z*s+i*t,this._w=this._w*s+a*t,this._onChangeCallback()}else this._x=this._x*s+n*t,this._y=this._y*s+r*t,this._z=this._z*s+i*t,this._w=this._w*s+a*t,this.normalize();return this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){let e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),r=Math.sqrt(1-n),i=Math.sqrt(n);return this.set(r*Math.sin(e),r*Math.cos(e),i*Math.sin(t),i*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},J=class e{static{e.prototype.isVector3=!0}constructor(e=0,t=0,n=0){this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw Error(`THREE.Vector3: index is out of range: `+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw Error(`THREE.Vector3: index is out of range: `+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(ur.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(ur.setFromAxisAngle(e,t))}applyMatrix3(e){let t=this.x,n=this.y,r=this.z,i=e.elements;return this.x=i[0]*t+i[3]*n+i[6]*r,this.y=i[1]*t+i[4]*n+i[7]*r,this.z=i[2]*t+i[5]*n+i[8]*r,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let t=this.x,n=this.y,r=this.z,i=e.elements,a=1/(i[3]*t+i[7]*n+i[11]*r+i[15]);return this.x=(i[0]*t+i[4]*n+i[8]*r+i[12])*a,this.y=(i[1]*t+i[5]*n+i[9]*r+i[13])*a,this.z=(i[2]*t+i[6]*n+i[10]*r+i[14])*a,this}applyQuaternion(e){let t=this.x,n=this.y,r=this.z,i=e.x,a=e.y,o=e.z,s=e.w,c=2*(a*r-o*n),l=2*(o*t-i*r),u=2*(i*n-a*t);return this.x=t+s*c+a*u-o*l,this.y=n+s*l+o*c-i*u,this.z=r+s*u+i*l-a*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let t=this.x,n=this.y,r=this.z,i=e.elements;return this.x=i[0]*t+i[4]*n+i[8]*r,this.y=i[1]*t+i[5]*n+i[9]*r,this.z=i[2]*t+i[6]*n+i[10]*r,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=q(this.x,e.x,t.x),this.y=q(this.y,e.y,t.y),this.z=q(this.z,e.z,t.z),this}clampScalar(e,t){return this.x=q(this.x,e,t),this.y=q(this.y,e,t),this.z=q(this.z,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(q(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){let n=e.x,r=e.y,i=e.z,a=t.x,o=t.y,s=t.z;return this.x=r*s-i*o,this.y=i*a-n*s,this.z=n*o-r*a,this}projectOnVector(e){let t=e.lengthSq();if(t===0)return this.set(0,0,0);let n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return lr.copy(this).projectOnVector(e),this.sub(lr)}reflect(e){return this.sub(lr.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(q(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y,r=this.z-e.z;return t*t+n*n+r*r}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){let r=Math.sin(t)*e;return this.x=r*Math.sin(n),this.y=Math.cos(t)*e,this.z=r*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){let t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),r=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=r,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},lr=new J,ur=new cr,dr=class e{static{e.prototype.isMatrix4=!0}constructor(e,t,n,r,i,a,o,s,c,l,u,d,f,p,m,h){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,r,i,a,o,s,c,l,u,d,f,p,m,h)}set(e,t,n,r,i,a,o,s,c,l,u,d,f,p,m,h){let g=this.elements;return g[0]=e,g[4]=t,g[8]=n,g[12]=r,g[1]=i,g[5]=a,g[9]=o,g[13]=s,g[2]=c,g[6]=l,g[10]=u,g[14]=d,g[3]=f,g[7]=p,g[11]=m,g[15]=h,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new e().fromArray(this.elements)}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){let t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){let t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return this.determinantAffine()===0?(e.set(1,0,0),t.set(0,1,0),n.set(0,0,1),this):(e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this)}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){if(e.determinantAffine()===0)return this.identity();let t=this.elements,n=e.elements,r=1/fr.setFromMatrixColumn(e,0).length(),i=1/fr.setFromMatrixColumn(e,1).length(),a=1/fr.setFromMatrixColumn(e,2).length();return t[0]=n[0]*r,t[1]=n[1]*r,t[2]=n[2]*r,t[3]=0,t[4]=n[4]*i,t[5]=n[5]*i,t[6]=n[6]*i,t[7]=0,t[8]=n[8]*a,t[9]=n[9]*a,t[10]=n[10]*a,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){let t=this.elements,n=e.x,r=e.y,i=e.z,a=Math.cos(n),o=Math.sin(n),s=Math.cos(r),c=Math.sin(r),l=Math.cos(i),u=Math.sin(i);if(e.order===`XYZ`){let e=a*l,n=a*u,r=o*l,i=o*u;t[0]=s*l,t[4]=-s*u,t[8]=c,t[1]=n+r*c,t[5]=e-i*c,t[9]=-o*s,t[2]=i-e*c,t[6]=r+n*c,t[10]=a*s}else if(e.order===`YXZ`){let e=s*l,n=s*u,r=c*l,i=c*u;t[0]=e+i*o,t[4]=r*o-n,t[8]=a*c,t[1]=a*u,t[5]=a*l,t[9]=-o,t[2]=n*o-r,t[6]=i+e*o,t[10]=a*s}else if(e.order===`ZXY`){let e=s*l,n=s*u,r=c*l,i=c*u;t[0]=e-i*o,t[4]=-a*u,t[8]=r+n*o,t[1]=n+r*o,t[5]=a*l,t[9]=i-e*o,t[2]=-a*c,t[6]=o,t[10]=a*s}else if(e.order===`ZYX`){let e=a*l,n=a*u,r=o*l,i=o*u;t[0]=s*l,t[4]=r*c-n,t[8]=e*c+i,t[1]=s*u,t[5]=i*c+e,t[9]=n*c-r,t[2]=-c,t[6]=o*s,t[10]=a*s}else if(e.order===`YZX`){let e=a*s,n=a*c,r=o*s,i=o*c;t[0]=s*l,t[4]=i-e*u,t[8]=r*u+n,t[1]=u,t[5]=a*l,t[9]=-o*l,t[2]=-c*l,t[6]=n*u+r,t[10]=e-i*u}else if(e.order===`XZY`){let e=a*s,n=a*c,r=o*s,i=o*c;t[0]=s*l,t[4]=-u,t[8]=c*l,t[1]=e*u+i,t[5]=a*l,t[9]=n*u-r,t[2]=r*u-n,t[6]=o*l,t[10]=i*u+e}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(pr,e,mr)}lookAt(e,t,n){let r=this.elements;return Z.subVectors(e,t),Z.lengthSq()===0&&(Z.z=1),Z.normalize(),X.crossVectors(n,Z),X.lengthSq()===0&&(Math.abs(n.z)===1?Z.x+=1e-4:Z.z+=1e-4,Z.normalize(),X.crossVectors(n,Z)),X.normalize(),hr.crossVectors(Z,X),r[0]=X.x,r[4]=hr.x,r[8]=Z.x,r[1]=X.y,r[5]=hr.y,r[9]=Z.y,r[2]=X.z,r[6]=hr.z,r[10]=Z.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,r=t.elements,i=this.elements,a=n[0],o=n[4],s=n[8],c=n[12],l=n[1],u=n[5],d=n[9],f=n[13],p=n[2],m=n[6],h=n[10],g=n[14],_=n[3],v=n[7],y=n[11],b=n[15],x=r[0],S=r[4],C=r[8],w=r[12],T=r[1],E=r[5],D=r[9],O=r[13],k=r[2],A=r[6],j=r[10],M=r[14],ee=r[3],te=r[7],ne=r[11],re=r[15];return i[0]=a*x+o*T+s*k+c*ee,i[4]=a*S+o*E+s*A+c*te,i[8]=a*C+o*D+s*j+c*ne,i[12]=a*w+o*O+s*M+c*re,i[1]=l*x+u*T+d*k+f*ee,i[5]=l*S+u*E+d*A+f*te,i[9]=l*C+u*D+d*j+f*ne,i[13]=l*w+u*O+d*M+f*re,i[2]=p*x+m*T+h*k+g*ee,i[6]=p*S+m*E+h*A+g*te,i[10]=p*C+m*D+h*j+g*ne,i[14]=p*w+m*O+h*M+g*re,i[3]=_*x+v*T+y*k+b*ee,i[7]=_*S+v*E+y*A+b*te,i[11]=_*C+v*D+y*j+b*ne,i[15]=_*w+v*O+y*M+b*re,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[4],r=e[8],i=e[12],a=e[1],o=e[5],s=e[9],c=e[13],l=e[2],u=e[6],d=e[10],f=e[14],p=e[3],m=e[7],h=e[11],g=e[15],_=s*f-c*d,v=o*f-c*u,y=o*d-s*u,b=a*f-c*l,x=a*d-s*l,S=a*u-o*l;return t*(m*_-h*v+g*y)-n*(p*_-h*b+g*x)+r*(p*v-m*b+g*S)-i*(p*y-m*x+h*S)}determinantAffine(){let e=this.elements,t=e[0],n=e[4],r=e[8],i=e[1],a=e[5],o=e[9],s=e[2],c=e[6],l=e[10];return t*(a*l-o*c)-n*(i*l-o*s)+r*(i*c-a*s)}transpose(){let e=this.elements,t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){let r=this.elements;return e.isVector3?(r[12]=e.x,r[13]=e.y,r[14]=e.z):(r[12]=e,r[13]=t,r[14]=n),this}invert(){let e=this.elements,t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=e[6],c=e[7],l=e[8],u=e[9],d=e[10],f=e[11],p=e[12],m=e[13],h=e[14],g=e[15],_=t*o-n*a,v=t*s-r*a,y=t*c-i*a,b=n*s-r*o,x=n*c-i*o,S=r*c-i*s,C=l*m-u*p,w=l*h-d*p,T=l*g-f*p,E=u*h-d*m,D=u*g-f*m,O=d*g-f*h,k=_*O-v*D+y*E+b*T-x*w+S*C;if(k===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let A=1/k;return e[0]=(o*O-s*D+c*E)*A,e[1]=(r*D-n*O-i*E)*A,e[2]=(m*S-h*x+g*b)*A,e[3]=(d*x-u*S-f*b)*A,e[4]=(s*T-a*O-c*w)*A,e[5]=(t*O-r*T+i*w)*A,e[6]=(h*y-p*S-g*v)*A,e[7]=(l*S-d*y+f*v)*A,e[8]=(a*D-o*T+c*C)*A,e[9]=(n*T-t*D-i*C)*A,e[10]=(p*x-m*y+g*_)*A,e[11]=(u*y-l*x-f*_)*A,e[12]=(o*w-a*E-s*C)*A,e[13]=(t*E-n*w+r*C)*A,e[14]=(m*v-p*b-h*_)*A,e[15]=(l*b-u*v+d*_)*A,this}scale(e){let t=this.elements,n=e.x,r=e.y,i=e.z;return t[0]*=n,t[4]*=r,t[8]*=i,t[1]*=n,t[5]*=r,t[9]*=i,t[2]*=n,t[6]*=r,t[10]*=i,t[3]*=n,t[7]*=r,t[11]*=i,this}getMaxScaleOnAxis(){let e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],r=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,r))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){let t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){let n=Math.cos(t),r=Math.sin(t),i=1-n,a=e.x,o=e.y,s=e.z,c=i*a,l=i*o;return this.set(c*a+n,c*o-r*s,c*s+r*o,0,c*o+r*s,l*o+n,l*s-r*a,0,c*s-r*o,l*s+r*a,i*s*s+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,r,i,a){return this.set(1,n,i,0,e,1,a,0,t,r,1,0,0,0,0,1),this}compose(e,t,n){let r=this.elements,i=t._x,a=t._y,o=t._z,s=t._w,c=i+i,l=a+a,u=o+o,d=i*c,f=i*l,p=i*u,m=a*l,h=a*u,g=o*u,_=s*c,v=s*l,y=s*u,b=n.x,x=n.y,S=n.z;return r[0]=(1-(m+g))*b,r[1]=(f+y)*b,r[2]=(p-v)*b,r[3]=0,r[4]=(f-y)*x,r[5]=(1-(d+g))*x,r[6]=(h+_)*x,r[7]=0,r[8]=(p+v)*S,r[9]=(h-_)*S,r[10]=(1-(d+m))*S,r[11]=0,r[12]=e.x,r[13]=e.y,r[14]=e.z,r[15]=1,this}decompose(e,t,n){let r=this.elements;e.x=r[12],e.y=r[13],e.z=r[14];let i=this.determinantAffine();if(i===0)return n.set(1,1,1),t.identity(),this;let a=fr.set(r[0],r[1],r[2]).length(),o=fr.set(r[4],r[5],r[6]).length(),s=fr.set(r[8],r[9],r[10]).length();i<0&&(a=-a),Y.copy(this);let c=1/a,l=1/o,u=1/s;return Y.elements[0]*=c,Y.elements[1]*=c,Y.elements[2]*=c,Y.elements[4]*=l,Y.elements[5]*=l,Y.elements[6]*=l,Y.elements[8]*=u,Y.elements[9]*=u,Y.elements[10]*=u,t.setFromRotationMatrix(Y),n.x=a,n.y=o,n.z=s,this}makePerspective(e,t,n,r,i,a,o=tr,s=!1){let c=this.elements,l=2*i/(t-e),u=2*i/(n-r),d=(t+e)/(t-e),f=(n+r)/(n-r),p,m;if(s)p=i/(a-i),m=a*i/(a-i);else if(o===2e3)p=-(a+i)/(a-i),m=-2*a*i/(a-i);else if(o===2001)p=-a/(a-i),m=-a*i/(a-i);else throw Error(`THREE.Matrix4.makePerspective(): Invalid coordinate system: `+o);return c[0]=l,c[4]=0,c[8]=d,c[12]=0,c[1]=0,c[5]=u,c[9]=f,c[13]=0,c[2]=0,c[6]=0,c[10]=p,c[14]=m,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,t,n,r,i,a,o=tr,s=!1){let c=this.elements,l=2/(t-e),u=2/(n-r),d=-(t+e)/(t-e),f=-(n+r)/(n-r),p,m;if(s)p=1/(a-i),m=a/(a-i);else if(o===2e3)p=-2/(a-i),m=-(a+i)/(a-i);else if(o===2001)p=-1/(a-i),m=-i/(a-i);else throw Error(`THREE.Matrix4.makeOrthographic(): Invalid coordinate system: `+o);return c[0]=l,c[4]=0,c[8]=0,c[12]=d,c[1]=0,c[5]=u,c[9]=0,c[13]=f,c[2]=0,c[6]=0,c[10]=p,c[14]=m,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){let t=this.elements,n=e.elements;for(let e=0;e<16;e++)if(t[e]!==n[e])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}},fr=new J,Y=new dr,pr=new J(0,0,0),mr=new J(1,1,1),X=new J,hr=new J,Z=new J,gr=new J,_r=new J,vr=new or,yr=class{constructor(e=new J(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,r){return this.normal.set(e,t,n),this.constant=r,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){let r=gr.subVectors(n,t).cross(_r.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(r,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t,n=!0){let r=e.delta(gr),i=this.normal.dot(r);if(i===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let a=-(e.start.dot(this.normal)+this.constant)/i;return n===!0&&(a<0||a>1)?null:t.copy(e.start).addScaledVector(r,a)}intersectsLine(e){let t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let n=t||vr.getNormalMatrix(e),r=this.coplanarPoint(gr).applyMatrix4(e),i=this.normal.applyMatrix3(n).normalize();return this.constant=-r.dot(i),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}toJSON(){return{normal:this.normal.toArray(),constant:this.constant}}fromJSON(e){return this.normal.fromArray(e.normal),this.constant=e.constant,this}},br=class e{static{e.prototype.isVector4=!0}constructor(e=0,t=0,n=0,r=1){this.x=e,this.y=t,this.z=n,this.w=r}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,r){return this.x=e,this.y=t,this.z=n,this.w=r,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw Error(`THREE.Vector4: index is out of range: `+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw Error(`THREE.Vector4: index is out of range: `+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w===void 0?1:e.w,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let t=this.x,n=this.y,r=this.z,i=this.w,a=e.elements;return this.x=a[0]*t+a[4]*n+a[8]*r+a[12]*i,this.y=a[1]*t+a[5]*n+a[9]*r+a[13]*i,this.z=a[2]*t+a[6]*n+a[10]*r+a[14]*i,this.w=a[3]*t+a[7]*n+a[11]*r+a[15]*i,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,r,i,a=.01,o=.1,s=e.elements,c=s[0],l=s[4],u=s[8],d=s[1],f=s[5],p=s[9],m=s[2],h=s[6],g=s[10];if(Math.abs(l-d)<a&&Math.abs(u-m)<a&&Math.abs(p-h)<a){if(Math.abs(l+d)<o&&Math.abs(u+m)<o&&Math.abs(p+h)<o&&Math.abs(c+f+g-3)<o)return this.set(1,0,0,0),this;t=Math.PI;let e=(c+1)/2,s=(f+1)/2,_=(g+1)/2,v=(l+d)/4,y=(u+m)/4,b=(p+h)/4;return e>s&&e>_?e<a?(n=0,r=.707106781,i=.707106781):(n=Math.sqrt(e),r=v/n,i=y/n):s>_?s<a?(n=.707106781,r=0,i=.707106781):(r=Math.sqrt(s),n=v/r,i=b/r):_<a?(n=.707106781,r=.707106781,i=0):(i=Math.sqrt(_),n=y/i,r=b/i),this.set(n,r,i,t),this}let _=Math.sqrt((h-p)*(h-p)+(u-m)*(u-m)+(d-l)*(d-l));return Math.abs(_)<.001&&(_=1),this.x=(h-p)/_,this.y=(u-m)/_,this.z=(d-l)/_,this.w=Math.acos((c+f+g-1)/2),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=q(this.x,e.x,t.x),this.y=q(this.y,e.y,t.y),this.z=q(this.z,e.z,t.z),this.w=q(this.w,e.w,t.w),this}clampScalar(e,t){return this.x=q(this.x,e,t),this.y=q(this.y,e,t),this.z=q(this.z,e,t),this.w=q(this.w,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(q(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},xr=new yr,Sr=0,Cr=class e{constructor(e=null){this.id=Sr++,this.version=0,this.clipIntersection=null,this.cacheKey=``,this.shadowPass=!1,this.viewMatrix=new dr,this.viewNormalMatrix=new or,this.clippingGroupContexts=new WeakMap,this.intersectionPlanes=[],this.unionPlanes=[],this.parentVersion=null,e!==null&&(this.viewMatrix=e.viewMatrix,this.viewNormalMatrix=e.viewNormalMatrix,this.clippingGroupContexts=e.clippingGroupContexts,this.shadowPass=e.shadowPass)}projectPlanes(e,t,n){let r=e.length;for(let i=0;i<r;i++){xr.copy(e[i]).applyMatrix4(this.viewMatrix,this.viewNormalMatrix);let r=t[n+i],a=xr.normal;r.x=-a.x,r.y=-a.y,r.z=-a.z,r.w=xr.constant}}updateGlobal(e,t){this.shadowPass=e.overrideMaterial!==null&&e.overrideMaterial.isShadowPassMaterial,this.viewMatrix.copy(t.matrixWorldInverse),this.viewNormalMatrix.getNormalMatrix(this.viewMatrix)}update(e,t){let n=!1;e.version!==this.parentVersion&&(this.intersectionPlanes=Array.from(e.intersectionPlanes),this.unionPlanes=Array.from(e.unionPlanes),this.parentVersion=e.version),this.clipIntersection!==t.clipIntersection&&(this.clipIntersection=t.clipIntersection,this.clipIntersection?this.unionPlanes.length=e.unionPlanes.length:this.intersectionPlanes.length=e.intersectionPlanes.length);let r=t.clippingPlanes,i=r.length,a,o;if(this.clipIntersection?(a=this.intersectionPlanes,o=e.intersectionPlanes.length):(a=this.unionPlanes,o=e.unionPlanes.length),a.length!==o+i){a.length=o+i;for(let e=0;e<i;e++)a[o+e]=new br;n=!0}this.projectPlanes(r,a,o),n&&(this.version++,this.cacheKey=`${this.id}:${this.intersectionPlanes.length}:${this.unionPlanes.length}`)}getGroupContext(t){if(this.shadowPass&&!t.clipShadows)return this;let n=this.clippingGroupContexts.get(t);return n===void 0&&(n=new e(this),this.clippingGroupContexts.set(t,n)),n.update(this,t),n}get unionClippingCount(){return this.unionPlanes.length}},wr=new WeakMap,Q=e=>typeof e==`object`&&!!e,$=(e,t)=>Q(e)&&t.every(t=>typeof e[t]==`function`);function Tr(e){return e._initialized===!0&&e._isDeviceLost===!1&&e.xr.isPresenting===!1&&e._mrt===null&&e._renderObjectFunction===null&&e._currentRenderBundle===null&&e._activeCubeFace===0&&e._activeMipmapLevel===0}function Er(e){if(!Q(e)||e.isWebGPURenderer!==!0||!Q(e.backend)||e.backend.isWebGPUBackend!==!0||!$(e,[`render`,`renderObject`,`_renderObjectDirect`,`_updateCamera`,`getRenderTarget`,`getDrawingBufferSize`])||!$(e.backend,[`beginRender`,`finishRender`,`updateTimeStampUID`,`getTimestampUID`])||!$(e._renderContexts,[`get`])||!$(e._textures,[`get`,`updateRenderTarget`])||!$(e._background,[`update`])||!$(e.lighting,[`beginRender`,`finishRender`,`getNode`])||!$(e.inspector,[`beginRender`,`finishRender`])||!Q(e._nodes)||!Q(e._nodes.nodeFrame)||!Q(e._canvasTarget)||!Q(e.xr)||!Q(e.info)||!Q(e.info.render)||typeof e._callDepth!=`number`||typeof e._nodes.nodeFrame.renderId!=`number`)return null;let t=e;if(!Tr(t))return null;let n=wr.get(e);return n||(n=new Dr(t),wr.set(e,n)),n}var Dr=class{screen=new P;size=new oe;renderer;constructor(e){this.renderer=e}render(e,t){let n=this.renderer,r=n.getRenderTarget();if(!Tr(n)||!r||n.needsFrameBufferTarget||r.depthBuffer||r.stencilBuffer||r.samples!==0||r.textures.length!==1||e.matrixWorldAutoUpdate||t.matrixWorldAutoUpdate||t.isArrayCamera||e.overrideMaterial||e.background||e.backgroundNode||e.environment||e.environmentNode||e.fog||e.children.some(e=>{let t=e;if(!t.isMesh||t.children.length||t.frustumCulled||Array.isArray(t.material)||t.occlusionTest)return!0;let n=t.material;return n.lights===!0||(n.transmission??0)>0||!!n.transmissionNode}))return n.render(e,t),!1;let i=n._nodes.nodeFrame,a=i.renderId,o=n._currentRenderContext,s=n._currentRenderObjectFunction,c=n._handleObjectFunction,l=n._currentSourceMaterial,u=n._callDepth,d,f=!1,p=!1,m=!1;try{n.lighting.beginRender(e),p=!0,n._callDepth++,d=n._renderContexts.get(r,null,n._callDepth),n._currentRenderContext=d,n._currentRenderObjectFunction=n.renderObject,n._handleObjectFunction=n._renderObjectDirect,n.info.calls++,n.info.render.calls++,n.info.render.frameCalls++,i.renderId=n.info.calls,n.backend.updateTimeStampUID(d),n.inspector.beginRender(n.backend.getTimestampUID(d),e,t,r),m=!0,t=n._updateCamera(t,!1),n.getDrawingBufferSize(this.size),this.screen.set(0,0,this.size.width,this.size.height),d.viewportValue.copy(r.viewport).floor();let a=r.viewport;d.viewportValue.minDepth=a.minDepth??0,d.viewportValue.maxDepth=a.maxDepth??1,d.viewport=!d.viewportValue.equals(this.screen),d.scissorValue.copy(r.scissor).floor(),d.scissor=n._canvasTarget._scissorTest&&!d.scissorValue.equals(this.screen),d.clippingContext||(d.clippingContext=new Cr),d.clippingContext.updateGlobal(e,t),e.onBeforeRender.call(e,n,e,t,r),n._textures.updateRenderTarget(r,0);let o=n._textures.get(r);d.textures=o.textures,d.depthTexture=o.depthTexture,d.width=o.width,d.height=o.height,d.renderTarget=r,d.depth=!1,d.stencil=!1,d.activeCubeFace=0,d.activeMipmapLevel=0,d.occlusionQueryCount=0,d.fullscreenPass=!1;let s=d.scissorValue;s.x=Math.max(s.x,0),s.y=Math.max(s.y,0),s.z=Math.min(Math.max(s.z,0),Math.max(d.width-s.x,0)),s.w=Math.min(Math.max(s.w,0),Math.max(d.height-s.y,0)),n._background.update(e,null,d),d.camera=t,n.backend.beginRender(d),f=!0;let c=n.lighting.getNode(e);for(let r=0;r<2;r++)if(!(r?!n.transparent:!n.opaque))for(let i of e.children){let a=i,o=a.material;if(Number(o.transparent)!==r||!a.visible||!a.layers.test(t.layers)||!o.visible)continue;let s=o.side;try{n.renderObject(a,e,t,a.geometry,o,null,c,d.clippingContext)}finally{o.side=s}}}finally{try{f&&n.backend.finishRender(d)}finally{i.renderId=a,n._currentRenderContext=o,n._currentRenderObjectFunction=s,n._handleObjectFunction=c,n._currentSourceMaterial=l,n._callDepth=u;try{p&&n.lighting.finishRender(e)}finally{m&&n.inspector.finishRender(n.backend.getTimestampUID(d))}}}return e.onAfterRender.call(e,n,e,t,r),!0}};export{Ae as createThreeNodeSurfacePaintFoldMaterial,Er as createThreeWebGpuDirectPass,at as createThreeWebGpuFillMaterial,Rn as createThreeWebGpuGradientFillMaterial,zn as createThreeWebGpuGradientStrokeMaterial,Nt as createThreeWebGpuMixedVectorMaterial,er as createThreeWebGpuPaintCompositorMaterials,Yn as createThreeWebGpuPrimitiveHighlightMaterial,un as createThreeWebGpuRasterMaterial,hn as createThreeWebGpuRasterStripMaterial,Tt as createThreeWebGpuStrokeMaterial,Wt as createThreeWebGpuTextMaterial,Me as enableThreeNodePaintFold};