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
import { prebuildVectorStrokeLodRuntime } from "./vectorStrokeLod";

/**
 * Combined options for `pdfObjectGenerator`.
 *
 * This includes source parsing options such as `segmentMerge` plus three.js
 * object options such as `vectorLod` and colors.
 */
export interface PdfObjectGeneratorRuntimeOptions
  extends PdfObjectGeneratorOptions,
    Omit<HeprThreeObjectOptions, "rendererType"> {}

const LOAD_PROGRESS_SCENE_END = 0.34;
const LOAD_PROGRESS_VECTOR_LOD_START = 0.38;
const LOAD_PROGRESS_VECTOR_LOD_END = 0.96;
const LOAD_PROGRESS_UPLOAD = 0.98;

/**
 * Load a PDF or HEPR parsed-data ZIP and return a three.js object.
 *
 * This is the main package entry point for three.js applications. The returned
 * object is a `THREE.Group`; add it to your scene and render normally.
 *
 * The PDF follows your three.js camera by default. HEPR synchronizes itself
 * from three.js `onBeforeRender`, so typical render loops do not need a
 * separate per-frame HEPR call.
 *
 * Example:
 *
 * ```ts
 * import { pdfObjectGenerator } from "@soadzoor/hepr";
 *
 * const pdfObject = await pdfObjectGenerator(file, {
 *   vectorLod: "auto",
 *   pageBackground: "#ffffff",
 *   onProgress: (progress) => {
 *     console.log(progress.stage, progress.value);
 *   }
 * });
 *
 * scene.add(pdfObject);
 *
 * function frame() {
 *   renderer.render(scene, camera);
 *   requestAnimationFrame(frame);
 * }
 * ```
 *
 * @param source PDF/ZIP bytes, a `File`/`Blob`, a URL/path string, or a base64 string.
 * @param options Parsing and three.js rendering options.
 * @param rendererType Native backend to use internally. Defaults to `"webgl"`.
 */
export async function pdfObjectGenerator(
  source: PdfObjectSource,
  options: PdfObjectGeneratorRuntimeOptions = {},
  rendererType: HeprRendererType = "webgl"
): Promise<HeprThreePdfObject> {
  const progress = createLoadProgressReporter(options.onProgress);
  const loadedScene = await loadPdfSceneFromSource(source, {
    ...options,
    onProgress: progress.child(0, LOAD_PROGRESS_SCENE_END).toCallback()
  });
  const sourceType = loadedScene.sourceKind === "pdf" ? "pdf" : "zip";
  progress.report(LOAD_PROGRESS_VECTOR_LOD_START, { stage: "vector-lod", sourceType });
  await prebuildVectorStrokeLodRuntime(loadedScene.scene, options.vectorLod ?? "auto", rendererType, {
    yieldIntervalMs: 500,
    onProgress: (lodProgress) => {
      const value =
        LOAD_PROGRESS_VECTOR_LOD_START +
        lodProgress.value * (LOAD_PROGRESS_VECTOR_LOD_END - LOAD_PROGRESS_VECTOR_LOD_START);
      progress.report(value, { stage: "vector-lod", sourceType });
    }
  });
  progress.report(LOAD_PROGRESS_UPLOAD, { stage: "upload", sourceType });
  await yieldToHostFrame();
  const object = await createThreePdfObject(loadedScene, {
    ...options,
    rendererType
  });
  progress.complete({ sourceType });
  return object;
}

async function yieldToHostFrame(): Promise<void> {
  if (typeof requestAnimationFrame === "function") {
    await new Promise<void>((resolve) => {
      requestAnimationFrame(() => resolve());
    });
    return;
  }
  await new Promise<void>((resolve) => {
    setTimeout(resolve, 0);
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

export type {
  LoadProgressCallback,
  PDFLoadProgress,
  PDFLoadStage
} from "./loadProgress";

export { createSceneTextSearcher, createTextSearchController } from "./textSearch";

export type {
  SceneTextSearcher,
  SceneTextSearchOptions,
  TextSearchController,
  TextSearchControllerOptions,
  TextSearchMatch,
  TextSearchState
} from "./textSearch";

export type { HeprTextSearchMatch } from "./threePdfObject";

export { createTextSelectionController } from "./textSelection";

export type {
  TextSelectionAdapter,
  TextSelectionCaret,
  TextSelectionController,
  TextSelectionOptions,
  TextSelectionPoint,
  TextSelectionRange
} from "./textSelection";

export { computeCharQuad, computeCharRangeBounds } from "./sceneTextGeometry";

export type { SearchHighlightSet } from "./rendererTypes";

export type { PageTextIndex, SceneTextIndex } from "./pdfVectorExtractor";

export type {
  VectorStrokeLodAsyncBuildOptions,
  VectorStrokeLodBuildProgress,
  VectorStrokeLodBuildTiming,
  VectorStrokeLodStats,
  VectorLodMode
} from "./vectorStrokeLod";

export {
  consumeVectorStrokeLodBuildTiming,
  prebuildVectorStrokeLodRuntime,
  resetVectorStrokeLodBuildTiming,
  VECTOR_STROKE_LOD_MIN_SEGMENTS,
  VECTOR_STROKE_LOD_TARGET_VISIBLE_SEGMENTS,
  VECTOR_STROKE_LOD_TOLERANCES
} from "./vectorStrokeLod";

export type { LoadedPdfScene } from "./pdfObjectGenerator";

export type { Bounds, SceneTextItem, VectorScene } from "./pdfVectorExtractor";

export { detectRooms } from "./roomDetector";

export type {
  DetectedRoom,
  RoomDetectionDebugInfo,
  RoomDetectionOptions,
  RoomDetectionPageStats,
  RoomDetectionRegionDebug,
  RoomDetectionResult,
  RoomSeed,
  RoomSeedFailure,
  RoomSeedFailureReason
} from "./roomDetector";
