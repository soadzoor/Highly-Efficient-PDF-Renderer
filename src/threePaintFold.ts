import * as THREE from "three";
import { gradientMaskVectors, GRADIENT_MASK_VECTORS as THREE_GRADIENT_MASK_VECTORS } from "./gradientMaskFold";
import { paintFoldMaskWeights, paintFoldFragmentGlsl } from "./nativePaintFold";
import type { VectorDrawRun, VectorScene } from "./pdfVectorExtractor";
import type { ScenePaintMask } from "./scenePaintGraph";

/**
 * Folded group chains in Three (see `ScenePaintCompositorAdapter.drawFolded`):
 * a paint material that can draw a leaf scaled by its chain's opacity and,
 * optionally, a soft mask's value at each fragment. `fold` holds (opacity,
 * mask mode, mask bias, 0) and `weights` the mask weights (see
 * `paintFoldMaskWeights`); materials start at (1, 0), which changes nothing.
 * The mask mode is one of `PaintFoldMode`: a mask surface's pixel, or a
 * gradient mask the fragment computes itself from `gradient`.
 */
export interface PaintFoldInputs {
  fold: { value: THREE.Vector4 };
  weights: { value: THREE.Vector4 };
  mask: { value: THREE.Texture | null };
  /** A gradient mask's description; see `THREE_GRADIENT_MASK_VECTORS`. */
  gradient: THREE.Vector4[];
  /** What `mask` holds while no mask applies. */
  neutral: THREE.Texture | null;
}

/** How a folded paint reads its soft mask; `fold.y` holds it. */
const PaintFoldMode = { None: 0, Surface: 1, Gradient: 2, LinearGradient: 3 } as const;

export { GRADIENT_MASK_VECTORS as THREE_GRADIENT_MASK_VECTORS,
  GRADIENT_MASK_PLANES as THREE_GRADIENT_MASK_PLANES } from "./gradientMaskFold";
const PLANE_BASE = 7;

const foldInputs = new WeakMap<THREE.Material, PaintFoldInputs>();

export function registerThreePaintFoldInputs(material: THREE.Material, inputs: PaintFoldInputs): void {
  foldInputs.set(material, inputs);
}

/** Straight-alpha Three paints share the native folded-mask shader. */
export const threePaintFoldFragmentGlsl = paintFoldFragmentGlsl;

/** Gives a raw paint material built with `threePaintFoldFragmentGlsl` its fold inputs. */
export function enableThreeRawPaintFold(material: THREE.RawShaderMaterial): void {
  const fold = material.uniforms.uPaintFold = { value: new THREE.Vector4(1, 0, 0, 0) };
  const weights = material.uniforms.uPaintMaskWeights = { value: new THREE.Vector4() };
  const gradient = neutralGradient();
  material.uniforms.uPaintMaskGradient = { value: gradient };
  const mask = material.uniforms.uPaintMask = { value: null };
  foldInputs.set(material, { fold, weights, mask, gradient, neutral: null });
}

export function neutralGradient(): THREE.Vector4[] {
  return Array.from({ length: THREE_GRADIENT_MASK_VECTORS }, (_, index) =>
    new THREE.Vector4(0, 0, index >= PLANE_BASE ? 1 : 0, 0));
}

/** Clip clones share the fold inputs of the material they wrap. */
export function copyThreePaintFold(source: THREE.Material, target: THREE.Material): void {
  const inputs = foldInputs.get(source);
  if (inputs) foldInputs.set(target, inputs);
}

export function canFoldThreePaint(material: THREE.Material): boolean {
  return foldInputs.has(material);
}

/** A soft mask made of one gradient paint, as a folded paint computes it; see `THREE_GRADIENT_MASK_VECTORS`. */
export interface ThreeGradientMaskFold {
  /** The scene's gradient colour table, which holds a row per gradient. */
  lut: THREE.Texture;
  vectors: Float32Array;
  /** Whether the mask's paint writes linear rather than display values. */
  linear: boolean;
}

/**
 * Applies a fold to a paint material until the returned callback restores it.
 * `content` is the soft mask that `mask` holds unconverted, or that
 * `gradient` describes. Materials sharing inputs must be restored in reverse
 * order.
 */
