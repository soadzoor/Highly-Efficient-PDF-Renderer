import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";

interface MutableUniform<T> {
  value: T;
}

export interface ThreeWebGpuStrokeMaterialState {
  material: THREE.Material;
  zoomUniform: MutableUniform<number>;
  useLocalToClipUniform: MutableUniform<number>;
  localUnitsPerPixelUniform: MutableUniform<number>;
  curveUniform: MutableUniform<number>;
}

interface ThreeWebGpuStrokeMaterialOptions {
  segmentTextureA: THREE.DataTexture;
  segmentTextureB: THREE.DataTexture;
  segmentStyleTexture: THREE.DataTexture;
  segmentBoundsTexture: THREE.DataTexture;
  segmentTextureWidth: number;
  viewport: THREE.Vector2;
  cameraCenter: THREE.Vector2;
  localToClip: THREE.Matrix4;
  vectorOverride: THREE.Vector4;
  strokeCurveEnabled: boolean;
}

type WgslFunction = ReturnType<typeof TSL.wgslFn>;

function includeNode(fn: WgslFunction): never {
  return (fn as WgslFunction & { functionNode: unknown }).functionNode as never;
}

const segmentCoordFn = TSL.wgslFn(`
fn heprSegmentCoord(index: f32, width: f32) -> vec2<i32> {
  let segmentIndex = i32(index + 0.5);
  let safeWidth = max(i32(width), 1);
  return vec2<i32>(segmentIndex % safeWidth, segmentIndex / safeWidth);
}
`);

const floatModFn = TSL.wgslFn(`
fn heprFloatMod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}
`);

const worldPackFn = TSL.wgslFn(`
fn heprStrokeWorldPack(
  corner: vec2<f32>,
  primitiveA: vec4<f32>,
  primitiveB: vec4<f32>,
  style: vec4<f32>,
  primitiveBounds: vec4<f32>,
  zoom: f32,
  useLocalToClip: f32,
  localUnitsPerPixelInput: f32,
  aaScreenPx: f32
) -> vec4<f32> {
  let p0 = primitiveA.xy;
  let p1 = primitiveA.zw;
  let p2 = primitiveB.xy;
  let primitiveType = primitiveB.z;
  let isQuadratic = primitiveType >= 0.5;
  var halfWidth = style.x;
  let packedStyle = primitiveB.w;
  let styleFlags = floor(packedStyle / 2.0 + 0.000001);
  let alpha = packedStyle - styleFlags * 2.0;
  let isHairline = heprFloatMod(styleFlags, 2.0) >= 0.5;
  let isRoundCap = heprFloatMod(floor(styleFlags * 0.5), 2.0) >= 0.5;

  var geometryLength: f32;
  if (isQuadratic) {
    geometryLength = length(p1 - p0) + length(p2 - p1);
  } else {
    geometryLength = length(p2 - p0);
  }

  if ((geometryLength < 0.00001 && !isRoundCap) || alpha <= 0.001) {
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
  let worldMin = primitiveBounds.xy - vec2<f32>(extent);
  let worldMax = primitiveBounds.zw + vec2<f32>(extent);
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  let worldPosition = worldMin + (worldMax - worldMin) * corner01;
  return vec4<f32>(worldPosition, halfWidth, aaWorld);
}
`, [includeNode(floatModFn)]);

