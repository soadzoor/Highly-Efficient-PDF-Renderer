const CAMERA_STRUCT = /* wgsl */ `
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
`;

const GRADIENT_BINDINGS = /* wgsl */ `
@group(0) @binding(GRADIENT_META_A_BINDING) var uGradientMetaA : texture_2d<f32>;
@group(0) @binding(GRADIENT_META_B_BINDING) var uGradientMetaB : texture_2d<f32>;
@group(0) @binding(GRADIENT_META_C_BINDING) var uGradientMetaC : texture_2d<f32>;
@group(0) @binding(GRADIENT_META_D_BINDING) var uGradientMetaD : texture_2d<f32>;
@group(0) @binding(GRADIENT_META_E_BINDING) var uGradientMetaE : texture_2d<f32>;
@group(0) @binding(GRADIENT_SAMPLER_BINDING) var uGradientSampler : sampler;
@group(0) @binding(GRADIENT_LUT_BINDING) var uGradientLut : texture_2d<f32>;
`;

const GRADIENT_FUNCTIONS = /* wgsl */ `
fn gradientCoord(index : i32) -> vec2i {
  let dimensions = textureDimensions(uGradientMetaA);
  return vec2i(index % i32(dimensions.x), index / i32(dimensions.x));
}

fn samplePdfGradient(index : i32, scenePoint : vec2f) -> vec4f {
  let gradientCount = i32(textureDimensions(uGradientLut).y);
  if (index < 0 || index >= gradientCount) {
    return vec4f(0.0);
  }
  let coord = gradientCoord(index);
  let metaA = textureLoad(uGradientMetaA, coord, 0);
  let metaB = textureLoad(uGradientMetaB, coord, 0);
  let metaC = textureLoad(uGradientMetaC, coord, 0);
  let metaD = textureLoad(uGradientMetaD, coord, 0);
  let metaE = textureLoad(uGradientMetaE, coord, 0);
  let transform = mat2x2f(vec2f(metaB.x, metaB.y), vec2f(metaB.z, metaB.w));
  let point = transform * scenePoint + metaC.xy;

  if (
    metaA.y >= 0.5 &&
    (point.x < metaE.x || point.y < metaE.y || point.x > metaE.z || point.y > metaE.w)
  ) {
    return vec4f(0.0);
  }

  let p0 = metaC.zw;
  let p1 = metaD.xy;
  let axis = p1 - p0;
  var t = 0.0;
  if (metaA.x < 0.5) {
    let denominator = dot(axis, axis);
    if (denominator <= 1e-12) {
      return vec4f(0.0);
    }
    t = dot(point - p0, axis) / denominator;
  } else {
    let radius0 = metaD.z;
    let radiusDelta = metaD.w - radius0;
    let offset = point - p0;
    let coefficientA = dot(axis, axis) - radiusDelta * radiusDelta;
    let coefficientB = -2.0 * (dot(offset, axis) + radius0 * radiusDelta);
    let coefficientC = dot(offset, offset) - radius0 * radius0;
    var firstRoot = -1e20;
    var secondRoot = -1e20;
    if (abs(coefficientA) <= 1e-10) {
      if (abs(coefficientB) <= 1e-10) {
        return vec4f(0.0);
      }
      firstRoot = -coefficientC / coefficientB;
    } else {
      let discriminant = coefficientB * coefficientB - 4.0 * coefficientA * coefficientC;
      if (discriminant < 0.0) {
        return vec4f(0.0);
      }
      let rootDelta = sqrt(max(discriminant, 0.0));
      firstRoot = (-coefficientB - rootDelta) / (2.0 * coefficientA);
      secondRoot = (-coefficientB + rootDelta) / (2.0 * coefficientA);
    }
    let firstValid = firstRoot > -1e19 && radius0 + firstRoot * radiusDelta >= 0.0;
    let secondValid = secondRoot > -1e19 && radius0 + secondRoot * radiusDelta >= 0.0;
    if (!firstValid && !secondValid) {
      return vec4f(0.0);
    }
    t = select(firstRoot, secondRoot, secondValid);
    if (firstValid && secondValid) {
      t = max(firstRoot, secondRoot);
    }
  }

  let lutX = (clamp(t, 0.0, 1.0) * 1023.0 + 0.5) / 1024.0;
  let lutY = (f32(index) + 0.5) / f32(max(gradientCount, 1));
  return textureSampleLevel(uGradientLut, uGradientSampler, vec2f(lutX, lutY), 0.0);
}

fn cornerFromVertexIndex(vertexIndex : u32) -> vec2f {
  switch (vertexIndex & 3u) {
    case 0u: { return vec2f(-1.0, -1.0); }
    case 1u: { return vec2f(1.0, -1.0); }
    case 2u: { return vec2f(-1.0, 1.0); }
    default: { return vec2f(1.0, 1.0); }
  }
}

fn coordFromIndex(index : i32, width : i32) -> vec2i {
  return vec2i(index % width, index / width);
}

fn distanceToLine(point : vec2f, start : vec2f, end : vec2f) -> f32 {
  let delta = end - start;
  let lengthSquared = dot(delta, delta);
  if (lengthSquared <= 1e-10) {
    return length(point - start);
  }
  let t = clamp(dot(point - start, delta) / lengthSquared, 0.0, 1.0);
  return length(point - (start + delta * t));
}

fn distanceToQuadratic(point : vec2f, p0 : vec2f, p1 : vec2f, p2 : vec2f) -> f32 {
  let aa = p1 - p0;
  let bb = p0 - 2.0 * p1 + p2;
  let cc = aa * 2.0;
  let dd = p0 - point;
  let bbLengthSquared = dot(bb, bb);
  if (bbLengthSquared <= 1e-12) {
    return distanceToLine(point, p0, p2);
  }
  let inverse = 1.0 / bbLengthSquared;
  let kx = inverse * dot(aa, bb);
  let ky = inverse * (2.0 * dot(aa, aa) + dot(dd, bb)) / 3.0;
  let kz = inverse * dot(dd, aa);
  let p = ky - kx * kx;
  let q = kx * (2.0 * kx * kx - 3.0 * ky) + kz;
  let h = q * q + 4.0 * p * p * p;
  var best = 1e20;
  if (h >= 0.0) {
    let hSqrt = sqrt(h);
    let roots = (vec2f(hSqrt, -hSqrt) - q) * 0.5;
    let uv = sign(roots) * pow(abs(roots), vec2f(1.0 / 3.0));
    let t = clamp(uv.x + uv.y - kx, 0.0, 1.0);
    let delta = dd + (cc + bb * t) * t;
    best = dot(delta, delta);
  } else {
    let z = sqrt(-p);
    let angle = acos(clamp(q / (2.0 * p * z), -1.0, 1.0)) / 3.0;
    let cosine = cos(angle);
    let sine = sin(angle) * 1.732050808;
    let roots = clamp(vec3f(cosine + cosine, -sine - cosine, sine - cosine) * z - kx, vec3f(0.0), vec3f(1.0));
    for (var rootIndex = 0; rootIndex < 3; rootIndex = rootIndex + 1) {
      let t = roots[rootIndex];
      let delta = dd + (cc + bb * t) * t;
      best = min(best, dot(delta, delta));
    }
  }
  return sqrt(max(best, 0.0));
}

fn quadraticPoint(p0 : vec2f, p1 : vec2f, p2 : vec2f, t : f32) -> vec2f {
  let oneMinusT = 1.0 - t;
  return oneMinusT * oneMinusT * p0 + 2.0 * oneMinusT * t * p1 + t * t * p2;
}
`;