export function setThreePaintFold(material: THREE.Material, opacity: number, mask: THREE.Texture | null,
  content?: ScenePaintMask, gradient?: ThreeGradientMaskFold): () => void {
  const inputs = foldInputs.get(material);
  if (!inputs) throw new Error("PDF material cannot draw a folded paint.");
  const fold = inputs.fold.value.clone(), weights = inputs.weights.value.clone(), texture = inputs.mask.value;
  const vectors = gradient ? inputs.gradient.map(vector => vector.clone()) : null;
  const [red, green, blue, alpha, bias] = paintFoldMaskWeights(content);
  const mode = gradient ? (gradient.linear ? PaintFoldMode.LinearGradient : PaintFoldMode.Gradient)
    : mask ? PaintFoldMode.Surface : PaintFoldMode.None;
  inputs.fold.value.set(opacity, mode, bias, 0);
  inputs.weights.value.set(red, green, blue, alpha);
  inputs.mask.value = gradient?.lut ?? mask ?? inputs.neutral;
  if (gradient) inputs.gradient.forEach((vector, index) => vector.fromArray(gradient.vectors, index * 4));
  return () => {
    inputs.fold.value.copy(fold); inputs.weights.value.copy(weights); inputs.mask.value = texture;
    if (vectors) inputs.gradient.forEach((vector, index) => vector.copy(vectors[index]));
  };
}

/**
 * The fold a paint material would draw with now, for diagnostics; null if it
 * cannot fold. `weights` are the mask weights and bias, as `paintFoldMaskWeights`
 * gives them, while masked. `gradient` is the gradient mask's description while
 * the paint computes its mask itself.
 */
export function threePaintFoldState(material: THREE.Material): { opacity: number; masked: boolean;
  mask: THREE.Texture | null; weights: number[] | null; gradient?: number[] } | null {
  const inputs = foldInputs.get(material);
  if (!inputs) return null;
  const mode = Math.round(inputs.fold.value.y);
  const masked = mode !== PaintFoldMode.None;
  const state = { opacity: inputs.fold.value.x, masked, mask: masked ? inputs.mask.value : null,
    weights: masked ? [...inputs.weights.value.toArray(), inputs.fold.value.z] : null };
  return mode >= PaintFoldMode.Gradient
    ? { ...state, gradient: inputs.gradient.flatMap(vector => vector.toArray()) } : state;
}

/**
 * What a folded paint needs to compute a soft mask made of this gradient
 * fill material's paint: its colour table and the domain it writes colour
 * in. Registered by the layer that builds the material.
 */
export interface ThreeGradientMaskSource {
  lut: THREE.Texture;
  linear: boolean;
  /** Whole-document colour override; a mask paint under one keeps its surface. */
  vectorOverride: THREE.Vector4;
  /** Per-paint highlight colour; likewise. */
  primitiveColor: THREE.Vector4;
}

const gradientMaskSources = new WeakMap<THREE.Material, ThreeGradientMaskSource>();

export function registerThreeGradientMaskSource(material: THREE.Material, source: ThreeGradientMaskSource): void {
  gradientMaskSources.set(material, source);
}

export function threeGradientMaskSource(material: THREE.Material): ThreeGradientMaskSource | undefined {
  return gradientMaskSources.get(material);
}

/** Three's clip-space projection expressed in the shared mask pixel homography. */
export function threeGradientMaskVectors(scene: VectorScene, maskRun: VectorDrawRun, foldedClip: number | undefined,
  clipFromData: THREE.Matrix4, width: number, height: number, topDown: boolean): Float32Array | null {
  const m = clipFromData.elements, halfWidth = width / 2, halfHeight = height / 2, flip = topDown ? -1 : 1;
  return gradientMaskVectors(scene, maskRun, foldedClip, [
    (m[0] + m[3]) * halfWidth, (m[4] + m[7]) * halfWidth, (m[12] + m[15]) * halfWidth,
    (m[3] + flip * m[1]) * halfHeight, (m[7] + flip * m[5]) * halfHeight, (m[15] + flip * m[13]) * halfHeight,
    m[3], m[7], m[15]
  ]);
}
