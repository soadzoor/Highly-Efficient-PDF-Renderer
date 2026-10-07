import {
  loadPdfSceneFromSource,
  type PdfObjectGeneratorOptions,
  type PdfObjectSource,
  type PdfObjectSourceKind
} from "./pdfObjectGenerator";
import {
  createThreePdfObject as createThreePdfObjectFromLoadedScene,
  type ThreePdfSceneSource,
  type HeprRendererType,
  type ThreeColorCompositing,
  type HeprThreeObjectOptions,
  type HeprColorInput,
  type HeprThreePdfObjectEventMap,
  type HeprThreePdfObject
} from "./threePdfObject";
import {
  createCanvasInteractionController,
  type CanvasInteractionController
} from "./canvasInteractions";
import { createLoadProgressReporter, type LoadProgressCallback, type LoadProgressReporter } from "./loadProgress";
import { hasStoredVectorStrokeLod, reserveVectorStrokeLodRuntime, type VectorStrokeLodRuntimeReservation } from "./vectorStrokeLodCore";
import { prebuildTextLod } from "./textLodCore";
import { yieldForLoad } from "./loadCancellation";
import type { VectorScene } from "./pdfVectorExtractor";
import type { RoomDetectionOptions, RoomDetectionResult } from "./roomDetector";

/**
 * Combined options for `pdfObjectGenerator`.
 *
 * This includes source parsing options such as `segmentMerge` plus three.js
 * object options such as `vectorLod` and colors.
 */
export interface PdfObjectGeneratorRuntimeOptions
  extends PdfObjectGeneratorOptions,
    Omit<HeprThreeObjectOptions, "rendererType"> {}

/** Options for rendering a compiled VectorScene, without loading a PDF or HEP. */
export interface CreateThreePdfObjectOptions extends HeprThreeObjectOptions {
  /** Label exposed on the returned object. Defaults to "Vector scene". */
  sourceLabel?: string;
  /** Cancels LOD preparation and object creation. */
  signal?: AbortSignal;
  /** Reports LOD preparation and upload progress with sourceType: "scene". */
  onProgress?: LoadProgressCallback;
}

export { buildStrokeScene } from "./strokeSceneBuilder";
export type { StrokeScenePoint, StrokeSceneStyle, StrokeScenePolyline } from "./strokeSceneBuilder";

const LOAD_PROGRESS_SCENE_END = 0.34;
const LOAD_PROGRESS_VECTOR_LOD_START = 0.38;
const LOAD_PROGRESS_VECTOR_LOD_END = 0.66;
const LOAD_PROGRESS_TEXT_LOD_START = LOAD_PROGRESS_VECTOR_LOD_END;
const LOAD_PROGRESS_TEXT_LOD_END = 0.96;
const LOAD_PROGRESS_UPLOAD = 0.98;

/**
 * Load a PDF or HEP parsed-data file and return a three.js object.
 *
 * This is the package's public PDF-object construction entry point for
 * three.js applications. The returned object is a `THREE.Group`; add it to
 * your scene and render normally.
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
 *   textLod: "auto",
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
 * @param source PDF/HEP bytes, a `File`/`Blob`, a URL/path string, or a base64 string.
 * @param options Parsing and three.js rendering options.
 * @param rendererType Native backend to use internally. Defaults to `"webgl"`.
 */
export async function pdfObjectGenerator(
  source: PdfObjectSource,
  options: PdfObjectGeneratorRuntimeOptions = {},
  rendererType: HeprRendererType = "webgl"
): Promise<HeprThreePdfObject> {
  const signal = options.signal;
  signal?.throwIfAborted();
  let loadedScene: Awaited<ReturnType<typeof loadPdfSceneFromSource>> | undefined;
  try {
    const progress = createLoadProgressReporter(options.onProgress);
    loadedScene = await loadPdfSceneFromSource(source, {
      ...options,
      onProgress: progress.child(0, LOAD_PROGRESS_SCENE_END).toCallback()
    }, signal, true);
    signal?.throwIfAborted();
    return await prepareThreePdfObject(loadedScene, { ...options, rendererType }, progress);
  } catch (error) {
    await loadedScene?.pageDemand?.close();
    signal?.throwIfAborted();
    throw error;
  }
}

/**
 * Render a compiled scene (for example, buildStrokeScene(polylines)) as a THREE.Group.
 * Prepares camera-driven LOD without parsing or serializing a document. The group
 * is centered on scene.pageBounds, just like pdfObjectGenerator's result.
 * The background is transparent by default. Add the group to your Three.js scene,
 * render normally, and call removeFromParent() and dispose() when finished.
 * Do not modify the supplied scene's buffers while it is in use.
 */
export async function createThreePdfObject(
  scene: VectorScene,
  options: CreateThreePdfObjectOptions = {}
): Promise<HeprThreePdfObject> {
  options.signal?.throwIfAborted();
  const progress = createLoadProgressReporter(options.onProgress);
  return prepareThreePdfObject({
    scene,
    sourceLabel: options.sourceLabel ?? "Vector scene",
    sourceKind: "scene"
  }, { ...options, pageBackgroundOpacity: options.pageBackgroundOpacity ?? 0 }, progress);
}