function gradientBindings(firstBinding: number): string {
  return GRADIENT_BINDINGS
    .replace("GRADIENT_META_A_BINDING", String(firstBinding))
    .replace("GRADIENT_META_B_BINDING", String(firstBinding + 1))
    .replace("GRADIENT_META_C_BINDING", String(firstBinding + 2))
    .replace("GRADIENT_META_D_BINDING", String(firstBinding + 3))
    .replace("GRADIENT_META_E_BINDING", String(firstBinding + 4))
    .replace("GRADIENT_SAMPLER_BINDING", String(firstBinding + 5))
    .replace("GRADIENT_LUT_BINDING", String(firstBinding + 6));
}

export const GRADIENT_FILL_WGSL = /* wgsl */ `
${CAMERA_STRUCT}
@group(0) @binding(0) var<uniform> uCamera : CameraUniforms;
@group(0) @binding(1) var uPathMetaA : texture_2d<f32>;
@group(0) @binding(2) var uPathMetaB : texture_2d<f32>;
@group(0) @binding(3) var uPathMetaC : texture_2d<f32>;
@group(0) @binding(4) var uPaintMeta : texture_2d<f32>;
@group(0) @binding(5) var uSegmentsA : texture_2d<f32>;
@group(0) @binding(6) var uSegmentsB : texture_2d<f32>;
${gradientBindings(7)}
${GRADIENT_FUNCTIONS}

struct FillOut {
  @builtin(position) position : vec4f,
  @location(0) local : vec2f,
  @location(1) @interpolate(flat) segmentStart : i32,
  @location(2) @interpolate(flat) segmentCount : i32,
  @location(3) @interpolate(flat) solidColor : vec3f,
  @location(4) @interpolate(flat) alpha : f32,
  @location(5) @interpolate(flat) fillRule : f32,
  @location(6) @interpolate(flat) companionStroke : f32,
  @location(7) @interpolate(flat) sourceGradient : i32,
  @location(8) @interpolate(flat) maskGradient : i32,
};

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32) -> FillOut {
  let pathIndex = i32(vertexIndex / 4u);
  let dimensions = textureDimensions(uPathMetaA);
  let coord = coordFromIndex(pathIndex, i32(dimensions.x));
  let metaA = textureLoad(uPathMetaA, coord, 0);
  let metaB = textureLoad(uPathMetaB, coord, 0);
  let metaC = textureLoad(uPathMetaC, coord, 0);
  let paintMeta = textureLoad(uPaintMeta, coord, 0);
  let segmentCount = i32(metaA.y + 0.5);
  let alpha = metaC.w;
  var out : FillOut;
  if (segmentCount <= 0 || alpha <= 0.001) {
    out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
    out.local = vec2f(0.0);
    out.segmentStart = 0;
    out.segmentCount = 0;
    out.solidColor = vec3f(0.0);
    out.alpha = 0.0;
    out.fillRule = 0.0;
    out.companionStroke = 0.0;
    out.sourceGradient = -1;
    out.maskGradient = -1;
    return out;
  }
  let corner = cornerFromVertexIndex(vertexIndex) * 0.5 + 0.5;
  let world = mix(metaA.zw, metaB.xy, corner);
  let screen = (world - uCamera.cameraCenter) * uCamera.zoom + 0.5 * uCamera.viewport;
  out.position = vec4f((screen / (0.5 * uCamera.viewport)) - 1.0, 0.0, 1.0);
  out.local = world;
  out.segmentStart = i32(metaA.x + 0.5);
  out.segmentCount = segmentCount;
  out.solidColor = vec3f(metaB.z, metaB.w, metaC.z);
  out.alpha = alpha;
  out.fillRule = metaC.x;
  out.companionStroke = metaC.y;
  out.sourceGradient = i32(round(paintMeta.x));
  out.maskGradient = i32(round(paintMeta.y));
  return out;
}

fn accumulateCrossing(start : vec2f, end : vec2f, point : vec2f, winding : ptr<function, i32>, crossings : ptr<function, i32>) {
  let upward = start.y <= point.y && end.y > point.y;
  let downward = start.y > point.y && end.y <= point.y;
  if (!upward && !downward) { return; }
  let denominator = end.y - start.y;
  if (abs(denominator) <= 1e-6) { return; }
  let x = start.x + (point.y - start.y) * (end.x - start.x) / denominator;
  if (x > point.x) {
    *crossings = *crossings + 1;
    *winding = *winding + select(-1, 1, upward);
  }
}

@fragment
fn fsMain(inData : FillOut) -> @location(0) vec4f {
  // Derivatives must be evaluated before any potentially non-uniform branch,
  // loop exit, or discard in the fragment shader.
  let dx = length(vec2f(dpdx(inData.local.x), dpdy(inData.local.x)));
  let dy = length(vec2f(dpdx(inData.local.y), dpdy(inData.local.y)));
  if (inData.segmentCount <= 0 || inData.alpha <= 0.001) { discard; }
  let dimensions = textureDimensions(uSegmentsA);
  var minDistance = 1e20;
  var winding = 0;
  var crossings = 0;
  for (var primitiveIndex = 0; primitiveIndex < 2048; primitiveIndex = primitiveIndex + 1) {
    if (primitiveIndex >= inData.segmentCount) { break; }
    let coord = coordFromIndex(inData.segmentStart + primitiveIndex, i32(dimensions.x));
    let primitiveA = textureLoad(uSegmentsA, coord, 0);
    let primitiveB = textureLoad(uSegmentsB, coord, 0);
    let p0 = primitiveA.xy;
    let p1 = primitiveA.zw;
    let p2 = primitiveB.xy;
    if (primitiveB.z >= 0.5) {
      minDistance = min(minDistance, distanceToQuadratic(inData.local, p0, p1, p2));
      var previous = p0;
      for (var step = 1; step <= 8; step = step + 1) {
        let next = quadraticPoint(p0, p1, p2, f32(step) / 8.0);
        accumulateCrossing(previous, next, inData.local, &winding, &crossings);
        previous = next;
      }
    } else {
      minDistance = min(minDistance, distanceToLine(inData.local, p0, p2));
      accumulateCrossing(p0, p2, inData.local, &winding, &crossings);
    }
  }
  let inside = select(winding != 0, (crossings & 1) == 1, inData.fillRule >= 0.5);
  var coverage = select(0.0, 1.0, inside);
  if (inData.companionStroke < 0.5) {
    let aaWidth = max(max(dx, dy) * uCamera.fillAAScreenPx, 1e-4);
    let signedDistance = select(minDistance, -minDistance, inside);
    coverage = clamp(0.5 - signedDistance / aaWidth, 0.0, 1.0);
  }
  let source = select(vec4f(inData.solidColor, 1.0), samplePdfGradient(inData.sourceGradient, inData.local), inData.sourceGradient >= 0);
  let maskAlpha = select(1.0, samplePdfGradient(inData.maskGradient, inData.local).a, inData.maskGradient >= 0);
  let alpha = coverage * inData.alpha * source.a * maskAlpha;
  if (alpha <= 0.001) { discard; }
  let color = mix(source.rgb, uCamera.vectorOverride.xyz, clamp(uCamera.vectorOverride.w, 0.0, 1.0));
  return vec4f(color, clamp(alpha, 0.0, 1.0));
}
`;

