import { pageProjectionNode } from "./threeWebGpuPageTransforms";
import type { ThreePageBinding } from "./threePageTransforms";
import { VECTOR_FILL_BAND_INFO_WGSL, vectorFillBandLoopWgsl } from "./vectorFillBandShaders";
import { MIN_VECTOR_INDEXED_PATH_SEGMENTS } from "./vectorFillBands";
import { FILL_COVERAGE_VERTEX_WGSL, FILL_COVERAGE_WGSL } from "./fillCoverageShaders";
import { VECTOR_CELL_COVERAGE_WGSL, VECTOR_FILL_CELL_INFO_WGSL } from "./vectorCellShaders";
import { registerThreePdfShapeUniform } from "./threePdfShape";
import { registerThreeNodeClipPosition } from "./threeWebGpuVectorClips";
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

export interface ThreeWebGpuFillMaterialOptions {
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
  /** The first cell header texel in segment texture A; -1 when there is none. */
  fillCellBase?: number;
  viewport: THREE.Vector2;
  cameraCenter: THREE.Vector2;
  localToClip: THREE.Matrix4;
  pageBinding?: ThreePageBinding;
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
const fillCellInfoFn = TSL.wgslFn(VECTOR_FILL_CELL_INFO_WGSL);
const cellCoverageFn = TSL.wgslFn(VECTOR_CELL_COVERAGE_WGSL, [includeNode(fillCoverageFn)]);

const coordFromIndexFn = TSL.wgslFn(`
fn heprCoordFromIndex(index: f32, width: f32) -> vec2<i32> {
  let itemIndex = i32(index);
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
  fillAAScreenPx: f32,
  viewport: vec2<f32>,
  zoom: f32,
  useLocalToClip: f32,
  localToClip: mat4x4<f32>
) -> vec4<f32> {
  let segmentCount = i32(metaA.y);
  let alpha = mix(metaC.w, 1.0, shapeOnly);
  if (segmentCount <= 0 || alpha <= 0.001) {
    return vec4<f32>(-2.0, -2.0, 0.0, 0.0);
  }

  let minBounds = metaA.zw;
  let maxBounds = metaB.xy;
  let corner01 = corner * 0.5 + vec2<f32>(0.5);
  // Pixels whose footprint reaches the path need fragments even when the path
  // is thinner than a pixel and falls between pixel centres.
  var rawMargin = heprCoverageMargin(heprPathToPixel(minBounds + (maxBounds - minBounds) * corner01,
    useLocalToClip, localToClip, zoom, max(viewport, vec2<f32>(1.0))));
  // Only proven closed contours are bounded by their decoded hull. Keep the
  // existing projected padding, including per-page and perspective transforms.
  if (metaC.x >= 0.0 && useLocalToClip < 0.5) {
    rawMargin = max(rawMargin * (0.5 * fillAAScreenPx), vec2<f32>(0.00005)) +
      vec2<f32>(0.00001 / max(zoom, 0.0001));
  }
  let margin = heprBoundCoverageMargin(minBounds + (maxBounds - minBounds) * corner01, rawMargin,
    mat2x2<f32>(1.0, 0.0, 0.0, 1.0), useLocalToClip, localToClip, max(viewport, vec2<f32>(1.0)));
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

const fillIndexedWindingFn = TSL.wgslFn(`
fn heprFillIndexedWinding(
  pathIndex: i32, segmentStart: i32, segmentCount: i32,
  origin: vec2<f32>, localY: f32, box: vec4<f32>, footprint: vec2<f32>,
  segmentTexA: texture_2d<f32>, segmentTexB: texture_2d<f32>, segmentTexWidth: f32,
  bandBase: f32, bandEntries: f32, cellHeaders: f32
) -> f32 {
  // Header reads belong to the fragment fallback: whole-contour integration
  // needs neither index, and paths with cells never need a band header.
  var bands = vec4<f32>(0.0);
  // Both builders leave small paths unindexed. Their original direct loop
  // therefore needs neither header, even when other paths use these stores.
  if (segmentCount >= ${MIN_VECTOR_INDEXED_PATH_SEGMENTS}) {
    let cells = heprFillCellInfo(f32(pathIndex), cellHeaders, segmentTexA);
    if (cells.y > 0.0) {
      return heprCellWinding(cells, origin, box, footprint, segmentTexA, segmentTexB);
    }
    bands = heprFillBandInfo(f32(pathIndex), bandBase, segmentTexA);
  }
  let safeWidth = max(i32(segmentTexWidth), 1);
  var winding = 0.0;
${vectorFillBandLoopWgsl({
    bands: "bands",
    y: "localY",
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
  return winding;
}
`, [includeNode(fillBandInfoFn), includeNode(fillCellInfoFn), includeNode(fillCoverageFn), includeNode(cellCoverageFn)]);

const fillFragmentSource = `
fn heprFillFragment(
  local: vec2<f32>,
  metaA: vec4<f32>,
  metaB: vec4<f32>,
  metaC: vec4<f32>,
  segmentTexA: texture_2d<f32>,
  segmentTexB: texture_2d<f32>,
  segmentTexWidth: f32,
  pathIndex: i32,
  bandBase: f32,
  bandEntries: f32,
  cellHeaders: f32,
  fillAAScreenPx: f32,
  vectorOverride: vec4<f32>,
  shapeOnly: f32
) -> vec4<f32> {
  // The path-space footprint of this pixel, taken before any discard.
  let footprint = max(vec2<f32>(
    length(vec2<f32>(dpdx(local.x), dpdy(local.x))),
    length(vec2<f32>(dpdx(local.y), dpdy(local.y)))
  ) * fillAAScreenPx, vec2<f32>(0.0001));
  let segmentStart = i32(metaA.x);
  let segmentCount = i32(metaA.y);
  let alphaStyle = mix(metaC.w, 1.0, shapeOnly);
  if (segmentCount <= 0 || alphaStyle <= 0.001) {
    discard;
  }

  // Average the winding number over the footprint box. A path with a cell
  // index reads only the cells under the box; otherwise the bands spanning
  // its rows hold every segment that can contribute, each integrating its own.
  let box = vec4<f32>(local - 0.5 * footprint, 1.0 / footprint);
  var winding = 0.0;
  if (metaC.x >= 0.0 && all(metaB.xy - metaA.zw <= footprint)) {
    // A hull no larger than the box needs only its signed area, not its segment records.
    winding = heprHullAreaWinding(metaC.y, metaA.zw, metaB.xy, box, footprint);
  } else {
    winding = heprFillIndexedWinding(pathIndex, segmentStart, segmentCount, metaA.zw, local.y,
      box, footprint, segmentTexA, segmentTexB, segmentTexWidth, bandBase, bandEntries, cellHeaders);
  }
  let mixAmount = clamp(vectorOverride.a, 0.0, 1.0);
  let baseColor = vec3<f32>(metaB.z, metaB.w, metaC.z);
  let color = baseColor * (1.0 - mixAmount) + vectorOverride.rgb * mixAmount;

  // A companion stroke no longer hides a hard fill edge: thin filled shapes
  // need their own coverage, and wide strokes still cover the edge.
  let fillRule = select(metaC.x, -metaC.x - 1.0, metaC.x < 0.0);
  let alpha = heprFillCoverage(winding, fillRule >= 0.5) * alphaStyle;
  if (alpha <= 0.001) {
    discard;
  }

  return vec4<f32>(heprThreeOutputColor(color), alpha);
}
`;
const fillFragmentDependencies = [includeNode(fillCoverageFn), includeNode(fillIndexedWindingFn)];
const fillFragmentFns = createThreeWebGpuOutputFragmentFns(fillFragmentSource, fillFragmentDependencies);

/** Shared exact paint math; mixed materials provide derivatives before branching. */
export const threeWebGpuFillShader: {
  vertex: unknown; fragmentSource: string; fragmentDependencies: readonly unknown[];
} = { vertex: fillVertexPackFn, fragmentSource: fillFragmentSource, fragmentDependencies: fillFragmentDependencies };

export function createThreeWebGpuFillMaterial(
  options: ThreeWebGpuFillMaterialOptions
): ThreeWebGpuFillMaterialState {
  const material = new NodeMaterial();
  const pageProjection = pageProjectionNode(options.localToClip, options.pageBinding);
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
  const pathIndex = varyingNode(TSL.int(fillPathIndex), true);
  const viewportUniform = TSL.uniform(options.viewport);
  const localToClipUniform = pageProjection.matrix;
  const vertexPack = varyingNode(callNode(fillVertexPackFn, {
    corner,
    metaA,
    metaB,
    metaC,
    shapeOnly: shapeOnlyUniform,
    fillAAScreenPx: fillAAScreenPxUniform,
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
  pageProjection.finish(material);
  material.fragmentNode = callNode(fillFragmentFns[options.colorCompositing], {
    local: vertexPackValue.xy,
    metaA,
    metaB,
    metaC,
    segmentTexA: TSL.textureLoad(options.fillSegmentTextureA),
    segmentTexB: TSL.textureLoad(options.fillSegmentTextureB),
    segmentTexWidth: fillSegmentTextureWidthUniform,
    pathIndex, bandBase: TSL.uniform(options.fillBandBase ?? -1),
    bandEntries: TSL.uniform(options.fillBandEntries ?? 0),
    cellHeaders: TSL.uniform((options.fillCellBase ?? -1) + 1),
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
