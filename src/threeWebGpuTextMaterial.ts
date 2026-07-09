import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";

import { configureStraightAlphaBlending } from "./threeMaterialBlending";

interface MutableUniform<T> {
  value: T;
}

export interface ThreeWebGpuTextMaterialState {
  material: THREE.Material;
  zoomUniform: MutableUniform<number>;
  useLocalToClipUniform: MutableUniform<number>;
  curveUniform: MutableUniform<number>;
  vectorOnlyUniform: MutableUniform<number>;
}

interface ThreeWebGpuTextMaterialOptions {
  textInstanceTextureA: THREE.DataTexture;
  textInstanceTextureB: THREE.DataTexture;
  textInstanceTextureC: THREE.DataTexture;
  textGlyphMetaTextureA: THREE.DataTexture;
  textGlyphMetaTextureB: THREE.DataTexture;
  textGlyphSegmentTextureA: THREE.DataTexture;
  textGlyphSegmentTextureB: THREE.DataTexture;
  textInstanceTextureWidth: number;
  textGlyphTextureWidth: number;
  textSegmentTextureWidth: number;
  viewport: THREE.Vector2;
  cameraCenter: THREE.Vector2;
  localToClip: THREE.Matrix4;
  vectorOverride: THREE.Vector4;
  strokeCurveEnabled: boolean;
  textVectorOnly: boolean;
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

const textVertexPackFn = TSL.wgslFn(`
fn heprTextVertexPack(
  corner: vec2<f32>,
  instanceA: vec4<f32>,
  instanceB: vec4<f32>,
  glyphMetaA: vec4<f32>,
  glyphMetaB: vec4<f32>
) -> vec4<f32> {
  let segmentCount = i32(glyphMetaA.y + 0.5);
  if (segmentCount <= 0) {
    return vec4<f32>(-2.0, -2.0, 0.0, 0.0);
  }

  let minBounds = glyphMetaA.zw;
  let maxBounds = glyphMetaB.xy;
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  let local = minBounds + (maxBounds - minBounds) * corner01;
  let world = vec2<f32>(
    instanceA.x * local.x + instanceA.z * local.y + instanceB.x,
    instanceA.y * local.x + instanceA.w * local.y + instanceB.y
  );
  return vec4<f32>(world, local);
}
`);

const textClipFn = TSL.wgslFn(`
fn heprTextClipPosition(
  vertexPack: vec4<f32>,
  viewport: vec2<f32>,
  cameraCenter: vec2<f32>,
  zoom: f32,
  useLocalToClip: f32,
  localToClip: mat4x4<f32>
) -> vec4<f32> {
  if (vertexPack.z <= -1.5 && vertexPack.w <= -1.5) {
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

const distanceToLineSegmentFn = TSL.wgslFn(`
fn heprDistanceToLineSegment(p: vec2<f32>, a: vec2<f32>, b: vec2<f32>) -> f32 {
  let ab = b - a;
  let abLenSq = dot(ab, ab);
  if (abLenSq <= 0.0000000001) {
    return length(p - a);
  }
  let t = clamp(dot(p - a, ab) / abLenSq, 0.0, 1.0);
  return length(p - (a + ab * t));
}
`);

const distanceToQuadraticBezierFn = TSL.wgslFn(`
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
`, [includeNode(distanceToLineSegmentFn)]);

const textCrossingFns = TSL.wgslFn(`
fn heprLineWindingDelta(a: vec2<f32>, b: vec2<f32>, p: vec2<f32>) -> i32 {
  let upward = (a.y <= p.y) && (b.y > p.y);
  let downward = (a.y > p.y) && (b.y <= p.y);
  if (!upward && !downward) {
    return 0;
  }
  let denom = b.y - a.y;
  if (abs(denom) <= 0.000001) {
    return 0;
  }
  let xCross = a.x + (p.y - a.y) * (b.x - a.x) / denom;
  if (xCross > p.x) {
    if (upward) {
      return 1;
    }
    return -1;
  }
  return 0;
}

fn heprEvaluateQuadratic(a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, t: f32) -> vec2<f32> {
  let oneMinusT = 1.0 - t;
  return oneMinusT * oneMinusT * a + 2.0 * oneMinusT * t * b + t * t * c;
}

fn heprQuadraticWindingDelta(a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, p: vec2<f32>) -> i32 {
  var delta = 0;
  var prev = a;
  for (var i = 1; i <= 6; i = i + 1) {
    let t = f32(i) / 6.0;
    let next = heprEvaluateQuadratic(a, b, c, t);
    delta = delta + heprLineWindingDelta(prev, next, p);
    prev = next;
  }
  return delta;
}
`);

const textFragmentFn = TSL.wgslFn(`
fn heprTextFragment(
  local: vec2<f32>,
  glyphMetaA: vec4<f32>,
  instanceColor: vec4<f32>,
  segmentTexA: texture_2d<f32>,
  segmentTexB: texture_2d<f32>,
  segmentTexWidth: f32,
  textAAScreenPx: f32,
  textCurveEnabled: f32,
  vectorOverride: vec4<f32>
) -> vec4<f32> {
  let segmentStart = i32(glyphMetaA.x + 0.5);
  let segmentCount = i32(glyphMetaA.y + 0.5);
  if (segmentCount <= 0 || instanceColor.a <= 0.001) {
    discard;
  }

  var minDistance = 100000000000000000000.0;
  var winding = 0;
  let safeWidth = max(i32(segmentTexWidth), 1);

  for (var i = 0; i < 256; i = i + 1) {
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

    if (textCurveEnabled >= 0.5 && primitiveType >= 1.0) {
      minDistance = min(minDistance, heprDistanceToQuadraticBezier(local, p0, p1, p2));
      winding = winding + heprQuadraticWindingDelta(p0, p1, p2, local);
    } else {
      minDistance = min(minDistance, heprDistanceToLineSegment(local, p0, p2));
      winding = winding + heprLineWindingDelta(p0, p2, local);
    }
  }

  let inside = winding != 0;
  let signedDistance = select(minDistance, -minDistance, inside);
  let pixelToLocalX = length(vec2<f32>(dpdx(local.x), dpdy(local.x)));
  let pixelToLocalY = length(vec2<f32>(dpdx(local.y), dpdy(local.y)));
  let localPerPixel = max(pixelToLocalX, pixelToLocalY);
  let baseAAWidth = max(localPerPixel * textAAScreenPx, 0.0001);
  let alphaBase = 1.0 - smoothstep(-baseAAWidth, baseAAWidth, signedDistance);
  let alpha = alphaBase * instanceColor.a;
  if (alpha <= 0.001) {
    discard;
  }

  let mixAmount = clamp(vectorOverride.a, 0.0, 1.0);
  let color = instanceColor.rgb * (1.0 - mixAmount) + vectorOverride.rgb * mixAmount;
  return vec4<f32>(color, alpha);
}
`, [
  includeNode(distanceToLineSegmentFn),
  includeNode(distanceToQuadraticBezierFn),
  includeNode(textCrossingFns)
]);

export function createThreeWebGpuTextMaterial(
  options: ThreeWebGpuTextMaterialOptions
): ThreeWebGpuTextMaterialState {
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
  const curveUniform = TSL.uniform(options.strokeCurveEnabled ? 1 : 0);
  const vectorOnlyUniform = TSL.uniform(options.textVectorOnly ? 1 : 0);
  const textAAScreenPxUniform = TSL.uniform(1.25);
  const instanceTextureWidthUniform = TSL.uniform(Math.max(1, options.textInstanceTextureWidth));
  const glyphTextureWidthUniform = TSL.uniform(Math.max(1, options.textGlyphTextureWidth));
  const segmentTextureWidthUniform = TSL.uniform(Math.max(1, options.textSegmentTextureWidth));

  const corner = TSL.attribute("aCorner", "vec2");
  const instanceIndex = TSL.attribute("aTextInstanceIndex", "float");
  const instanceCoord = callNode(coordFromIndexFn, {
    index: instanceIndex,
    width: instanceTextureWidthUniform
  });
  const instanceA = varyingNode(TSL.textureLoad(options.textInstanceTextureA, instanceCoord, 0));
  const instanceB = varyingNode(TSL.textureLoad(options.textInstanceTextureB, instanceCoord, 0));
  const instanceColor = varyingNode(TSL.textureLoad(options.textInstanceTextureC, instanceCoord, 0));
  const glyphCoord = callNode(coordFromIndexFn, {
    index: (instanceB as { z: unknown }).z,
    width: glyphTextureWidthUniform
  });
  const glyphMetaA = varyingNode(TSL.textureLoad(options.textGlyphMetaTextureA, glyphCoord, 0));
  const glyphMetaB = varyingNode(TSL.textureLoad(options.textGlyphMetaTextureB, glyphCoord, 0));
  const vertexPack = varyingNode(callNode(textVertexPackFn, {
    corner,
    instanceA,
    instanceB,
    glyphMetaA,
    glyphMetaB
  }));
  const vertexPackValue = vertexPack as { zw: unknown };

  material.vertexNode = callNode(textClipFn, {
    vertexPack,
    viewport: TSL.uniform(options.viewport),
    cameraCenter: TSL.uniform(options.cameraCenter),
    zoom: zoomUniform,
    useLocalToClip: useLocalToClipUniform,
    localToClip: TSL.uniform(options.localToClip)
  });
  material.fragmentNode = callNode(textFragmentFn, {
    local: vertexPackValue.zw,
    glyphMetaA,
    instanceColor,
    segmentTexA: TSL.textureLoad(options.textGlyphSegmentTextureA),
    segmentTexB: TSL.textureLoad(options.textGlyphSegmentTextureB),
    segmentTexWidth: segmentTextureWidthUniform,
    textAAScreenPx: textAAScreenPxUniform,
    textCurveEnabled: curveUniform,
    vectorOverride: TSL.uniform(options.vectorOverride)
  });

  return {
    material,
    zoomUniform: zoomUniform as MutableUniform<number>,
    useLocalToClipUniform: useLocalToClipUniform as MutableUniform<number>,
    curveUniform: curveUniform as MutableUniform<number>,
    vectorOnlyUniform: vectorOnlyUniform as MutableUniform<number>
  };
}
