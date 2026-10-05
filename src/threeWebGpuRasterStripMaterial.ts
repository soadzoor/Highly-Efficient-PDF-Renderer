import { pageProjectionNode, type ThreePageBinding } from "./threePageTransforms";
import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";
import { registerThreePdfShapeUniform } from "./threePdfShape";
import { registerThreeNodeClipPosition } from "./threeVectorClips";
import { RASTER_STRIP_LEVEL_WGSL, RASTER_STRIP_SAMPLE_WGSL } from "./rasterStripWebGpuSampling";
import type { ThreeColorCompositing } from "./threeWebGpuColorSpace";
import { rasterPackFn, rasterClipFn, rasterFragmentFns } from "./threeWebGpuRasterMaterial";

interface MutableUniform<T> { value: T; }

export interface ThreeWebGpuRasterStripMaterialState {
  material: THREE.Material;
  zoomUniform: MutableUniform<number>;
  useLocalToClipUniform: MutableUniform<number>;
}

interface ThreeWebGpuRasterStripMaterialOptions {
  texture: THREE.Texture;
  colorCompositing: ThreeColorCompositing;
  viewport: THREE.Vector2;
  cameraCenter: THREE.Vector2;
  localToClip: THREE.Matrix4;
  pageBinding?: ThreePageBinding;
}

// Keep TSL proxies opaque to avoid instantiating recursive @types/three types.
function callNode(fn: unknown, params: Record<string, unknown>): never {
  return (fn as (...args: unknown[]) => unknown)(params) as never;
}

function varyingNode(node: unknown, flat = false): never {
  const varying = (TSL.varying as unknown as (node: unknown) => { setInterpolation(type: string): unknown })(node);
  return (flat ? varying.setInterpolation("flat") : varying) as never;
}

const rasterStripLevelFn: unknown = TSL.wgslFn(RASTER_STRIP_LEVEL_WGSL);
const rasterStripSampleFn: unknown = TSL.wgslFn(RASTER_STRIP_SAMPLE_WGSL, [rasterStripLevelFn] as never);

export function createThreeWebGpuRasterStripMaterial(
  options: ThreeWebGpuRasterStripMaterialOptions
): ThreeWebGpuRasterStripMaterialState {
  const material = new NodeMaterial();
  const pageProjection = pageProjectionNode(options.localToClip, options.pageBinding);
  material.transparent = false;
  material.depthTest = false;
  material.depthWrite = false;
  material.side = THREE.DoubleSide;
  material.toneMapped = false;
  material.fog = false;
  material.lights = false;
  material.blending = THREE.CustomBlending;
  material.blendSrc = THREE.OneFactor;
  material.blendDst = THREE.OneMinusSrcAlphaFactor;
  material.blendSrcAlpha = THREE.OneFactor;
  material.blendDstAlpha = THREE.OneMinusSrcAlphaFactor;

  const shapeOnlyUniform = TSL.uniform(0);
  registerThreePdfShapeUniform(material, shapeOnlyUniform);
  const zoomUniform = TSL.uniform(1);
  const useLocalToClipUniform = TSL.uniform(0);
  const matrixB = TSL.attribute("aRasterMatrixEFWidthOpacity", "vec4") as unknown as { xy: unknown; zw: unknown };
  const wholeImage = TSL.vec4(0, 0, 1, 1);
  const rasterPack = varyingNode(callNode(rasterPackFn, {
    corner: TSL.attribute("aCorner", "vec2"),
    matrixABCD: TSL.attribute("aRasterMatrixABCD", "vec4"),
    matrixEF: matrixB.xy,
    tileQuad: wholeImage,
    tileUv: wholeImage
  }));
  const packed = rasterPack as { xy: unknown; zw: unknown };
  material.vertexNode = callNode(rasterClipFn, {
    rasterPack,
    viewport: TSL.uniform(options.viewport),
    cameraCenter: TSL.uniform(options.cameraCenter),
    zoom: zoomUniform,
    useLocalToClip: useLocalToClipUniform,
    localToClip: pageProjection.matrix
  });
  const widthOpacity = varyingNode(matrixB.zw, true) as { x: unknown; y: unknown };
  const inputColor = callNode(rasterStripSampleFn, {
    uRasterTex: TSL.texture(options.texture),
    uRasterSampler: TSL.sampler(options.texture),
    uv: packed.zw,
    row: varyingNode(TSL.instanceIndex, true),
    width: widthOpacity.x
  });
  pageProjection.finish(material);
  material.fragmentNode = callNode(rasterFragmentFns[options.colorCompositing], {
    inputColor,
    opacity: widthOpacity.y,
    shapeOnly: shapeOnlyUniform
  });
  registerThreeNodeClipPosition(material, packed.xy, "premultiplied", true);

  return {
    material,
    zoomUniform: zoomUniform as MutableUniform<number>,
    useLocalToClipUniform: useLocalToClipUniform as MutableUniform<number>
  };
}