const clipPositionFn = TSL.wgslFn(`
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

const fragmentFn = TSL.wgslFn(`
fn heprStrokeFragment(
  local: vec2<f32>,
  primitiveA: vec4<f32>,
  primitiveB: vec4<f32>,
  style: vec4<f32>,
  halfWidthFromVertex: f32,
  strokeCurveEnabled: f32,
  aaScreenPx: f32,
  vectorOverride: vec4<f32>
) -> vec4<f32> {
  let p0 = primitiveA.xy;
  let p1 = primitiveA.zw;
  let p2 = primitiveB.xy;
  let primitiveType = primitiveB.z;
  let packedStyle = primitiveB.w;
  let styleFlags = floor(packedStyle / 2.0 + 0.000001);
  let alphaStyle = packedStyle - styleFlags * 2.0;
  if (alphaStyle <= 0.001) {
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

  let coverage = 1.0 - smoothstep(halfWidth - aaWorld, halfWidth + aaWorld, distanceToSegment);
  let alpha = coverage * alphaStyle;
  if (alpha <= 0.001) {
    discard;
  }

  let mixAmount = clamp(vectorOverride.a, 0.0, 1.0);
  let baseColor = style.yzw;
  let color = baseColor * (1.0 - mixAmount) + vectorOverride.rgb * mixAmount;
  return vec4<f32>(color, alpha);
}
`, [
  includeNode(floatModFn),
  includeNode(distanceToLineSegmentFn),
  includeNode(distanceToQuadraticBezierFn)
]);

export function createThreeWebGpuStrokeMaterial(
  options: ThreeWebGpuStrokeMaterialOptions
): ThreeWebGpuStrokeMaterialState {
  const material = new NodeMaterial();
  material.transparent = true;
  material.depthTest = false;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  material.toneMapped = false;
  material.fog = false;
  material.lights = false;

  const zoomUniform = TSL.uniform(1);
  const useLocalToClipUniform = TSL.uniform(0);
  const localUnitsPerPixelUniform = TSL.uniform(1);
  const curveUniform = TSL.uniform(options.strokeCurveEnabled ? 1 : 0);
  const segmentTextureWidthUniform = TSL.uniform(Math.max(1, options.segmentTextureWidth));
  const aaScreenPxUniform = TSL.uniform(1);

  const corner = TSL.attribute("aCorner", "vec2");
  const segmentIndex = TSL.attribute("aSegmentIndex", "float");
  const coord = segmentCoordFn({
    index: segmentIndex,
    width: segmentTextureWidthUniform
  });

  const primitiveA = TSL.varying(TSL.textureLoad(options.segmentTextureA, coord, 0));
  const primitiveB = TSL.varying(TSL.textureLoad(options.segmentTextureB, coord, 0));
  const style = TSL.varying(TSL.textureLoad(options.segmentStyleTexture, coord, 0));
  const primitiveBounds = TSL.varying(TSL.textureLoad(options.segmentBoundsTexture, coord, 0));
  const worldPack = TSL.varying(worldPackFn({
    corner,
    primitiveA,
    primitiveB,
    style,
    primitiveBounds,
    zoom: zoomUniform,
    useLocalToClip: useLocalToClipUniform,
    localUnitsPerPixelInput: localUnitsPerPixelUniform,
    aaScreenPx: aaScreenPxUniform
  }));
  const worldPackValue = worldPack as typeof worldPack & {
    xy: unknown;
    z: unknown;
  };

  const viewportUniform = TSL.uniform(options.viewport);
  const cameraCenterUniform = TSL.uniform(options.cameraCenter);
  const localToClipUniform = TSL.uniform(options.localToClip);
  const vectorOverrideUniform = TSL.uniform(options.vectorOverride);

  material.vertexNode = clipPositionFn({
    worldPack,
    viewport: viewportUniform,
    cameraCenter: cameraCenterUniform,
    zoom: zoomUniform,
    useLocalToClip: useLocalToClipUniform,
    localToClip: localToClipUniform
  });
  material.fragmentNode = (fragmentFn as (...params: unknown[]) => unknown)({
    local: worldPackValue.xy,
    primitiveA,
    primitiveB,
    style,
    halfWidthFromVertex: worldPackValue.z,
    strokeCurveEnabled: curveUniform,
    aaScreenPx: aaScreenPxUniform,
    vectorOverride: vectorOverrideUniform
  }) as never;

  return {
    material,
    zoomUniform: zoomUniform as MutableUniform<number>,
    useLocalToClipUniform: useLocalToClipUniform as MutableUniform<number>,
    localUnitsPerPixelUniform: localUnitsPerPixelUniform as MutableUniform<number>,
    curveUniform: curveUniform as MutableUniform<number>
  };
}