async function prepareThreePdfObject(
  loadedScene: ThreePdfSceneSource,
  options: CreateThreePdfObjectOptions,
  progress: LoadProgressReporter
): Promise<HeprThreePdfObject> {
  const signal = options.signal;
  const rendererType = options.rendererType ?? "webgl";
  const sourceType = loadedScene.sourceKind;
  let vectorLodReservation: VectorStrokeLodRuntimeReservation | null = null;
  try {
    signal?.throwIfAborted();
    const vectorLodStage = hasStoredVectorStrokeLod(loadedScene.scene) ? "vector-lod-restore" : "vector-lod";
    progress.report(LOAD_PROGRESS_VECTOR_LOD_START, { stage: vectorLodStage, sourceType });
    vectorLodReservation = await reserveVectorStrokeLodRuntime(loadedScene.scene, options.vectorLod ?? "auto", rendererType, {
      yieldIntervalMs: 50,
      signal,
      shouldCancel: () => signal?.aborted === true,
      onProgress: (lodProgress) => {
        const value =
          LOAD_PROGRESS_VECTOR_LOD_START +
          lodProgress.value * (LOAD_PROGRESS_VECTOR_LOD_END - LOAD_PROGRESS_VECTOR_LOD_START);
        progress.report(value, { stage: vectorLodStage, sourceType });
      }
    });
    signal?.throwIfAborted();
    progress.report(LOAD_PROGRESS_TEXT_LOD_START, { stage: "text-lod", sourceType });
    if (options.textLod !== "off") {
      await prebuildTextLod(loadedScene.scene, {
        yieldIntervalMs: 50,
        signal,
        onProgress: (lodProgress) => {
          const value =
            LOAD_PROGRESS_TEXT_LOD_START +
            lodProgress.value * (LOAD_PROGRESS_TEXT_LOD_END - LOAD_PROGRESS_TEXT_LOD_START);
          progress.report(value, { stage: "text-lod", sourceType });
        }
      });
    } else {
      progress.report(LOAD_PROGRESS_TEXT_LOD_END, { stage: "text-lod", sourceType });
    }
    signal?.throwIfAborted();
    progress.report(LOAD_PROGRESS_UPLOAD, { stage: "upload", sourceType });
    await yieldForLoad(signal);
    const object = await createThreePdfObjectFromLoadedScene(loadedScene, {
      ...options,
      rendererType
    }, signal, vectorLodReservation);
    try {
      signal?.throwIfAborted();
      progress.complete({ sourceType });
      signal?.throwIfAborted();
      return object;
    } catch (error) {
      try {
        object.dispose();
      } catch {
        // Keep the original cancellation/progress error.
      }
      throw error;
    }
  } catch (error) {
    signal?.throwIfAborted();
    throw error;
  } finally {
    vectorLodReservation?.release();
  }
}

export { createCanvasInteractionController };

export {
  CORE_STROKE_VERTEX_SHADER_SOURCE,
  CORE_STROKE_FRAGMENT_SHADER_SOURCE,
  CORE_FILL_VERTEX_SHADER_SOURCE,
  CORE_FILL_FRAGMENT_SHADER_SOURCE,
  CORE_TEXT_VERTEX_SHADER_SOURCE,
  CORE_TEXT_FRAGMENT_SHADER_SOURCE,
  CORE_BLIT_VERTEX_SHADER_SOURCE,
  CORE_VECTOR_COMPOSITE_FRAGMENT_SHADER_SOURCE,
  CORE_RASTER_VERTEX_SHADER_SOURCE,
  CORE_RASTER_FRAGMENT_SHADER_SOURCE
} from "./coreShaders";

export type {
  PdfObjectSource,
  PdfObjectSourceKind,
  PdfObjectGeneratorOptions,
  HeprRendererType,
  ThreeColorCompositing,
  HeprThreeObjectOptions,
  HeprColorInput,
  HeprThreePdfObjectEventMap,
  HeprThreePdfObject,
  CanvasInteractionController
};

export { buildHep } from "./hepBuilder";
export { isPdfPasswordError } from "./pdfObjectGenerator";
export type { PdfPasswordError, PdfPasswordErrorReason } from "./pdfObjectGenerator";
export { createAnnotationOverlay, pickSceneAnnotation } from "./annotationOverlay";
export type { AnnotationOverlay, AnnotationOverlayOptions, AnnotationOverlayAdapter, AnnotationPoint } from "./annotationOverlay";
export type { PdfAnnotation, SceneAnnotation, ScenePdfPage, AnnotationGeometry, AnnotationAction,
  AnnotationDestination, AnnotationField, AnnotationBorder, AnnotationAppearanceMode } from "./annotationData";
export { annotationLayerId } from "./annotationLayers";
export type { SceneContentItem, SceneMarkedContent, StructureElement, StructureUserProperty } from "./structureData";

