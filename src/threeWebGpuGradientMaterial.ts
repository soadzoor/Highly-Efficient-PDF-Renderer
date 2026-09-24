import { VECTOR_FILL_BAND_INFO_WGSL, vectorFillBandLoopWgsl } from "./vectorFillBandShaders";
import { registerThreePdfShapeUniform } from "./threePdfShape";
import { GRADIENT_PARAMETER_WGSL, GRADIENT_BACKGROUND_WGSL } from "./gradientSampling";
import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";
import { registerThreeNodeClipPosition } from "./threeVectorClips";

import {
  CORE_WGSL_DISTANCE_TO_LINE_SEGMENT_SOURCE,
  CORE_WGSL_DISTANCE_TO_QUADRATIC_BEZIER_SOURCE,
  CORE_WGSL_STROKE_QUAD_WORLD_POSITION_SOURCE
} from "./coreWgslShaders";
import { configureStraightAlphaBlending } from "./threeMaterialBlending";
import {
  createThreeWebGpuOutputFragmentFns,
  type ThreeColorCompositing
} from "./threeWebGpuColorSpace";

interface MutableUniform<T> {
  value: T;
}

interface GradientTextureOptions {
  gradientMetaTextureA: THREE.DataTexture;
  gradientMetaTextureB: THREE.DataTexture;
  gradientMetaTextureC: THREE.DataTexture;
  gradientMetaTextureD: THREE.DataTexture;
  gradientMetaTextureE: THREE.DataTexture;
  gradientLutTexture: THREE.DataTexture;
  gradientMetaTextureWidth: number;
  sourceGradientIndex: number;
  maskGradientIndex: number;
}

interface CommonMaterialOptions extends GradientTextureOptions {
  colorCompositing: ThreeColorCompositing;
  viewport: THREE.Vector2;
  cameraCenter: THREE.Vector2;
  localToClip: THREE.Matrix4;
  vectorOverride: THREE.Vector4;
  primitiveColor: THREE.Vector4;
}

export interface ThreeWebGpuGradientFillMaterialOptions extends CommonMaterialOptions {
  mesh?: boolean;
  fillPathMetaTextureA: THREE.DataTexture;
  fillPathMetaTextureB: THREE.DataTexture;
  fillPathMetaTextureC: THREE.DataTexture;
  fillSegmentTextureA: THREE.DataTexture;
  fillSegmentTextureB: THREE.DataTexture;
  fillPathTextureWidth: number;
  fillSegmentTextureWidth: number;
  fillBandBase?: number;
  fillBandEntries?: number;
}

export interface ThreeWebGpuGradientStrokeMaterialOptions extends CommonMaterialOptions {
  segmentTextureA: THREE.DataTexture;
  segmentTextureB: THREE.DataTexture;
  segmentStyleTexture: THREE.DataTexture;
  segmentBoundsTexture: THREE.DataTexture;
  segmentTextureWidth: number;
  strokeCurveEnabled: boolean;
}

export interface ThreeWebGpuGradientFillMaterialState {
  material: THREE.Material;
  zoomUniform: MutableUniform<number>;
  useLocalToClipUniform: MutableUniform<number>;
}

export interface ThreeWebGpuGradientStrokeMaterialState {
  material: THREE.Material;
  zoomUniform: MutableUniform<number>;
  useLocalToClipUniform: MutableUniform<number>;
  localUnitsPerPixelUniform: MutableUniform<number>;
  curveUniform: MutableUniform<number>;
}

function includeNode(fn: unknown): never {
  return fn as never;
}

function callNode(fn: unknown, params: Record<string, unknown>): never {
  return (fn as (...args: unknown[]) => unknown)(params) as never;
}

// `flat` mirrors the `flat` qualifier the GLSL shaders and the
// `@interpolate(flat)` attribute the native WGSL shaders use for per-primitive
// values. Only positions, which really do vary across the quad, stay
// interpolated.
function varyingNode(node: unknown, flat = false): never {
  const varying = (TSL.varying as unknown as (node: unknown) =>
    { setInterpolation(type: string): unknown })(node);
  return (flat ? varying.setInterpolation("flat") : varying) as never;
}

