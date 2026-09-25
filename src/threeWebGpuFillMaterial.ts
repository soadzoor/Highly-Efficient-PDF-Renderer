import { VECTOR_FILL_BAND_INFO_WGSL, vectorFillBandLoopWgsl } from "./vectorFillBandShaders";
import { FILL_COVERAGE_VERTEX_WGSL, FILL_COVERAGE_WGSL } from "./fillCoverageShaders";
import { registerThreePdfShapeUniform } from "./threePdfShape";
import { registerThreeNodeClipPosition } from "./threeVectorClips";
import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";

import { configureStraightAlphaBlending } from "./threeMaterialBlending";
import {
  createThreeWebGpuOutputFragmentFns,
  type ThreeColorCompositing
} from "./threeWebGpuColorSpace";

interface MutableUniform<T> {
  value: T;
}

export interface ThreeWebGpuFillMaterialState {
  material: THREE.Material;
  zoomUniform: MutableUniform<number>;
  useLocalToClipUniform: MutableUniform<number>;
}

interface ThreeWebGpuFillMaterialOptions {
  colorCompositing: ThreeColorCompositing;
  fillPathMetaTextureA: THREE.DataTexture;
  fillPathMetaTextureB: THREE.DataTexture;
  fillPathMetaTextureC: THREE.DataTexture;
  fillSegmentTextureA: THREE.DataTexture;
  fillSegmentTextureB: THREE.DataTexture;
  fillPathTextureWidth: number;
  fillSegmentTextureWidth: number;
  fillBandBase?: number;
  fillBandEntries?: number;
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
const fillCoverageFn = TSL.wgslFn(FILL_COVERAGE_WGSL);
const fillCoverageVertexFn = TSL.wgslFn(FILL_COVERAGE_VERTEX_WGSL);

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
  // Pixels whose footprint reaches the path need fragments even when the path
  // is thinner than a pixel and falls between pixel centres.
  let margin = heprCoverageMargin(heprPathToPixel(minBounds + (maxBounds - minBounds) * corner01,
    useLocalToClip, localToClip, zoom, max(viewport, vec2<f32>(1.0))));
  let world = minBounds - margin + (maxBounds - minBounds + 2.0 * margin) * corner01;
  return vec4<f32>(world, 1.0, 0.0);
}
`, [includeNode(fillCoverageVertexFn)]);

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

const fillFragmentFns = createThreeWebGpuOutputFragmentFns(`
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
  fillAAScreenPx: f32,
  vectorOverride: vec4<f32>,
  shapeOnly: f32
) -> vec4<f32> {
  // The path-space footprint of this pixel, taken before any discard.
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

  // Average the winding number over the footprint box. The bands spanning its
  // rows hold every segment that can contribute; each integrates its own rows.
  let box = vec4<f32>(local - 0.5 * footprint, 1.0 / footprint);
  var winding = 0.0;
  let safeWidth = max(i32(segmentTexWidth), 1);
${vectorFillBandLoopWgsl({
    bands: "bands",
    y: "local.y",
    radius: "0.5 * footprint.y",
    count: "segmentCount",
    start: "segmentStart",
    texture: "segmentTexA",
    entries: "bandEntries",
    setup: "let rows = heprBandRows(bandInfo, band, bandCount, box);",
    edge: `    let coord = vec2<i32>(segmentIndex % safeWidth, segmentIndex / safeWidth);
    let primitiveA = textureLoad(segmentTexA, coord, 0);
    let primitiveB = textureLoad(segmentTexB, coord, 0);
    winding = winding + heprSegmentCoverage(primitiveA.xy, primitiveA.zw, primitiveB.xy,
      primitiveB.z >= 1.0, box, rows.x, rows.y);`
  })}
  let mixAmount = clamp(vectorOverride.a, 0.0, 1.0);
  let baseColor = vec3<f32>(metaB.z, metaB.w, metaC.z);
  let color = baseColor * (1.0 - mixAmount) + vectorOverride.rgb * mixAmount;

  // A companion stroke no longer hides a hard fill edge: thin filled shapes
  // need their own coverage, and wide strokes still cover the edge.
  let alpha = heprFillCoverage(winding, metaC.x >= 0.5) * alphaStyle;
  if (alpha <= 0.001) {
    discard;
  }

  return vec4<f32>(heprThreeOutputColor(color), alpha);
}
`, [includeNode(fillCoverageFn)]);

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

  const shapeOnlyUniform = TSL.uniform(0);
  registerThreePdfShapeUniform(material, shapeOnlyUniform);
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
  const metaA = varyingNode(TSL.textureLoad(options.fillPathMetaTextureA, pathCoord, 0), true);
  const metaB = varyingNode(TSL.textureLoad(options.fillPathMetaTextureB, pathCoord, 0), true);
  const metaC = varyingNode(TSL.textureLoad(options.fillPathMetaTextureC, pathCoord, 0), true);
  const bands = varyingNode(callNode(fillBandInfoFn, {
    pathIndex: fillPathIndex, base: TSL.uniform(options.fillBandBase ?? -1),
    segments: TSL.textureLoad(options.fillSegmentTextureA)
  }), true);
  const viewportUniform = TSL.uniform(options.viewport);
  const localToClipUniform = TSL.uniform(options.localToClip);
  const vertexPack = varyingNode(callNode(fillVertexPackFn, {
    corner,
    metaA,
    metaB,
    metaC,
    shapeOnly: shapeOnlyUniform,
    viewport: viewportUniform,
    zoom: zoomUniform,
    useLocalToClip: useLocalToClipUniform,
    localToClip: localToClipUniform
  }));
  const vertexPackValue = vertexPack as { xy: unknown };

  material.vertexNode = callNode(fillClipFn, {
    vertexPack,
    viewport: viewportUniform,
    cameraCenter: TSL.uniform(options.cameraCenter),
    zoom: zoomUniform,
    useLocalToClip: useLocalToClipUniform,
    localToClip: localToClipUniform
  });
  material.fragmentNode = callNode(fillFragmentFns[options.colorCompositing], {
    local: vertexPackValue.xy,
    metaA,
    metaB,
    metaC,
    segmentTexA: TSL.textureLoad(options.fillSegmentTextureA),
    segmentTexB: TSL.textureLoad(options.fillSegmentTextureB),
    segmentTexWidth: fillSegmentTextureWidthUniform,
    bands, bandEntries: TSL.uniform(options.fillBandEntries ?? 0),
    fillAAScreenPx: fillAAScreenPxUniform,
    vectorOverride: TSL.uniform(options.vectorOverride),
    shapeOnly: shapeOnlyUniform
  });

  registerThreeNodeClipPosition(material, vertexPackValue.xy);

  return {
    material,
    zoomUniform: zoomUniform as MutableUniform<number>,
    useLocalToClipUniform: useLocalToClipUniform as MutableUniform<number>
  };
}
