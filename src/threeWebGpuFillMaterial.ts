import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";

import { configureStraightAlphaBlending } from "./threeMaterialBlending";
import { threeWebGpuOutputSrgbToLinearFn } from "./threeWebGpuColorSpace";

interface MutableUniform<T> {
  value: T;
}

export interface ThreeWebGpuFillMaterialState {
  material: THREE.Material;
  zoomUniform: MutableUniform<number>;
  useLocalToClipUniform: MutableUniform<number>;
}

interface ThreeWebGpuFillMaterialOptions {
  fillPathMetaTextureA: THREE.DataTexture;
  fillPathMetaTextureB: THREE.DataTexture;
  fillPathMetaTextureC: THREE.DataTexture;
  fillSegmentTextureA: THREE.DataTexture;
  fillSegmentTextureB: THREE.DataTexture;
  fillPathTextureWidth: number;
  fillSegmentTextureWidth: number;
  viewport: THREE.Vector2;
  cameraCenter: THREE.Vector2;
  localToClip: THREE.Matrix4;
  vectorOverride: THREE.Vector4;
}

// Deliberately typed as `unknown`: naming the TSL function type (e.g. via
// `ReturnType<typeof TSL.wgslFn>`) instantiates @types/three's recursive
// ProxiedTuple/ProxiedObject types, which hangs the TypeScript 7 native compiler.
// Since three r180, wgslFn results are proxies without a `functionNode`
// property; the include entry is the wgslFn value itself.
function includeNode(fn: unknown): never {
  return fn as never;
}

function callNode(fn: unknown, params: Record<string, unknown>): never {
  return (fn as (...args: unknown[]) => unknown)(params) as never;
}

function varyingNode(node: unknown): never {
  return (TSL.varying as unknown as (node: unknown) => unknown)(node) as never;
}

const coordFromIndexFn = TSL.wgslFn(`
fn heprCoordFromIndex(index: f32, width: f32) -> vec2<i32> {
  let itemIndex = i32(index + 0.5);
  let safeWidth = max(i32(width), 1);
  return vec2<i32>(itemIndex % safeWidth, itemIndex / safeWidth);
}
`);

const fillVertexPackFn = TSL.wgslFn(`
fn heprFillVertexPack(
  corner: vec2<f32>,
  metaA: vec4<f32>,
  metaB: vec4<f32>,
  metaC: vec4<f32>
) -> vec4<f32> {
  let segmentCount = i32(metaA.y + 0.5);
  let alpha = metaC.w;
  if (segmentCount <= 0 || alpha <= 0.001) {
    return vec4<f32>(-2.0, -2.0, 0.0, 0.0);
  }

  let minBounds = metaA.zw;
  let maxBounds = metaB.xy;
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  let world = minBounds + (maxBounds - minBounds) * corner01;
  return vec4<f32>(world, 1.0, 0.0);
}
`);

const fillClipFn = TSL.wgslFn(`
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
`);