const fillBandInfoFn = TSL.wgslFn(VECTOR_FILL_BAND_INFO_WGSL);

const coordFromIndexFn = TSL.wgslFn(`
fn heprGradientCoordFromIndex(index: f32, width: f32) -> vec2<i32> {
  let itemIndex = i32(index + 0.5);
  let safeWidth = max(i32(width), 1);
  return vec2<i32>(itemIndex % safeWidth, itemIndex / safeWidth);
}
`);

const floatModFn = TSL.wgslFn(`
fn heprGradientFloatMod(x: f32, y: f32) -> f32 {
  return x - y * floor(x / y);
}
`);

const gradientParameterFn = TSL.wgslFn(GRADIENT_PARAMETER_WGSL);
const gradientBackgroundFn = TSL.wgslFn(GRADIENT_BACKGROUND_WGSL);

const gradientSampleFn = TSL.wgslFn(`
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
`, [includeNode(gradientParameterFn), includeNode(gradientBackgroundFn)]);

const fillVertexPackFn = TSL.wgslFn(`
fn heprGradientFillVertexPack(
  corner: vec2<f32>,
  metaA: vec4<f32>,
  metaB: vec4<f32>,
  metaC: vec4<f32>,
  shapeOnly: f32
) -> vec4<f32> {
  let segmentCount = i32(metaA.y + 0.5);
  let alpha = metaC.w;
  if (segmentCount <= 0 || (alpha <= 0.001 && shapeOnly < 0.5)) {
    return vec4<f32>(-2.0, -2.0, 0.0, 0.0);
  }
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  let world = metaA.zw + (metaB.xy - metaA.zw) * corner01;
  return vec4<f32>(world, 1.0, 0.0);
}
`);

const clipPositionFn = TSL.wgslFn(`
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
`);

const strokeClipPositionFn = TSL.wgslFn(`
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
`);

const distanceToLineSegmentFn = TSL.wgslFn(CORE_WGSL_DISTANCE_TO_LINE_SEGMENT_SOURCE);
const distanceToQuadraticBezierFn = TSL.wgslFn(
  CORE_WGSL_DISTANCE_TO_QUADRATIC_BEZIER_SOURCE,
  [includeNode(distanceToLineSegmentFn)]
);

const lineCrossingFn = TSL.wgslFn(`
fn heprGradientLineCrossing(a: vec2<f32>, b: vec2<f32>, p: vec2<f32>) -> vec2<i32> {
  let upward = (a.y <= p.y) && (b.y > p.y);
  let downward = (a.y > p.y) && (b.y <= p.y);
  if (!upward && !downward) { return vec2<i32>(0); }
  let denom = b.y - a.y;
  if (abs(denom) <= 0.000001) { return vec2<i32>(0); }
  let xCross = a.x + (p.y - a.y) * (b.x - a.x) / denom;
  if (xCross <= p.x) { return vec2<i32>(0); }
  return vec2<i32>(select(-1, 1, upward), 1);
}
`);

const quadraticCrossingFn = TSL.wgslFn(`
fn heprGradientQuadraticCrossing(a: vec2<f32>, b: vec2<f32>, c: vec2<f32>, p: vec2<f32>) -> vec2<i32> {
  var result = vec2<i32>(0);
  var previous = a;
  for (var i = 1; i <= 6; i = i + 1) {
    let t = f32(i) / 6.0;
    let mt = 1.0 - t;
    let next = mt * mt * a + 2.0 * mt * t * b + t * t * c;
    result = result + heprGradientLineCrossing(previous, next, p);
    previous = next;
  }
  return result;
}
`, [includeNode(lineCrossingFn)]);

