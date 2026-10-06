import * as THREE from "three";
import { multiplyFragmentGlsl } from "./vectorMultiply";

/** Clone one paint pass while sharing all camera/geometry uniform references. */
export function createThreeMultiplyMaterial(source: THREE.Material, pass: 0 | 1,
  premultiplied = false): THREE.Material {
  const material = source.clone();
  if (source instanceof THREE.RawShaderMaterial && material instanceof THREE.RawShaderMaterial) {
    material.uniforms = source.uniforms;
    if (!premultiplied) material.fragmentShader = multiplyFragmentGlsl(source.fragmentShader);
  } else if ((material as THREE.Material & { isNodeMaterial?: boolean }).isNodeMaterial === true) {
    if (!premultiplied) material.premultipliedAlpha = true;
  } else {
    throw new Error("Unsupported Multiply paint material.");
  }
  material.blending = THREE.CustomBlending;
  material.blendEquation = material.blendEquationAlpha = THREE.AddEquation;
  material.blendSrc = pass === 0 ? THREE.DstColorFactor : THREE.OneMinusDstAlphaFactor;
  material.blendDst = pass === 0 ? THREE.OneMinusSrcAlphaFactor : THREE.OneFactor;
  material.blendSrcAlpha = pass === 0 ? THREE.ZeroFactor : THREE.OneFactor;
  material.blendDstAlpha = pass === 0 ? THREE.OneFactor : THREE.OneMinusSrcAlphaFactor;
  return material;
}
