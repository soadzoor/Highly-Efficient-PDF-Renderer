import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";
import { configureStraightAlphaBlending } from "./threeMaterialBlending";
import { registerThreePdfShapeUniform } from "./threePdfShape";
import { pageProjectionNode } from "./threeWebGpuPageTransforms";
import { registerThreeNodeClipPosition } from "./threeWebGpuVectorClips";
import { createThreeWebGpuOutputFragmentFns } from "./threeWebGpuColorSpace";
import { threeWebGpuFillShader, type ThreeWebGpuFillMaterialOptions } from "./threeWebGpuFillMaterial";
import {
  threeWebGpuStrokeShader, type ThreeWebGpuStrokeMaterialOptions, type ThreeWebGpuStrokeMaterialState
} from "./threeWebGpuStrokeMaterial";

export interface ThreeWebGpuMixedVectorMaterialOptions
  extends ThreeWebGpuStrokeMaterialOptions, ThreeWebGpuFillMaterialOptions {}

export interface ThreeWebGpuMixedVectorMaterialState extends ThreeWebGpuStrokeMaterialState {
  fillRenderingUniform: { value: number };
  strokeRenderingUniform: { value: number };
}

// Keep TSL's recursive proxy types out of the exported material contract.
function call(fn: unknown, args: Record<string, unknown>): never {
  return (fn as (args: Record<string, unknown>) => never)(args);
}
function flat(node: unknown): never {
  return ((TSL.varying as unknown as (value: unknown) => { setInterpolation(type: string): unknown })(node)
    .setInterpolation("flat")) as never;
}
function varying(node: unknown): never {
  return (TSL.varying as unknown as (value: unknown) => never)(node);
}

const textureFieldFn: unknown = TSL.wgslFn(`
fn heprMixedTextureField(
  kind: f32, index: f32,
  head: texture_2d<f32>, tail: texture_2d<f32>, fill: texture_2d<f32>,
  headWidth: f32, tailWidth: f32, split: f32, fillWidth: f32, fillOffset: f32
) -> vec4<f32> {
  if (kind >= 0.5) {
    if (fillOffset < 0.0) { return vec4<f32>(0.0); }
    let i = i32(index + fillOffset);
    let width = max(i32(fillWidth), 1);
    return textureLoad(fill, vec2<i32>(i % width, i / width), 0);
  }
  var i = i32(index);
  if (split >= 0.0 && index >= split) {
    i = i - i32(split);
    let width = max(i32(tailWidth), 1);
    return textureLoad(tail, vec2<i32>(i % width, i / width), 0);
  }
  let width = max(i32(headWidth), 1);
  return textureLoad(head, vec2<i32>(i % width, i / width), 0);
}
`);

const cellFieldFn: unknown = TSL.wgslFn(`
fn heprMixedCellField(kind: f32, index: f32, segments: texture_2d<f32>, width: f32, base: f32) -> vec4<f32> {
  if (kind < 0.5 || base < 0.0) { return vec4<f32>(0.0); }
  let i = i32(base + index);
  let safeWidth = max(i32(width), 1);
  return textureLoad(segments, vec2<i32>(i % safeWidth, i / safeWidth), 0);
}
`);

const worldPackFn: unknown = TSL.wgslFn(`
fn heprMixedWorldPack(
  corner: vec2<f32>, kind: f32,
  dataA: vec4<f32>, dataB: vec4<f32>, dataC: vec4<f32>, dataD: vec4<f32>,
  viewport: vec2<f32>, zoom: f32, useLocalToClip: f32,
  localToClip: mat4x4<f32>, localUnitsPerPixel: f32, aaScreenPx: f32, shapeOnly: f32,
  fillEnabled: f32, strokeEnabled: f32
) -> vec4<f32> {
  if (select(fillEnabled, strokeEnabled, kind < 0.5) < 0.5) {
    return vec4<f32>(-2.0, -2.0, 0.0, 0.0);
  }
  if (kind < 0.5) {
    return heprStrokeWorldPack(corner, dataA, dataB, dataC, dataD,
      zoom, useLocalToClip, localUnitsPerPixel, aaScreenPx, shapeOnly);
  }
  let pack = heprFillVertexPack(corner, dataA, dataB, dataC, shapeOnly, aaScreenPx,
    viewport, zoom, useLocalToClip, localToClip);
  // Both branches use W for validity; Z carries a stroke's resolved half width.
  return vec4<f32>(pack.xy, 0.0, pack.z);
}
`, [threeWebGpuStrokeShader.vertex, threeWebGpuFillShader.vertex] as never);

