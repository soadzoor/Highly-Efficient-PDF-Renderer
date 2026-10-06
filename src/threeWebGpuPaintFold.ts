import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";
import { PAINT_FOLD_SCALE_WGSL, foldGradientWgsl } from "./nativePaintFold";
import { neutralGradient, registerThreePaintFoldInputs, type PaintFoldInputs } from "./threePaintFold";

// The mask input's placeholder: read only while no mask applies, where the
// fold ignores it, and never a surface a pass could write. Three WebGPU
// rebinds a texture input only when the new texture's version differs, and
// the compositor numbers its surfaces' versions upwards from 2^20, so the
// placeholder takes a version no surface reaches.
const NEUTRAL_MASK_VERSION = 2 ** 30;
let neutralMask: THREE.DataTexture | null = null;

const paintFoldScaleFn: unknown = TSL.wgslFn(PAINT_FOLD_SCALE_WGSL,
  [TSL.wgslFn(foldGradientWgsl.slice(0, foldGradientWgsl.indexOf("fn heprFoldGradientBackground"))),
    TSL.wgslFn(foldGradientWgsl.slice(foldGradientWgsl.indexOf("fn heprFoldGradientBackground")))] as never);

/**
 * Scales a straight-alpha node paint's alpha by the fold. A mask surface is
 * read at this fragment's pixel of the destination-sized surface.
 */
export function enableThreeNodePaintFold(material: THREE.Material): void {
  if (!(material instanceof NodeMaterial) || !material.fragmentNode) {
    throw new Error("Folded paint material has no node fragment output.");
  }
  if (!neutralMask) {
    neutralMask = new THREE.DataTexture(Uint8Array.of(255, 255, 255, 255), 1, 1);
    neutralMask.needsUpdate = true;
    neutralMask.version = NEUTRAL_MASK_VERSION;
  }
  const fold = TSL.uniform(new THREE.Vector4(1, 0, 0, 0));
  const weights = TSL.uniform(new THREE.Vector4());
  const gradient = neutralGradient();
  // A texture-valued function argument must stay a texture node rather than a sampled vec4.
  const mask = TSL.textureLoad(neutralMask);
  // Three keys texture bindings by the texture a node holds when the shader
  // is built; a fixed hash keeps this input its own binding whatever it holds.
  (mask as unknown as { getUniformHash: () => string }).getUniformHash = () => "hepr-paint-fold-mask";
  const parameters: Record<string, unknown> = { pixel: TSL.screenCoordinate, mask, fold, weights };
  gradient.forEach((vector, index) => { parameters[`d${index}`] = TSL.uniform(vector); });
  const scale = (paintFoldScaleFn as (params: Record<string, unknown>) => unknown)(parameters);
  const source = material.fragmentNode;
  material.fragmentNode = TSL.Fn(() => {
    const color = TSL.property("vec4", "heprFoldSource");
    color.assign(source as never);
    return TSL.vec4(color.rgb, TSL.mul(color.a, scale as never));
  })() as never;
  registerThreePaintFoldInputs(material, { fold: fold as unknown as PaintFoldInputs["fold"],
    weights: weights as unknown as PaintFoldInputs["weights"],
    mask: mask as unknown as PaintFoldInputs["mask"], gradient, neutral: neutralMask });
}

