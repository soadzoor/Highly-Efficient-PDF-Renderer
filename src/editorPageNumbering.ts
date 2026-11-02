import type { EditorTextObject } from "./editorTypes";
import type { VectorScene } from "./pdfVectorExtractor";
import type { SceneAnnotation } from "./annotationData";
import { AnnotationLayerBuilder } from "./annotationLayers";
import { defaultVectorDrawRuns } from "./vectorDrawOrder";
import { setEditorAnnotationSource } from "./editorScene";

/** Give generated text a portable appearance owner so reopening can replace it exactly. */
export async function compileEditorPageNumber(object: EditorTextObject,
  compile: (object: EditorTextObject, signal?: AbortSignal) => Promise<VectorScene>, signal?: AbortSignal): Promise<VectorScene> {
  const scene = await compile(object, signal); signal?.throwIfAborted();
  if (!object.pageNumberingId) return scene;
  const annotation: SceneAnnotation = { id: object.id, name: object.id, pageIndex: 0, sourcePageIndex: object.pageIndex,
    annotationIndex: 0, subtype: "FreeText", flags: 4, visibleInDefaultView: true, hasAppearance: true,
    pageNumberingId: object.pageNumberingId, contents: object.text,
    pdfGeometry: { rect: [object.x, object.y, object.x + object.width, object.y + object.height] },
    bounds: { minX: object.x, minY: object.y, maxX: object.x + object.width, maxY: object.y + object.height } };
  const layers = new AnnotationLayerBuilder(scene.optionalContent, [...(scene.optionalContent?.conditions ?? [])]);
  scene.drawRuns = (scene.drawRuns ?? defaultVectorDrawRuns(scene)).map(run => ({ ...run,
    optionalContent: layers.condition(run.optionalContent, annotation.id) }));
  scene.optionalContent = layers.build(); scene.annotations = [annotation];
  scene.pdfPages = [{ pageIndex: 0, sourcePageIndex: object.pageIndex, pdfToScene: [1, 0, 0, 1, 0, 0] }];
  setEditorAnnotationSource(scene, annotation);
  return scene;
}
