import { VECTOR_CLIP_GLSL, VECTOR_CLIP_WGSL } from "./vectorClipShaders";
import { PRIMITIVE_SELECTION_COLOR, PRIMITIVE_HOVER_COLOR } from "./primitiveAppearance";

/** Original-scene geometry, including quadratic controls; no tessellation or scene copies. */
export const PRIMITIVE_HIGHLIGHT_VERTEX_GLSL = `#version 300 es
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
  vColor = aHighlightIndex < uSelectionCount ? vec3(${PRIMITIVE_SELECTION_COLOR.join(",")}) : vec3(${PRIMITIVE_HOVER_COLOR.join(",")});
  gl_Position = uLocalToClip * vec4(vLocal, 0.0, 1.0);
}
`;

export const PRIMITIVE_HIGHLIGHT_FRAGMENT_GLSL = `#version 300 es
precision highp float;
precision highp sampler2D;
uniform float uPixelRatio;
in vec2 vLocal;
flat in vec4 vSegmentA;
flat in vec4 vSegmentB;
flat in vec3 vColor;
out vec4 outColor;
${VECTOR_CLIP_GLSL.replace("int(uVectorClipIndex)", "int(vSegmentB.w)")}
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
`;

export const PRIMITIVE_HIGHLIGHT_LINE_OFFSET_WGSL = `
fn heprOffsetToLineSegment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> vec2<f32> {
  let ab = b - a;
  let abLenSq = dot(ab, ab);
  if (abLenSq <= 1e-10) {
    return a - p;
  }
  let t = clamp(dot(p - a, ab) / abLenSq, 0.0, 1.0);
  return a + ab * t - p;
}
`;

export const PRIMITIVE_HIGHLIGHT_QUADRATIC_OFFSET_WGSL = `
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
`;

/** Dependencies: the highlight line and quadratic offset functions. */
export const PRIMITIVE_HIGHLIGHT_COVERAGE_WGSL = `
fn heprPrimitiveHighlightCoverage(point: vec2<f32>, a: vec4<f32>, b: vec4<f32>, pixelRatio: f32) -> f32 {
  let offset = select(heprOffsetToLineSegment(point,a.xy,b.xy),heprOffsetToQuadraticBezier(point,a.xy,a.zw,b.xy),b.z >= 0.5);
  let distanceValue = length(offset);
  let axis = b.xy-a.xy;
  let fallback = select(vec2<f32>(1.0,0.0),vec2<f32>(-axis.y,axis.x)/max(length(axis),0.00000001),length(axis)>0.00000001);
  let normal = select(fallback,offset/max(distanceValue,0.00000001),distanceValue>0.00000001);
  let localPerPixel = max(length(vec2<f32>(dot(normal,dpdx(point)),dot(normal,dpdy(point)))),0.000001);
  return 1.0-smoothstep(max(0.0,pixelRatio-0.75)*localPerPixel,(pixelRatio+0.75)*localPerPixel,distanceValue);
}
`;

export const PRIMITIVE_HIGHLIGHT_POSITION_WGSL = `
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
`;

export const PRIMITIVE_HIGHLIGHT_WGSL = `
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
${PRIMITIVE_HIGHLIGHT_LINE_OFFSET_WGSL}
${PRIMITIVE_HIGHLIGHT_QUADRATIC_OFFSET_WGSL}
${PRIMITIVE_HIGHLIGHT_COVERAGE_WGSL}
${VECTOR_CLIP_WGSL}
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
  out.color=select(vec3f(${PRIMITIVE_HOVER_COLOR.join(",")}),vec3f(${PRIMITIVE_SELECTION_COLOR.join(",")}),f32(instance)<uCamera.params.z);
  return out;
}
@fragment fn fsMain(inData: Output) -> @location(0) vec4f {
  let alpha=heprPrimitiveHighlightCoverage(inData.local,inData.a,inData.b,uCamera.params.y)*heprVectorClip(inData.local,inData.b.w,uClips);
  if(alpha<=0.001){discard;}
  return vec4f(inData.color,alpha);
}
`;
