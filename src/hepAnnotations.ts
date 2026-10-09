import { validateAnnotationAppearanceMode, validateAnnotations, validateScenePdfPages, type AnnotationAppearanceMode,
  type SceneAnnotation } from "./annotationData";
import type { HepArchive } from "./hepContainer";
import type { VectorScene } from "./pdfVectorExtractor";

export const HEP_ANNOTATIONS_PATH = "annotations/annotations.json";
/** HEP chunk lengths use an unsigned 32-bit wire field. */
export const MAX_HEP_ANNOTATION_BYTES = 0xffffffff;

export function writeHepAnnotations(archive: HepArchive, scene: VectorScene): {
  file: string; version: 1; count: number; appearances?: AnnotationAppearanceMode;
} | undefined {
  if (scene.annotations === undefined && scene.pdfPages === undefined) return undefined;
  validateAnnotationAppearanceMode(scene.annotationAppearances);
  const annotations = scene.annotations ?? [];
  validateScenePdfPages(scene.pdfPages, scene.pageCount);
  validateAnnotations(annotations, { pageCount: scene.pageCount, conditionCount: scene.optionalContent?.conditions.length ?? 0 });
  // Loading an older HEP exposes an empty annotation array; do not grow the
  // archive with an empty section on every load/export round trip.
  if (annotations.length === 0 && !scene.pdfPages?.length) return undefined;
  const bytes = new TextEncoder().encode(JSON.stringify({ version: 1, annotations, pdfPages: scene.pdfPages }));
  if (bytes.length > MAX_HEP_ANNOTATION_BYTES) throw new Error("Annotation metadata exceeds the HEP section limit.");
  archive.file(HEP_ANNOTATIONS_PATH, bytes);
  // Older readers ignore the optional mode; "render" is recorded by omission.
  return { file: HEP_ANNOTATIONS_PATH, version: 1, count: annotations.length,
    ...(scene.annotationAppearances && scene.annotationAppearances !== "render" ? { appearances: scene.annotationAppearances } : {}) };
}

export async function readHepAnnotations(archive: HepArchive, descriptor: unknown, scene: VectorScene,
  signal?: AbortSignal): Promise<readonly SceneAnnotation[]> {
  if (descriptor === undefined) return [];
  const meta = descriptor as { file?: unknown; version?: unknown; count?: unknown; appearances?: unknown };
  if (!meta || meta.file !== HEP_ANNOTATIONS_PATH || meta.version !== 1 || !Number.isSafeInteger(meta.count) || (meta.count as number) < 0 ||
      (meta.appearances !== undefined && meta.appearances !== "forms" && meta.appearances !== "none")) {
    throw new Error("Invalid HEP annotation descriptor.");
  }
  signal?.throwIfAborted();
  const entry = archive.file(HEP_ANNOTATIONS_PATH);
  if (!entry) throw new Error("Missing HEP annotation section.");
  const bytes = await entry.async("uint8array");
  if (bytes.length > MAX_HEP_ANNOTATION_BYTES) throw new Error("Annotation metadata exceeds the HEP section limit.");
  signal?.throwIfAborted();
  const data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  if (!data || data.version !== 1 || !Array.isArray(data.annotations) || data.annotations.length !== meta.count) {
    throw new Error("HEP annotations do not match their manifest entry.");
  }
  validateAnnotations(data.annotations, { pageCount: scene.pageCount, conditionCount: scene.optionalContent?.conditions.length ?? 0 });
  validateScenePdfPages(data.pdfPages, scene.pageCount);
  scene.pdfPages = data.pdfPages;
  if (meta.appearances !== undefined) scene.annotationAppearances = meta.appearances as AnnotationAppearanceMode;
  return data.annotations as SceneAnnotation[];
}
