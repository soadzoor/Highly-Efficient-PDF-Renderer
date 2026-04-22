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

export interface PdfObjectGeneratorRuntimeOptions
  extends PdfObjectGeneratorOptions,
    Omit<HeprThreeObjectOptions, "rendererType"> {}

export async function pdfObjectGenerator(
  source: PdfObjectSource,
  options: PdfObjectGeneratorRuntimeOptions = {},
  rendererType: HeprRendererType = "webgl"
): Promise<HeprThreePdfObject> {
  const loadedScene = await loadPdfSceneFromSource(source, options);
  return createThreePdfObject(loadedScene, {
    ...options,
    rendererType
  });
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