export const GRADIENT_STROKE_WGSL = /* wgsl */ `
${CAMERA_STRUCT}
@group(0) @binding(0) var<uniform> uCamera : CameraUniforms;
@group(0) @binding(1) var uRunMetaA : texture_2d<f32>;
@group(0) @binding(2) var uEndpoints : texture_2d<f32>;
@group(0) @binding(3) var uPrimitiveMeta : texture_2d<f32>;
@group(0) @binding(4) var uPrimitiveBounds : texture_2d<f32>;
@group(0) @binding(5) var uStyles : texture_2d<f32>;
${gradientBindings(6)}
${GRADIENT_FUNCTIONS}

struct StrokeOut {
  @builtin(position) position : vec4f,
  @location(0) local : vec2f,
  @location(1) @interpolate(flat) p0 : vec2f,
  @location(2) @interpolate(flat) p1 : vec2f,
  @location(3) @interpolate(flat) p2 : vec2f,
  @location(4) @interpolate(flat) primitiveType : f32,
  @location(5) @interpolate(flat) halfWidth : f32,
  @location(6) @interpolate(flat) solidColor : vec3f,
  @location(7) @interpolate(flat) alpha : f32,
  @location(8) @interpolate(flat) clipBounds : vec4f,
  @location(9) @interpolate(flat) hasClipBounds : f32,
  @location(10) @interpolate(flat) sourceGradient : i32,
  @location(11) @interpolate(flat) maskGradient : i32,
};

@vertex
fn vsMain(@builtin(vertex_index) vertexIndex : u32, @builtin(instance_index) instanceIndex : u32) -> StrokeOut {
  let runIndex = i32(vertexIndex / 4u);
  let runDimensions = textureDimensions(uRunMetaA);
  let runMeta = textureLoad(uRunMetaA, coordFromIndex(runIndex, i32(runDimensions.x)), 0);
  let segmentIndex = i32(runMeta.x + 0.5) + i32(instanceIndex);
  let segmentDimensions = textureDimensions(uEndpoints);
  let coord = coordFromIndex(segmentIndex, i32(segmentDimensions.x));
  let primitiveA = textureLoad(uEndpoints, coord, 0);
  let primitiveB = textureLoad(uPrimitiveMeta, coord, 0);
  let bounds = textureLoad(uPrimitiveBounds, coord, 0);
  let style = textureLoad(uStyles, coord, 0);
  let p0 = primitiveA.xy;
  let p1 = primitiveA.zw;
  let p2 = primitiveB.xy;
  let packedStyle = primitiveB.w;
  let flags = i32(floor(packedStyle / 2.0 + 1e-6));
  let alpha = clamp(packedStyle - f32(flags) * 2.0, 0.0, 1.0);
  let hairline = (flags & 1) != 0;
  let roundCap = (flags & 2) != 0;
  let clipped = (flags & 4) != 0;
  let geometryLength = select(length(p2 - p0), length(p1 - p0) + length(p2 - p1), primitiveB.z >= 0.5);
  var out : StrokeOut;
  if ((geometryLength < 1e-5 && !roundCap) || alpha <= 0.001) {
    out.position = vec4f(-2.0, -2.0, 0.0, 1.0);
    out.local = vec2f(0.0);
    out.p0 = vec2f(0.0);
    out.p1 = vec2f(0.0);
    out.p2 = vec2f(0.0);
    out.primitiveType = 0.0;
    out.halfWidth = 0.0;
    out.solidColor = vec3f(0.0);
    out.alpha = 0.0;
    out.clipBounds = vec4f(0.0);
    out.hasClipBounds = 0.0;
    out.sourceGradient = -1;
    out.maskGradient = -1;
    return out;
  }
  let localPerPixel = 1.0 / max(uCamera.zoom, 1e-4);
  let halfWidth = select(style.x, max(0.5 * localPerPixel, 1e-5), hairline);
  let aaWorld = select(
    max(localPerPixel, 0.0001) * uCamera.strokeAAScreenPx,
    max(0.35 * localPerPixel, 5e-5),
    hairline
  );
  let extent = halfWidth + aaWorld;
  let corner = cornerFromVertexIndex(vertexIndex) * 0.5 + 0.5;
  let world = mix(bounds.xy - vec2f(extent), bounds.zw + vec2f(extent), corner);
  let screen = (world - uCamera.cameraCenter) * uCamera.zoom + 0.5 * uCamera.viewport;
  out.position = vec4f((screen / (0.5 * uCamera.viewport)) - 1.0, 0.0, 1.0);
  out.local = world;
  out.p0 = p0;
  out.p1 = p1;
  out.p2 = p2;
  out.primitiveType = primitiveB.z;
  out.halfWidth = halfWidth;
  out.solidColor = style.yzw;
  out.alpha = alpha;
  out.clipBounds = bounds;
  out.hasClipBounds = select(0.0, 1.0, clipped);
  out.sourceGradient = i32(round(runMeta.z));
  out.maskGradient = i32(round(runMeta.w));
  return out;
}

@fragment
fn fsMain(inData : StrokeOut) -> @location(0) vec4f {
  // Keep derivative evaluation in uniform control flow, before clipping and
  // alpha tests can discard individual fragments.
  let dx = length(vec2f(dpdx(inData.local.x), dpdy(inData.local.x)));
  let dy = length(vec2f(dpdx(inData.local.y), dpdy(inData.local.y)));
  if (inData.alpha <= 0.001) { discard; }
  if (
    inData.hasClipBounds >= 0.5 &&
    (inData.local.x < inData.clipBounds.x || inData.local.y < inData.clipBounds.y ||
      inData.local.x > inData.clipBounds.z || inData.local.y > inData.clipBounds.w)
  ) { discard; }
  let distanceValue = select(
    distanceToLine(inData.local, inData.p0, inData.p2),
    distanceToQuadratic(inData.local, inData.p0, inData.p1, inData.p2),
    uCamera.strokeCurveEnabled >= 0.5 && inData.primitiveType >= 0.5
  );
  let localPerPixel = max(max(dx, dy), 1e-6);
  let aaWorld = max(localPerPixel * uCamera.strokeAAScreenPx, 5e-5);
  let coverage = 1.0 - smoothstep(inData.halfWidth - aaWorld, inData.halfWidth + aaWorld, distanceValue);
  let source = select(vec4f(inData.solidColor, 1.0), samplePdfGradient(inData.sourceGradient, inData.local), inData.sourceGradient >= 0);
  let maskAlpha = select(1.0, samplePdfGradient(inData.maskGradient, inData.local).a, inData.maskGradient >= 0);
  let alpha = coverage * inData.alpha * source.a * maskAlpha;
  if (alpha <= 0.001) { discard; }
  let color = mix(source.rgb, uCamera.vectorOverride.xyz, clamp(uCamera.vectorOverride.w, 0.0, 1.0));
  return vec4f(color, clamp(alpha, 0.0, 1.0));
}
`;
