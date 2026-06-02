import {
  loadPdfSceneFromSource,
  type PdfObjectGeneratorOptions,
  type PdfObjectSource,
  type PdfObjectSourceKind
} from "./pdfObjectGenerator";
import {
  createThreePdfObject,
  type HeprRendererType,
  type HeprThreeObjectOptions,
  type HeprColorInput,
  type HeprThreePdfObject
} from "./threePdfObject";
import {
  createCanvasInteractionController,
  type CanvasInteractionController
} from "./canvasInteractions";
import { createLoadProgressReporter } from "./loadProgress";

export interface PdfObjectGeneratorRuntimeOptions
  extends PdfObjectGeneratorOptions,
    Omit<HeprThreeObjectOptions, "rendererType"> {}

export async function pdfObjectGenerator(
  source: PdfObjectSource,
  options: PdfObjectGeneratorRuntimeOptions = {},
  rendererType: HeprRendererType = "webgl"
): Promise<HeprThreePdfObject> {
  const progress = createLoadProgressReporter(options.onProgress);
  const loadedScene = await loadPdfSceneFromSource(source, {
    ...options,
    onProgress: progress.child(0, 0.92).toCallback()
  });
  progress.report(0.94, { stage: "upload", sourceType: loadedScene.sourceKind === "pdf" ? "pdf" : "zip" });
  const object = await createThreePdfObject(loadedScene, {
    ...options,
    rendererType
  });
  progress.complete({ sourceType: loadedScene.sourceKind === "pdf" ? "pdf" : "zip" });
  return object;
}

export {
  loadPdfSceneFromSource,
  createThreePdfObject,
  createCanvasInteractionController
};

export {
  CORE_STROKE_VERTEX_SHADER_SOURCE,
  CORE_STROKE_FRAGMENT_SHADER_SOURCE,
  CORE_FILL_VERTEX_SHADER_SOURCE,
  CORE_FILL_FRAGMENT_SHADER_SOURCE,
  CORE_TEXT_VERTEX_SHADER_SOURCE,
  CORE_TEXT_FRAGMENT_SHADER_SOURCE,
  CORE_BLIT_VERTEX_SHADER_SOURCE,
  CORE_BLIT_FRAGMENT_SHADER_SOURCE,
  CORE_VECTOR_COMPOSITE_FRAGMENT_SHADER_SOURCE,
  CORE_RASTER_VERTEX_SHADER_SOURCE,
  CORE_RASTER_FRAGMENT_SHADER_SOURCE
} from "./coreShaders";

export type {
  PdfObjectSource,
  PdfObjectSourceKind,
  PdfObjectGeneratorOptions,
  HeprRendererType,
  HeprThreeObjectOptions,
  HeprColorInput,
  HeprThreePdfObject,
  CanvasInteractionController
};

export type {
  LoadProgressCallback,
  PDFLoadProgress,
  PDFLoadStage
} from "./loadProgress";

export type {
  VectorLodMode
} from "./vectorStrokeLod";

export {
  VECTOR_STROKE_LOD_MIN_SEGMENTS,
  VECTOR_STROKE_LOD_TARGET_VISIBLE_SEGMENTS,
  VECTOR_STROKE_LOD_TOLERANCES
} from "./vectorStrokeLod";
