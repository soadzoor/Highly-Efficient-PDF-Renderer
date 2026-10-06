import{A as e,At as t,B as n,Ci as r,Ct as i,Dt as a,It as o,Kr as s,Lt as c,M as l,N as u,Nt as d,Ot as f,P as p,Pt as m,St as h,Tt as g,V as _,X as v,ii as y,ni as b,qr as x}from"./drawCallMetrics-BhbpfXyU.js";import{n as S,t as C}from"./vectorFillBandShaders-BzpX2kFL.js";import{L as w,Tt as T,c as E,g as D,h as O,hr as k,m as A,o as ee,s as te}from"./src-DKgNjNSe.js";import{n as j,t as M}from"./three.webgpu-Ck30fFTZ.js";import{a as ne,i as re,n as ie,r as ae,t as oe}from"./rasterStripWebGpuSampling-ZZGY41Kz.js";var se=j.wgslFn(`fn heprPageProjection(document: mat4x4f, matrices: texture_2d<f32>, page: f32) -> mat4x4f {
  let p = i32(page);
  return document * mat4x4f(textureLoad(matrices,vec2i(0,p),0), textureLoad(matrices,vec2i(1,p),0),
    textureLoad(matrices,vec2i(2,p),0),textureLoad(matrices,vec2i(3,p),0));
}`),ce=j.wgslFn(`fn heprPrimitivePage(owners: texture_2d<f32>, index: f32) -> f32 {
  let width = i32(textureDimensions(owners,0).x); let i = i32(index);
  return textureLoad(owners,vec2i(i % width,i / width),0).r;
}`),le=j.wgslFn(`fn heprPageParameters(parameters: texture_2d<f32>, page: f32) -> vec4f {
  return textureLoad(parameters,vec2i(0,i32(page)),0);
}`),ue=j.wgslFn(`fn heprPageClip(position: vec4f, parameters: vec4f) -> vec4f {
  if (parameters.y < 0.5) { return vec4f(2.0,2.0,2.0,1.0); } return position;
}`);function N(e,t){return e(t)}function P(e,t){let n=j.uniform(e);if(!t)return{matrix:n,finish(){}};let r=t.owners?N(ce,{owners:j.textureLoad(t.owners),index:j.attribute(t.attribute,`float`)}):t.page===void 0?j.attribute(`aPageIndex`,`float`):j.float(t.page),i=N(le,{parameters:j.textureLoad(t.table.parameters),page:r});return{matrix:N(se,{document:n,matrices:j.textureLoad(t.table.matrices),page:r}),units:i.x,finish(e){e.vertexNode=N(ue,{position:e.vertexNode,parameters:i})}}}var de=new WeakMap,fe=new WeakMap,pe=new WeakSet,me=j.wgslFn(g),he=j.wgslFn(i),ge=j.wgslFn(h),_e=j.wgslFn(`
fn heprClipPixelWidth(point: vec2<f32>) -> f32 {
  let dx = length(vec2<f32>(dpdx(point.x), dpdy(point.x)));
  let dy = length(vec2<f32>(dpdx(point.y), dpdy(point.y)));
  return max(max(dx, dy), 0.0001);
}
`);function F(e,t,n=!1,r=!1){te(e,ye),de.set(e,t),n&&fe.set(e,n),r&&pe.add(e)}function ve(e){return j.varying(e).setInterpolation(`flat`)}function ye(e,t,n,r){if(!(e instanceof M)||!(t instanceof M))throw Error(`Unsupported vector clip material.`);let i=de.get(e);if(!i||!e.fragmentNode)throw Error(`Clipped node material has no page-space position.`);let a={point:i,clipIndex:n===null?j.sub(ve(j.attribute(ee,`float`)),1):j.uniform(n),clipTexture:j.textureLoad(r)},o=fe.get(e);if(o)t.fragmentNode=j.Fn(()=>{let t=j.property(`float`,`heprClipAAWidth`);t.assign(_e({point:i}));let n=j.property(`vec4`,`heprClipSource`);n.assign(e.fragmentNode);let r=(pe.has(e)?ge:he)({...a,aaWidth:t});return o===`premultiplied`?j.mul(n,r):j.vec4(n.rgb,j.mul(n.a,r))})();else{let n=me(a);t.fragmentNode=j.mul(e.fragmentNode,n)}}var be=j.wgslFn(`
fn heprThreeOutputColor(color: vec3<f32>) -> vec3<f32> {
  let safeColor = clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
  let lower = safeColor / 12.92;
  let higher = pow((safeColor + vec3<f32>(0.055)) / 1.055, vec3<f32>(2.4));
  return select(higher, lower, safeColor <= vec3<f32>(0.04045));
}
`),xe=j.wgslFn(`
fn heprThreeOutputColor(color: vec3<f32>) -> vec3<f32> {
  return clamp(color, vec3<f32>(0.0), vec3<f32>(1.0));
}
`);function I(e,t=[]){let n=n=>j.wgslFn(e,[n,...t]);return{linear:n(be),display:n(xe)}}function L(e){return e}function R(e,t){return e(t)}function z(e,t=!1){let n=j.varying(e);return t?n.setInterpolation(`flat`):n}var Se=j.wgslFn(C),Ce=j.wgslFn(m),we=j.wgslFn(d),Te=j.wgslFn(f),Ee=j.wgslFn(a,[L(Ce)]),De=j.wgslFn(`
fn heprCoordFromIndex(index: f32, width: f32) -> vec2<i32> {
  let itemIndex = i32(index + 0.5);
  let safeWidth = max(i32(width), 1);
  return vec2<i32>(itemIndex % safeWidth, itemIndex / safeWidth);
}
`),Oe=j.wgslFn(`
fn heprFillVertexPack(
  corner: vec2<f32>,
  metaA: vec4<f32>,
  metaB: vec4<f32>,
  metaC: vec4<f32>,
  shapeOnly: f32,
  viewport: vec2<f32>,
  zoom: f32,
  useLocalToClip: f32,
  localToClip: mat4x4<f32>
) -> vec4<f32> {
  let segmentCount = i32(metaA.y + 0.5);
  let alpha = mix(metaC.w, 1.0, shapeOnly);
  if (segmentCount <= 0 || alpha <= 0.001) {
    return vec4<f32>(-2.0, -2.0, 0.0, 0.0);
  }

  let minBounds = metaA.zw;
  let maxBounds = metaB.xy;
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  
  
  let rawMargin = heprCoverageMargin(heprPathToPixel(minBounds + (maxBounds - minBounds) * corner01,
    useLocalToClip, localToClip, zoom, max(viewport, vec2<f32>(1.0))));
  let margin = heprBoundCoverageMargin(minBounds + (maxBounds - minBounds) * corner01, rawMargin,
    mat2x2<f32>(1.0, 0.0, 0.0, 1.0), useLocalToClip, localToClip, max(viewport, vec2<f32>(1.0)));
  let world = minBounds - margin + (maxBounds - minBounds + 2.0 * margin) * corner01;
  return vec4<f32>(world, 1.0, 0.0);
}
`,[L(we)]),ke=j.wgslFn(`
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
`),Ae=I(`
fn heprFillFragment(
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
  fillAAScreenPx: f32,
  vectorOverride: vec4<f32>,
  shapeOnly: f32
) -> vec4<f32> {
  
  let footprint = max(vec2<f32>(
    length(vec2<f32>(dpdx(local.x), dpdy(local.x))),
    length(vec2<f32>(dpdx(local.y), dpdy(local.y)))
  ) * fillAAScreenPx, vec2<f32>(0.0001));
  let segmentStart = i32(metaA.x + 0.5);
  let segmentCount = i32(metaA.y + 0.5);
  let alphaStyle = mix(metaC.w, 1.0, shapeOnly);
  if (segmentCount <= 0 || alphaStyle <= 0.001) {
    discard;
  }

  
  
  
  let box = vec4<f32>(local - 0.5 * footprint, 1.0 / footprint);
  var winding = 0.0;
  let safeWidth = max(i32(segmentTexWidth), 1);
  if (cells.y > 0.0) {
    winding = heprCellWinding(cells, metaA.zw, box, footprint, segmentTexA, segmentTexB);
  } else {
${S({bands:`bands`,y:`local.y`,radius:`0.5 * footprint.y`,count:`segmentCount`,start:`segmentStart`,texture:`segmentTexA`,entries:`bandEntries`,setup:`let rows = heprBandRows(bandInfo, band, bandCount, box);`,edge:`    let coord = vec2<i32>(segmentIndex % safeWidth, segmentIndex / safeWidth);
    let primitiveA = textureLoad(segmentTexA, coord, 0);
    let primitiveB = textureLoad(segmentTexB, coord, 0);
    winding = winding + heprSegmentCoverage(primitiveA.xy, primitiveA.zw, primitiveB.xy,
      primitiveB.z >= 1.0, box, rows.x, rows.y);`})}
  }
  let mixAmount = clamp(vectorOverride.a, 0.0, 1.0);
  let baseColor = vec3<f32>(metaB.z, metaB.w, metaC.z);
  let color = baseColor * (1.0 - mixAmount) + vectorOverride.rgb * mixAmount;

  
  
  let alpha = heprFillCoverage(winding, metaC.x >= 0.5) * alphaStyle;
  if (alpha <= 0.001) {
    discard;
  }

  return vec4<f32>(heprThreeOutputColor(color), alpha);
}
`,[L(Ce),L(Ee)]);function je(e){let t=new M,n=P(e.localToClip,e.pageBinding);t.transparent=!1,t.depthTest=!1,t.depthWrite=!1,t.side=2,t.toneMapped=!1,t.fog=!1,t.lights=!1,E(t);let r=j.uniform(0);D(t,r);let i=j.uniform(1),a=j.uniform(0),o=j.uniform(1),s=j.uniform(Math.max(1,e.fillPathTextureWidth)),c=j.uniform(Math.max(1,e.fillSegmentTextureWidth)),l=j.attribute(`aCorner`,`vec2`),u=j.attribute(`aFillPathIndex`,`float`),d=R(De,{index:u,width:s}),f=z(j.textureLoad(e.fillPathMetaTextureA,d,0),!0),p=z(j.textureLoad(e.fillPathMetaTextureB,d,0),!0),m=z(j.textureLoad(e.fillPathMetaTextureC,d,0),!0),h=z(R(Se,{pathIndex:u,base:j.uniform(e.fillBandBase??-1),segments:j.textureLoad(e.fillSegmentTextureA)}),!0),g=z(R(Te,{pathIndex:u,headers:j.uniform((e.fillCellBase??-1)+1),segments:j.textureLoad(e.fillSegmentTextureA)}),!0),_=j.uniform(e.viewport),v=n.matrix,y=z(R(Oe,{corner:l,metaA:f,metaB:p,metaC:m,shapeOnly:r,viewport:_,zoom:i,useLocalToClip:a,localToClip:v})),b=y;return t.vertexNode=R(ke,{vertexPack:y,viewport:_,cameraCenter:j.uniform(e.cameraCenter),zoom:i,useLocalToClip:a,localToClip:v}),n.finish(t),t.fragmentNode=R(Ae[e.colorCompositing],{local:b.xy,metaA:f,metaB:p,metaC:m,segmentTexA:j.textureLoad(e.fillSegmentTextureA),segmentTexB:j.textureLoad(e.fillSegmentTextureB),segmentTexWidth:c,bands:h,bandEntries:j.uniform(e.fillBandEntries??0),cells:g,fillAAScreenPx:o,vectorOverride:j.uniform(e.vectorOverride),shapeOnly:r}),F(t,b.xy),{material:t,zoomUniform:i,useLocalToClipUniform:a}}function B(e){return e}function V(e,t){return e(t)}function H(e,t=!1){let n=j.varying(e);return t?n.setInterpolation(`flat`):n}var Me=j.wgslFn(`
fn heprSegmentCoord(index: f32, width: f32) -> vec2<i32> {
  let segmentIndex = i32(index + 0.5);
  let safeWidth = max(i32(width), 1);
  return vec2<i32>(segmentIndex % safeWidth, segmentIndex / safeWidth);
}
`),Ne=j.wgslFn(`
fn heprSplitSegmentTexel(
  headTexture: texture_2d<f32>,
  tailTexture: texture_2d<f32>,
  index: f32,
  headWidth: f32,
  tailWidth: f32,
  splitIndex: f32
) -> vec4<f32> {
  let segmentIndex = i32(index + 0.5);
  let split = i32(splitIndex + 0.5);
  if (segmentIndex >= split) {
    let tailIndex = segmentIndex - split;
    let width = max(i32(tailWidth), 1);
    return textureLoad(tailTexture, vec2<i32>(tailIndex % width, tailIndex / width), 0);
  }
  let width = max(i32(headWidth), 1);
  return textureLoad(headTexture, vec2<i32>(segmentIndex % width, segmentIndex / width), 0);
}
`),Pe=j.wgslFn(`
fn heprFloatMod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}
`),Fe=j.wgslFn(ne),Ie=j.wgslFn(`
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
`,[B(Pe),B(Fe)]),Le=j.wgslFn(`
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
`),Re=j.wgslFn(o),ze=j.wgslFn(c),Be=j.wgslFn(ae),Ve=j.wgslFn(re,[B(Be)]),He=I(`
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
`,[B(Pe),B(Re),B(ze),B(Be),B(Ve)]);function Ue(e){let t=new M,n=P(e.localToClip,e.pageBinding);t.transparent=!1,t.depthTest=!1,t.depthWrite=!1,t.side=2,t.toneMapped=!1,t.fog=!1,t.lights=!1,E(t);let r=j.uniform(0);D(t,r);let i=j.uniform(1),a=j.uniform(0),o=j.uniform(1),s=j.uniform(+!!e.strokeCurveEnabled),c=j.uniform(Math.max(1,e.segmentTextureWidth)),l=j.uniform(1),u=j.attribute(`aCorner`,`vec2`),d=j.attribute(`aSegmentIndex`,`float`),f=V(Me,{index:d,width:c}),p=e.segmentTail,m=p?j.uniform(Math.max(1,p.width)):null,h=p?j.uniform(p.split):null,g=(e,t)=>t?V(Ne,{headTexture:j.textureLoad(e),tailTexture:j.textureLoad(t),index:d,headWidth:c,tailWidth:m,splitIndex:h}):j.textureLoad(e,f,0),_=H(g(e.segmentTextureA,p?.textureA),!0),v=H(g(e.segmentTextureB,p?.textureB),!0),y=H(g(e.segmentStyleTexture,p?.styleTexture),!0),b=H(g(e.segmentBoundsTexture,p?.boundsTexture),!0),x=H(V(Ie,{corner:u,primitiveA:_,primitiveB:v,style:y,primitiveBounds:b,zoom:i,useLocalToClip:a,localUnitsPerPixelInput:n.units??o,aaScreenPx:l,shapeOnly:r})),S=x,C=j.uniform(e.viewport),w=j.uniform(e.cameraCenter),T=n.matrix,O=j.uniform(e.vectorOverride);return t.vertexNode=V(Le,{worldPack:x,viewport:C,cameraCenter:w,zoom:i,useLocalToClip:a,localToClip:T}),n.finish(t),t.fragmentNode=V(He[e.colorCompositing],{local:S.xy,primitiveA:_,primitiveB:v,style:y,primitiveBounds:b,halfWidthFromVertex:S.z,strokeCurveEnabled:s,aaScreenPx:l,vectorOverride:O,shapeOnly:r}),F(t,S.xy),{material:t,zoomUniform:i,useLocalToClipUniform:a,localUnitsPerPixelUniform:o,curveUniform:s}}function We(e){return e}function U(e,t){return e(t)}function W(e,t=!1){let n=j.varying(e);return t?n.setInterpolation(`flat`):n}var Ge=j.wgslFn(`
fn heprCoordFromIndex(index: f32, width: f32) -> vec2<i32> {
  let itemIndex = i32(index + 0.5);
  let safeWidth = max(i32(width), 1);
  return vec2<i32>(itemIndex % safeWidth, itemIndex / safeWidth);
}
`),Ke=j.wgslFn(`
fn heprClipCoordFromReference(reference: f32, width: f32) -> vec2<i32> {
  let itemIndex = max(i32(reference + 0.5) - 1, 0);
  let safeWidth = max(i32(width), 1);
  return vec2<i32>(itemIndex % safeWidth, itemIndex / safeWidth);
}
`),qe=j.wgslFn(m),Je=j.wgslFn(d),Ye=j.wgslFn(`
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
  let segmentCount = i32(glyphMetaA.y + 0.5);
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
`,[We(Je)]),Xe=j.wgslFn(`
fn heprTextClipPosition(
  vertexPack: vec4<f32>,
  glyphMetaA: vec4<f32>,
  viewport: vec2<f32>,
  cameraCenter: vec2<f32>,
  zoom: f32,
  useLocalToClip: f32,
  localToClip: mat4x4<f32>
) -> vec4<f32> {
  
  
  
  
  if (i32(glyphMetaA.y + 0.5) <= 0) {
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
`),Ze=j.wgslFn(`
fn heprTextNormCoord(local: vec2<f32>, glyphMetaA: vec4<f32>, glyphMetaB: vec4<f32>) -> vec2<f32> {
  let minBounds = glyphMetaA.zw;
  let maxBounds = glyphMetaB.xy;
  let span = max(maxBounds - minBounds, vec2<f32>(0.000001));
  
  return (local - minBounds) / span;
}
`),Qe=j.wgslFn(`
fn heprTextRasterAtlasPixels(
  normCoord: vec2<f32>,
  rasterRect: vec4<f32>,
  atlasSize: vec2<f32>
) -> vec2<f32> {
  let dims = max(atlasSize, vec2<f32>(1.0));
  return vec2<f32>(normCoord.x, 1.0 - normCoord.y) * (rasterRect.zw * dims);
}
`),$e=I(`
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

  let segmentStart = i32(glyphMetaA.x + 0.5);
  let segmentCount = i32(glyphMetaA.y + 0.5);
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
`,[We(qe)]);function et(e){let t=new M,n=P(e.localToClip,e.pageBinding);t.transparent=!1,t.depthTest=!1,t.depthWrite=!1,t.side=2,t.toneMapped=!1,t.fog=!1,t.lights=!1,E(t);let r=j.uniform(0);D(t,r);let i=j.uniform(1),a=j.uniform(0),o=j.uniform(+!!e.strokeCurveEnabled),s=j.uniform(+!!e.textVectorOnly),c=j.uniform(1.25),l=j.uniform(Math.max(1,e.textInstanceTextureWidth)),u=j.uniform(Math.max(1,e.textGlyphTextureWidth)),d=j.uniform(Math.max(1,e.textSegmentTextureWidth)),f=j.attribute(`aCorner`,`vec2`),p=U(Ge,{index:j.attribute(`aTextInstanceIndex`,`float`),width:l}),m=W(j.textureLoad(e.textInstanceTextureA,p,0),!0),h=W(j.textureLoad(e.textInstanceTextureB,p,0),!0),g=W(j.textureLoad(e.textInstanceTextureC,p,0),!0),_=U(Ge,{index:h.z,width:u}),v=W(j.textureLoad(e.textGlyphMetaTextureA,_,0),!0),y=W(j.textureLoad(e.textGlyphMetaTextureB,_,0),!0),b=W(j.textureLoad(e.textGlyphRasterMetaTexture,_,0),!0),x=j.uniform(e.viewport),S=n.matrix,C=W(U(Ye,{corner:f,instanceA:m,instanceB:h,glyphMetaA:v,glyphMetaB:y,viewport:x,zoom:i,useLocalToClip:a,localToClip:S})),w=C,T=U(Ke,{reference:h.w,width:u}),O=W(j.textureLoad(e.textGlyphMetaTextureA,T,0),!0);t.vertexNode=U(Xe,{vertexPack:C,glyphMetaA:v,viewport:x,cameraCenter:j.uniform(e.cameraCenter),zoom:i,useLocalToClip:a,localToClip:S});let k=j.uniform(e.textRasterAtlasSize),A=U(Ze,{local:w.zw,glyphMetaA:v,glyphMetaB:y}),ee=U(Qe,{normCoord:A,rasterRect:b,atlasSize:k});return n.finish(t),t.fragmentNode=U($e[e.colorCompositing],{local:w.zw,world:C.xy,clipReference:h.w,clipRect:O,glyphMetaA:v,instanceColor:g,normCoord:A,atlasPixels:ee,rasterRect:b,rasterAtlasTex:j.texture(e.textRasterAtlasTexture),rasterAtlasSampler:j.sampler(e.textRasterAtlasTexture),rasterAtlasSize:k,vectorOnly:s,segmentTexA:j.textureLoad(e.textGlyphSegmentTextureA),segmentTexB:j.textureLoad(e.textGlyphSegmentTextureB),segmentTexWidth:d,textAAScreenPx:c,textCurveEnabled:o,vectorOverride:j.uniform(e.vectorOverride),shapeOnly:r,inkDensity:y.z}),F(t,C.xy),{material:t,zoomUniform:i,useLocalToClipUniform:a,curveUniform:o,vectorOnlyUniform:s}}var G=[0,0,1,1];function K(e,t){return e(t)}function tt(e){return j.varying(e)}var nt=j.wgslFn(`
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
`),rt=j.wgslFn(`
fn heprPageBackgroundPack(corner: vec2<f32>, pageRect: vec4<f32>) -> vec4<f32> {
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  let localTopDown = vec2<f32>(corner01.x, 1.0 - corner01.y);
  let world = pageRect.xy + pageRect.zw * localTopDown;
  return vec4<f32>(world, localTopDown);
}
`),it=j.wgslFn(`
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
`),at=I(`
fn heprRasterFragment(inputColor: vec4<f32>, opacity: f32, shapeOnly: f32) -> vec4<f32> {
  let color = inputColor * mix(opacity, 1.0, shapeOnly);
  if (color.a <= 0.001) {
    discard;
  }
  let straightSrgb = clamp(color.rgb / color.a, vec3<f32>(0.0), vec3<f32>(1.0));
  let outputPremultiplied = heprThreeOutputColor(straightSrgb) * color.a;
  return vec4<f32>(outputPremultiplied, color.a);
}
`);function ot(e){let t=new M,n=P(e.localToClip,e.pageBinding);t.transparent=!1,t.depthTest=!1,t.depthWrite=!1,t.side=2,t.toneMapped=!1,t.fog=!1,t.lights=!1,t.blending=5,t.blendSrc=201,t.blendDst=205,t.blendSrcAlpha=201,t.blendDstAlpha=205;let r=j.uniform(0);D(t,r);let i=j.uniform(1),a=j.uniform(0),o=j.attribute(`aCorner`,`vec2`),s=new k().fromArray(e.tile?.quad??G),c=new k().fromArray(e.tile?.uv??G),l=tt(e.instancedPageBackground?K(rt,{corner:o,pageRect:j.attribute(`aPageRect`,`vec4`)}):K(nt,{corner:o,matrixABCD:j.uniform(e.matrixABCD),matrixEF:j.uniform(e.matrixEF),tileQuad:j.uniform(s),tileUv:j.uniform(c)})),u=l,d=j.texture(e.texture,u.zw),f=j.uniform(e.opacity??1);return t.vertexNode=K(it,{rasterPack:l,viewport:j.uniform(e.viewport),cameraCenter:j.uniform(e.cameraCenter),zoom:i,useLocalToClip:a,localToClip:n.matrix}),n.finish(t),t.fragmentNode=K(at[e.colorCompositing],{inputColor:d,opacity:f,shapeOnly:r}),F(t,l.xy,`premultiplied`,!0),{material:t,zoomUniform:i,useLocalToClipUniform:a,updateSource(t,n,r,i){d.value=t,e.matrixABCD.set(n[0],n[1],n[2],n[3]),e.matrixEF.set(n[4],n[5]),s.fromArray(i?.quad??G),c.fromArray(i?.uv??G),f.value=r}}}function q(e,t){return e(t)}function J(e,t=!1){let n=j.varying(e);return t?n.setInterpolation(`flat`):n}var st=j.wgslFn(oe),ct=j.wgslFn(ie,[st]);function lt(e){let t=new M,n=P(e.localToClip,e.pageBinding);t.transparent=!1,t.depthTest=!1,t.depthWrite=!1,t.side=2,t.toneMapped=!1,t.fog=!1,t.lights=!1,t.blending=5,t.blendSrc=201,t.blendDst=205,t.blendSrcAlpha=201,t.blendDstAlpha=205;let r=j.uniform(0);D(t,r);let i=j.uniform(1),a=j.uniform(0),o=j.attribute(`aRasterMatrixEFWidthOpacity`,`vec4`),s=j.vec4(0,0,1,1),c=J(q(nt,{corner:j.attribute(`aCorner`,`vec2`),matrixABCD:j.attribute(`aRasterMatrixABCD`,`vec4`),matrixEF:o.xy,tileQuad:s,tileUv:s})),l=c;t.vertexNode=q(it,{rasterPack:c,viewport:j.uniform(e.viewport),cameraCenter:j.uniform(e.cameraCenter),zoom:i,useLocalToClip:a,localToClip:n.matrix});let u=J(o.zw,!0),d=q(ct,{uRasterTex:j.texture(e.texture),uRasterSampler:j.sampler(e.texture),uv:l.zw,row:J(j.instanceIndex,!0),width:u.x});return n.finish(t),t.fragmentNode=q(at[e.colorCompositing],{inputColor:d,opacity:u.y,shapeOnly:r}),F(t,l.xy,`premultiplied`,!0),{material:t,zoomUniform:i,useLocalToClipUniform:a}}function Y(e){return e}function X(e,t){return e(t)}function Z(e,t=!1){let n=j.varying(e);return t?n.setInterpolation(`flat`):n}var ut=j.wgslFn(C),dt=j.wgslFn(f),ft=j.wgslFn(`
fn heprGradientCoordFromIndex(index: f32, width: f32) -> vec2<i32> {
  let itemIndex = i32(index + 0.5);
  let safeWidth = max(i32(width), 1);
  return vec2<i32>(itemIndex % safeWidth, itemIndex / safeWidth);
}
`),pt=j.wgslFn(`
fn heprGradientFloatMod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}
`),mt=j.wgslFn(y),ht=j.wgslFn(b),gt=j.wgslFn(`
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

  let gradientIndex = i32(gradientIndexInput + 0.5);
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
`,[Y(mt),Y(ht)]),_t=j.wgslFn(m),vt=j.wgslFn(a,[Y(_t)]),yt=j.wgslFn(d),bt=j.wgslFn(t,[Y(yt)]),xt=j.wgslFn(`
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
  let segmentCount = i32(metaA.y + 0.5);
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
`,[Y(bt)]),St=j.wgslFn(`
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
`),Ct=j.wgslFn(`
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
`),wt=j.wgslFn(o),Tt=j.wgslFn(ae),Et=j.wgslFn(re,[Y(Tt)]),Dt=I(`
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
  let segmentStart = i32(metaA.x + 0.5);
  let segmentCount = i32(metaA.y + 0.5);
  if (segmentCount <= 0 || (metaC.w <= 0.001 && shapeOnly < 0.5)) { discard; }
  
  
  
  let box = vec4<f32>(local - 0.5 * footprint, 1.0 / footprint);
  var winding = 0.0;
  let safeWidth = max(i32(segmentTexWidth), 1);
  if (cells.y > 0.0) {
    winding = heprCellWinding(cells, metaA.zw, box, footprint, segmentTexA, segmentTexB);
  } else {
${S({bands:`bands`,y:`local.y`,radius:`0.5 * footprint.y`,count:`segmentCount`,start:`segmentStart`,texture:`segmentTexA`,entries:`bandEntries`,setup:`let rows = heprBandRows(bandInfo, band, bandCount, box);`,edge:`    let coord = vec2<i32>(segmentIndex % safeWidth, segmentIndex / safeWidth);
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
`,[Y(gt),Y(_t),Y(vt)]),Ot=j.wgslFn(ne),kt=j.wgslFn(`
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
`,[Y(pt),Y(Ot)]),At=I(`
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
`,[Y(pt),Y(wt),Y(Tt),Y(Et),Y(gt)]);function jt(e){let t=Pt(),n=P(e.localToClip,e.pageBinding),i=j.uniform(0);D(t,i);let a=j.uniform(1),o=j.uniform(0),s=j.uniform(Math.max(1,e.fillPathTextureWidth)),c=j.uniform(Math.max(1,e.fillSegmentTextureWidth)),l=j.uniform(Math.max(1,e.gradientMetaTextureWidth)),u=j.attribute(`aFillPathIndex`,`float`),d=X(ft,{index:u,width:s}),f=Z(j.textureLoad(e.fillPathMetaTextureA,d,0),!0),p=Z(j.textureLoad(e.fillPathMetaTextureB,d,0),!0),m=Z(j.textureLoad(e.fillPathMetaTextureC,d,0),!0),h=Z(X(ut,{pathIndex:u,base:j.uniform(e.fillBandBase??-1),segments:j.textureLoad(e.fillSegmentTextureA)}),!0),g=Z(X(dt,{pathIndex:u,headers:j.uniform((e.fillCellBase??-1)+1),segments:j.textureLoad(e.fillSegmentTextureA)}),!0),_=j.uniform(e.viewport),v=n.matrix,y=Z(e.mesh?j.vec4(j.attribute(`aMeshPosition`,`vec2`),1,0):X(xt,{corner:j.attribute(`aCorner`,`vec2`),metaA:f,metaB:p,metaC:m,clipBounds:j.uniform(e.clipBounds??new k().fromArray(r)),shapeOnly:i,viewport:_,zoom:a,useLocalToClip:o,localToClip:v})),b=y;return t.vertexNode=X(St,{vertexPack:y,viewport:_,cameraCenter:j.uniform(e.cameraCenter),zoom:a,useLocalToClip:o,localToClip:v}),n.finish(t),t.fragmentNode=X(Dt[e.colorCompositing],{local:b.xy,metaA:f,metaB:p,metaC:m,segmentTexA:j.textureLoad(e.fillSegmentTextureA),segmentTexB:j.textureLoad(e.fillSegmentTextureB),segmentTexWidth:c,bands:h,bandEntries:j.uniform(e.fillBandEntries??0),cells:g,...Nt(e,l),fillAAScreenPx:j.uniform(1),meshColor:e.mesh?Z(j.attribute(`aMeshColor`,`vec4`)):j.vec4(0),useMesh:j.uniform(+!!e.mesh),shapeOnly:i,vectorOverride:j.uniform(e.vectorOverride),primitiveColor:j.uniform(e.primitiveColor)}),F(t,b.xy,`straight-alpha`),{material:t,zoomUniform:a,useLocalToClipUniform:o}}function Mt(e){let t=Pt(),n=P(e.localToClip,e.pageBinding),r=j.uniform(0);D(t,r);let i=j.uniform(1),a=j.uniform(0),o=j.uniform(1),s=j.uniform(+!!e.strokeCurveEnabled),c=j.uniform(Math.max(1,e.segmentTextureWidth)),l=j.uniform(Math.max(1,e.gradientMetaTextureWidth)),u=X(ft,{index:j.attribute(`aSegmentIndex`,`float`),width:c}),d=Z(j.textureLoad(e.segmentTextureA,u,0),!0),f=Z(j.textureLoad(e.segmentTextureB,u,0),!0),p=Z(j.textureLoad(e.segmentStyleTexture,u,0),!0),m=Z(j.textureLoad(e.segmentBoundsTexture,u,0),!0),h=Z(X(kt,{corner:j.attribute(`aCorner`,`vec2`),primitiveA:d,primitiveB:f,style:p,primitiveBounds:m,zoom:i,useLocalToClip:a,localUnitsPerPixelInput:n.units??o,aaScreenPx:j.uniform(1),shapeOnly:r})),g=h;return t.vertexNode=X(Ct,{worldPack:h,viewport:j.uniform(e.viewport),cameraCenter:j.uniform(e.cameraCenter),zoom:i,useLocalToClip:a,localToClip:n.matrix}),n.finish(t),t.fragmentNode=X(At[e.colorCompositing],{local:g.xy,primitiveA:d,primitiveB:f,style:p,primitiveBounds:m,shapeOnly:r,halfWidthFromVertex:g.z,strokeCurveEnabled:s,aaScreenPx:j.uniform(1),vectorOverride:j.uniform(e.vectorOverride),primitiveColor:j.uniform(e.primitiveColor),...Nt(e,l)}),F(t,g.xy,`straight-alpha`),{material:t,zoomUniform:i,useLocalToClipUniform:a,localUnitsPerPixelUniform:o,curveUniform:s}}function Nt(e,t){return{gradientMetaA:j.textureLoad(e.gradientMetaTextureA),gradientMetaB:j.textureLoad(e.gradientMetaTextureB),gradientMetaC:j.textureLoad(e.gradientMetaTextureC),gradientMetaD:j.textureLoad(e.gradientMetaTextureD),gradientMetaE:j.textureLoad(e.gradientMetaTextureE),gradientLut:j.textureLoad(e.gradientLutTexture),gradientMetaWidth:t,sourceGradientIndex:j.uniform(e.sourceGradientIndex),maskGradientIndex:j.uniform(e.maskGradientIndex)}}function Pt(){let e=new M;return e.transparent=!1,e.depthTest=!1,e.depthWrite=!1,e.side=2,e.toneMapped=!1,e.fog=!1,e.lights=!1,E(e),e}var Ft=2**30,Q=null,It=j.wgslFn(n,[j.wgslFn(_.slice(0,_.indexOf(`fn heprFoldGradientBackground`))),j.wgslFn(_.slice(_.indexOf(`fn heprFoldGradientBackground`)))]);function Lt(e){if(!(e instanceof M)||!e.fragmentNode)throw Error(`Folded paint material has no node fragment output.`);Q||(Q=new w(Uint8Array.of(255,255,255,255),1,1),Q.needsUpdate=!0,Q.version=Ft);let t=j.uniform(new k(1,0,0,0)),n=j.uniform(new k),r=A(),i=j.textureLoad(Q);i.getUniformHash=()=>`hepr-paint-fold-mask`;let a={pixel:j.screenCoordinate,mask:i,fold:t,weights:n};r.forEach((e,t)=>{a[`d${t}`]=j.uniform(e)});let o=It(a),s=e.fragmentNode;e.fragmentNode=j.Fn(()=>{let e=j.property(`vec4`,`heprFoldSource`);return e.assign(s),j.vec4(e.rgb,j.mul(e.a,o))})(),O(e,{fold:t,weights:n,mask:i,gradient:r,neutral:Q})}var Rt=j.wgslFn(l),zt=j.wgslFn(p,[Rt]),Bt=j.wgslFn(e,[Rt,zt]),Vt=j.wgslFn(u),Ht=j.wgslFn(g.replace(/depth < \d+/,`depth < 66`)),Ut=I(`
fn heprThreePrimitiveHighlight(point:vec2<f32>,a:vec4<f32>,b:vec4<f32>,index:f32,
  pixelRatio:f32,selectionCount:f32,clipTexture:texture_2d<f32>) -> vec4<f32> {
  let alpha=heprPrimitiveHighlightCoverage(point,a,b,pixelRatio)*heprVectorClip(point,b.w,clipTexture);
  if (alpha<=0.001) { discard; }
  let color=select(vec3<f32>(${s.join(`,`)}),
    vec3<f32>(${x.join(`,`)}),index<selectionCount);
  return vec4<f32>(heprThreeOutputColor(color),alpha);
}`,[Bt,Ht]);function Wt(e,t){return e(t)}function Gt(e){let t=j.uniform(1),n=j.uniform(1),r=j.uniform(0),i=new M,a=j.varying(j.attribute(`aSegmentA`,`vec4`)),o=j.varying(j.attribute(`aSegmentB`,`vec4`)),s=j.varying(Wt(Vt,{corner:j.attribute(`aCorner`,`vec2`),a,b:o,localUnitsPerPixel:t,pixelRatio:n}));return i.vertexNode=j.mul(j.uniform(e.matrix),j.vec4(s,0,1)),i.fragmentNode=Wt(Ut[e.colorCompositing],{point:s,a,b:o,index:j.varying(j.attribute(`aHighlightIndex`,`float`)),pixelRatio:n,selectionCount:r,clipTexture:j.textureLoad(e.clips)}),i.depthTest=i.depthWrite=!1,i.side=2,i.toneMapped=!1,{material:i,units:t,pixelRatio:n,selectionCount:r}}function $(e,t){return e(t)}function Kt(e,t){let n=e;return n.name=t,n.getUniformHash=()=>`hepr-composite-${t}`,e}var qt=j.wgslFn(`
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
}`,[j.wgslFn(v(`wgsl`))]),Jt=j.wgslFn(`
fn heprPresentComposite(color:vec4f) -> vec4f {
  return vec4f(color.rgb/max(color.a,0.0000001),color.a);
}`);function Yt(e){let t=[`uSource`,`uShape`,`uCurrent`,`uStats`,`uInitial`,`uMask`,`uTransfer`],n=new M,r=t.slice(0,6).map(t=>{let n=j.textureLoad(e.zero,j.screenCoordinate),r=j.vec2(j.textureSize(n));return n.uvNode=j.clamp(j.screenCoordinate,j.vec2(0),r.sub(1)),Kt(n,t)});e.bindings.push(...r);let i=j.uniform(e.passRect);n.vertexNode=j.vec4(j.mix(i.xy,i.zw,j.positionLocal.xy),0,1);let a=Kt(j.textureLoad(e.zero),t[6]);e.bindings.push(a),n.fragmentNode=$(qt,{source:r[0],shape:r[1],current:r[2],stats:r[3],initial:r[4],mask:r[5],transferTex:a,p:j.uniform(e.params),q:j.uniform(e.extra),backdrop:j.uniform(e.backdropColor)});let o=new M;o.vertexNode=$(j.wgslFn(`fn heprPagePresentPosition(position: vec3f, depth: vec3f) -> vec4f {
    return vec4f(position.xy, dot(depth, vec3f(position.xy, 1.0)), 1.0);
  }`),{position:j.positionLocal,depth:j.uniform(e.pageDepth)});let s=j.texture(e.presentZero,j.uv().flipY());return o.fragmentNode=$(Jt,{color:s}),{passMaterial:n,presentationBinding:s,mesh:new T(e.geometry,o)}}export{je as createThreeWebGpuFillMaterial,jt as createThreeWebGpuGradientFillMaterial,Mt as createThreeWebGpuGradientStrokeMaterial,Yt as createThreeWebGpuPaintCompositorMaterials,Gt as createThreeWebGpuPrimitiveHighlightMaterial,ot as createThreeWebGpuRasterMaterial,lt as createThreeWebGpuRasterStripMaterial,Ue as createThreeWebGpuStrokeMaterial,et as createThreeWebGpuTextMaterial,Lt as enableThreeNodePaintFold};