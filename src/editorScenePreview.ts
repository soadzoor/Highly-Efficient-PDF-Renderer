import type { VectorScene } from "./pdfVectorExtractor";
import type { PrimitiveRef } from "./scenePrimitives";

export interface EditorSceneTranslationHint {
  source: VectorScene;
  changed: readonly PrimitiveRef[];
  dx: number;
  dy: number;
  changedClips?: readonly number[];
}
const translations = new WeakMap<VectorScene, EditorSceneTranslationHint>();

/** Transient renderer handoff only; never serialized into PDF or HEP. */
export function setEditorSceneTranslationHint(scene: VectorScene, hint: EditorSceneTranslationHint): void { translations.set(scene, hint); }
export function getEditorSceneTranslationHint(scene: VectorScene): EditorSceneTranslationHint | undefined { return translations.get(scene); }
