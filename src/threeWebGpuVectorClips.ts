import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";
import { VECTOR_CLIP_WGSL, VECTOR_CLIP_AA_WGSL } from "./vectorClipShaders";
import { RASTER_CLIP_WGSL } from "./rasterClipShaders";
import { registerThreeVectorClipCloner, VECTOR_CLIP_INSTANCE_ATTRIBUTE } from "./threeVectorClips";

const nodeWorldPositions = new WeakMap<THREE.Material, unknown>();
const antialiasedNodeClips = new WeakMap<THREE.Material, "straight-alpha" | "premultiplied">();
const rasterNodeClips = new WeakSet<THREE.Material>();
const clipFn: unknown = TSL.wgslFn(VECTOR_CLIP_WGSL);
const clipAAFn: unknown = TSL.wgslFn(VECTOR_CLIP_AA_WGSL);
const rasterClipAAFn: unknown = TSL.wgslFn(RASTER_CLIP_WGSL);
const clipPixelWidthFn: unknown = TSL.wgslFn(`
fn heprClipPixelWidth(point: vec2<f32>) -> f32 {
  let dx = length(vec2<f32>(dpdx(point.x), dpdy(point.x)));
  let dy = length(vec2<f32>(dpdx(point.y), dpdy(point.y)));
  return max(max(dx, dy), 0.0001);
}
`);

/**
 * Without `antialias` a clip is a per-pixel point test. An antialiased clip
 * scales a straight-alpha color's alpha by its coverage, or all of a
 * premultiplied color. Raster clips keep rectangular tile/page edges solid.
 */
export function registerThreeNodeClipPosition(material: THREE.Material, world: unknown,
  antialias: false | "straight-alpha" | "premultiplied" = false, raster = false): void {
  registerThreeVectorClipCloner(material, applyNodeVectorClip);
  nodeWorldPositions.set(material, world);
  if (antialias) antialiasedNodeClips.set(material, antialias);
  if (raster) rasterNodeClips.add(material);
}

function flatVarying(node: unknown): never {
  return ((TSL.varying as unknown as (value: unknown) => { setInterpolation(type: string): unknown })(node)
    .setInterpolation("flat")) as never;
}

function applyNodeVectorClip(source: THREE.Material, material: THREE.Material, clipIndex: number | null, texture: THREE.DataTexture): void {
  if (!(source instanceof NodeMaterial) || !(material instanceof NodeMaterial)) {
    throw new Error("Unsupported vector clip material.");
  }
  const world = nodeWorldPositions.get(source);
  if (!world || !source.fragmentNode) throw new Error("Clipped node material has no page-space position.");
  // The clip root is per instance, so it travels flat, like every other
  // per-primitive value in these materials.
  const index = clipIndex === null
    ? TSL.sub(flatVarying(TSL.attribute(VECTOR_CLIP_INSTANCE_ATTRIBUTE, "float")), 1)
    : TSL.uniform(clipIndex);
  const clipParams = { point: world, clipIndex: index, clipTexture: TSL.textureLoad(texture) };
  const antialias = antialiasedNodeClips.get(source);
  if (antialias) {
    material.fragmentNode = TSL.Fn(() => {
      // Force derivatives before the paint helper, which can discard. The
      // straight-alpha blend must keep RGB intact along partially covered clips.
      const aaWidth = TSL.property("float", "heprClipAAWidth");
      aaWidth.assign((clipPixelWidthFn as (params: Record<string, unknown>) => never)({ point: world }));
      const color = TSL.property("vec4", "heprClipSource");
      color.assign(source.fragmentNode as never);
      // Premultiplied image paint keeps rectangular tile/page clips solid.
      const coverageFn = rasterNodeClips.has(source) ? rasterClipAAFn : clipAAFn;
      const coverage = (coverageFn as (params: Record<string, unknown>) => never)({ ...clipParams, aaWidth });
      return antialias === "premultiplied" ? TSL.mul(color, coverage) : TSL.vec4(color.rgb, TSL.mul(color.a, coverage));
    })();
  } else {
    const coverage = (clipFn as (params: Record<string, unknown>) => never)(clipParams);
    material.fragmentNode = TSL.mul(source.fragmentNode as never, coverage);
  }
}
