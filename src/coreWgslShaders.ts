// Shared WGSL stroke shader functions.
//
// The native WebGPU renderer interpolates these into its full shader modules,
// while the three.js WebGPU node materials wrap them individually with
// TSL.wgslFn. That is why each export holds exactly one function definition
// and why the function names are hepr-prefixed: three.js stitches them into
// its own generated module, where unprefixed names could collide.
//
// The full stroke module cannot be shared like the GLSL sources in
// coreShaders.ts, because three.js generates its own bindings, varyings, and
// entry points around TSL nodes. Keep backend-specific plumbing (uniforms,
// transforms, varyings) in the consumers and only shared math here.

export const CORE_WGSL_DISTANCE_TO_LINE_SEGMENT_SOURCE = /* wgsl */ `
fn heprDistanceToLineSegment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let ab = b - a;
  let abLenSq = dot(ab, ab);
  if (abLenSq <= 1e-10) {
    return length(p - a);
  }
  let t = clamp(dot(p - a, ab) / abLenSq, 0.0, 1.0);
  return length(p - (a + ab * t));
}
`;

export const CORE_WGSL_DISTANCE_TO_QUADRATIC_BEZIER_SOURCE = /* wgsl */ `
fn heprDistanceToQuadraticBezier(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>) -> f32 {
  let aa = b - a;
  let bb = a - 2.0 * b + c;
  let cc = aa * 2.0;
  let dd = a - p;

  let bbLenSq = dot(bb, bb);
  if (bbLenSq <= 1e-12) {
    return heprDistanceToLineSegment(p, a, c);
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
    let roots = (vec2<f32>(hSqrt, -hSqrt) - vec2<f32>(qValue)) * 0.5;
    let uv = sign(roots) * pow(abs(roots), vec2<f32>(1.0 / 3.0));
    let t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    let delta = dd + (cc + bb * t) * t;
    best = dot(delta, delta);
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
    best = min(best, dot(delta, delta));
    delta = dd + (cc + bb * t.y) * t.y;
    best = min(best, dot(delta, delta));
    delta = dd + (cc + bb * t.z) * t.z;
    best = min(best, dot(delta, delta));
  }

  return sqrt(max(best, 0.0));
}
`;

export const CORE_WGSL_STROKE_QUAD_WORLD_POSITION_SOURCE = /* wgsl */ `
fn heprStrokeQuadWorldPosition(
  corner01: vec2<f32>,
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  primitiveBounds: vec4<f32>,
  extent: f32
) -> vec2<f32> {
  // Candidate A: axis-aligned quad over the (possibly clip-intersected) primitive bounds.
  let worldMin = primitiveBounds.xy - vec2<f32>(extent);
  let worldMax = primitiveBounds.zw + vec2<f32>(extent);

  // Candidate B: oriented quad along the primitive direction. Diagonal segments
  // (e.g. hatching) rasterize orders of magnitude fewer wasted fragments this way,
  // because their axis-aligned bounds cover far more area than the stroke itself.
  let axisDelta = p2 - p0;
  let axisLength = length(axisDelta);
  var axisU = vec2<f32>(1.0, 0.0);
  if (axisLength > 1e-6) {
    axisU = axisDelta / axisLength;
  }
  let axisV = vec2<f32>(-axisU.y, axisU.x);
  let controlOffset = p1 - p0;
  let controlU = dot(controlOffset, axisU);
  let controlV = dot(controlOffset, axisV);
  let orientedMinU = min(min(0.0, controlU), axisLength) - extent;
  let orientedMaxU = max(max(0.0, controlU), axisLength) + extent;
  let orientedMinV = min(0.0, controlV) - extent;
  let orientedMaxV = max(0.0, controlV) + extent;

  let axisAlignedArea = (worldMax.x - worldMin.x) * (worldMax.y - worldMin.y);
  let orientedArea = (orientedMaxU - orientedMinU) * (orientedMaxV - orientedMinV);

  if (orientedArea < axisAlignedArea) {
    return p0
      + axisU * mix(orientedMinU, orientedMaxU, corner01.x)
      + axisV * mix(orientedMinV, orientedMaxV, corner01.y);
  }
  return mix(worldMin, worldMax, corner01);
}
`;