export type {
  PdfIccOptions,
  NativeIccTransformResolver,
  NativeIccTransformRequest,
  NativeIccTransformResult,
  NativeIccProfileMetadata
} from "./pdf/nativeIcc";
export type {
  NativeImageCodec,
  NativeImageCodecResolver,
  NativeImageCodecRequest,
  NativeImageCodecResult,
  CodecMetadataRecord,
  CodecMetadataValue
} from "./pdf/nativeImage";
export type { PdfDiagnostic } from "./pdf/nativeTypes";

export type {
  BuildHepFromPdfOptions,
  BuildHepFromSceneOptions,
  HepCompression,
  HepEncodingOptions
} from "./hepBuilder";

export type {
  LoadProgressCallback,
  PDFLoadExecutionPath,
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
export type { HeprPageOverlapMode } from "./threePdfObject";
export type { PrimitivePickOptions, AnnotationPickOptions } from "./threePdfObject";
export type { AnnotationHit } from "./sceneAnnotationInteraction";
export type {
  PrimitiveKind, PrimitiveRef, PrimitivePoint, PrimitiveSegment, PrimitiveSegmentStyle, PrimitiveInfo, PrimitiveHit, PrimitiveOptionalContent
} from "./scenePrimitives";
export type { GradientMeshTriangle } from "./gradientMesh";
export { OptionalContentController } from "./optionalContent";
export type { OptionalContentLayer, OptionalContentSnapshot, OptionalContentListener, LayerVisibilityChange,
  LayerVisibilitySummary, OptionalContentControllerOptions, OptionalContentUpdateOptions, AnnotationLayerVisibility } from "./optionalContent";
export type { SceneOptionalContent, OptionalContentGroup, OptionalContentCondition, OptionalContentOrderNode } from "./optionalContentData";
export type { ScenePaintGraph, ScenePaintNode, ScenePaintDraw, ScenePaintGroup, ScenePaintMask, ScenePaintRetained } from "./scenePaintGraph";
export type { SceneRetainedPage } from "./retainedPageData";
export { createLayerVisibilityController } from "./layerVisibility";
export type { LayerVisibilityController, LayerVisibilityOptions } from "./layerVisibility";
export { createPdfLayerControls } from "./pdfLayerControls";
export type { PdfLayerControlsOptions } from "./pdfLayerControls";
export { createPdfAnnotationControls } from "./pdfAnnotationControls";
export type { PdfAnnotationControls, PdfAnnotationControlsController, PdfAnnotationControlsOptions } from "./pdfAnnotationControls";
export { createThreePdfLayerControls } from "./threePdfLayerControls";
export type { ThreePdfLayerControlsOptions } from "./threePdfLayerControls";
export { isSceneTextCharVisible } from "./optionalContentText";
export type { PrimitiveColorInput, PrimitiveOverride } from "./primitiveAppearance";
export { createPrimitiveInteractionController } from "./primitiveInteraction";
export { createThreePrimitiveInteractionController } from "./threePrimitiveInteraction";
export type {
  PrimitiveInteractionCallbacks, PrimitiveInteractionController, PrimitiveInteractionOptions
} from "./primitiveInteraction";
export type { ThreePrimitiveInteractionOptions } from "./threePrimitiveInteraction";

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

export type {
  TextLodMode,
  TextLodStats
} from "./textLodCore";

export type {
  TextLodAsyncBuildOptions,
  TextLodBuildData,
  TextLodBuildProgress,
  TextLodBuildResult,
  TextLodCluster,
  TextLodPageNode,
  TextLodRun
} from "./textGreekLod";

export {
  getCachedTextLod,
  prebuildTextLod,
  TEXT_LOD_COARSE_ENTER_PX,
  TEXT_LOD_EXACT_ENTER_PX,
  TEXT_LOD_SOFT_EXACT_GLYPH_BUDGET
} from "./textLodCore";

export {
  consumeVectorStrokeLodBuildTiming,
  prebuildVectorStrokeLodRuntime,
  resetVectorStrokeLodBuildTiming,
  VECTOR_STROKE_LOD_MIN_SEGMENTS,
  VECTOR_STROKE_LOD_TARGET_VISIBLE_SEGMENTS,
  VECTOR_STROKE_LOD_TOLERANCES
} from "./vectorStrokeLod";

export type { Bounds, SceneTextItem, VectorScene } from "./pdfVectorExtractor";

/**
 * Load the optional room detector on first use, then detect closed wall-bounded
 * regions in a vector scene. Browser detection runs in a worker so the UI stays
 * responsive; non-browser environments without Worker run on the calling thread.
 *
 * Await the result: `const result = await detectRooms(pdfObject.sceneData)`.
 * Pass `options.signal` to cancel an active browser worker.
 */
export async function detectRooms(
  scene: VectorScene,
  options: RoomDetectionOptions = {}
): Promise<RoomDetectionResult> {
  options.signal?.throwIfAborted();
  const { detectRoomsInWorker } = await import("./roomDetectorClient");
  return detectRoomsInWorker(scene, options);
}

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
