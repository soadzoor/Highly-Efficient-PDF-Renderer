import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";
import { PAINT_FOLD_SCALE_WGSL, foldGradientWgsl } from "./nativePaintFold";
import { copyThreePaintFold, neutralGradient, registerThreePaintFoldInputs, type PaintFoldInputs } from "./threePaintFold";
import { copyThreePdfShapeUniform } from "./threePdfShape";

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

// Most paints need opacity or a rendered mask only. Their shader need not
// bind and update the fifteen vectors used to compute a gradient mask.
const surfacePaintFoldScaleFn: unknown = TSL.wgslFn(`
fn heprSurfacePaintFoldScale(pixel: vec2f, mask: texture_2d<f32>, fold: vec4f, weights: vec4f) -> f32 {
  if (fold.y < 0.5) { return fold.x; }
  let size = vec2<i32>(textureDimensions(mask));
  let value = textureLoad(mask, clamp(vec2<i32>(pixel), vec2<i32>(0), size - vec2<i32>(1)), 0);
  return fold.x * clamp(dot(value, weights) + fold.z, 0.0, 1.0);
}
`);

interface SurfacePaintFoldFragment { full: unknown; surface: unknown }
const surfacePaintFoldFragments = new WeakMap<THREE.Material, SurfacePaintFoldFragment>();

/**
 * A compositor-only variant for opacity and rendered masks. Keep the source
 * material's full graph intact: callers may apply a computed gradient fold to
 * it, and the compositor selects that source for those draws.
 */
export function createThreeNodeSurfacePaintFoldMaterial(source: THREE.Material): THREE.Material | null {
  if (!(source instanceof NodeMaterial)) return null;
  const fragments = surfacePaintFoldFragments.get(source);
  if (!fragments || source.fragmentNode !== fragments.full) return null;
  const material = source.clone();
  material.fragmentNode = fragments.surface as never;
  copyThreePaintFold(source, material);
  copyThreePdfShapeUniform(source, material);
  return material;
}

/** Apply the same clip wrapper to a recognized material's ordinary fold graph. */
export function mapThreeNodeSurfacePaintFold(source: THREE.Material, target: THREE.Material,
  mapFragment: (fragment: unknown) => unknown): void {
  if (!(source instanceof NodeMaterial) || !(target instanceof NodeMaterial)) return;
  const fragments = surfacePaintFoldFragments.get(source);
  if (!fragments || source.fragmentNode !== fragments.full) return;
  surfacePaintFoldFragments.set(target, { full: target.fragmentNode, surface: mapFragment(fragments.surface) });
}

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
  const surfaceScale = (surfacePaintFoldScaleFn as (params: Record<string, unknown>) => unknown)(
    { pixel: TSL.screenCoordinate, mask, fold, weights });
  const source = material.fragmentNode;
  const fragment = (scale: unknown): never => TSL.Fn(() => {
    const color = TSL.property("vec4", "heprFoldSource");
    color.assign(source as never);
    return TSL.vec4(color.rgb, TSL.mul(color.a, scale as never));
  })() as never;
  material.fragmentNode = fragment(scale);
  surfacePaintFoldFragments.set(material, { full: material.fragmentNode, surface: fragment(surfaceScale) });
  registerThreePaintFoldInputs(material, { fold: fold as unknown as PaintFoldInputs["fold"],
    weights: weights as unknown as PaintFoldInputs["weights"],
    mask: mask as unknown as PaintFoldInputs["mask"], gradient, neutral: neutralMask });
}
