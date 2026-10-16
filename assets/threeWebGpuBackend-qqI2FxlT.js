import{B as e,Ca as t,D as n,E as r,F as i,H as a,Hi as o,I as s,L as c,U as l,Ui as u,W as d,_t as f,a as p,at as m,bt as h,ct as g,d as _,dt as v,f as y,gt as b,ia as x,na as S,o as C,ot as w,pt as T,r as E,s as D,ut as O,y as k,yt as A,z as ee}from"./nativeWebGlMixedVectorShaders-oEv9dGMx.js";import{n as te,t as j}from"./vectorFillBandShaders-CRyg2aoB.js";import{V as ne,br as M,c as re,d as ie,f as ae,h as N,kt as oe,l as se,m as ce,o as le,p as ue,s as de,vr as fe}from"./src-Bvrx3Q23.js";import{n as P,t as F}from"./three.webgpu-BrNGWr6r.js";import{a as pe,i as me,n as he,r as ge,t as _e}from"./rasterStripWebGpuSampling-ZZGY41Kz.js";var ve=P.wgslFn(`fn heprPageProjection(document: mat4x4f, matrices: texture_2d<f32>, page: f32) -> mat4x4f {
  let p = i32(page);
  return document * mat4x4f(textureLoad(matrices,vec2i(0,p),0), textureLoad(matrices,vec2i(1,p),0),
    textureLoad(matrices,vec2i(2,p),0),textureLoad(matrices,vec2i(3,p),0));
}`),ye=P.wgslFn(`fn heprPrimitivePage(owners: texture_2d<f32>, index: f32) -> f32 {
  let width = i32(textureDimensions(owners,0).x); let i = i32(index);
  return textureLoad(owners,vec2i(i % width,i / width),0).r;
}`),be=P.wgslFn(`fn heprPageParameters(parameters: texture_2d<f32>, page: f32) -> vec4f {
  return textureLoad(parameters,vec2i(0,i32(page)),0);
}`),xe=P.wgslFn(`fn heprPageClip(position: vec4f, parameters: vec4f) -> vec4f {
  if (parameters.y < 0.5) { return vec4f(2.0,2.0,2.0,1.0); } return position;
}`);function Se(e,t){return e(t)}function I(e,t){let n=P.uniform(e);if(!t)return{matrix:n,finish(){}};let r=t.owners?Se(ye,{owners:P.textureLoad(t.owners),index:P.attribute(t.attribute,`float`)}):t.page===void 0?P.attribute(`aPageIndex`,`float`):P.float(t.page),i=Se(be,{parameters:P.textureLoad(t.table.parameters),page:r});return{matrix:Se(ve,{document:n,matrices:P.textureLoad(t.table.matrices),page:r}),units:i.x,finish(e){e.vertexNode=Se(xe,{position:e.vertexNode,parameters:i})}}}var Ce=2**30,we=null,Te=P.wgslFn(_,[P.wgslFn(y.slice(0,y.indexOf(`fn heprFoldGradientBackground`))),P.wgslFn(y.slice(y.indexOf(`fn heprFoldGradientBackground`)))]),Ee=P.wgslFn(`
fn heprSurfacePaintFoldScale(pixel: vec2f, mask: texture_2d<f32>, fold: vec4f, weights: vec4f) -> f32 {
  if (fold.y < 0.5) { return fold.x; }
  let size = vec2<i32>(textureDimensions(mask));
  let value = textureLoad(mask, clamp(vec2<i32>(pixel), vec2<i32>(0), size - vec2<i32>(1)), 0);
  return fold.x * clamp(dot(value, weights) + fold.z, 0.0, 1.0);
}
`),De=new WeakMap;function Oe(e){if(!(e instanceof F))return null;let t=De.get(e);if(!t||e.fragmentNode!==t.full)return null;let n=e.clone();return n.fragmentNode=t.surface,ie(e,n),ce(e,n),n}function ke(e,t,n){if(!(e instanceof F)||!(t instanceof F))return;let r=De.get(e);r&&e.fragmentNode===r.full&&De.set(t,{full:t.fragmentNode,surface:n(r.surface)})}function Ae(e){if(!(e instanceof F)||!e.fragmentNode)throw Error(`Folded paint material has no node fragment output.`);we||(we=new ne(Uint8Array.of(255,255,255,255),1,1),we.needsUpdate=!0,we.version=Ce);let t=P.uniform(new M(1,0,0,0)),n=P.uniform(new M),r=ae(),i=P.textureLoad(we);i.getUniformHash=()=>`hepr-paint-fold-mask`;let a={pixel:P.screenCoordinate,mask:i,fold:t,weights:n};r.forEach((e,t)=>{a[`d${t}`]=P.uniform(e)});let o=Te(a),s=Ee({pixel:P.screenCoordinate,mask:i,fold:t,weights:n}),c=e.fragmentNode,l=e=>P.Fn(()=>{let t=P.property(`vec4`,`heprFoldSource`);return t.assign(c),P.vec4(t.rgb,P.mul(t.a,e))})();e.fragmentNode=l(o),De.set(e,{full:e.fragmentNode,surface:l(s)}),ue(e,{fold:t,weights:n,mask:i,gradient:r,neutral:we})}var je=new WeakMap,Me=new WeakMap,Ne=new WeakSet,Pe=P.wgslFn(g),Fe=P.wgslFn(w),Ie=P.wgslFn(m),Le=P.wgslFn(`
fn heprClipPixelWidth(point: vec2<f32>) -> f32 {
  let dx = length(vec2<f32>(dpdx(point.x), dpdy(point.x)));
  let dy = length(vec2<f32>(dpdx(point.y), dpdy(point.y)));
  return max(max(dx, dy), 0.0001);
}
`);function L(e,t,n=!1,r=!1){re(e,ze),je.set(e,t),n&&Me.set(e,n),r&&Ne.add(e)}function Re(e){return P.varying(e).setInterpolation(`flat`)}function ze(e,t,n,r){if(!(e instanceof F)||!(t instanceof F))throw Error(`Unsupported vector clip material.`);let i=je.get(e);if(!i||!e.fragmentNode)throw Error(`Clipped node material has no page-space position.`);let a={point:i,clipIndex:n===null?P.sub(Re(P.attribute(de,`float`)),1):P.uniform(n),clipTexture:P.textureLoad(r)},o=Me.get(e),s=t=>{if(o)return P.Fn(()=>{let n=P.property(`float`,`heprClipAAWidth`);n.assign(Le({point:i}));let r=P.property(`vec4`,`heprClipSource`);r.assign(t);let s=(Ne.has(e)?Ie:Fe)({...a,aaWidth:n});return o===`premultiplied`?P.mul(r,s):P.vec4(r.rgb,P.mul(r.a,s))})();let n=Pe(a);return P.mul(t,n)};t.fragmentNode=s(e.fragmentNode),ke(e,t,s)}var Be=P.wgslFn(`
fn heprThreeOutputColor(color: vec3<f32>) -> vec3<f32> {
  let safeColor = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
  let lower = safeColor / 12.92;
  let higher = pow((safeColor + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
  return select(higher, lower, safeColor <= vec3<f32>(0.04045));
}
`),Ve=P.wgslFn(`
fn heprThreeOutputColor(color: vec3<f32>) -> vec3<f32> {
  return clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
}
`);function R(e,t=[]){let n=n=>P.wgslFn(e,[n,...t]);return{linear:n(Be),display:n(Ve)}}function z(e){return e}function He(e,t){return e(t)}function Ue(e,t=!1){let n=P.varying(e);return t?n.setInterpolation(`flat`):n}var We=P.wgslFn(j),Ge=P.wgslFn(f),Ke=P.wgslFn(b),qe=P.wgslFn(v),Je=P.wgslFn(O,[z(Ge)]),Ye=P.wgslFn(`
fn heprCoordFromIndex(index: f32, width: f32) -> vec2<i32> {
  let itemIndex = i32(index);
  let safeWidth = max(i32(width), 1);
  return vec2<i32>(itemIndex % safeWidth, itemIndex / safeWidth);
}
`),Xe=P.wgslFn(`
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
  localToClip: mat4x4<f32>
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
  let margin = heprBoundCoverageMargin(minBounds + (maxBounds - minBounds) * corner01, rawMargin,
    mat2x2<f32>(1.0, 0.0, 0.0, 1.0), useLocalToClip, localToClip, max(viewport, vec2<f32>(1.0)));
  let world = minBounds - margin + (maxBounds - minBounds + 2.0 * margin) * corner01;
  return vec4<f32>(world, 1.0, 0.0);
}
`,[z(Ke)]),Ze=P.wgslFn(`
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
`),Qe=P.wgslFn(`
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
${te({bands:`bands`,y:`localY`,radius:`0.5 * footprint.y`,count:`segmentCount`,start:`segmentStart`,texture:`segmentTexA`,entries:`bandEntries`,setup:`let rows = heprBandRows(bandInfo, band, bandCount, box);`,edge:`    let coord = vec2<i32>(segmentIndex % safeWidth, segmentIndex / safeWidth);
    let primitiveA = textureLoad(segmentTexA, coord, 0);
    let primitiveB = textureLoad(segmentTexB, coord, 0);
    winding = winding + heprSegmentCoverage(primitiveA.xy, primitiveA.zw, primitiveB.xy,
      primitiveB.z >= 1.0, box, rows.x, rows.y);`})}
  return winding;
}
`,[z(We),z(qe),z(Ge),z(Je)]),$e=`
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
`,et=[z(Ge),z(Qe)],tt=R($e,et),nt={vertex:Xe,fragmentSource:$e,fragmentDependencies:et};function rt(e){let t=new F,n=I(e.localToClip,e.pageBinding);t.transparent=!1,t.depthTest=!1,t.depthWrite=!1,t.side=2,t.toneMapped=!1,t.fog=!1,t.lights=!1,se(t);let r=P.uniform(0);N(t,r);let i=P.uniform(1),a=P.uniform(0),o=P.uniform(1),s=P.uniform(Math.max(1,e.fillPathTextureWidth)),c=P.uniform(Math.max(1,e.fillSegmentTextureWidth)),l=P.attribute(`aCorner`,`vec2`),u=P.attribute(`aFillPathIndex`,`float`),d=He(Ye,{index:u,width:s}),f=Ue(P.textureLoad(e.fillPathMetaTextureA,d,0),!0),p=Ue(P.textureLoad(e.fillPathMetaTextureB,d,0),!0),m=Ue(P.textureLoad(e.fillPathMetaTextureC,d,0),!0),h=Ue(P.int(u),!0),g=P.uniform(e.viewport),_=n.matrix,v=Ue(He(Xe,{corner:l,metaA:f,metaB:p,metaC:m,shapeOnly:r,fillAAScreenPx:o,viewport:g,zoom:i,useLocalToClip:a,localToClip:_})),y=v;return t.vertexNode=He(Ze,{vertexPack:v,viewport:g,cameraCenter:P.uniform(e.cameraCenter),zoom:i,useLocalToClip:a,localToClip:_}),n.finish(t),t.fragmentNode=He(tt[e.colorCompositing],{local:y.xy,metaA:f,metaB:p,metaC:m,segmentTexA:P.textureLoad(e.fillSegmentTextureA),segmentTexB:P.textureLoad(e.fillSegmentTextureB),segmentTexWidth:c,pathIndex:h,bandBase:P.uniform(e.fillBandBase??-1),bandEntries:P.uniform(e.fillBandEntries??0),cellHeaders:P.uniform((e.fillCellBase??-1)+1),fillAAScreenPx:o,vectorOverride:P.uniform(e.vectorOverride),shapeOnly:r}),L(t,y.xy),{material:t,zoomUniform:i,useLocalToClipUniform:a}}function B(e){return e}function it(e,t){return e(t)}function at(e,t=!1){let n=P.varying(e);return t?n.setInterpolation(`flat`):n}var ot=P.wgslFn(`
fn heprSegmentCoord(index: f32, width: f32) -> vec2<i32> {
  let segmentIndex = i32(index);
  let safeWidth = max(i32(width), 1);
  return vec2<i32>(segmentIndex % safeWidth, segmentIndex / safeWidth);
}
`),st=P.wgslFn(`
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
`),ct=P.wgslFn(`
fn heprFloatMod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}
`),lt=P.wgslFn(pe),ut=P.wgslFn(`
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

  var aaWorld = max(localUnitsPerPixel, 0.0001) * aaScreenPx;
  if (isHairline) {
    aaWorld = max(0.35 * localUnitsPerPixel, 0.00005);
  }

  let extent = halfWidth + aaWorld;
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  let worldPosition = heprStrokeQuadWorldPosition(corner01, p0, p1, p2, primitiveBounds, extent);

  return vec4<f32>(worldPosition, halfWidth, aaWorld);
}
`,[B(ct),B(lt)]),dt=P.wgslFn(`
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
`),ft=P.wgslFn(A),pt=P.wgslFn(h),mt=P.wgslFn(ge),ht=P.wgslFn(me,[B(mt)]),gt=`
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
  shapeOnly: f32
) -> vec4<f32> {
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

  var distanceToSegment: f32;
  if (strokeCurveEnabled >= 0.5 && primitiveType >= 0.5) {
    distanceToSegment = heprDistanceToQuadraticBezier(local, p0, p1, p2);
  } else {
    distanceToSegment = heprDistanceToLineSegment(local, p0, p2);
  }

  let pixelToLocalX = length(vec2<f32>(dpdx(local.x), dpdy(local.x)));
  let pixelToLocalY = length(vec2<f32>(dpdx(local.y), dpdy(local.y)));
  let localPerPixel = max(max(pixelToLocalX, pixelToLocalY), 0.000001);
  let isHairline = heprFloatMod(styleFlags, 2.0) >= 0.5;
  let aaWorld = max(localPerPixel * aaScreenPx, 0.00005);
  var halfWidth = halfWidthFromVertex;
  if (isHairline) {
    halfWidth = max(0.5 * localPerPixel, 0.00001);
  }

  let coverage = heprStrokeCoverage(distanceToSegment, halfWidth, aaWorld);
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
`,_t=[B(ct),B(ft),B(pt),B(mt),B(ht)],vt=R(gt,_t),yt={vertex:ut,clip:dt,fragmentSource:gt,fragmentDependencies:_t};function bt(e){let t=new F,n=I(e.localToClip,e.pageBinding);t.transparent=!1,t.depthTest=!1,t.depthWrite=!1,t.side=2,t.toneMapped=!1,t.fog=!1,t.lights=!1,se(t);let r=P.uniform(0);N(t,r);let i=P.uniform(1),a=P.uniform(0),o=P.uniform(1),s=P.uniform(+!!e.strokeCurveEnabled),c=P.uniform(Math.max(1,e.segmentTextureWidth)),l=P.uniform(1),u=P.attribute(`aCorner`,`vec2`),d=P.attribute(`aSegmentIndex`,`float`),f=it(ot,{index:d,width:c}),p=e.segmentTail,m=p?P.uniform(Math.max(1,p.width)):null,h=p?P.uniform(p.split):null,g=(e,t)=>t?it(st,{headTexture:P.textureLoad(e),tailTexture:P.textureLoad(t),index:d,headWidth:c,tailWidth:m,splitIndex:h}):P.textureLoad(e,f,0),_=at(g(e.segmentTextureA,p?.textureA),!0),v=at(g(e.segmentTextureB,p?.textureB),!0),y=at(g(e.segmentStyleTexture,p?.styleTexture),!0),b=at(g(e.segmentBoundsTexture,p?.boundsTexture),!0),x=at(it(ut,{corner:u,primitiveA:_,primitiveB:v,style:y,primitiveBounds:b,zoom:i,useLocalToClip:a,localUnitsPerPixelInput:n.units??o,aaScreenPx:l,shapeOnly:r})),S=x,C=P.uniform(e.viewport),w=P.uniform(e.cameraCenter),T=n.matrix,E=P.uniform(e.vectorOverride);return t.vertexNode=it(dt,{worldPack:x,viewport:C,cameraCenter:w,zoom:i,useLocalToClip:a,localToClip:T}),n.finish(t),t.fragmentNode=it(vt[e.colorCompositing],{local:S.xy,primitiveA:_,primitiveB:v,style:y,primitiveBounds:b,halfWidthFromVertex:S.z,strokeCurveEnabled:s,aaScreenPx:l,vectorOverride:E,shapeOnly:r}),L(t,S.xy),{material:t,zoomUniform:i,useLocalToClipUniform:a,localUnitsPerPixelUniform:o,curveUniform:s}}function xt(e,t){return e(t)}function St(e){return P.varying(e).setInterpolation(`flat`)}function Ct(e){return P.varying(e)}var wt=P.wgslFn(`
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
`),Tt=P.wgslFn(`
fn heprMixedWorldPack(
  corner: vec2<f32>, kind: f32,
  dataA: vec4<f32>, dataB: vec4<f32>, dataC: vec4<f32>, dataD: vec4<f32>,
  viewport: vec2<f32>, zoom: f32, useLocalToClip: f32,
  localToClip: mat4x4<f32>, localUnitsPerPixel: f32, aaScreenPx: f32, shapeOnly: f32,
  fillEnabled: f32, strokeEnabled: f32
) -> vec4<f32> {
  if (select(fillEnabled, strokeEnabled, kind < 0.5) < 0.5) {
    return vec4<f32>(-2.0, -2.0, 0.0, 0.0);
  }
  if (kind < 0.5) {
    return heprStrokeWorldPack(corner, dataA, dataB, dataC, dataD,
      zoom, useLocalToClip, localUnitsPerPixel, aaScreenPx, shapeOnly);
  }
  let pack = heprFillVertexPack(corner, dataA, dataB, dataC, shapeOnly, aaScreenPx,
    viewport, zoom, useLocalToClip, localToClip);
  
  return vec4<f32>(pack.xy, 0.0, pack.z);
}
`,[yt.vertex,nt.vertex]);function Et(e,t){return e.replace(/fn hepr(?:Stroke|Fill)Fragment\(/,`fn ${t}(`).replace(`shapeOnly: f32
)`,`shapeOnly: f32,
  pixelFootprint: vec2<f32>
)`).replaceAll(`length(vec2<f32>(dpdx(local.x), dpdy(local.x)))`,`pixelFootprint.x`).replaceAll(`length(vec2<f32>(dpdx(local.y), dpdy(local.y)))`,`pixelFootprint.y`)}var Dt=R(`
fn heprMixedVectorFragment(
  local: vec2<f32>, kind: f32, pathIndex: i32,
  dataA: vec4<f32>, dataB: vec4<f32>, dataC: vec4<f32>, dataD: vec4<f32>,
  halfWidth: f32, segmentTexA: texture_2d<f32>, segmentTexB: texture_2d<f32>, segmentWidth: f32,
  bandBase: f32, bandEntries: f32, cellHeaders: f32,
  fillAAScreenPx: f32, strokeAAScreenPx: f32, curveEnabled: f32,
  vectorOverride: vec4<f32>, shapeOnly: f32
) -> vec4<f32> {
  
  let pixelFootprint = vec2<f32>(length(vec2<f32>(dpdx(local.x), dpdy(local.x))),
    length(vec2<f32>(dpdx(local.y), dpdy(local.y))));
  if (kind < 0.5) {
    return heprMixedStrokeFragment(local, dataA, dataB, dataC, dataD, halfWidth,
      curveEnabled, strokeAAScreenPx, vectorOverride, shapeOnly, pixelFootprint);
  }
  return heprMixedFillFragment(local, dataA, dataB, dataC, segmentTexA, segmentTexB,
    segmentWidth, pathIndex, bandBase, bandEntries, cellHeaders,
    fillAAScreenPx, vectorOverride, shapeOnly, pixelFootprint);
}
`,[P.wgslFn(Et(yt.fragmentSource,`heprMixedStrokeFragment`),yt.fragmentDependencies),P.wgslFn(Et(nt.fragmentSource,`heprMixedFillFragment`),nt.fragmentDependencies)]);function Ot(e){let t=new F;t.transparent=!1,t.depthTest=!1,t.depthWrite=!1,t.side=2,t.toneMapped=!1,t.fog=!1,t.lights=!1,se(t);let n=P.uniform(0);N(t,n);let r=P.uniform(1),i=P.uniform(0),a=P.uniform(1),o=P.uniform(+!!e.strokeCurveEnabled),s=P.uniform(1),c=P.uniform(1),l=I(e.localToClip,e.pageBinding),u=P.attribute(`aVectorKind`,`float`),d=P.attribute(`aVectorIndex`,`float`),f=P.uniform(e.viewport),p=P.uniform(Math.max(1,e.segmentTextureWidth)),m=P.uniform(Math.max(1,e.fillSegmentTextureWidth)),h=P.uniform(Math.max(1,e.fillPathTextureWidth)),g=e.segmentTail,_=P.uniform(Math.max(1,g?.width??e.segmentTextureWidth)),v=P.uniform(g?.split??-1),y=(e,t,n,r,i)=>St(xt(wt,{kind:u,index:d,head:P.textureLoad(e),tail:P.textureLoad(t??e),fill:P.textureLoad(n),headWidth:p,tailWidth:_,split:v,fillWidth:r,fillOffset:P.uniform(i)})),b=y(e.segmentTextureA,g?.textureA,e.fillPathMetaTextureA,h,0),x=y(e.segmentTextureB,g?.textureB,e.fillPathMetaTextureB,h,0),S=y(e.segmentStyleTexture,g?.styleTexture,e.fillPathMetaTextureC,h,0),C=y(e.segmentBoundsTexture,g?.boundsTexture,e.segmentBoundsTexture,p,-1),w=Ct(xt(Tt,{corner:P.attribute(`aCorner`,`vec2`),kind:u,dataA:b,dataB:x,dataC:S,dataD:C,viewport:f,zoom:r,useLocalToClip:i,localToClip:l.matrix,localUnitsPerPixel:l.units??a,aaScreenPx:P.uniform(1),shapeOnly:n,fillEnabled:s,strokeEnabled:c})),T=w;return t.vertexNode=xt(yt.clip,{worldPack:w,viewport:f,cameraCenter:P.uniform(e.cameraCenter),zoom:r,useLocalToClip:i,localToClip:l.matrix}),l.finish(t),t.fragmentNode=xt(Dt[e.colorCompositing],{local:T.xy,kind:St(u),pathIndex:St(P.int(d)),dataA:b,dataB:x,dataC:S,dataD:C,halfWidth:T.z,segmentTexA:P.textureLoad(e.fillSegmentTextureA),segmentTexB:P.textureLoad(e.fillSegmentTextureB),segmentWidth:m,bandBase:P.uniform(e.fillBandBase??-1),bandEntries:P.uniform(e.fillBandEntries??0),cellHeaders:P.uniform((e.fillCellBase??-1)+1),fillAAScreenPx:P.uniform(1),strokeAAScreenPx:P.uniform(1),curveEnabled:o,vectorOverride:P.uniform(e.vectorOverride),shapeOnly:n}),L(t,T.xy),{material:t,zoomUniform:r,useLocalToClipUniform:i,localUnitsPerPixelUniform:a,curveUniform:o,fillRenderingUniform:s,strokeRenderingUniform:c}}function kt(e){return e}function V(e,t){return e(t)}function H(e,t=!1){let n=P.varying(e);return t?n.setInterpolation(`flat`):n}var At=P.wgslFn(`
fn heprCoordFromIndex(index: f32, width: f32) -> vec2<i32> {
  let itemIndex = i32(index);
  let safeWidth = max(i32(width), 1);
  return vec2<i32>(itemIndex % safeWidth, itemIndex / safeWidth);
}
`),jt=P.wgslFn(`
fn heprClipCoordFromReference(reference: f32, width: f32) -> vec2<i32> {
  let itemIndex = max(i32(reference) - 1, 0);
  let safeWidth = max(i32(width), 1);
  return vec2<i32>(itemIndex % safeWidth, itemIndex / safeWidth);
}
`),Mt=P.wgslFn(f),Nt=P.wgslFn(b),Pt=P.wgslFn(`
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
`,[kt(Nt)]),Ft=P.wgslFn(`
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
`),It=P.wgslFn(`
fn heprTextNormCoord(local: vec2<f32>, glyphMetaA: vec4<f32>, glyphMetaB: vec4<f32>) -> vec2<f32> {
  let minBounds = glyphMetaA.zw;
  let maxBounds = glyphMetaB.xy;
  let span = max(maxBounds - minBounds, vec2<f32>(0.000001));
  
  return (local - minBounds) / span;
}
`),Lt=P.wgslFn(`
fn heprTextRasterAtlasPixels(
  normCoord: vec2<f32>,
  rasterRect: vec4<f32>,
  atlasSize: vec2<f32>
) -> vec2<f32> {
  let dims = max(atlasSize, vec2<f32>(1.0));
  return vec2<f32>(normCoord.x, 1.0 - normCoord.y) * (rasterRect.zw * dims);
}
`),Rt=R(`
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
`,[kt(Mt)]);function zt(e){let t=new F,n=I(e.localToClip,e.pageBinding);t.transparent=!1,t.depthTest=!1,t.depthWrite=!1,t.side=2,t.toneMapped=!1,t.fog=!1,t.lights=!1,se(t);let r=P.uniform(0);N(t,r);let i=P.uniform(1),a=P.uniform(0),o=P.uniform(+!!e.strokeCurveEnabled),s=P.uniform(+!!e.textVectorOnly),c=P.uniform(1.25),l=P.uniform(Math.max(1,e.textInstanceTextureWidth)),u=P.uniform(Math.max(1,e.textGlyphTextureWidth)),d=P.uniform(Math.max(1,e.textSegmentTextureWidth)),f=P.attribute(`aCorner`,`vec2`),p=V(At,{index:P.attribute(`aTextInstanceIndex`,`float`),width:l}),m=H(P.textureLoad(e.textInstanceTextureA,p,0),!0),h=H(P.textureLoad(e.textInstanceTextureB,p,0),!0),g=H(P.textureLoad(e.textInstanceTextureC,p,0),!0),_=V(At,{index:h.z,width:u}),v=H(P.textureLoad(e.textGlyphMetaTextureA,_,0),!0),y=H(P.textureLoad(e.textGlyphMetaTextureB,_,0),!0),b=H(P.textureLoad(e.textGlyphRasterMetaTexture,_,0),!0),x=P.uniform(e.viewport),S=n.matrix,C=H(V(Pt,{corner:f,instanceA:m,instanceB:h,glyphMetaA:v,glyphMetaB:y,viewport:x,zoom:i,useLocalToClip:a,localToClip:S})),w=C,T=V(jt,{reference:h.w,width:u}),E=H(P.textureLoad(e.textGlyphMetaTextureA,T,0),!0);t.vertexNode=V(Ft,{vertexPack:C,glyphMetaA:v,viewport:x,cameraCenter:P.uniform(e.cameraCenter),zoom:i,useLocalToClip:a,localToClip:S});let D=P.uniform(e.textRasterAtlasSize),O=V(It,{local:w.zw,glyphMetaA:v,glyphMetaB:y}),k=V(Lt,{normCoord:O,rasterRect:b,atlasSize:D});return n.finish(t),t.fragmentNode=V(Rt[e.colorCompositing],{local:w.zw,world:C.xy,clipReference:h.w,clipRect:E,glyphMetaA:v,instanceColor:g,normCoord:O,atlasPixels:k,rasterRect:b,rasterAtlasTex:P.texture(e.textRasterAtlasTexture),rasterAtlasSampler:P.sampler(e.textRasterAtlasTexture),rasterAtlasSize:D,vectorOnly:s,segmentTexA:P.textureLoad(e.textGlyphSegmentTextureA),segmentTexB:P.textureLoad(e.textGlyphSegmentTextureB),segmentTexWidth:d,textAAScreenPx:c,textCurveEnabled:o,vectorOverride:P.uniform(e.vectorOverride),shapeOnly:r,inkDensity:y.z}),L(t,C.xy),{material:t,zoomUniform:i,useLocalToClipUniform:a,curveUniform:o,vectorOnlyUniform:s}}var Bt=[0,0,1,1],Vt=P.wgslFn(r),Ht=P.wgslFn(n,[Vt]);function U(e,t){return e(t)}function Ut(e){return P.varying(e)}var Wt=P.wgslFn(`
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
`),Gt=P.wgslFn(`
fn heprPageBackgroundPack(corner: vec2<f32>, pageRect: vec4<f32>) -> vec4<f32> {
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  let localTopDown = vec2<f32>(corner01.x, 1.0 - corner01.y);
  let world = pageRect.xy + pageRect.zw * localTopDown;
  return vec4<f32>(world, localTopDown);
}
`),Kt=P.wgslFn(`
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
`),qt=R(`
fn heprRasterFragment(inputColor: vec4<f32>, opacity: f32, shapeOnly: f32) -> vec4<f32> {
  let color = inputColor * mix(opacity, 1.0, shapeOnly);
  if (color.a <= 0.001) {
    discard;
  }
  let straightSrgb = clamp(color.rgb / color.a, vec3<f32>(0.0), vec3<f32>(1.0));
  let outputPremultiplied = heprThreeOutputColor(straightSrgb) * color.a;
  return vec4<f32>(outputPremultiplied, color.a);
}
`),Jt=P.wgslFn(d),Yt=P.wgslFn(e,[Jt]),Xt=P.wgslFn(l,[Jt,Yt]),Zt=P.wgslFn(ee,[Xt]),Qt=P.wgslFn(a,[Jt,Zt]),$t=P.wgslFn(`
fn heprThreeRasterBit(image: texture_2d<f32>, size: vec2f, pixel: vec2i) -> f32 {
  let p = clamp(pixel, vec2i(0), vec2i(size) - vec2i(1));
  let bits = u32(round(textureLoad(image, vec2i(p.x / 8, p.y), 0).r * 255.0));
  return f32((bits >> (7u - (u32(p.x) & 7u))) & 1u);
}`),en=P.wgslFn(s),tn=P.wgslFn(i,[en]),nn=P.wgslFn(c,[tn]),rn=P.wgslFn(`
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
}`,[$t,nn,Qt]);function an(e){let t=new F,n=I(e.localToClip,e.pageBinding);t.transparent=!1,t.depthTest=!1,t.depthWrite=!1,t.side=2,t.toneMapped=!1,t.fog=!1,t.lights=!1,t.blending=5,t.blendSrc=201,t.blendDst=205,t.blendSrcAlpha=201,t.blendDstAlpha=205;let r=P.uniform(0);N(t,r);let i=P.uniform(1),a=P.uniform(0),o=P.attribute(`aCorner`,`vec2`),s=new M().fromArray(e.tile?.quad??Bt),c=new M().fromArray(e.tile?.uv??Bt),l=Ut(e.instancedPageBackground?U(Gt,{corner:o,pageRect:P.attribute(`aPageRect`,`vec4`)}):U(Wt,{corner:o,matrixABCD:e.instancedRasterRepeat?P.attribute(`aRasterRepeatABCD`,`vec4`):P.uniform(e.matrixABCD),matrixEF:e.instancedRasterRepeat?P.attribute(`aRasterRepeatEF`,`vec2`):P.uniform(e.matrixEF),tileQuad:P.uniform(s),tileUv:P.uniform(c)})),u=l,d=le(e.texture),f=P.texture(e.texture),p=P.texture(d.coverage);f.getUniformHash=()=>f.uuid,p.getUniformHash=()=>p.uuid;let m=P.uniform(d.mode),h=P.uniform(+!!d.compressionFormat),g=d.size.clone(),_=d.color0.clone(),v=d.color1.clone(),y=U(rn,{image:f,imageSampler:P.sampler(p),coverageImage:p,coverageSampler:P.sampler(p),uv:u.zw,mode:m,size:P.uniform(g),color0:P.uniform(_),color1:P.uniform(v),opaque:h}),b=P.uniform(e.opacity??1),x=P.uniform(0),S=e.instancedPageBackground?U(Ht,{paper:y,uv:u.zw,pending:Ut(P.attribute(`aPageLoading`,`float`)),time:x}):y;return t.vertexNode=U(Kt,{rasterPack:l,viewport:P.uniform(e.viewport),cameraCenter:P.uniform(e.cameraCenter),zoom:i,useLocalToClip:a,localToClip:n.matrix}),n.finish(t),t.fragmentNode=U(qt[e.colorCompositing],{inputColor:S,opacity:b,shapeOnly:r}),L(t,l.xy,`premultiplied`,!0),{material:t,zoomUniform:i,useLocalToClipUniform:a,pagePlaceholderTimeUniform:x,updateSource(t,n,r,i){f.value=t;let a=le(t);p.value=a.coverage,m.value=a.mode,h.value=+!!a.compressionFormat,g.copy(a.size),_.copy(a.color0),v.copy(a.color1),e.matrixABCD.set(n[0],n[1],n[2],n[3]),e.matrixEF.set(n[4],n[5]),s.fromArray(i?.quad??Bt),c.fromArray(i?.uv??Bt),b.value=r}}}function on(e,t){return e(t)}function sn(e,t=!1){let n=P.varying(e);return t?n.setInterpolation(`flat`):n}var cn=P.wgslFn(_e),ln=P.wgslFn(he,[cn]);function un(e){let t=new F,n=I(e.localToClip,e.pageBinding);t.transparent=!1,t.depthTest=!1,t.depthWrite=!1,t.side=2,t.toneMapped=!1,t.fog=!1,t.lights=!1,t.blending=5,t.blendSrc=201,t.blendDst=205,t.blendSrcAlpha=201,t.blendDstAlpha=205;let r=P.uniform(0);N(t,r);let i=P.uniform(1),a=P.uniform(0),o=P.attribute(`aRasterMatrixEFWidthOpacity`,`vec4`),s=P.vec4(0,0,1,1),c=sn(on(Wt,{corner:P.attribute(`aCorner`,`vec2`),matrixABCD:P.attribute(`aRasterMatrixABCD`,`vec4`),matrixEF:o.xy,tileQuad:s,tileUv:s})),l=c;t.vertexNode=on(Kt,{rasterPack:c,viewport:P.uniform(e.viewport),cameraCenter:P.uniform(e.cameraCenter),zoom:i,useLocalToClip:a,localToClip:n.matrix});let u=sn(o.zw,!0),d=on(ln,{uRasterTex:P.texture(e.texture),uRasterSampler:P.sampler(e.texture),uv:l.zw,row:sn(P.instanceIndex,!0),width:u.x});return n.finish(t),t.fragmentNode=on(qt[e.colorCompositing],{inputColor:d,opacity:u.y,shapeOnly:r}),L(t,l.xy,`premultiplied`,!0),{material:t,zoomUniform:i,useLocalToClipUniform:a}}function W(e){return e}function G(e,t){return e(t)}function K(e,t=!1){let n=P.varying(e);return t?n.setInterpolation(`flat`):n}var dn=P.wgslFn(j),fn=P.wgslFn(v),pn=P.wgslFn(`
fn heprGradientCoordFromIndex(index: f32, width: f32) -> vec2<i32> {
  let itemIndex = i32(index);
  let safeWidth = max(i32(width), 1);
  return vec2<i32>(itemIndex % safeWidth, itemIndex / safeWidth);
}
`),mn=P.wgslFn(`
fn heprGradientFloatMod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}
`),hn=P.wgslFn(x),gn=P.wgslFn(S),_n=P.wgslFn(`
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
`,[W(hn),W(gn)]),vn=P.wgslFn(f),yn=P.wgslFn(O,[W(vn)]),bn=P.wgslFn(b),xn=P.wgslFn(T,[W(bn)]),Sn=P.wgslFn(`
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
`,[W(xn)]),Cn=P.wgslFn(`
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
`),wn=P.wgslFn(`
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
`),Tn=P.wgslFn(A),En=P.wgslFn(ge),Dn=P.wgslFn(me,[W(En)]),On=R(`
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
${te({bands:`bands`,y:`local.y`,radius:`0.5 * footprint.y`,count:`segmentCount`,start:`segmentStart`,texture:`segmentTexA`,entries:`bandEntries`,setup:`let rows = heprBandRows(bandInfo, band, bandCount, box);`,edge:`    let coord = vec2<i32>(segmentIndex % safeWidth, segmentIndex / safeWidth);
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
`,[W(_n),W(vn),W(yn)]),kn=P.wgslFn(pe),An=P.wgslFn(`
fn heprGradientStrokeWorldPack(
  corner: vec2<f32>, primitiveA: vec4<f32>, primitiveB: vec4<f32>, style: vec4<f32>,
  primitiveBounds: vec4<f32>, zoom: f32, useLocalToClip: f32,
  localUnitsPerPixelInput: f32, aaScreenPx: f32, shapeOnly: f32
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
  var aaWorld = max(localUnitsPerPixel, 0.0001) * aaScreenPx;
  if (isHairline) { aaWorld = max(0.35 * localUnitsPerPixel, 0.00005); }
  let extent = halfWidth + aaWorld;
  let world = heprStrokeQuadWorldPosition(corner * 0.5 + vec2<f32>(0.5), primitiveA.xy, primitiveA.zw, primitiveB.xy, primitiveBounds, extent);
  return vec4<f32>(world, halfWidth, aaWorld);
}
`,[W(mn),W(kn)]),jn=R(`
fn heprGradientStrokeFragment(
  local: vec2<f32>, primitiveA: vec4<f32>, primitiveB: vec4<f32>, style: vec4<f32>,
  primitiveBounds: vec4<f32>, halfWidthFromVertex: f32, strokeCurveEnabled: f32,
  aaScreenPx: f32, vectorOverride: vec4<f32>, primitiveColor: vec4<f32>,
  gradientMetaA: texture_2d<f32>, gradientMetaB: texture_2d<f32>,
  gradientMetaC: texture_2d<f32>, gradientMetaD: texture_2d<f32>,
  gradientMetaE: texture_2d<f32>, gradientLut: texture_2d<f32>, gradientMetaWidth: f32,
  sourceGradientIndex: f32, maskGradientIndex: f32, shapeOnly: f32
) -> vec4<f32> {
  
  let pixelToLocalX = length(vec2<f32>(dpdx(local.x), dpdy(local.x)));
  let pixelToLocalY = length(vec2<f32>(dpdx(local.y), dpdy(local.y)));
  let styleFlags = floor(primitiveB.w / 2.0 + 0.000001);
  let alphaStyle = primitiveB.w - styleFlags * 2.0;
  if (alphaStyle <= 0.001 && shapeOnly < 0.5) { discard; }
  let hasClipBounds = heprGradientFloatMod(floor(styleFlags * 0.25), 2.0) >= 0.5;
  if (hasClipBounds && (local.x < primitiveBounds.x || local.y < primitiveBounds.y || local.x > primitiveBounds.z || local.y > primitiveBounds.w)) { discard; }
  let distanceToSegment = select(
    heprDistanceToLineSegment(local, primitiveA.xy, primitiveB.xy),
    heprDistanceToQuadraticBezier(local, primitiveA.xy, primitiveA.zw, primitiveB.xy),
    strokeCurveEnabled >= 0.5 && primitiveB.z >= 0.5
  );
  let localPerPixel = max(max(pixelToLocalX, pixelToLocalY), 0.000001);
  let isHairline = heprGradientFloatMod(styleFlags, 2.0) >= 0.5;
  let halfWidth = select(halfWidthFromVertex, max(0.5 * localPerPixel, 0.00001), isHairline);
  let aaWorld = max(localPerPixel * aaScreenPx, 0.00005);
  let coverage = heprStrokeCoverage(distanceToSegment, halfWidth, aaWorld);
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
`,[W(mn),W(Tn),W(En),W(Dn),W(_n)]);function Mn(e){let n=Fn(),r=I(e.localToClip,e.pageBinding),i=P.uniform(0);N(n,i);let a=P.uniform(1),o=P.uniform(0),s=P.uniform(Math.max(1,e.fillPathTextureWidth)),c=P.uniform(Math.max(1,e.fillSegmentTextureWidth)),l=P.uniform(Math.max(1,e.gradientMetaTextureWidth)),u=P.attribute(`aFillPathIndex`,`float`),d=G(pn,{index:u,width:s}),f=K(P.textureLoad(e.fillPathMetaTextureA,d,0),!0),p=K(P.textureLoad(e.fillPathMetaTextureB,d,0),!0),m=K(P.textureLoad(e.fillPathMetaTextureC,d,0),!0),h=K(G(dn,{pathIndex:u,base:P.uniform(e.fillBandBase??-1),segments:P.textureLoad(e.fillSegmentTextureA)}),!0),g=K(G(fn,{pathIndex:u,headers:P.uniform((e.fillCellBase??-1)+1),segments:P.textureLoad(e.fillSegmentTextureA)}),!0),_=P.uniform(e.viewport),v=r.matrix,y=K(e.mesh?P.vec4(P.attribute(`aMeshPosition`,`vec2`),1,0):G(Sn,{corner:P.attribute(`aCorner`,`vec2`),metaA:f,metaB:p,metaC:m,clipBounds:P.uniform(e.clipBounds??new M().fromArray(t)),shapeOnly:i,viewport:_,zoom:a,useLocalToClip:o,localToClip:v})),b=y;return n.vertexNode=G(Cn,{vertexPack:y,viewport:_,cameraCenter:P.uniform(e.cameraCenter),zoom:a,useLocalToClip:o,localToClip:v}),r.finish(n),n.fragmentNode=G(On[e.colorCompositing],{local:b.xy,metaA:f,metaB:p,metaC:m,segmentTexA:P.textureLoad(e.fillSegmentTextureA),segmentTexB:P.textureLoad(e.fillSegmentTextureB),segmentTexWidth:c,bands:h,bandEntries:P.uniform(e.fillBandEntries??0),cells:g,...Pn(e,l),fillAAScreenPx:P.uniform(1),meshColor:e.mesh?K(P.attribute(`aMeshColor`,`vec4`)):P.vec4(0),useMesh:P.uniform(+!!e.mesh),shapeOnly:i,vectorOverride:P.uniform(e.vectorOverride),primitiveColor:P.uniform(e.primitiveColor)}),L(n,b.xy,`straight-alpha`),{material:n,zoomUniform:a,useLocalToClipUniform:o}}function Nn(e){let t=Fn(),n=I(e.localToClip,e.pageBinding),r=P.uniform(0);N(t,r);let i=P.uniform(1),a=P.uniform(0),o=P.uniform(1),s=P.uniform(+!!e.strokeCurveEnabled),c=P.uniform(Math.max(1,e.segmentTextureWidth)),l=P.uniform(Math.max(1,e.gradientMetaTextureWidth)),u=G(pn,{index:P.attribute(`aSegmentIndex`,`float`),width:c}),d=K(P.textureLoad(e.segmentTextureA,u,0),!0),f=K(P.textureLoad(e.segmentTextureB,u,0),!0),p=K(P.textureLoad(e.segmentStyleTexture,u,0),!0),m=K(P.textureLoad(e.segmentBoundsTexture,u,0),!0),h=K(G(An,{corner:P.attribute(`aCorner`,`vec2`),primitiveA:d,primitiveB:f,style:p,primitiveBounds:m,zoom:i,useLocalToClip:a,localUnitsPerPixelInput:n.units??o,aaScreenPx:P.uniform(1),shapeOnly:r})),g=h;return t.vertexNode=G(wn,{worldPack:h,viewport:P.uniform(e.viewport),cameraCenter:P.uniform(e.cameraCenter),zoom:i,useLocalToClip:a,localToClip:n.matrix}),n.finish(t),t.fragmentNode=G(jn[e.colorCompositing],{local:g.xy,primitiveA:d,primitiveB:f,style:p,primitiveBounds:m,shapeOnly:r,halfWidthFromVertex:g.z,strokeCurveEnabled:s,aaScreenPx:P.uniform(1),vectorOverride:P.uniform(e.vectorOverride),primitiveColor:P.uniform(e.primitiveColor),...Pn(e,l)}),L(t,g.xy,`straight-alpha`),{material:t,zoomUniform:i,useLocalToClipUniform:a,localUnitsPerPixelUniform:o,curveUniform:s}}function Pn(e,t){return{gradientMetaA:P.textureLoad(e.gradientMetaTextureA),gradientMetaB:P.textureLoad(e.gradientMetaTextureB),gradientMetaC:P.textureLoad(e.gradientMetaTextureC),gradientMetaD:P.textureLoad(e.gradientMetaTextureD),gradientMetaE:P.textureLoad(e.gradientMetaTextureE),gradientLut:P.textureLoad(e.gradientLutTexture),gradientMetaWidth:t,sourceGradientIndex:P.uniform(e.sourceGradientIndex),maskGradientIndex:P.uniform(e.maskGradientIndex)}}function Fn(){let e=new F;return e.transparent=!1,e.depthTest=!1,e.depthWrite=!1,e.side=2,e.toneMapped=!1,e.fog=!1,e.lights=!1,se(e),e}var In=P.wgslFn(p),Ln=P.wgslFn(D,[In]),Rn=P.wgslFn(E,[In,Ln]),zn=P.wgslFn(C),Bn=P.wgslFn(g),Vn=R(`
fn heprThreePrimitiveHighlight(point:vec2<f32>,a:vec4<f32>,b:vec4<f32>,index:f32,
  pixelRatio:f32,selectionCount:f32,clipTexture:texture_2d<f32>) -> vec4<f32> {
  let alpha=heprPrimitiveHighlightCoverage(point,a,b,pixelRatio)*heprVectorClip(point,b.w,clipTexture);
  if (alpha<=0.001) { discard; }
  let color=select(vec3<f32>(${o.join(`,`)}),
    vec3<f32>(${u.join(`,`)}),index<selectionCount);
  return vec4<f32>(heprThreeOutputColor(color),alpha);
}`,[Rn,Bn]);function Hn(e,t){return e(t)}function Un(e){let t=P.uniform(1),n=P.uniform(1),r=P.uniform(0),i=new F,a=P.varying(P.attribute(`aSegmentA`,`vec4`)),o=P.varying(P.attribute(`aSegmentB`,`vec4`)),s=P.varying(Hn(zn,{corner:P.attribute(`aCorner`,`vec2`),a,b:o,localUnitsPerPixel:t,pixelRatio:n}));return i.vertexNode=P.mul(P.uniform(e.matrix),P.vec4(s,0,1)),i.fragmentNode=Hn(Vn[e.colorCompositing],{point:s,a,b:o,index:P.varying(P.attribute(`aHighlightIndex`,`float`)),pixelRatio:n,selectionCount:r,clipTexture:P.textureLoad(e.clips)}),i.depthTest=i.depthWrite=!1,i.side=2,i.toneMapped=!1,{material:i,units:t,pixelRatio:n,selectionCount:r}}function Wn(e,t){return e(t)}function Gn(e,t){let n=e;return n.name=t,n.getUniformHash=()=>`hepr-composite-${t}`,e}var Kn=P.wgslFn(`
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
}`,[P.wgslFn(k(`wgsl`))]),qn=P.wgslFn(`
fn heprPresentComposite(color:vec4f) -> vec4f {
  return vec4f(color.rgb/max(color.a,0.0000001),color.a);
}`);function Jn(e){let t=[`uSource`,`uShape`,`uCurrent`,`uStats`,`uInitial`,`uMask`,`uTransfer`],n=new F,r=t.slice(0,6).map(t=>{let n=P.textureLoad(e.zero,P.screenCoordinate),r=P.vec2(P.textureSize(n));return n.uvNode=P.clamp(P.screenCoordinate,P.vec2(0),r.sub(1)),Gn(n,t)});e.bindings.push(...r);let i=P.uniform(e.passRect);n.vertexNode=P.vec4(P.mix(i.xy,i.zw,P.positionLocal.xy),0,1);let a=Gn(P.textureLoad(e.zero),t[6]);e.bindings.push(a),n.fragmentNode=Wn(Kn,{source:r[0],shape:r[1],current:r[2],stats:r[3],initial:r[4],mask:r[5],transferTex:a,p:P.uniform(e.params),q:P.uniform(e.extra),backdrop:P.uniform(e.backdropColor)});let o=new F;o.vertexNode=Wn(P.wgslFn(`fn heprPagePresentPosition(position: vec3f, depth: vec3f) -> vec4f {
    return vec4f(position.xy, dot(depth, vec3f(position.xy, 1.0)), 1.0);
  }`),{position:P.positionLocal,depth:P.uniform(e.pageDepth)});let s=P.texture(e.presentZero,P.uv().flipY());return o.fragmentNode=Wn(qn,{color:s}),{passMaterial:n,presentationBinding:s,mesh:new oe(e.geometry,o)}}var Yn=2e3,Xn={};function Zn(e){let t=e[0];if(typeof t==`string`&&t.startsWith(`TSL:`)){let t=e[1];t&&t.isStackTrace?e[0]+=` `+t.getLocation():e[1]=`Stack trace not available. Enable "THREE.Node.captureStackTrace" to capture stack traces.`}return e}function Qn(...e){e=Zn(e);let t=`THREE.`+e.shift();{let n=e[0];n&&n.isStackTrace?console.warn(n.getError(t)):console.warn(t,...e)}}function $n(...e){let t=e.join(` `);t in Xn||(Xn[t]=!0,Qn(...e))}var er=class e{static{e.prototype.isMatrix3=!0}constructor(e,t,n,r,i,a,o,s,c){this.elements=[1,0,0,0,1,0,0,0,1],e!==void 0&&this.set(e,t,n,r,i,a,o,s,c)}set(e,t,n,r,i,a,o,s,c){let l=this.elements;return l[0]=e,l[1]=r,l[2]=o,l[3]=t,l[4]=i,l[5]=s,l[6]=n,l[7]=a,l[8]=c,this}identity(){return this.set(1,0,0,0,1,0,0,0,1),this}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],this}extractBasis(e,t,n){return e.setFromMatrix3Column(this,0),t.setFromMatrix3Column(this,1),n.setFromMatrix3Column(this,2),this}setFromMatrix4(e){let t=e.elements;return this.set(t[0],t[4],t[8],t[1],t[5],t[9],t[2],t[6],t[10]),this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,r=t.elements,i=this.elements,a=n[0],o=n[3],s=n[6],c=n[1],l=n[4],u=n[7],d=n[2],f=n[5],p=n[8],m=r[0],h=r[3],g=r[6],_=r[1],v=r[4],y=r[7],b=r[2],x=r[5],S=r[8];return i[0]=a*m+o*_+s*b,i[3]=a*h+o*v+s*x,i[6]=a*g+o*y+s*S,i[1]=c*m+l*_+u*b,i[4]=c*h+l*v+u*x,i[7]=c*g+l*y+u*S,i[2]=d*m+f*_+p*b,i[5]=d*h+f*v+p*x,i[8]=d*g+f*y+p*S,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[3]*=e,t[6]*=e,t[1]*=e,t[4]*=e,t[7]*=e,t[2]*=e,t[5]*=e,t[8]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=e[6],c=e[7],l=e[8];return t*a*l-t*o*c-n*i*l+n*o*s+r*i*c-r*a*s}invert(){let e=this.elements,t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=e[6],c=e[7],l=e[8],u=l*a-o*c,d=o*s-l*i,f=c*i-a*s,p=t*u+n*d+r*f;if(p===0)return this.set(0,0,0,0,0,0,0,0,0);let m=1/p;return e[0]=u*m,e[1]=(r*c-l*n)*m,e[2]=(o*n-r*a)*m,e[3]=d*m,e[4]=(l*t-r*s)*m,e[5]=(r*i-o*t)*m,e[6]=f*m,e[7]=(n*s-c*t)*m,e[8]=(a*t-n*i)*m,this}transpose(){let e,t=this.elements;return e=t[1],t[1]=t[3],t[3]=e,e=t[2],t[2]=t[6],t[6]=e,e=t[5],t[5]=t[7],t[7]=e,this}getNormalMatrix(e){return this.setFromMatrix4(e).invert().transpose()}transposeIntoArray(e){let t=this.elements;return e[0]=t[0],e[1]=t[3],e[2]=t[6],e[3]=t[1],e[4]=t[4],e[5]=t[7],e[6]=t[2],e[7]=t[5],e[8]=t[8],this}setUvTransform(e,t,n,r,i,a,o){let s=Math.cos(i),c=Math.sin(i);return this.set(n*s,n*c,-n*(s*a+c*o)+a+e,-r*c,r*s,-r*(-c*a+s*o)+o+t,0,0,1),this}scale(e,t){return $n(`Matrix3: .scale() is deprecated. Use .makeScale() instead.`),this.premultiply(tr.makeScale(e,t)),this}rotate(e){return $n(`Matrix3: .rotate() is deprecated. Use .makeRotation() instead.`),this.premultiply(tr.makeRotation(-e)),this}translate(e,t){return $n(`Matrix3: .translate() is deprecated. Use .makeTranslation() instead.`),this.premultiply(tr.makeTranslation(e,t)),this}makeTranslation(e,t){return e.isVector2?this.set(1,0,e.x,0,1,e.y,0,0,1):this.set(1,0,e,0,1,t,0,0,1),this}makeRotation(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,n,t,0,0,0,1),this}makeScale(e,t){return this.set(e,0,0,0,t,0,0,0,1),this}equals(e){let t=this.elements,n=e.elements;for(let e=0;e<9;e++)if(t[e]!==n[e])return!1;return!0}fromArray(e,t=0){for(let n=0;n<9;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e}clone(){return new this.constructor().fromArray(this.elements)}},tr=new er;function q(e,t,n){return Math.max(t,Math.min(n,e))}var nr=class{constructor(e=0,t=0,n=0,r=1){this.isQuaternion=!0,this._x=e,this._y=t,this._z=n,this._w=r}static slerpFlat(e,t,n,r,i,a,o){let s=n[r+0],c=n[r+1],l=n[r+2],u=n[r+3],d=i[a+0],f=i[a+1],p=i[a+2],m=i[a+3];if(u!==m||s!==d||c!==f||l!==p){let e=s*d+c*f+l*p+u*m;e<0&&(d=-d,f=-f,p=-p,m=-m,e=-e);let t=1-o;if(e<.9995){let n=Math.acos(e),r=Math.sin(n);t=Math.sin(t*n)/r,o=Math.sin(o*n)/r,s=s*t+d*o,c=c*t+f*o,l=l*t+p*o,u=u*t+m*o}else{s=s*t+d*o,c=c*t+f*o,l=l*t+p*o,u=u*t+m*o;let e=1/Math.sqrt(s*s+c*c+l*l+u*u);s*=e,c*=e,l*=e,u*=e}}e[t]=s,e[t+1]=c,e[t+2]=l,e[t+3]=u}static multiplyQuaternionsFlat(e,t,n,r,i,a){let o=n[r],s=n[r+1],c=n[r+2],l=n[r+3],u=i[a],d=i[a+1],f=i[a+2],p=i[a+3];return e[t]=o*p+l*u+s*f-c*d,e[t+1]=s*p+l*d+c*u-o*f,e[t+2]=c*p+l*f+o*d-s*u,e[t+3]=l*p-o*u-s*d-c*f,e}get x(){return this._x}set x(e){this._x=e,this._onChangeCallback()}get y(){return this._y}set y(e){this._y=e,this._onChangeCallback()}get z(){return this._z}set z(e){this._z=e,this._onChangeCallback()}get w(){return this._w}set w(e){this._w=e,this._onChangeCallback()}set(e,t,n,r){return this._x=e,this._y=t,this._z=n,this._w=r,this._onChangeCallback(),this}clone(){return new this.constructor(this._x,this._y,this._z,this._w)}copy(e){return this._x=e.x,this._y=e.y,this._z=e.z,this._w=e.w,this._onChangeCallback(),this}setFromEuler(e,t=!0){let n=e._x,r=e._y,i=e._z,a=e._order,o=Math.cos,s=Math.sin,c=o(n/2),l=o(r/2),u=o(i/2),d=s(n/2),f=s(r/2),p=s(i/2);switch(a){case`XYZ`:this._x=d*l*u+c*f*p,this._y=c*f*u-d*l*p,this._z=c*l*p+d*f*u,this._w=c*l*u-d*f*p;break;case`YXZ`:this._x=d*l*u+c*f*p,this._y=c*f*u-d*l*p,this._z=c*l*p-d*f*u,this._w=c*l*u+d*f*p;break;case`ZXY`:this._x=d*l*u-c*f*p,this._y=c*f*u+d*l*p,this._z=c*l*p+d*f*u,this._w=c*l*u-d*f*p;break;case`ZYX`:this._x=d*l*u-c*f*p,this._y=c*f*u+d*l*p,this._z=c*l*p-d*f*u,this._w=c*l*u+d*f*p;break;case`YZX`:this._x=d*l*u+c*f*p,this._y=c*f*u+d*l*p,this._z=c*l*p-d*f*u,this._w=c*l*u-d*f*p;break;case`XZY`:this._x=d*l*u-c*f*p,this._y=c*f*u-d*l*p,this._z=c*l*p+d*f*u,this._w=c*l*u+d*f*p;break;default:Qn(`Quaternion: .setFromEuler() encountered an unknown order: `+a)}return t===!0&&this._onChangeCallback(),this}setFromAxisAngle(e,t){let n=t/2,r=Math.sin(n);return this._x=e.x*r,this._y=e.y*r,this._z=e.z*r,this._w=Math.cos(n),this._onChangeCallback(),this}setFromRotationMatrix(e){let t=e.elements,n=t[0],r=t[4],i=t[8],a=t[1],o=t[5],s=t[9],c=t[2],l=t[6],u=t[10],d=n+o+u;if(d>0){let e=.5/Math.sqrt(d+1);this._w=.25/e,this._x=(l-s)*e,this._y=(i-c)*e,this._z=(a-r)*e}else if(n>o&&n>u){let e=2*Math.sqrt(1+n-o-u);this._w=(l-s)/e,this._x=.25*e,this._y=(r+a)/e,this._z=(i+c)/e}else if(o>u){let e=2*Math.sqrt(1+o-n-u);this._w=(i-c)/e,this._x=(r+a)/e,this._y=.25*e,this._z=(s+l)/e}else{let e=2*Math.sqrt(1+u-n-o);this._w=(a-r)/e,this._x=(i+c)/e,this._y=(s+l)/e,this._z=.25*e}return this._onChangeCallback(),this}setFromUnitVectors(e,t){let n=e.dot(t)+1;return n<1e-8?(n=0,Math.abs(e.x)>Math.abs(e.z)?(this._x=-e.y,this._y=e.x,this._z=0,this._w=n):(this._x=0,this._y=-e.z,this._z=e.y,this._w=n)):(this._x=e.y*t.z-e.z*t.y,this._y=e.z*t.x-e.x*t.z,this._z=e.x*t.y-e.y*t.x,this._w=n),this.normalize()}angleTo(e){return 2*Math.acos(Math.abs(q(this.dot(e),-1,1)))}rotateTowards(e,t){let n=this.angleTo(e);if(n===0)return this;let r=Math.min(1,t/n);return this.slerp(e,r),this}identity(){return this.set(0,0,0,1)}invert(){return this.conjugate()}conjugate(){return this._x*=-1,this._y*=-1,this._z*=-1,this._onChangeCallback(),this}dot(e){return this._x*e._x+this._y*e._y+this._z*e._z+this._w*e._w}lengthSq(){return this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w}length(){return Math.sqrt(this._x*this._x+this._y*this._y+this._z*this._z+this._w*this._w)}normalize(){let e=this.length();return e===0?(this._x=0,this._y=0,this._z=0,this._w=1):(e=1/e,this._x*=e,this._y*=e,this._z*=e,this._w*=e),this._onChangeCallback(),this}multiply(e){return this.multiplyQuaternions(this,e)}premultiply(e){return this.multiplyQuaternions(e,this)}multiplyQuaternions(e,t){let n=e._x,r=e._y,i=e._z,a=e._w,o=t._x,s=t._y,c=t._z,l=t._w;return this._x=n*l+a*o+r*c-i*s,this._y=r*l+a*s+i*o-n*c,this._z=i*l+a*c+n*s-r*o,this._w=a*l-n*o-r*s-i*c,this._onChangeCallback(),this}slerp(e,t){let n=e._x,r=e._y,i=e._z,a=e._w,o=this.dot(e);o<0&&(n=-n,r=-r,i=-i,a=-a,o=-o);let s=1-t;if(o<.9995){let e=Math.acos(o),c=Math.sin(e);s=Math.sin(s*e)/c,t=Math.sin(t*e)/c,this._x=this._x*s+n*t,this._y=this._y*s+r*t,this._z=this._z*s+i*t,this._w=this._w*s+a*t,this._onChangeCallback()}else this._x=this._x*s+n*t,this._y=this._y*s+r*t,this._z=this._z*s+i*t,this._w=this._w*s+a*t,this.normalize();return this}slerpQuaternions(e,t,n){return this.copy(e).slerp(t,n)}random(){let e=2*Math.PI*Math.random(),t=2*Math.PI*Math.random(),n=Math.random(),r=Math.sqrt(1-n),i=Math.sqrt(n);return this.set(r*Math.sin(e),r*Math.cos(e),i*Math.sin(t),i*Math.cos(t))}equals(e){return e._x===this._x&&e._y===this._y&&e._z===this._z&&e._w===this._w}fromArray(e,t=0){return this._x=e[t],this._y=e[t+1],this._z=e[t+2],this._w=e[t+3],this._onChangeCallback(),this}toArray(e=[],t=0){return e[t]=this._x,e[t+1]=this._y,e[t+2]=this._z,e[t+3]=this._w,e}fromBufferAttribute(e,t){return this._x=e.getX(t),this._y=e.getY(t),this._z=e.getZ(t),this._w=e.getW(t),this._onChangeCallback(),this}toJSON(){return this.toArray()}_onChange(e){return this._onChangeCallback=e,this}_onChangeCallback(){}*[Symbol.iterator](){yield this._x,yield this._y,yield this._z,yield this._w}},J=class e{static{e.prototype.isVector3=!0}constructor(e=0,t=0,n=0){this.x=e,this.y=t,this.z=n}set(e,t,n){return n===void 0&&(n=this.z),this.x=e,this.y=t,this.z=n,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;default:throw Error(`THREE.Vector3: index is out of range: `+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;default:throw Error(`THREE.Vector3: index is out of range: `+e)}}clone(){return new this.constructor(this.x,this.y,this.z)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this}multiplyVectors(e,t){return this.x=e.x*t.x,this.y=e.y*t.y,this.z=e.z*t.z,this}applyEuler(e){return this.applyQuaternion(ir.setFromEuler(e))}applyAxisAngle(e,t){return this.applyQuaternion(ir.setFromAxisAngle(e,t))}applyMatrix3(e){let t=this.x,n=this.y,r=this.z,i=e.elements;return this.x=i[0]*t+i[3]*n+i[6]*r,this.y=i[1]*t+i[4]*n+i[7]*r,this.z=i[2]*t+i[5]*n+i[8]*r,this}applyNormalMatrix(e){return this.applyMatrix3(e).normalize()}applyMatrix4(e){let t=this.x,n=this.y,r=this.z,i=e.elements,a=1/(i[3]*t+i[7]*n+i[11]*r+i[15]);return this.x=(i[0]*t+i[4]*n+i[8]*r+i[12])*a,this.y=(i[1]*t+i[5]*n+i[9]*r+i[13])*a,this.z=(i[2]*t+i[6]*n+i[10]*r+i[14])*a,this}applyQuaternion(e){let t=this.x,n=this.y,r=this.z,i=e.x,a=e.y,o=e.z,s=e.w,c=2*(a*r-o*n),l=2*(o*t-i*r),u=2*(i*n-a*t);return this.x=t+s*c+a*u-o*l,this.y=n+s*l+o*c-i*u,this.z=r+s*u+i*l-a*c,this}project(e){return this.applyMatrix4(e.matrixWorldInverse).applyMatrix4(e.projectionMatrix)}unproject(e){return this.applyMatrix4(e.projectionMatrixInverse).applyMatrix4(e.matrixWorld)}transformDirection(e){let t=this.x,n=this.y,r=this.z,i=e.elements;return this.x=i[0]*t+i[4]*n+i[8]*r,this.y=i[1]*t+i[5]*n+i[9]*r,this.z=i[2]*t+i[6]*n+i[10]*r,this.normalize()}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this}divideScalar(e){return this.multiplyScalar(1/e)}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this}clamp(e,t){return this.x=q(this.x,e.x,t.x),this.y=q(this.y,e.y,t.y),this.z=q(this.z,e.z,t.z),this}clampScalar(e,t){return this.x=q(this.x,e,t),this.y=q(this.y,e,t),this.z=q(this.z,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(q(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this}cross(e){return this.crossVectors(this,e)}crossVectors(e,t){let n=e.x,r=e.y,i=e.z,a=t.x,o=t.y,s=t.z;return this.x=r*s-i*o,this.y=i*a-n*s,this.z=n*o-r*a,this}projectOnVector(e){let t=e.lengthSq();if(t===0)return this.set(0,0,0);let n=e.dot(this)/t;return this.copy(e).multiplyScalar(n)}projectOnPlane(e){return rr.copy(this).projectOnVector(e),this.sub(rr)}reflect(e){return this.sub(rr.copy(e).multiplyScalar(2*this.dot(e)))}angleTo(e){let t=Math.sqrt(this.lengthSq()*e.lengthSq());if(t===0)return Math.PI/2;let n=this.dot(e)/t;return Math.acos(q(n,-1,1))}distanceTo(e){return Math.sqrt(this.distanceToSquared(e))}distanceToSquared(e){let t=this.x-e.x,n=this.y-e.y,r=this.z-e.z;return t*t+n*n+r*r}manhattanDistanceTo(e){return Math.abs(this.x-e.x)+Math.abs(this.y-e.y)+Math.abs(this.z-e.z)}setFromSpherical(e){return this.setFromSphericalCoords(e.radius,e.phi,e.theta)}setFromSphericalCoords(e,t,n){let r=Math.sin(t)*e;return this.x=r*Math.sin(n),this.y=Math.cos(t)*e,this.z=r*Math.cos(n),this}setFromCylindrical(e){return this.setFromCylindricalCoords(e.radius,e.theta,e.y)}setFromCylindricalCoords(e,t,n){return this.x=e*Math.sin(t),this.y=n,this.z=e*Math.cos(t),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this}setFromMatrixScale(e){let t=this.setFromMatrixColumn(e,0).length(),n=this.setFromMatrixColumn(e,1).length(),r=this.setFromMatrixColumn(e,2).length();return this.x=t,this.y=n,this.z=r,this}setFromMatrixColumn(e,t){return this.fromArray(e.elements,t*4)}setFromMatrix3Column(e,t){return this.fromArray(e.elements,t*3)}setFromEuler(e){return this.x=e._x,this.y=e._y,this.z=e._z,this}setFromColor(e){return this.x=e.r,this.y=e.g,this.z=e.b,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this}randomDirection(){let e=Math.random()*Math.PI*2,t=Math.random()*2-1,n=Math.sqrt(1-t*t);return this.x=n*Math.cos(e),this.y=t,this.z=n*Math.sin(e),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z}},rr=new J,ir=new nr,ar=class e{static{e.prototype.isMatrix4=!0}constructor(e,t,n,r,i,a,o,s,c,l,u,d,f,p,m,h){this.elements=[1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1],e!==void 0&&this.set(e,t,n,r,i,a,o,s,c,l,u,d,f,p,m,h)}set(e,t,n,r,i,a,o,s,c,l,u,d,f,p,m,h){let g=this.elements;return g[0]=e,g[4]=t,g[8]=n,g[12]=r,g[1]=i,g[5]=a,g[9]=o,g[13]=s,g[2]=c,g[6]=l,g[10]=u,g[14]=d,g[3]=f,g[7]=p,g[11]=m,g[15]=h,this}identity(){return this.set(1,0,0,0,0,1,0,0,0,0,1,0,0,0,0,1),this}clone(){return new e().fromArray(this.elements)}copy(e){let t=this.elements,n=e.elements;return t[0]=n[0],t[1]=n[1],t[2]=n[2],t[3]=n[3],t[4]=n[4],t[5]=n[5],t[6]=n[6],t[7]=n[7],t[8]=n[8],t[9]=n[9],t[10]=n[10],t[11]=n[11],t[12]=n[12],t[13]=n[13],t[14]=n[14],t[15]=n[15],this}copyPosition(e){let t=this.elements,n=e.elements;return t[12]=n[12],t[13]=n[13],t[14]=n[14],this}setFromMatrix3(e){let t=e.elements;return this.set(t[0],t[3],t[6],0,t[1],t[4],t[7],0,t[2],t[5],t[8],0,0,0,0,1),this}extractBasis(e,t,n){return this.determinantAffine()===0?(e.set(1,0,0),t.set(0,1,0),n.set(0,0,1),this):(e.setFromMatrixColumn(this,0),t.setFromMatrixColumn(this,1),n.setFromMatrixColumn(this,2),this)}makeBasis(e,t,n){return this.set(e.x,t.x,n.x,0,e.y,t.y,n.y,0,e.z,t.z,n.z,0,0,0,0,1),this}extractRotation(e){if(e.determinantAffine()===0)return this.identity();let t=this.elements,n=e.elements,r=1/or.setFromMatrixColumn(e,0).length(),i=1/or.setFromMatrixColumn(e,1).length(),a=1/or.setFromMatrixColumn(e,2).length();return t[0]=n[0]*r,t[1]=n[1]*r,t[2]=n[2]*r,t[3]=0,t[4]=n[4]*i,t[5]=n[5]*i,t[6]=n[6]*i,t[7]=0,t[8]=n[8]*a,t[9]=n[9]*a,t[10]=n[10]*a,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromEuler(e){let t=this.elements,n=e.x,r=e.y,i=e.z,a=Math.cos(n),o=Math.sin(n),s=Math.cos(r),c=Math.sin(r),l=Math.cos(i),u=Math.sin(i);if(e.order===`XYZ`){let e=a*l,n=a*u,r=o*l,i=o*u;t[0]=s*l,t[4]=-s*u,t[8]=c,t[1]=n+r*c,t[5]=e-i*c,t[9]=-o*s,t[2]=i-e*c,t[6]=r+n*c,t[10]=a*s}else if(e.order===`YXZ`){let e=s*l,n=s*u,r=c*l,i=c*u;t[0]=e+i*o,t[4]=r*o-n,t[8]=a*c,t[1]=a*u,t[5]=a*l,t[9]=-o,t[2]=n*o-r,t[6]=i+e*o,t[10]=a*s}else if(e.order===`ZXY`){let e=s*l,n=s*u,r=c*l,i=c*u;t[0]=e-i*o,t[4]=-a*u,t[8]=r+n*o,t[1]=n+r*o,t[5]=a*l,t[9]=i-e*o,t[2]=-a*c,t[6]=o,t[10]=a*s}else if(e.order===`ZYX`){let e=a*l,n=a*u,r=o*l,i=o*u;t[0]=s*l,t[4]=r*c-n,t[8]=e*c+i,t[1]=s*u,t[5]=i*c+e,t[9]=n*c-r,t[2]=-c,t[6]=o*s,t[10]=a*s}else if(e.order===`YZX`){let e=a*s,n=a*c,r=o*s,i=o*c;t[0]=s*l,t[4]=i-e*u,t[8]=r*u+n,t[1]=u,t[5]=a*l,t[9]=-o*l,t[2]=-c*l,t[6]=n*u+r,t[10]=e-i*u}else if(e.order===`XZY`){let e=a*s,n=a*c,r=o*s,i=o*c;t[0]=s*l,t[4]=-u,t[8]=c*l,t[1]=e*u+i,t[5]=a*l,t[9]=n*u-r,t[2]=r*u-n,t[6]=o*l,t[10]=i*u+e}return t[3]=0,t[7]=0,t[11]=0,t[12]=0,t[13]=0,t[14]=0,t[15]=1,this}makeRotationFromQuaternion(e){return this.compose(sr,e,cr)}lookAt(e,t,n){let r=this.elements;return Z.subVectors(e,t),Z.lengthSq()===0&&(Z.z=1),Z.normalize(),X.crossVectors(n,Z),X.lengthSq()===0&&(Math.abs(n.z)===1?Z.x+=1e-4:Z.z+=1e-4,Z.normalize(),X.crossVectors(n,Z)),X.normalize(),lr.crossVectors(Z,X),r[0]=X.x,r[4]=lr.x,r[8]=Z.x,r[1]=X.y,r[5]=lr.y,r[9]=Z.y,r[2]=X.z,r[6]=lr.z,r[10]=Z.z,this}multiply(e){return this.multiplyMatrices(this,e)}premultiply(e){return this.multiplyMatrices(e,this)}multiplyMatrices(e,t){let n=e.elements,r=t.elements,i=this.elements,a=n[0],o=n[4],s=n[8],c=n[12],l=n[1],u=n[5],d=n[9],f=n[13],p=n[2],m=n[6],h=n[10],g=n[14],_=n[3],v=n[7],y=n[11],b=n[15],x=r[0],S=r[4],C=r[8],w=r[12],T=r[1],E=r[5],D=r[9],O=r[13],k=r[2],A=r[6],ee=r[10],te=r[14],j=r[3],ne=r[7],M=r[11],re=r[15];return i[0]=a*x+o*T+s*k+c*j,i[4]=a*S+o*E+s*A+c*ne,i[8]=a*C+o*D+s*ee+c*M,i[12]=a*w+o*O+s*te+c*re,i[1]=l*x+u*T+d*k+f*j,i[5]=l*S+u*E+d*A+f*ne,i[9]=l*C+u*D+d*ee+f*M,i[13]=l*w+u*O+d*te+f*re,i[2]=p*x+m*T+h*k+g*j,i[6]=p*S+m*E+h*A+g*ne,i[10]=p*C+m*D+h*ee+g*M,i[14]=p*w+m*O+h*te+g*re,i[3]=_*x+v*T+y*k+b*j,i[7]=_*S+v*E+y*A+b*ne,i[11]=_*C+v*D+y*ee+b*M,i[15]=_*w+v*O+y*te+b*re,this}multiplyScalar(e){let t=this.elements;return t[0]*=e,t[4]*=e,t[8]*=e,t[12]*=e,t[1]*=e,t[5]*=e,t[9]*=e,t[13]*=e,t[2]*=e,t[6]*=e,t[10]*=e,t[14]*=e,t[3]*=e,t[7]*=e,t[11]*=e,t[15]*=e,this}determinant(){let e=this.elements,t=e[0],n=e[4],r=e[8],i=e[12],a=e[1],o=e[5],s=e[9],c=e[13],l=e[2],u=e[6],d=e[10],f=e[14],p=e[3],m=e[7],h=e[11],g=e[15],_=s*f-c*d,v=o*f-c*u,y=o*d-s*u,b=a*f-c*l,x=a*d-s*l,S=a*u-o*l;return t*(m*_-h*v+g*y)-n*(p*_-h*b+g*x)+r*(p*v-m*b+g*S)-i*(p*y-m*x+h*S)}determinantAffine(){let e=this.elements,t=e[0],n=e[4],r=e[8],i=e[1],a=e[5],o=e[9],s=e[2],c=e[6],l=e[10];return t*(a*l-o*c)-n*(i*l-o*s)+r*(i*c-a*s)}transpose(){let e=this.elements,t;return t=e[1],e[1]=e[4],e[4]=t,t=e[2],e[2]=e[8],e[8]=t,t=e[6],e[6]=e[9],e[9]=t,t=e[3],e[3]=e[12],e[12]=t,t=e[7],e[7]=e[13],e[13]=t,t=e[11],e[11]=e[14],e[14]=t,this}setPosition(e,t,n){let r=this.elements;return e.isVector3?(r[12]=e.x,r[13]=e.y,r[14]=e.z):(r[12]=e,r[13]=t,r[14]=n),this}invert(){let e=this.elements,t=e[0],n=e[1],r=e[2],i=e[3],a=e[4],o=e[5],s=e[6],c=e[7],l=e[8],u=e[9],d=e[10],f=e[11],p=e[12],m=e[13],h=e[14],g=e[15],_=t*o-n*a,v=t*s-r*a,y=t*c-i*a,b=n*s-r*o,x=n*c-i*o,S=r*c-i*s,C=l*m-u*p,w=l*h-d*p,T=l*g-f*p,E=u*h-d*m,D=u*g-f*m,O=d*g-f*h,k=_*O-v*D+y*E+b*T-x*w+S*C;if(k===0)return this.set(0,0,0,0,0,0,0,0,0,0,0,0,0,0,0,0);let A=1/k;return e[0]=(o*O-s*D+c*E)*A,e[1]=(r*D-n*O-i*E)*A,e[2]=(m*S-h*x+g*b)*A,e[3]=(d*x-u*S-f*b)*A,e[4]=(s*T-a*O-c*w)*A,e[5]=(t*O-r*T+i*w)*A,e[6]=(h*y-p*S-g*v)*A,e[7]=(l*S-d*y+f*v)*A,e[8]=(a*D-o*T+c*C)*A,e[9]=(n*T-t*D-i*C)*A,e[10]=(p*x-m*y+g*_)*A,e[11]=(u*y-l*x-f*_)*A,e[12]=(o*w-a*E-s*C)*A,e[13]=(t*E-n*w+r*C)*A,e[14]=(m*v-p*b-h*_)*A,e[15]=(l*b-u*v+d*_)*A,this}scale(e){let t=this.elements,n=e.x,r=e.y,i=e.z;return t[0]*=n,t[4]*=r,t[8]*=i,t[1]*=n,t[5]*=r,t[9]*=i,t[2]*=n,t[6]*=r,t[10]*=i,t[3]*=n,t[7]*=r,t[11]*=i,this}getMaxScaleOnAxis(){let e=this.elements,t=e[0]*e[0]+e[1]*e[1]+e[2]*e[2],n=e[4]*e[4]+e[5]*e[5]+e[6]*e[6],r=e[8]*e[8]+e[9]*e[9]+e[10]*e[10];return Math.sqrt(Math.max(t,n,r))}makeTranslation(e,t,n){return e.isVector3?this.set(1,0,0,e.x,0,1,0,e.y,0,0,1,e.z,0,0,0,1):this.set(1,0,0,e,0,1,0,t,0,0,1,n,0,0,0,1),this}makeRotationX(e){let t=Math.cos(e),n=Math.sin(e);return this.set(1,0,0,0,0,t,-n,0,0,n,t,0,0,0,0,1),this}makeRotationY(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,0,n,0,0,1,0,0,-n,0,t,0,0,0,0,1),this}makeRotationZ(e){let t=Math.cos(e),n=Math.sin(e);return this.set(t,-n,0,0,n,t,0,0,0,0,1,0,0,0,0,1),this}makeRotationAxis(e,t){let n=Math.cos(t),r=Math.sin(t),i=1-n,a=e.x,o=e.y,s=e.z,c=i*a,l=i*o;return this.set(c*a+n,c*o-r*s,c*s+r*o,0,c*o+r*s,l*o+n,l*s-r*a,0,c*s-r*o,l*s+r*a,i*s*s+n,0,0,0,0,1),this}makeScale(e,t,n){return this.set(e,0,0,0,0,t,0,0,0,0,n,0,0,0,0,1),this}makeShear(e,t,n,r,i,a){return this.set(1,n,i,0,e,1,a,0,t,r,1,0,0,0,0,1),this}compose(e,t,n){let r=this.elements,i=t._x,a=t._y,o=t._z,s=t._w,c=i+i,l=a+a,u=o+o,d=i*c,f=i*l,p=i*u,m=a*l,h=a*u,g=o*u,_=s*c,v=s*l,y=s*u,b=n.x,x=n.y,S=n.z;return r[0]=(1-(m+g))*b,r[1]=(f+y)*b,r[2]=(p-v)*b,r[3]=0,r[4]=(f-y)*x,r[5]=(1-(d+g))*x,r[6]=(h+_)*x,r[7]=0,r[8]=(p+v)*S,r[9]=(h-_)*S,r[10]=(1-(d+m))*S,r[11]=0,r[12]=e.x,r[13]=e.y,r[14]=e.z,r[15]=1,this}decompose(e,t,n){let r=this.elements;e.x=r[12],e.y=r[13],e.z=r[14];let i=this.determinantAffine();if(i===0)return n.set(1,1,1),t.identity(),this;let a=or.set(r[0],r[1],r[2]).length(),o=or.set(r[4],r[5],r[6]).length(),s=or.set(r[8],r[9],r[10]).length();i<0&&(a=-a),Y.copy(this);let c=1/a,l=1/o,u=1/s;return Y.elements[0]*=c,Y.elements[1]*=c,Y.elements[2]*=c,Y.elements[4]*=l,Y.elements[5]*=l,Y.elements[6]*=l,Y.elements[8]*=u,Y.elements[9]*=u,Y.elements[10]*=u,t.setFromRotationMatrix(Y),n.x=a,n.y=o,n.z=s,this}makePerspective(e,t,n,r,i,a,o=Yn,s=!1){let c=this.elements,l=2*i/(t-e),u=2*i/(n-r),d=(t+e)/(t-e),f=(n+r)/(n-r),p,m;if(s)p=i/(a-i),m=a*i/(a-i);else if(o===2e3)p=-(a+i)/(a-i),m=-2*a*i/(a-i);else if(o===2001)p=-a/(a-i),m=-a*i/(a-i);else throw Error(`THREE.Matrix4.makePerspective(): Invalid coordinate system: `+o);return c[0]=l,c[4]=0,c[8]=d,c[12]=0,c[1]=0,c[5]=u,c[9]=f,c[13]=0,c[2]=0,c[6]=0,c[10]=p,c[14]=m,c[3]=0,c[7]=0,c[11]=-1,c[15]=0,this}makeOrthographic(e,t,n,r,i,a,o=Yn,s=!1){let c=this.elements,l=2/(t-e),u=2/(n-r),d=-(t+e)/(t-e),f=-(n+r)/(n-r),p,m;if(s)p=1/(a-i),m=a/(a-i);else if(o===2e3)p=-2/(a-i),m=-(a+i)/(a-i);else if(o===2001)p=-1/(a-i),m=-i/(a-i);else throw Error(`THREE.Matrix4.makeOrthographic(): Invalid coordinate system: `+o);return c[0]=l,c[4]=0,c[8]=0,c[12]=d,c[1]=0,c[5]=u,c[9]=0,c[13]=f,c[2]=0,c[6]=0,c[10]=p,c[14]=m,c[3]=0,c[7]=0,c[11]=0,c[15]=1,this}equals(e){let t=this.elements,n=e.elements;for(let e=0;e<16;e++)if(t[e]!==n[e])return!1;return!0}fromArray(e,t=0){for(let n=0;n<16;n++)this.elements[n]=e[n+t];return this}toArray(e=[],t=0){let n=this.elements;return e[t]=n[0],e[t+1]=n[1],e[t+2]=n[2],e[t+3]=n[3],e[t+4]=n[4],e[t+5]=n[5],e[t+6]=n[6],e[t+7]=n[7],e[t+8]=n[8],e[t+9]=n[9],e[t+10]=n[10],e[t+11]=n[11],e[t+12]=n[12],e[t+13]=n[13],e[t+14]=n[14],e[t+15]=n[15],e}},or=new J,Y=new ar,sr=new J(0,0,0),cr=new J(1,1,1),X=new J,lr=new J,Z=new J,ur=new J,dr=new J,fr=new er,pr=class{constructor(e=new J(1,0,0),t=0){this.isPlane=!0,this.normal=e,this.constant=t}set(e,t){return this.normal.copy(e),this.constant=t,this}setComponents(e,t,n,r){return this.normal.set(e,t,n),this.constant=r,this}setFromNormalAndCoplanarPoint(e,t){return this.normal.copy(e),this.constant=-t.dot(this.normal),this}setFromCoplanarPoints(e,t,n){let r=ur.subVectors(n,t).cross(dr.subVectors(e,t)).normalize();return this.setFromNormalAndCoplanarPoint(r,e),this}copy(e){return this.normal.copy(e.normal),this.constant=e.constant,this}normalize(){let e=1/this.normal.length();return this.normal.multiplyScalar(e),this.constant*=e,this}negate(){return this.constant*=-1,this.normal.negate(),this}distanceToPoint(e){return this.normal.dot(e)+this.constant}distanceToSphere(e){return this.distanceToPoint(e.center)-e.radius}projectPoint(e,t){return t.copy(e).addScaledVector(this.normal,-this.distanceToPoint(e))}intersectLine(e,t,n=!0){let r=e.delta(ur),i=this.normal.dot(r);if(i===0)return this.distanceToPoint(e.start)===0?t.copy(e.start):null;let a=-(e.start.dot(this.normal)+this.constant)/i;return n===!0&&(a<0||a>1)?null:t.copy(e.start).addScaledVector(r,a)}intersectsLine(e){let t=this.distanceToPoint(e.start),n=this.distanceToPoint(e.end);return t<0&&n>0||n<0&&t>0}intersectsBox(e){return e.intersectsPlane(this)}intersectsSphere(e){return e.intersectsPlane(this)}coplanarPoint(e){return e.copy(this.normal).multiplyScalar(-this.constant)}applyMatrix4(e,t){let n=t||fr.getNormalMatrix(e),r=this.coplanarPoint(ur).applyMatrix4(e),i=this.normal.applyMatrix3(n).normalize();return this.constant=-r.dot(i),this}translate(e){return this.constant-=e.dot(this.normal),this}equals(e){return e.normal.equals(this.normal)&&e.constant===this.constant}clone(){return new this.constructor().copy(this)}toJSON(){return{normal:this.normal.toArray(),constant:this.constant}}fromJSON(e){return this.normal.fromArray(e.normal),this.constant=e.constant,this}},mr=class e{static{e.prototype.isVector4=!0}constructor(e=0,t=0,n=0,r=1){this.x=e,this.y=t,this.z=n,this.w=r}get width(){return this.z}set width(e){this.z=e}get height(){return this.w}set height(e){this.w=e}set(e,t,n,r){return this.x=e,this.y=t,this.z=n,this.w=r,this}setScalar(e){return this.x=e,this.y=e,this.z=e,this.w=e,this}setX(e){return this.x=e,this}setY(e){return this.y=e,this}setZ(e){return this.z=e,this}setW(e){return this.w=e,this}setComponent(e,t){switch(e){case 0:this.x=t;break;case 1:this.y=t;break;case 2:this.z=t;break;case 3:this.w=t;break;default:throw Error(`THREE.Vector4: index is out of range: `+e)}return this}getComponent(e){switch(e){case 0:return this.x;case 1:return this.y;case 2:return this.z;case 3:return this.w;default:throw Error(`THREE.Vector4: index is out of range: `+e)}}clone(){return new this.constructor(this.x,this.y,this.z,this.w)}copy(e){return this.x=e.x,this.y=e.y,this.z=e.z,this.w=e.w===void 0?1:e.w,this}add(e){return this.x+=e.x,this.y+=e.y,this.z+=e.z,this.w+=e.w,this}addScalar(e){return this.x+=e,this.y+=e,this.z+=e,this.w+=e,this}addVectors(e,t){return this.x=e.x+t.x,this.y=e.y+t.y,this.z=e.z+t.z,this.w=e.w+t.w,this}addScaledVector(e,t){return this.x+=e.x*t,this.y+=e.y*t,this.z+=e.z*t,this.w+=e.w*t,this}sub(e){return this.x-=e.x,this.y-=e.y,this.z-=e.z,this.w-=e.w,this}subScalar(e){return this.x-=e,this.y-=e,this.z-=e,this.w-=e,this}subVectors(e,t){return this.x=e.x-t.x,this.y=e.y-t.y,this.z=e.z-t.z,this.w=e.w-t.w,this}multiply(e){return this.x*=e.x,this.y*=e.y,this.z*=e.z,this.w*=e.w,this}multiplyScalar(e){return this.x*=e,this.y*=e,this.z*=e,this.w*=e,this}applyMatrix4(e){let t=this.x,n=this.y,r=this.z,i=this.w,a=e.elements;return this.x=a[0]*t+a[4]*n+a[8]*r+a[12]*i,this.y=a[1]*t+a[5]*n+a[9]*r+a[13]*i,this.z=a[2]*t+a[6]*n+a[10]*r+a[14]*i,this.w=a[3]*t+a[7]*n+a[11]*r+a[15]*i,this}divide(e){return this.x/=e.x,this.y/=e.y,this.z/=e.z,this.w/=e.w,this}divideScalar(e){return this.multiplyScalar(1/e)}setAxisAngleFromQuaternion(e){this.w=2*Math.acos(e.w);let t=Math.sqrt(1-e.w*e.w);return t<1e-4?(this.x=1,this.y=0,this.z=0):(this.x=e.x/t,this.y=e.y/t,this.z=e.z/t),this}setAxisAngleFromRotationMatrix(e){let t,n,r,i,a=.01,o=.1,s=e.elements,c=s[0],l=s[4],u=s[8],d=s[1],f=s[5],p=s[9],m=s[2],h=s[6],g=s[10];if(Math.abs(l-d)<a&&Math.abs(u-m)<a&&Math.abs(p-h)<a){if(Math.abs(l+d)<o&&Math.abs(u+m)<o&&Math.abs(p+h)<o&&Math.abs(c+f+g-3)<o)return this.set(1,0,0,0),this;t=Math.PI;let e=(c+1)/2,s=(f+1)/2,_=(g+1)/2,v=(l+d)/4,y=(u+m)/4,b=(p+h)/4;return e>s&&e>_?e<a?(n=0,r=.707106781,i=.707106781):(n=Math.sqrt(e),r=v/n,i=y/n):s>_?s<a?(n=.707106781,r=0,i=.707106781):(r=Math.sqrt(s),n=v/r,i=b/r):_<a?(n=.707106781,r=.707106781,i=0):(i=Math.sqrt(_),n=y/i,r=b/i),this.set(n,r,i,t),this}let _=Math.sqrt((h-p)*(h-p)+(u-m)*(u-m)+(d-l)*(d-l));return Math.abs(_)<.001&&(_=1),this.x=(h-p)/_,this.y=(u-m)/_,this.z=(d-l)/_,this.w=Math.acos((c+f+g-1)/2),this}setFromMatrixPosition(e){let t=e.elements;return this.x=t[12],this.y=t[13],this.z=t[14],this.w=t[15],this}min(e){return this.x=Math.min(this.x,e.x),this.y=Math.min(this.y,e.y),this.z=Math.min(this.z,e.z),this.w=Math.min(this.w,e.w),this}max(e){return this.x=Math.max(this.x,e.x),this.y=Math.max(this.y,e.y),this.z=Math.max(this.z,e.z),this.w=Math.max(this.w,e.w),this}clamp(e,t){return this.x=q(this.x,e.x,t.x),this.y=q(this.y,e.y,t.y),this.z=q(this.z,e.z,t.z),this.w=q(this.w,e.w,t.w),this}clampScalar(e,t){return this.x=q(this.x,e,t),this.y=q(this.y,e,t),this.z=q(this.z,e,t),this.w=q(this.w,e,t),this}clampLength(e,t){let n=this.length();return this.divideScalar(n||1).multiplyScalar(q(n,e,t))}floor(){return this.x=Math.floor(this.x),this.y=Math.floor(this.y),this.z=Math.floor(this.z),this.w=Math.floor(this.w),this}ceil(){return this.x=Math.ceil(this.x),this.y=Math.ceil(this.y),this.z=Math.ceil(this.z),this.w=Math.ceil(this.w),this}round(){return this.x=Math.round(this.x),this.y=Math.round(this.y),this.z=Math.round(this.z),this.w=Math.round(this.w),this}roundToZero(){return this.x=Math.trunc(this.x),this.y=Math.trunc(this.y),this.z=Math.trunc(this.z),this.w=Math.trunc(this.w),this}negate(){return this.x=-this.x,this.y=-this.y,this.z=-this.z,this.w=-this.w,this}dot(e){return this.x*e.x+this.y*e.y+this.z*e.z+this.w*e.w}lengthSq(){return this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w}length(){return Math.sqrt(this.x*this.x+this.y*this.y+this.z*this.z+this.w*this.w)}manhattanLength(){return Math.abs(this.x)+Math.abs(this.y)+Math.abs(this.z)+Math.abs(this.w)}normalize(){return this.divideScalar(this.length()||1)}setLength(e){return this.normalize().multiplyScalar(e)}lerp(e,t){return this.x+=(e.x-this.x)*t,this.y+=(e.y-this.y)*t,this.z+=(e.z-this.z)*t,this.w+=(e.w-this.w)*t,this}lerpVectors(e,t,n){return this.x=e.x+(t.x-e.x)*n,this.y=e.y+(t.y-e.y)*n,this.z=e.z+(t.z-e.z)*n,this.w=e.w+(t.w-e.w)*n,this}equals(e){return e.x===this.x&&e.y===this.y&&e.z===this.z&&e.w===this.w}fromArray(e,t=0){return this.x=e[t],this.y=e[t+1],this.z=e[t+2],this.w=e[t+3],this}toArray(e=[],t=0){return e[t]=this.x,e[t+1]=this.y,e[t+2]=this.z,e[t+3]=this.w,e}fromBufferAttribute(e,t){return this.x=e.getX(t),this.y=e.getY(t),this.z=e.getZ(t),this.w=e.getW(t),this}random(){return this.x=Math.random(),this.y=Math.random(),this.z=Math.random(),this.w=Math.random(),this}*[Symbol.iterator](){yield this.x,yield this.y,yield this.z,yield this.w}},hr=new pr,gr=0,_r=class e{constructor(e=null){this.id=gr++,this.version=0,this.clipIntersection=null,this.cacheKey=``,this.shadowPass=!1,this.viewMatrix=new ar,this.viewNormalMatrix=new er,this.clippingGroupContexts=new WeakMap,this.intersectionPlanes=[],this.unionPlanes=[],this.parentVersion=null,e!==null&&(this.viewMatrix=e.viewMatrix,this.viewNormalMatrix=e.viewNormalMatrix,this.clippingGroupContexts=e.clippingGroupContexts,this.shadowPass=e.shadowPass)}projectPlanes(e,t,n){let r=e.length;for(let i=0;i<r;i++){hr.copy(e[i]).applyMatrix4(this.viewMatrix,this.viewNormalMatrix);let r=t[n+i],a=hr.normal;r.x=-a.x,r.y=-a.y,r.z=-a.z,r.w=hr.constant}}updateGlobal(e,t){this.shadowPass=e.overrideMaterial!==null&&e.overrideMaterial.isShadowPassMaterial,this.viewMatrix.copy(t.matrixWorldInverse),this.viewNormalMatrix.getNormalMatrix(this.viewMatrix)}update(e,t){let n=!1;e.version!==this.parentVersion&&(this.intersectionPlanes=Array.from(e.intersectionPlanes),this.unionPlanes=Array.from(e.unionPlanes),this.parentVersion=e.version),this.clipIntersection!==t.clipIntersection&&(this.clipIntersection=t.clipIntersection,this.clipIntersection?this.unionPlanes.length=e.unionPlanes.length:this.intersectionPlanes.length=e.intersectionPlanes.length);let r=t.clippingPlanes,i=r.length,a,o;if(this.clipIntersection?(a=this.intersectionPlanes,o=e.intersectionPlanes.length):(a=this.unionPlanes,o=e.unionPlanes.length),a.length!==o+i){a.length=o+i;for(let e=0;e<i;e++)a[o+e]=new mr;n=!0}this.projectPlanes(r,a,o),n&&(this.version++,this.cacheKey=`${this.id}:${this.intersectionPlanes.length}:${this.unionPlanes.length}`)}getGroupContext(t){if(this.shadowPass&&!t.clipShadows)return this;let n=this.clippingGroupContexts.get(t);return n===void 0&&(n=new e(this),this.clippingGroupContexts.set(t,n)),n.update(this,t),n}get unionClippingCount(){return this.unionPlanes.length}},vr=new WeakMap,Q=e=>typeof e==`object`&&!!e,$=(e,t)=>Q(e)&&t.every(t=>typeof e[t]==`function`);function yr(e){return e._initialized===!0&&e._isDeviceLost===!1&&e.xr.isPresenting===!1&&e._mrt===null&&e._renderObjectFunction===null&&e._currentRenderBundle===null&&e._activeCubeFace===0&&e._activeMipmapLevel===0}function br(e){if(!Q(e)||e.isWebGPURenderer!==!0||!Q(e.backend)||e.backend.isWebGPUBackend!==!0||!$(e,[`render`,`renderObject`,`_renderObjectDirect`,`_updateCamera`,`getRenderTarget`,`getDrawingBufferSize`])||!$(e.backend,[`beginRender`,`finishRender`,`updateTimeStampUID`,`getTimestampUID`])||!$(e._renderContexts,[`get`])||!$(e._textures,[`get`,`updateRenderTarget`])||!$(e._background,[`update`])||!$(e.lighting,[`beginRender`,`finishRender`,`getNode`])||!$(e.inspector,[`beginRender`,`finishRender`])||!Q(e._nodes)||!Q(e._nodes.nodeFrame)||!Q(e._canvasTarget)||!Q(e.xr)||!Q(e.info)||!Q(e.info.render)||typeof e._callDepth!=`number`||typeof e._nodes.nodeFrame.renderId!=`number`)return null;let t=e;if(!yr(t))return null;let n=vr.get(e);return n||(n=new xr(t),vr.set(e,n)),n}var xr=class{screen=new M;size=new fe;renderer;constructor(e){this.renderer=e}render(e,t){let n=this.renderer,r=n.getRenderTarget();if(!yr(n)||!r||n.needsFrameBufferTarget||r.depthBuffer||r.stencilBuffer||r.samples!==0||r.textures.length!==1||e.matrixWorldAutoUpdate||t.matrixWorldAutoUpdate||t.isArrayCamera||e.overrideMaterial||e.background||e.backgroundNode||e.environment||e.environmentNode||e.fog||e.children.some(e=>{let t=e;if(!t.isMesh||t.children.length||t.frustumCulled||Array.isArray(t.material)||t.occlusionTest)return!0;let n=t.material;return n.lights===!0||(n.transmission??0)>0||!!n.transmissionNode}))return n.render(e,t),!1;let i=n._nodes.nodeFrame,a=i.renderId,o=n._currentRenderContext,s=n._currentRenderObjectFunction,c=n._handleObjectFunction,l=n._currentSourceMaterial,u=n._callDepth,d,f=!1,p=!1,m=!1;try{n.lighting.beginRender(e),p=!0,n._callDepth++,d=n._renderContexts.get(r,null,n._callDepth),n._currentRenderContext=d,n._currentRenderObjectFunction=n.renderObject,n._handleObjectFunction=n._renderObjectDirect,n.info.calls++,n.info.render.calls++,n.info.render.frameCalls++,i.renderId=n.info.calls,n.backend.updateTimeStampUID(d),n.inspector.beginRender(n.backend.getTimestampUID(d),e,t,r),m=!0,t=n._updateCamera(t,!1),n.getDrawingBufferSize(this.size),this.screen.set(0,0,this.size.width,this.size.height),d.viewportValue.copy(r.viewport).floor();let a=r.viewport;d.viewportValue.minDepth=a.minDepth??0,d.viewportValue.maxDepth=a.maxDepth??1,d.viewport=!d.viewportValue.equals(this.screen),d.scissorValue.copy(r.scissor).floor(),d.scissor=n._canvasTarget._scissorTest&&!d.scissorValue.equals(this.screen),d.clippingContext||(d.clippingContext=new _r),d.clippingContext.updateGlobal(e,t),e.onBeforeRender.call(e,n,e,t,r),n._textures.updateRenderTarget(r,0);let o=n._textures.get(r);d.textures=o.textures,d.depthTexture=o.depthTexture,d.width=o.width,d.height=o.height,d.renderTarget=r,d.depth=!1,d.stencil=!1,d.activeCubeFace=0,d.activeMipmapLevel=0,d.occlusionQueryCount=0,d.fullscreenPass=!1;let s=d.scissorValue;s.x=Math.max(s.x,0),s.y=Math.max(s.y,0),s.z=Math.min(Math.max(s.z,0),Math.max(d.width-s.x,0)),s.w=Math.min(Math.max(s.w,0),Math.max(d.height-s.y,0)),n._background.update(e,null,d),d.camera=t,n.backend.beginRender(d),f=!0;let c=n.lighting.getNode(e);for(let r=0;r<2;r++)if(!(r?!n.transparent:!n.opaque))for(let i of e.children){let a=i,o=a.material;if(Number(o.transparent)!==r||!a.visible||!a.layers.test(t.layers)||!o.visible)continue;let s=o.side;try{n.renderObject(a,e,t,a.geometry,o,null,c,d.clippingContext)}finally{o.side=s}}}finally{try{f&&n.backend.finishRender(d)}finally{i.renderId=a,n._currentRenderContext=o,n._currentRenderObjectFunction=s,n._handleObjectFunction=c,n._currentSourceMaterial=l,n._callDepth=u;try{p&&n.lighting.finishRender(e)}finally{m&&n.inspector.finishRender(n.backend.getTimestampUID(d))}}}return e.onAfterRender.call(e,n,e,t,r),!0}};export{Oe as createThreeNodeSurfacePaintFoldMaterial,br as createThreeWebGpuDirectPass,rt as createThreeWebGpuFillMaterial,Mn as createThreeWebGpuGradientFillMaterial,Nn as createThreeWebGpuGradientStrokeMaterial,Ot as createThreeWebGpuMixedVectorMaterial,Jn as createThreeWebGpuPaintCompositorMaterials,Un as createThreeWebGpuPrimitiveHighlightMaterial,an as createThreeWebGpuRasterMaterial,un as createThreeWebGpuRasterStripMaterial,bt as createThreeWebGpuStrokeMaterial,zt as createThreeWebGpuTextMaterial,Ae as enableThreeNodePaintFold};