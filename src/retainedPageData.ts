import type { HeprPageData } from "./heprDocumentData";
import { validateHeprPageData } from "./heprDocumentDataValidation";
import type { VectorScene } from "./pdfVectorExtractor";

/** Self-contained replay resources shared by fallback islands from the same page. */
export interface SceneRetainedPage {
  readonly page: HeprPageData;
  /** Retained-page membership index to scene condition index; -1 means unconditional. */
  readonly optionalContentConditions: Int32Array;
  /** Page-native coordinates to composed scene coordinates. */
  readonly matrix: Float32Array;
}

export function validateSceneRetainedPages(scene: VectorScene): void {
  if (scene.retainedPages === undefined) return;
  if (!Array.isArray(scene.retainedPages)) throw new TypeError("Invalid retained page resources.");
  const validated = new Set<HeprPageData>();
  for (const resource of scene.retainedPages) {
    if (!resource || !(resource.matrix instanceof Float32Array) || resource.matrix.length !== 6 ||
        !resource.matrix.every(Number.isFinite) || Math.abs(resource.matrix[0] * resource.matrix[3] - resource.matrix[1] * resource.matrix[2]) <= 1e-12 ||
        !(resource.optionalContentConditions instanceof Int32Array)) throw new TypeError("Invalid retained page placement or conditions.");
    if (!validated.has(resource.page)) { validateHeprPageData(resource.page); validated.add(resource.page); }
    if (resource.optionalContentConditions.length !== resource.page.stores.optionalContent.names.length ||
        resource.optionalContentConditions.some(index => index < -1 || index >= (scene.optionalContent?.conditions.length ?? 0))) {
      throw new TypeError("Retained page references an invalid optional-content condition.");
    }
  }
}