/** Reuse exact paint coverage while supplying uniform derivatives from the caller. */
function mixedFragmentSource(source: string, name: string): string {
  return source.replace(/fn hepr(?:Stroke|Fill)Fragment\(/, `fn ${name}(`)
    .replace("shapeOnly: f32\n)", "shapeOnly: f32,\n  pixelFootprint: vec2<f32>\n)")
    .replaceAll("length(vec2<f32>(dpdx(local.x), dpdy(local.x)))", "pixelFootprint.x")
    .replaceAll("length(vec2<f32>(dpdx(local.y), dpdy(local.y)))", "pixelFootprint.y");
}

const strokeFragmentFn: unknown = TSL.wgslFn(
  mixedFragmentSource(threeWebGpuStrokeShader.fragmentSource, "heprMixedStrokeFragment"),
  threeWebGpuStrokeShader.fragmentDependencies as never
);
const fillFragmentFn: unknown = TSL.wgslFn(
  mixedFragmentSource(threeWebGpuFillShader.fragmentSource, "heprMixedFillFragment"),
  threeWebGpuFillShader.fragmentDependencies as never
);
const fragmentFns = createThreeWebGpuOutputFragmentFns(`
fn heprMixedVectorFragment(
  local: vec2<f32>, kind: f32,
  dataA: vec4<f32>, dataB: vec4<f32>, dataC: vec4<f32>, dataD: vec4<f32>, dataE: vec4<f32>,
  halfWidth: f32, segmentTexA: texture_2d<f32>, segmentTexB: texture_2d<f32>, segmentWidth: f32,
  bandEntries: f32, fillAAScreenPx: f32, strokeAAScreenPx: f32, curveEnabled: f32,
  vectorOverride: vec4<f32>, shapeOnly: f32
) -> vec4<f32> {
  // Both paints can discard. Evaluate derivatives before their divergent branch.
  let pixelFootprint = vec2<f32>(length(vec2<f32>(dpdx(local.x), dpdy(local.x))),
    length(vec2<f32>(dpdx(local.y), dpdy(local.y))));
  if (kind < 0.5) {
    return heprMixedStrokeFragment(local, dataA, dataB, dataC, dataD, halfWidth,
      curveEnabled, strokeAAScreenPx, vectorOverride, shapeOnly, pixelFootprint);
  }
  return heprMixedFillFragment(local, dataA, dataB, dataC, segmentTexA, segmentTexB,
    segmentWidth, dataD, bandEntries, dataE, fillAAScreenPx, vectorOverride, shapeOnly, pixelFootprint);
}
`, [strokeFragmentFn, fillFragmentFn]);

/** Shared fill/stroke instances preserve the existing page, clip and paint math. */
export function createThreeWebGpuMixedVectorMaterial(
  options: ThreeWebGpuMixedVectorMaterialOptions
): ThreeWebGpuMixedVectorMaterialState {
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
  const localUnitsPerPixelUniform = TSL.uniform(1);
  const curveUniform = TSL.uniform(options.strokeCurveEnabled ? 1 : 0);
  const fillRenderingUniform = TSL.uniform(1);
  const strokeRenderingUniform = TSL.uniform(1);
  const page = pageProjectionNode(options.localToClip, options.pageBinding);
  const kind = TSL.attribute("aVectorKind", "float");
  const index = TSL.attribute("aVectorIndex", "float");
  const viewport = TSL.uniform(options.viewport);
  const segmentWidth = TSL.uniform(Math.max(1, options.segmentTextureWidth));
  const fillWidth = TSL.uniform(Math.max(1, options.fillSegmentTextureWidth));
  const fillMetaWidth = TSL.uniform(Math.max(1, options.fillPathTextureWidth));
  const tail = options.segmentTail;
  const tailWidth = TSL.uniform(Math.max(1, tail?.width ?? options.segmentTextureWidth));
  const split = TSL.uniform(tail?.split ?? -1);
  const load = (head: THREE.DataTexture, tailTexture: THREE.DataTexture | undefined,
    fill: THREE.DataTexture, width: unknown, offset: number): never => flat(call(textureFieldFn, {
    kind, index, head: TSL.textureLoad(head), tail: TSL.textureLoad(tailTexture ?? head),
    fill: TSL.textureLoad(fill), headWidth: segmentWidth, tailWidth, split,
    fillWidth: width, fillOffset: TSL.uniform(offset)
  }));
  const dataA = load(options.segmentTextureA, tail?.textureA, options.fillPathMetaTextureA, fillMetaWidth, 0);
  const dataB = load(options.segmentTextureB, tail?.textureB, options.fillPathMetaTextureB, fillMetaWidth, 0);
  const dataC = load(options.segmentStyleTexture, tail?.styleTexture, options.fillPathMetaTextureC, fillMetaWidth, 0);
  const dataD = load(options.segmentBoundsTexture, tail?.boundsTexture, options.fillSegmentTextureA,
    fillWidth, options.fillBandBase ?? -1);
  const dataE = flat(call(cellFieldFn, {
    kind, index, segments: TSL.textureLoad(options.fillSegmentTextureA),
    width: fillWidth, base: TSL.uniform(options.fillCellBase ?? -1)
  }));
  const worldPack = varying(call(worldPackFn, {
    corner: TSL.attribute("aCorner", "vec2"), kind, dataA, dataB, dataC, dataD,
    viewport, zoom: zoomUniform, useLocalToClip: useLocalToClipUniform,
    localToClip: page.matrix, localUnitsPerPixel: page.units ?? localUnitsPerPixelUniform,
    aaScreenPx: TSL.uniform(1), shapeOnly: shapeOnlyUniform,
    fillEnabled: fillRenderingUniform, strokeEnabled: strokeRenderingUniform
  }));
  const world = worldPack as { xy: unknown; z: unknown };
  material.vertexNode = call(threeWebGpuStrokeShader.clip, {
    worldPack, viewport, cameraCenter: TSL.uniform(options.cameraCenter), zoom: zoomUniform,
    useLocalToClip: useLocalToClipUniform, localToClip: page.matrix
  });
  page.finish(material);
  material.fragmentNode = call(fragmentFns[options.colorCompositing], {
    local: world.xy, kind: flat(kind), dataA, dataB, dataC, dataD, dataE, halfWidth: world.z,
    segmentTexA: TSL.textureLoad(options.fillSegmentTextureA), segmentTexB: TSL.textureLoad(options.fillSegmentTextureB),
    segmentWidth: fillWidth, bandEntries: TSL.uniform(options.fillBandEntries ?? 0),
    fillAAScreenPx: TSL.uniform(1), strokeAAScreenPx: TSL.uniform(1), curveEnabled: curveUniform,
    vectorOverride: TSL.uniform(options.vectorOverride), shapeOnly: shapeOnlyUniform
  });
  registerThreeNodeClipPosition(material, world.xy);
  return { material, zoomUniform, useLocalToClipUniform, localUnitsPerPixelUniform, curveUniform,
    fillRenderingUniform, strokeRenderingUniform };
}