const fillFragmentFns = createThreeWebGpuOutputFragmentFns(`
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
  // WGSL derivatives must execute before any divergent branch, loop exit, or
  // discard. Flat-interpolated paint metadata is not statically uniform.
  let pixelToLocalX = length(vec2<f32>(dpdx(local.x), dpdy(local.x)));
  let pixelToLocalY = length(vec2<f32>(dpdx(local.y), dpdy(local.y)));
  let aaWidth = max(max(pixelToLocalX, pixelToLocalY) * fillAAScreenPx, 0.0001);
  let segmentStart = i32(metaA.x + 0.5);
  let segmentCount = i32(metaA.y + 0.5);
  if (segmentCount <= 0 || (metaC.w <= 0.001 && shapeOnly < 0.5)) { discard; }
  var minDistance = 100000000000000000000.0;
  var winding = 0;
  var crossings = 0;
  let safeWidth = max(i32(segmentTexWidth), 1);
  let searchRadius = select(aaWidth, 0.0, metaC.y >= 0.5);
${vectorFillBandLoopWgsl({
    bands: "bands",
    y: "local.y",
    radius: "searchRadius",
    count: "segmentCount",
    start: "segmentStart",
    texture: "segmentTexA",
    entries: "bandEntries",
    edge: `    let coord = vec2<i32>(segmentIndex % safeWidth, segmentIndex / safeWidth);
    let primitiveA = textureLoad(segmentTexA, coord, 0);
    let primitiveB = textureLoad(segmentTexB, coord, 0);
    var crossing = vec2<i32>(0);
    if (primitiveB.z >= 1.0) {
      minDistance = min(minDistance, heprDistanceToQuadraticBezier(local, primitiveA.xy, primitiveA.zw, primitiveB.xy));
      crossing = heprGradientQuadraticCrossing(primitiveA.xy, primitiveA.zw, primitiveB.xy, local);
    } else {
      minDistance = min(minDistance, heprDistanceToLineSegment(local, primitiveA.xy, primitiveB.xy));
      crossing = heprGradientLineCrossing(primitiveA.xy, primitiveB.xy, local);
    }
    if (countsCrossings) { winding += crossing.x; crossings += crossing.y; }`
  })}
  let inside = select(winding != 0, (crossings % 2) == 1, metaC.x >= 0.5);
  var coverage: f32;
  if (metaC.y >= 0.5) {
    coverage = select(0.0, 1.0, inside);
  } else {
    let signedDistance = select(minDistance, -minDistance, inside);
    coverage = clamp(0.5 - signedDistance / aaWidth, 0.0, 1.0);
  }

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
`, [
  includeNode(gradientSampleFn),
  includeNode(distanceToLineSegmentFn),
  includeNode(distanceToQuadraticBezierFn),
  includeNode(lineCrossingFn),
  includeNode(quadraticCrossingFn)
]);

const strokeQuadWorldPositionFn = TSL.wgslFn(CORE_WGSL_STROKE_QUAD_WORLD_POSITION_SOURCE);

const strokeWorldPackFn = TSL.wgslFn(`
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
  if ((geometryLength < 0.00001 && !isRoundCap) || (alpha <= 0.001 && shapeOnly < 0.5)) {
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
`, [includeNode(floatModFn), includeNode(strokeQuadWorldPositionFn)]);

const strokeFragmentFns = createThreeWebGpuOutputFragmentFns(`
fn heprGradientStrokeFragment(
  local: vec2<f32>, primitiveA: vec4<f32>, primitiveB: vec4<f32>, style: vec4<f32>,
  primitiveBounds: vec4<f32>, halfWidthFromVertex: f32, strokeCurveEnabled: f32,
  aaScreenPx: f32, vectorOverride: vec4<f32>, primitiveColor: vec4<f32>,
  gradientMetaA: texture_2d<f32>, gradientMetaB: texture_2d<f32>,
  gradientMetaC: texture_2d<f32>, gradientMetaD: texture_2d<f32>,
  gradientMetaE: texture_2d<f32>, gradientLut: texture_2d<f32>, gradientMetaWidth: f32,
  sourceGradientIndex: f32, maskGradientIndex: f32, shapeOnly: f32
) -> vec4<f32> {
  // Evaluate derivatives in uniform control flow before alpha/clip discards.
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
  let coverage = 1.0 - smoothstep(halfWidth - aaWorld, halfWidth + aaWorld, distanceToSegment);
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
`, [
  includeNode(floatModFn),
  includeNode(distanceToLineSegmentFn),
  includeNode(distanceToQuadraticBezierFn),
  includeNode(gradientSampleFn)
]);

