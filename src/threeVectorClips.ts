import * as THREE from "three";
import type { VectorClipPath, VectorScene } from "./pdfVectorExtractor";
import { packVectorClips } from "./vectorClips";
import { copyThreePdfShapeUniform } from "./threePdfShape";
import { copyThreePaintFold } from "./threePaintFold";

const materialTextures = new WeakMap<THREE.Material, THREE.DataTexture>();
type NodeClipCloner = (source: THREE.Material, target: THREE.Material, clipIndex: number | null, texture: THREE.DataTexture) => void;
const nodeClipCloners = new WeakMap<THREE.Material, NodeClipCloner>();

interface SharedClipTexture { texture: THREE.DataTexture; users: number }
const sharedClipTextures = new WeakMap<readonly VectorClipPath[], SharedClipTexture>();
const emptyClipPaths: readonly VectorClipPath[] = [];

/** Material layers and derived LOD/page scenes borrow one immutable clip store. */
export function acquireThreeVectorClipTexture(scene: VectorScene): {
  texture: THREE.DataTexture;
  release(): void;
} {
  const key = scene.clipPaths ?? emptyClipPaths;
  let entry = sharedClipTextures.get(key);
  if (!entry) {
    entry = { texture: createThreeVectorClipTexture(scene), users: 0 };
    sharedClipTextures.set(key, entry);
  }
  entry.users++;
  const resource = entry;
  let released = false;
  return {
    texture: resource.texture,
    release(): void {
      if (released) return;
      released = true;
      if (--resource.users === 0) {
        sharedClipTextures.delete(key);
        resource.texture.dispose();
      }
    }
  };
}

/** The selected backend supplies clipping when it creates a node material. */
export function registerThreeVectorClipCloner(material: THREE.Material, applyClip: NodeClipCloner): void {
  nodeClipCloners.set(material, applyClip);
}

/** Per-instance clip root, stored as `clipIndex + 1` so zero means unclipped. */
export const VECTOR_CLIP_INSTANCE_ATTRIBUTE = "aVectorClipIndex";
/** `uVectorClipIndex` value that selects the instance stream in the core shaders. */
const INSTANCE_VECTOR_CLIP_UNIFORM = -2;

export function createThreeVectorClipTexture(scene: VectorScene): THREE.DataTexture {
  // Both the GLSL and WGSL clips read cell storage, bounding each pixel's clip
  // work at any zoom.
  const data = packVectorClips(scene.clipPaths, undefined, { cells: true });
  const width = Math.min(4096, Math.max(1, Math.ceil(Math.sqrt(data.length / 4))));
  const height = Math.ceil(data.length / 4 / width);
  if (height > 4096) throw new RangeError("Vector clip texture exceeds material capacity.");
  const padded = new Float32Array(width * height * 4); padded.set(data);
  const texture = new THREE.DataTexture(padded, width, height, THREE.RGBAFormat, THREE.FloatType);
  texture.minFilter = texture.magFilter = THREE.NearestFilter;
  texture.generateMipmaps = false;
  texture.needsUpdate = true;
  return texture;
}

export function initializeThreeVectorClip(material: THREE.Material, texture: THREE.DataTexture): void {
  materialTextures.set(material, texture);
  if (material instanceof THREE.RawShaderMaterial) {
    material.uniforms.uPdfShapeOnly ??= { value: 0 };
    material.uniforms.uVectorClipTex = { value: texture };
    material.uniforms.uVectorClipIndex = { value: -1 };
  }
}

/** Each clip gets its own constant uniform; camera/color/geometry nodes remain shared. */
export function createThreeVectorClipMaterial(source: THREE.Material, clipIndex?: number): THREE.Material {
  if (clipIndex === undefined || clipIndex < 0) return source;
  return cloneWithVectorClip(source, clipIndex);
}

/**
 * One material for paints under different clips, reading the clip root from the
 * `aVectorClipIndex` instance stream as `clipIndex + 1` (zero meaning unclipped).
 * This is what lets a single draw span clip changes, exactly as the native
 * backends do, instead of ending a batch at every clip boundary.
 */
export function createThreeInstanceVectorClipMaterial(source: THREE.Material): THREE.Material {
  return cloneWithVectorClip(source, null);
}

function cloneWithVectorClip(source: THREE.Material, clipIndex: number | null): THREE.Material {
  const texture = materialTextures.get(source);
  if (!texture) throw new Error("Clipped material has no vector clip texture.");
  const material = source.clone();
  copyThreePdfShapeUniform(source, material);
  copyThreePaintFold(source, material);
  if (source instanceof THREE.RawShaderMaterial && material instanceof THREE.RawShaderMaterial) {
    // The shared core shaders already fall back to the instance stream when the
    // uniform selects it, so only the uniform changes.
    material.uniforms = { ...source.uniforms, uVectorClipIndex: { value: clipIndex ?? INSTANCE_VECTOR_CLIP_UNIFORM } };
  } else {
    const applyClip = nodeClipCloners.get(source);
    if (!applyClip) throw new Error("Unsupported vector clip material.");
    applyClip(source, material, clipIndex, texture);
  }
  return material;
}
