import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";
import { PRIMITIVE_SELECTION_COLOR, PRIMITIVE_HOVER_COLOR } from "./primitiveAppearance";
import { PRIMITIVE_HIGHLIGHT_COVERAGE_WGSL, PRIMITIVE_HIGHLIGHT_POSITION_WGSL,
  PRIMITIVE_HIGHLIGHT_LINE_OFFSET_WGSL, PRIMITIVE_HIGHLIGHT_QUADRATIC_OFFSET_WGSL } from "./primitiveHighlightShaders";
import { createThreeWebGpuOutputFragmentFns, type ThreeColorCompositing } from "./threeWebGpuColorSpace";
import { VECTOR_CLIP_WGSL } from "./vectorClipShaders";
import { MAX_VECTOR_CLIP_DEPTH } from "./vectorClips";

const lineFn = TSL.wgslFn(PRIMITIVE_HIGHLIGHT_LINE_OFFSET_WGSL);
const quadraticFn = TSL.wgslFn(PRIMITIVE_HIGHLIGHT_QUADRATIC_OFFSET_WGSL, [lineFn] as never);
const coverageFn = TSL.wgslFn(PRIMITIVE_HIGHLIGHT_COVERAGE_WGSL, [lineFn, quadraticFn] as never);
const positionFn = TSL.wgslFn(PRIMITIVE_HIGHLIGHT_POSITION_WGSL);
const clipFn = TSL.wgslFn(VECTOR_CLIP_WGSL.replace(/depth < \d+/, `depth < ${MAX_VECTOR_CLIP_DEPTH + 2}`));
const fragmentFns = createThreeWebGpuOutputFragmentFns(`
fn heprThreePrimitiveHighlight(point:vec2<f32>,a:vec4<f32>,b:vec4<f32>,index:f32,
  pixelRatio:f32,selectionCount:f32,clipTexture:texture_2d<f32>) -> vec4<f32> {
  let alpha=heprPrimitiveHighlightCoverage(point,a,b,pixelRatio)*heprVectorClip(point,b.w,clipTexture);
  if (alpha<=0.001) { discard; }
  let color=select(vec3<f32>(${PRIMITIVE_HOVER_COLOR.join(",")}),
    vec3<f32>(${PRIMITIVE_SELECTION_COLOR.join(",")}),index<selectionCount);
  return vec4<f32>(heprThreeOutputColor(color),alpha);
}`, [coverageFn, clipFn]);

function nodeCall(fn: unknown, args: Record<string, unknown>): never {
  return (fn as (args: Record<string, unknown>) => unknown)(args) as never;
}

interface PrimitiveHighlightMaterialState {
  material: THREE.Material;
  units: { value: number };
  pixelRatio: { value: number };
  selectionCount: { value: number };
}

export function createThreeWebGpuPrimitiveHighlightMaterial(options: {
  matrix: THREE.Matrix4;
  clips: THREE.DataTexture;
  colorCompositing: ThreeColorCompositing;
}): PrimitiveHighlightMaterialState {
  const units = TSL.uniform(1);
  const pixelRatio = TSL.uniform(1);
  const selectionCount = TSL.uniform(0);
  const nodeMaterial = new NodeMaterial();
  const a = TSL.varying(TSL.attribute("aSegmentA", "vec4"));
  const b = TSL.varying(TSL.attribute("aSegmentB", "vec4"));
  const point = TSL.varying(nodeCall(positionFn, {
    corner: TSL.attribute("aCorner", "vec2"), a, b,
    localUnitsPerPixel: units, pixelRatio: pixelRatio
  }));
  nodeMaterial.vertexNode = TSL.mul(TSL.uniform(options.matrix), TSL.vec4(point as never, 0, 1));
  nodeMaterial.fragmentNode = nodeCall(fragmentFns[options.colorCompositing], {
    point, a, b, index: TSL.varying(TSL.attribute("aHighlightIndex", "float")),
    pixelRatio: pixelRatio, selectionCount: selectionCount,
    clipTexture: TSL.textureLoad(options.clips)
  });
  nodeMaterial.depthTest = nodeMaterial.depthWrite = false;
  nodeMaterial.side = THREE.DoubleSide;
  nodeMaterial.toneMapped = false;
  return { material: nodeMaterial, units, pixelRatio, selectionCount };
}