export function createThreeWebGpuGradientFillMaterial(
  options: ThreeWebGpuGradientFillMaterialOptions
): ThreeWebGpuGradientFillMaterialState {
  const material = createBaseMaterial();
  const shapeOnly = TSL.uniform(0);
  registerThreePdfShapeUniform(material, shapeOnly);
  const zoomUniform = TSL.uniform(1);
  const useLocalToClipUniform = TSL.uniform(0);
  const pathWidth = TSL.uniform(Math.max(1, options.fillPathTextureWidth));
  const segmentWidth = TSL.uniform(Math.max(1, options.fillSegmentTextureWidth));
  const gradientWidth = TSL.uniform(Math.max(1, options.gradientMetaTextureWidth));
  const pathIndex = TSL.attribute("aFillPathIndex", "float");
  const pathCoord = callNode(coordFromIndexFn, { index: pathIndex, width: pathWidth });
  const metaA = varyingNode(TSL.textureLoad(options.fillPathMetaTextureA, pathCoord, 0), true);
  const metaB = varyingNode(TSL.textureLoad(options.fillPathMetaTextureB, pathCoord, 0), true);
  const metaC = varyingNode(TSL.textureLoad(options.fillPathMetaTextureC, pathCoord, 0), true);
  const bands = varyingNode(callNode(fillBandInfoFn, {
    pathIndex: pathIndex, base: TSL.uniform(options.fillBandBase ?? -1),
    segments: TSL.textureLoad(options.fillSegmentTextureA)
  }), true);
  const vertexPack = varyingNode(options.mesh ? TSL.vec4(TSL.attribute("aMeshPosition", "vec2") as never, 1, 0) : callNode(fillVertexPackFn, {
    corner: TSL.attribute("aCorner", "vec2"), metaA, metaB, metaC, shapeOnly
  }));
  const vertexValue = vertexPack as { xy: unknown };
  material.vertexNode = callNode(clipPositionFn, {
    vertexPack,
    viewport: TSL.uniform(options.viewport),
    cameraCenter: TSL.uniform(options.cameraCenter),
    zoom: zoomUniform,
    useLocalToClip: useLocalToClipUniform,
    localToClip: TSL.uniform(options.localToClip)
  });
  material.fragmentNode = callNode(fillFragmentFns[options.colorCompositing], {
    local: vertexValue.xy, metaA, metaB, metaC,
    segmentTexA: TSL.textureLoad(options.fillSegmentTextureA),
    segmentTexB: TSL.textureLoad(options.fillSegmentTextureB),
    segmentTexWidth: segmentWidth,
    bands, bandEntries: TSL.uniform(options.fillBandEntries ?? 0),
    ...createGradientNodes(options, gradientWidth),
    fillAAScreenPx: TSL.uniform(1),
    meshColor: options.mesh ? varyingNode(TSL.attribute("aMeshColor", "vec4")) : TSL.vec4(0),
    useMesh: TSL.uniform(options.mesh ? 1 : 0), shapeOnly,
    vectorOverride: TSL.uniform(options.vectorOverride), primitiveColor: TSL.uniform(options.primitiveColor)
  });
  registerThreeNodeClipPosition(material, vertexValue.xy, true);
  return {
    material,
    zoomUniform: zoomUniform as MutableUniform<number>,
    useLocalToClipUniform: useLocalToClipUniform as MutableUniform<number>
  };
}