const fillFragmentFn = TSL.wgslFn(`
fn heprFillFragment(
  local: vec2<f32>,
  metaA: vec4<f32>,
  metaB: vec4<f32>,
  metaC: vec4<f32>,
  segmentTexA: texture_2d<f32>,
  segmentTexB: texture_2d<f32>,
  segmentTexWidth: f32,
  fillAAScreenPx: f32,
  vectorOverride: vec4<f32>
) -> vec4<f32> {
  let segmentStart = i32(metaA.x + 0.5);
  let segmentCount = i32(metaA.y + 0.5);
  let alphaStyle = metaC.w;
  if (segmentCount <= 0 || alphaStyle <= 0.001) {
    discard;
  }

  var minDistance = 100000000000000000000.0;
  var winding = 0;
  var crossings = 0;
  let safeWidth = max(i32(segmentTexWidth), 1);

  for (var i = 0; i < 2048; i = i + 1) {
    if (i >= segmentCount) {
      break;
    }

    let primitiveIndex = segmentStart + i;
    let coord = vec2<i32>(primitiveIndex % safeWidth, primitiveIndex / safeWidth);
    let primitiveA = textureLoad(segmentTexA, coord, 0);
    let primitiveB = textureLoad(segmentTexB, coord, 0);
    let p0 = primitiveA.xy;
    let p1 = primitiveA.zw;
    let p2 = primitiveB.xy;
    let primitiveType = primitiveB.z;

    if (primitiveType >= 1.0) {
      minDistance = min(minDistance, heprDistanceToQuadraticBezier(local, p0, p1, p2));
      let crossingDelta = heprQuadraticCrossingDelta(p0, p1, p2, local);
      winding = winding + crossingDelta.x;
      crossings = crossings + crossingDelta.y;
    } else {
      minDistance = min(minDistance, heprDistanceToLineSegment(local, p0, p2));
      let crossingDelta = heprLineCrossingDelta(p0, p2, local);
      winding = winding + crossingDelta.x;
      crossings = crossings + crossingDelta.y;
    }
  }

  let insideNonZero = winding != 0;
  let insideEvenOdd = (crossings % 2) == 1;
  let inside = select(insideNonZero, insideEvenOdd, metaC.x >= 0.5);
  let mixAmount = clamp(vectorOverride.a, 0.0, 1.0);
  let baseColor = vec3<f32>(metaB.z, metaB.w, metaC.z);
  let color = baseColor * (1.0 - mixAmount) + vectorOverride.rgb * mixAmount;

  if (metaC.y >= 0.5) {
    let alpha = select(0.0, alphaStyle, inside);
    if (alpha <= 0.001) {
      discard;
    }
    return vec4<f32>(heprThreeOutputSrgbToLinear(color), alpha);
  }

  let signedDistance = select(minDistance, -minDistance, inside);
  let pixelToLocalX = length(vec2<f32>(dpdx(local.x), dpdy(local.x)));
  let pixelToLocalY = length(vec2<f32>(dpdx(local.y), dpdy(local.y)));
  let aaWidth = max(max(pixelToLocalX, pixelToLocalY) * fillAAScreenPx, 0.0001);
  let alpha = clamp(0.5 - signedDistance / aaWidth, 0.0, 1.0) * alphaStyle;
  if (alpha <= 0.001) {
    discard;
  }

  return vec4<f32>(heprThreeOutputSrgbToLinear(color), alpha);
}
`, [
  includeNode(threeWebGpuOutputSrgbToLinearFn),
  includeNode(TSL.wgslFn(`
fn heprDistanceToLineSegment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let ab = b - a;
  let abLenSq = dot(ab, ab);
  if (abLenSq <= 0.0000000001) {
    return length(p - a);
  }
  let t = clamp(dot(p - a, ab) / abLenSq, 0.0, 1.0);
  return length(p - (a + ab * t));
}
`)),
  includeNode(TSL.wgslFn(`
fn heprDistanceToQuadraticBezier(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>, c: vec2<f32>) -> f32 {
  let aa = b - a;
  let bb = a - 2.0 * b + c;
  let cc = aa * 2.0;
  let dd = a - p;

  let bbLenSq = dot(bb, bb);
  if (bbLenSq <= 0.000000000001) {
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
  var best = 100000000000000000000.0;

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
`)),
  includeNode(TSL.wgslFn(`
fn heprLineCrossingDelta(a: vec2<f32>, b: vec2<f32>, p: vec2<f32>) -> vec2<i32> {
  let upward = (a.y <= p.y) && (b.y > p.y);
  let downward = (a.y > p.y) && (b.y <= p.y);
  if (!upward && !downward) {
    return vec2<i32>(0);
  }
  let denom = b.y - a.y;
  if (abs(denom) <= 0.000001) {
    return vec2<i32>(0);
  }
  let xCross = a.x + (p.y - a.y) * (b.x - a.x) / denom;
  if (xCross > p.x) {
    var windingDelta = -1;
    if (upward) {
      windingDelta = 1;
    }
    return vec2<i32>(windingDelta, 1);
  }
  return vec2<i32>(0);
}
`)),
  includeNode(TSL.wgslFn(`
fn heprEvaluateQuadratic(a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, t: f32) -> vec2<f32> {
  let oneMinusT = 1.0 - t;
  return oneMinusT * oneMinusT * a + 2.0 * oneMinusT * t * b + t * t * c;
}

fn heprQuadraticCrossingDelta(a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, p: vec2<f32>) -> vec2<i32> {
  var delta = vec2<i32>(0);
  var prev = a;
  for (var i = 1; i <= 6; i = i + 1) {
    let t = f32(i) / 6.0;
    let next = heprEvaluateQuadratic(a, b, c, t);
    delta = delta + heprLineCrossingDelta(prev, next, p);
    prev = next;
  }
  return delta;
}
`))
]);

export function createThreeWebGpuFillMaterial(
  options: ThreeWebGpuFillMaterialOptions
): ThreeWebGpuFillMaterialState {
  const material = new NodeMaterial();
  material.transparent = false;
  material.depthTest = false;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  material.toneMapped = false;
  material.fog = false;
  material.lights = false;
  configureStraightAlphaBlending(material);

  const zoomUniform = TSL.uniform(1);
  const useLocalToClipUniform = TSL.uniform(0);
  const fillAAScreenPxUniform = TSL.uniform(1);
  const fillPathTextureWidthUniform = TSL.uniform(Math.max(1, options.fillPathTextureWidth));
  const fillSegmentTextureWidthUniform = TSL.uniform(Math.max(1, options.fillSegmentTextureWidth));

  const corner = TSL.attribute("aCorner", "vec2");
  const fillPathIndex = TSL.attribute("aFillPathIndex", "float");
  const pathCoord = callNode(coordFromIndexFn, {
    index: fillPathIndex,
    width: fillPathTextureWidthUniform
  });
  const metaA = varyingNode(TSL.textureLoad(options.fillPathMetaTextureA, pathCoord, 0));
  const metaB = varyingNode(TSL.textureLoad(options.fillPathMetaTextureB, pathCoord, 0));
  const metaC = varyingNode(TSL.textureLoad(options.fillPathMetaTextureC, pathCoord, 0));
  const vertexPack = varyingNode(callNode(fillVertexPackFn, {
    corner,
    metaA,
    metaB,
    metaC
  }));
  const vertexPackValue = vertexPack as { xy: unknown };

  material.vertexNode = callNode(fillClipFn, {
    vertexPack,
    viewport: TSL.uniform(options.viewport),
    cameraCenter: TSL.uniform(options.cameraCenter),
    zoom: zoomUniform,
    useLocalToClip: useLocalToClipUniform,
    localToClip: TSL.uniform(options.localToClip)
  });
  material.fragmentNode = callNode(fillFragmentFn, {
    local: vertexPackValue.xy,
    metaA,
    metaB,
    metaC,
    segmentTexA: TSL.textureLoad(options.fillSegmentTextureA),
    segmentTexB: TSL.textureLoad(options.fillSegmentTextureB),
    segmentTexWidth: fillSegmentTextureWidthUniform,
    fillAAScreenPx: fillAAScreenPxUniform,
    vectorOverride: TSL.uniform(options.vectorOverride)
  });

  return {
    material,
    zoomUniform: zoomUniform as MutableUniform<number>,
    useLocalToClipUniform: useLocalToClipUniform as MutableUniform<number>
  };
}
