import * as THREE from "three";
import { NodeMaterial, TSL } from "three/webgpu";
import type { ThreePageBinding } from "./threePageTransforms";

const matrixFn: unknown = TSL.wgslFn(`fn heprPageProjection(document: mat4x4f, matrices: texture_2d<f32>, page: f32) -> mat4x4f {
  let p = i32(page);
  return document * mat4x4f(textureLoad(matrices,vec2i(0,p),0), textureLoad(matrices,vec2i(1,p),0),
    textureLoad(matrices,vec2i(2,p),0),textureLoad(matrices,vec2i(3,p),0));
}`);
const ownerFn: unknown = TSL.wgslFn(`fn heprPrimitivePage(owners: texture_2d<f32>, index: f32) -> f32 {
  let width = i32(textureDimensions(owners,0).x); let i = i32(index);
  return textureLoad(owners,vec2i(i % width,i / width),0).r;
}`);
const parameterFn: unknown = TSL.wgslFn(`fn heprPageParameters(parameters: texture_2d<f32>, page: f32) -> vec4f {
  return textureLoad(parameters,vec2i(0,i32(page)),0);
}`);
const visibilityFn: unknown = TSL.wgslFn(`fn heprPageClip(position: vec4f, parameters: vec4f) -> vec4f {
  if (parameters.y < 0.5) { return vec4f(2.0,2.0,2.0,1.0); } return position;
}`);
function call(fn: unknown, args: Record<string, unknown>): never { return (fn as (args: Record<string, unknown>) => never)(args); }

export function pageProjectionNode(document: THREE.Matrix4, binding?: ThreePageBinding): { matrix: never; units?: never; finish(material: NodeMaterial): void } {
  const original = TSL.uniform(document) as never;
  if (!binding) return { matrix: original, finish() {} };
  const page = binding.owners ? call(ownerFn, { owners: TSL.textureLoad(binding.owners), index: TSL.attribute(binding.attribute!, "float") })
    : binding.page === undefined ? TSL.attribute("aPageIndex", "float") : TSL.float(binding.page);
  const parameters = call(parameterFn, { parameters: TSL.textureLoad(binding.table.parameters), page });
  return {
    matrix: call(matrixFn, { document: original, matrices: TSL.textureLoad(binding.table.matrices), page }),
    units: (parameters as { x: never }).x,
    finish(material) { material.vertexNode = call(visibilityFn, { position: material.vertexNode, parameters }); }
  };
}
