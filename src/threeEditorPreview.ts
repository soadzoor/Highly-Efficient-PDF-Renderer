import type * as THREE from "three";
import type { VectorScene } from "./pdfVectorExtractor";
import { editorPreviewFillCoverage, editorPreviewSceneTexels, type EditorPreviewSceneUpdate, type EditorPreviewTexel } from "./editorPreviewSceneUpdate";

const writable = new WeakSet<THREE.DataTexture>();

/** Patch renderer-owned storage; never write through a view of canonical geometry. */
export function patchThreeEditorPreviewTexture(texture: THREE.DataTexture, patches: readonly EditorPreviewTexel[],
  first = 0, count = Infinity): void {
  const selected = patches.filter(patch => patch.index >= first && patch.index < first + count);
  if (!selected.length) return;
  if (!writable.has(texture)) { texture.image.data = (texture.image.data as Float32Array).slice(); writable.add(texture); }
  const data = texture.image.data as Float32Array;
  texture.clearUpdateRanges?.();
  for (const patch of selected) {
    const offset = (patch.index - first) * 4;
    data.set(patch.pixels, offset); texture.addUpdateRange?.(offset, 4);
  }
  // The Three WebGPU backend may upload this whole texture. Its allocation and
  // material remain stable, and unrelated textures are never marked dirty.
  texture.needsUpdate = true;
}

/** Recompute coverage for only the moved contours, retaining canonical rounding. */
export function threeEditorPreviewTexels(scene: VectorScene, update: EditorPreviewSceneUpdate): EditorPreviewTexel[] {
  return editorPreviewSceneTexels(scene, update, editorPreviewFillCoverage(scene, update));
}