export function createThreeWebGpuGradientStrokeMaterial(
  options: ThreeWebGpuGradientStrokeMaterialOptions
): ThreeWebGpuGradientStrokeMaterialState {
  const material = createBaseMaterial();
  const shapeOnly = TSL.uniform(0);
  registerThreePdfShapeUniform(material, shapeOnly);
  const zoomUniform = TSL.uniform(1);
  const useLocalToClipUniform = TSL.uniform(0);
  const localUnitsPerPixelUniform = TSL.uniform(1);
  const curveUniform = TSL.uniform(options.strokeCurveEnabled ? 1 : 0);
  const segmentWidth = TSL.uniform(Math.max(1, options.segmentTextureWidth));
  const gradientWidth = TSL.uniform(Math.max(1, options.gradientMetaTextureWidth));
  const segmentIndex = TSL.attribute("aSegmentIndex", "float");
  const coord = callNode(coordFromIndexFn, { index: segmentIndex, width: segmentWidth });
  const primitiveA = varyingNode(TSL.textureLoad(options.segmentTextureA, coord, 0), true);
  const primitiveB = varyingNode(TSL.textureLoad(options.segmentTextureB, coord, 0), true);
  const style = varyingNode(TSL.textureLoad(options.segmentStyleTexture, coord, 0), true);
  const primitiveBounds = varyingNode(TSL.textureLoad(options.segmentBoundsTexture, coord, 0), true);
  const worldPack = varyingNode(callNode(strokeWorldPackFn, {
    corner: TSL.attribute("aCorner", "vec2"), primitiveA, primitiveB, style, primitiveBounds,
    zoom: zoomUniform, useLocalToClip: useLocalToClipUniform,
    localUnitsPerPixelInput: localUnitsPerPixelUniform, aaScreenPx: TSL.uniform(1), shapeOnly
  }));
  const worldValue = worldPack as { xy: unknown; z: unknown };
  material.vertexNode = callNode(strokeClipPositionFn, {
    worldPack,
    viewport: TSL.uniform(options.viewport), cameraCenter: TSL.uniform(options.cameraCenter),
    zoom: zoomUniform, useLocalToClip: useLocalToClipUniform,
    localToClip: TSL.uniform(options.localToClip)
  });
  material.fragmentNode = callNode(strokeFragmentFns[options.colorCompositing], {
    local: worldValue.xy, primitiveA, primitiveB, style, primitiveBounds, shapeOnly,
    halfWidthFromVertex: worldValue.z, strokeCurveEnabled: curveUniform,
    aaScreenPx: TSL.uniform(1), vectorOverride: TSL.uniform(options.vectorOverride), primitiveColor: TSL.uniform(options.primitiveColor),
    ...createGradientNodes(options, gradientWidth)
  });
  registerThreeNodeClipPosition(material, worldValue.xy, true);
  return {
    material,
    zoomUniform: zoomUniform as MutableUniform<number>,
    useLocalToClipUniform: useLocalToClipUniform as MutableUniform<number>,
    localUnitsPerPixelUniform: localUnitsPerPixelUniform as MutableUniform<number>,
    curveUniform: curveUniform as MutableUniform<number>
  };
}

function createGradientNodes(options: GradientTextureOptions, gradientWidth: unknown): Record<string, unknown> {
  return {
    gradientMetaA: TSL.textureLoad(options.gradientMetaTextureA),
    gradientMetaB: TSL.textureLoad(options.gradientMetaTextureB),
    gradientMetaC: TSL.textureLoad(options.gradientMetaTextureC),
    gradientMetaD: TSL.textureLoad(options.gradientMetaTextureD),
    gradientMetaE: TSL.textureLoad(options.gradientMetaTextureE),
    gradientLut: TSL.textureLoad(options.gradientLutTexture),
    gradientMetaWidth: gradientWidth,
    sourceGradientIndex: TSL.uniform(options.sourceGradientIndex),
    maskGradientIndex: TSL.uniform(options.maskGradientIndex)
  };
}

function createBaseMaterial(): InstanceType<typeof NodeMaterial> {
  const material = new NodeMaterial();
  material.transparent = false;
  material.depthTest = false;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  material.toneMapped = false;
  material.fog = false;
  material.lights = false;
  configureStraightAlphaBlending(material);
  return material;
}
