var e=`
fn heprDistanceToLineSegment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let ab = b - a;
  let abLenSq = dot(ab, ab);
  if (abLenSq <= 1e-10) {
    return length(p - a);
  }
  let t = clamp(dot(p - a, ab) / abLenSq, 0.0, 1.0);
  return length(p - (a + ab * t));
}
`,t=`
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
`,n=`
fn heprStrokeQuadWorldPosition(
  corner01: vec2<f32>,
  p0: vec2<f32>,
  p1: vec2<f32>,
  p2: vec2<f32>,
  primitiveBounds: vec4<f32>,
  extent: f32
) -> vec2<f32> {
  
  let worldMin = primitiveBounds.xy - vec2<f32>(extent);
  let worldMax = primitiveBounds.zw + vec2<f32>(extent);

  
  
  
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
`,r=`
fn heprRasterStripLevel(
  uRasterTex : texture_2d<f32>,
  uRasterSampler : sampler,
  uv : vec2f,
  row : u32,
  width : u32,
  level : u32
) -> vec4f {
  var offset = 0u;
  var levelWidth = width;
  for (var index = 0u; index < level; index = index + 1u) {
    offset = offset + levelWidth;
    levelWidth = max(levelWidth / 2u, 1u);
  }
  let x = f32(offset) + clamp(uv.x * f32(levelWidth), 0.5, f32(levelWidth) - 0.5);
  let atlasUv = vec2f(x, f32(row) + 0.5) / vec2f(textureDimensions(uRasterTex));
  return textureSampleLevel(uRasterTex, uRasterSampler, atlasUv, 0.0);
}
`,i=`
fn heprRasterStripSample(
  uRasterTex : texture_2d<f32>,
  uRasterSampler : sampler,
  uv : vec2f,
  row : u32,
  width : u32
) -> vec4f {
  let sourceUv = uv * vec2f(f32(width), 1.0);
  let footprint = max(length(dpdx(sourceUv)), length(dpdy(sourceUv)));
  let maxLevel = firstLeadingBit(width);
  let lod = clamp(log2(max(footprint, 1.0)), 0.0, f32(maxLevel));
  let lowerLevel = u32(floor(lod));
  let upperLevel = u32(ceil(lod));
  return mix(
    heprRasterStripLevel(uRasterTex, uRasterSampler, uv, row, width, lowerLevel),
    heprRasterStripLevel(uRasterTex, uRasterSampler, uv, row, width, upperLevel),
    fract(lod)
  );
}
`;export{n as a,t as i,i as n,e as r,r as t};