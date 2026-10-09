import {
  createNativeCompositeSurfaceFactory,
  createSelectiveCompositePage,
  renderNativeCompositeCommandSpan,
  renderNativeCompositePixels,
  renderNativeRetainedCommandSpan,
  type NativeSelectiveRasterLayer
} from "./retainedPageCompositor";
import { rectangleVectorClip } from "./pdf/nativeVectorClips";
import { buildNativeRasterPage, buildNativeFallbackTextIndex } from "./pdf/nativeRasterPage";
import { lowerRetainedPageToVectorScene, type RetainedTextPositions } from "./retainedVectorPage";
import { attachRetainedTextOptionalContent } from "./retainedOptionalContentText";
import { defaultVectorDrawRuns } from "./vectorDrawOrder";
import {
  DENSE_PDF_VECTOR_SCENE_EVENT_FILL,
  DENSE_PDF_VECTOR_SCENE_EVENT_STROKE,
  DENSE_PDF_VECTOR_SCENE_EVENT_GRADIENT,
  DENSE_PDF_VECTOR_SCENE_EVENT_COMPOSITE,
  DENSE_PDF_VECTOR_SCENE_EVENT_FORM,
  DENSE_PDF_VECTOR_SCENE_EVENT_GLYPH,
  DENSE_PDF_VECTOR_SCENE_EVENT_IMAGE,
  DENSE_PDF_VECTOR_SCENE_EVENT_ORDINARY_PAINT,
  DENSE_PDF_VECTOR_SCENE_GLYPH_FLAG_CLIPPED,
  DENSE_PDF_VECTOR_SCENE_IMAGE_FLAG_SELECTIVE_PATH_SPAN,
  DENSE_PDF_STROKE_STYLE_FLAG_CLIPPED,
  DENSE_PDF_PAINT_RUN_FILL,
  DENSE_PDF_PAINT_RUN_FORM,
  DENSE_PDF_PAINT_RUN_GLYPH,
  DENSE_PDF_PAINT_RUN_IMAGE,
  DENSE_PDF_PAINT_RUN_PATH,
  DENSE_PDF_PAINT_RUN_STROKE,
  DensePdfResourceLimitError,
  DensePdfSyntaxError,
  DensePdfUnsupportedError,
  compileDensePdfContent,
  compileGroupedVectorPageContent,
  compileVectorFormContent,
  type DensePdfBounds,
  type DensePdfColorSpaceDefinition,
  type DensePdfColorSpaceResolver,
  type DensePdfCompiledPage,
  type DensePdfContentSegment,
  type DensePdfContentInputOptions,
  type DensePdfExtGStateDefinition,
  type DensePdfInitialGraphicsState,
  type DensePdfVectorSceneData,
  type DensePdfMarkedContentPropertyDefinition,
  type DensePdfMatrix,
  type DensePdfPatternColorSpaceDefinition,
  type DensePdfPatternDefinition,
  DensePdfStreamingUnsupportedError,
  type DensePdfResourceLoader,
  type DensePdfResourceReferences,
  type DensePdfTextClip,
  type DensePdfTextOperatorContext
} from "./pdf/nativeContentCompiler";
import {
  scanPreparedResourceReferencesFastOrExact,
  tryScanFastPreparedResourceReferences
} from "./pdf/nativeFastResourceScanner";
import {
  createHeprPageDataFromDense,
  getHeprCommandPaintSourceIdentity,
  type DensePdfCompositingPageData,
  type DensePdfFormPageData,
  type DensePdfFormProgramData,
  type DensePdfPatternPageData,
  type DensePdfPatternProgramData,
  type DensePdfType3PageData,
  type DensePdfType3ProgramData
} from "./densePdfPageData";
import {
  HEPR_GLYPH_FLAG,
  HEPR_DOCUMENT_DATA_VERSION,
  HEPR_PAINT_KIND,
  HEPR_VIEW_TRANSFORM_FLAG,
  type HeprDocumentData,
  type HeprDisplayCommand,
  type HeprOptionalContentStore,
  type HeprPageData,
  type HeprTextIndex,
  type PdfBox,
  type PdfCompileOptions,
  type PdfCompilePagesOptions,
  type PdfDocumentInfo,
  type PdfPageInfo,
  type PdfMatrix,
  type PdfProgress
} from "./heprDocumentData";
import {
  HEPR_DATA_VALIDATION_CODES,
  HeprDataValidationError,
  validateHeprPageData
} from "./heprDocumentDataValidation";
import {
  NativePdfDocument,
  PdfError,
  isPdfDictionary,
  isPdfName,
  isPdfStream,
  isPdfString,
  createNativeOptionalContentRegistry,
  openNativePdfDocument,
  type NativePdfOpenOptions,
  type NativePdfPage,
  type PdfDictionary,
  type PdfDiagnostic,
  type PdfResourceLimits,
  type PdfSource,
  type PdfStream,
  type PdfValue
} from "./pdf/nativePdf";
import type { NativeOptionalContentRegistry } from "./pdf/nativeOptionalContent";
import type { NativeMissingFontResolver } from "./pdf/nativeFont";
import { NativePageFontRegistry } from "./pdf/nativeFontResources";
import {
  NativeTextCompiler,
  type NativeTextCompilation,
  type NativeTextDrawRun,
  type NativeTextFontResource
} from "./pdf/nativeText";
import { buildNativePageTextResources } from "./pdf/nativePageText";
import { computeNativePdfPageGeometry } from "./pdf/nativePageGeometry";
import {
  NativePdfType3Registry,
  type NativePdfType3GlyphInvocation
} from "./pdf/nativeType3";
import {
  NativePdfImageRegistry,
  type NativeImageCodecResolver
} from "./pdf/nativeImage";
import { createBundledImageCodecResolver } from "./pdf/nativeJpegCodec";
import {
  DEFAULT_NATIVE_INLINE_IMAGE_LIMITS,
  prepareNativeInlineImages,
  type NativeInlineImageRecord,
  type NativeInlineImageResult
} from "./pdf/nativeInlineImage";
import { NativePdfColorRegistry } from "./pdf/nativeColor";
import { validateIccEngine, type NativeIccTransformResolver, type PdfIccOptions } from "./pdf/nativeIcc";
import { NativePdfShadingRegistry } from "./pdf/nativeShadings";
import { resolveNativeSolidPattern } from "./pdf/nativeSolidPatterns";
import { supportedNativeVectorShadings } from "./pdf/nativeVectorGradients";
import {
  NativePdfExtGStateRegistry,
  type NativePdfExtGStateDescription,
  type NativePdfSoftMaskDefinition
} from "./pdf/nativeExtGState";
import {
  NativePdfPatternRegistry,
  type NativePdfPatternInvocation
} from "./pdf/nativePatterns";
import {
  NATIVE_PDF_ANNOTATION_VIEW_FLAGS,
  NativePdfFormAppearanceRegistry
} from "./pdf/nativeForms";
import { NativePdfAppearanceSynthesizer } from "./pdf/nativeAppearanceSynthesis";
import {
  buildNativePdfFormDefinitionGraph,
  buildNativePdfResourceFormDefinitionGraph,
  NativePdfFormGraphBuilder,
  buildNativePdfScopedFormDefinitionGraph,
  classifyNativePdfXObjectReferences,
  type NativePdfFormDefinition,
  type NativePdfFormDefinitionGraph,
  type NativePdfXObjectReference
} from "./pdf/nativeFormPrograms";
import { callerOrdinaryPaintIsDisjointFromForm } from "./pdf/nativeVectorFormOrder";
import {
  multiplyNativePdfMatrices,
  transformNativePdfRectangle
} from "./pdf/nativeFormGeometry";
import type { VectorScene } from "./pdfVectorExtractor";
import { buildNativeVectorPage } from "./pdf/nativeVectorPage";

import { placeSceneAnnotation, validateAnnotationAppearanceMode, type PdfAnnotation } from "./annotationData";
import { NativePdfAnnotationMetadataRegistry } from "./pdf/nativeAnnotations";
import { NativePdfStructureTree } from "./pdf/nativeStructure";

export { renderNativeRetainedCommandSpan };
export const computePageGeometry = computeNativePdfPageGeometry;

export interface OpenPdfOptions extends PdfIccOptions {
  /** Strict parsing always runs first. `safe` allows one bounded xref repair scan. */
  readonly repair?: "off" | "safe";
  /** User or owner password for a PDF that requires one to open. */
  readonly password?: string;
  readonly limits?: Partial<PdfResourceLimits>;
  readonly signal?: AbortSignal;
  readonly onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
  readonly onProgress?: PdfCompileOptions["onProgress"];
  /** Deterministic substitutes for missing fonts and unsupported embedded Type1 outlines. */
  readonly missingFontResolver?: NativeMissingFontResolver;
  /** Focused decoder bridge returning validated packed image samples. */
  readonly imageCodecResolver?: NativeImageCodecResolver;
}

export interface ParsePdfOptions extends OpenPdfOptions {
  readonly sourcePageIndexes?: readonly number[];
  readonly optimization?: PdfCompileOptions["optimization"];
}

export interface PdfSession {
  readonly info: Readonly<PdfDocumentInfo>;
  getPageAnnotations(sourcePageIndex: number, options?: { signal?: AbortSignal }): Promise<readonly PdfAnnotation[]>;
  compilePage(sourcePageIndex: number, options?: PdfCompileOptions): Promise<HeprPageData>;
  compilePages(options?: PdfCompilePagesOptions): AsyncIterable<HeprPageData>;
  getDiagnostics(): readonly PdfDiagnostic[];
  close(): Promise<void>;
}

/** @internal Native parser output that targets the established renderer ABI. */
export interface NativeVectorPdfSession extends PdfSession {
  compileVectorPage(
    sourcePageIndex: number,
    options?: NativeVectorCompileOptions
  ): Promise<VectorScene>;
}

/** @internal Established-renderer controls which are intentionally absent from the page-native API. */
export interface NativeVectorCompileOptions extends PdfCompileOptions {
  /** Viewing approximation: draw stored text with substitute fonts and skip image decoding. */
  readonly ocrTextOnly?: boolean;
  /** Content-aware overview: preserve vectors, use OCR for scans, bound scans without OCR. */
  readonly previewMaxDimension?: number;
  /** Internal capability probes can require direct vector output. Normal loading falls back to pixels. */
  readonly vectorFallback?: "raster" | "error";
  /** Internal compatibility retry for features still using the grouped bridge. */
  readonly preserveDrawingOrder?: boolean;
  /** Retain all layers for viewer output; internal static fallback can opt out. */
  readonly retainOptionalContent?: boolean;
  /** Internal vector expansion budget, independent of parser safety limits. */
  readonly retainedVectorMaxPatternCells?: number;
  readonly enableSegmentMerge?: boolean;
  readonly enableInvisibleCull?: boolean;
}

interface NativeVectorCompileTimings {
  decodeMs: number;
  inlinePreparationMs: number;
  inlinePreparationSkipped: boolean;
  resourceScanMs: number;
  resourceLoadMs: number;
  fontLoadMs: number;
  imageLoadMs: number;
  preparedFonts: number;
  decodedImages: number;
  decodedImageBytes: number;
  compileScanMs: number;
  compileFinalizeMs: number;
  vectorSceneAdaptationMs: number;
  formOccurrenceCacheHits: number;
  formOccurrenceCacheMisses: number;
  selectiveCompileMs: number;
  selectiveRasterMs: number;
  selectiveCompositing?: import("./heprCanvas2dRenderer").HeprCanvas2dTimings;
  selectiveCompilation?: Readonly<NativeVectorCompileTimings>;
}

interface NativeVectorCompileProfile {
  readonly scene: VectorScene;
  readonly timings: Readonly<NativeVectorCompileTimings>;
}

function createNativeVectorCompileTimings(): NativeVectorCompileTimings {
  return {
    decodeMs: 0,
    inlinePreparationMs: 0,
    inlinePreparationSkipped: false,
    resourceScanMs: 0,
    resourceLoadMs: 0,
    fontLoadMs: 0,
    imageLoadMs: 0,
    preparedFonts: 0,
    decodedImages: 0,
    decodedImageBytes: 0,
    compileScanMs: 0,
    compileFinalizeMs: 0,
    vectorSceneAdaptationMs: 0,
    formOccurrenceCacheHits: 0,
    formOccurrenceCacheMisses: 0,
    selectiveCompileMs: 0,
    selectiveRasterMs: 0
  };
}

function nativeVectorTimingNow(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

function measurePreparedResources(
  timings: NativeVectorCompileTimings | undefined,
  fonts: NativePageFontRegistry,
  images: NativePdfImageRegistry,
  initialFonts = 0,
  initialImages = 0
): void {
  if (!timings) return;
  timings.preparedFonts = fonts.resources.length - initialFonts;
  for (let index = initialImages; index < images.size; index += 1) {
    const image = images.describe(index);
    if (image.codecRequest) continue; // Deferred codec requests have no decoded pixels yet.
    timings.decodedImages += 1;
    timings.decodedImageBytes += image.data.byteLength;
  }
}

/** Open the dependency-free PDF structure engine and resolve page metadata. */
export async function openPdf(
  source: PdfSource,
  options: OpenPdfOptions = {}
): Promise<PdfSession> {
  throwIfSessionAborted(options.signal);
  const ownedSource = createSessionOwnedSource(source);
  let document: NativePdfDocument | null = null;
  try {
    options.onProgress?.(progress(
      "source-read", 0, null, null, 0, sourceByteLength(ownedSource)
    ));
    throwIfSessionAborted(options.signal);
    const nativeOptions: NativePdfOpenOptions = {
      repair: options.repair,
      password: options.password,
      limits: options.limits,
      signal: options.signal,
      onDiagnostic: options.onDiagnostic
    };
    document = await openNativePdfDocument(ownedSource, nativeOptions);
    options.onProgress?.(progress(
      "xref",
      1,
      1,
      null,
      document.info.byteLength,
      document.info.byteLength
    ));
    const info = await buildDocumentInfo(document, options.signal);
    options.onProgress?.(progress(
      "catalog",
      info.pageCount,
      info.pageCount,
      null,
      info.byteLength,
      info.byteLength
    ));
    const optionalContent = await createNativeOptionalContentRegistry(document, {
      signal: options.signal,
      onDiagnostic: options.onDiagnostic
    });
    options.onProgress?.(progress(
      "page",
      info.pageCount,
      info.pageCount,
      null,
      info.byteLength,
      info.byteLength
    ));
    throwIfSessionAborted(options.signal);
    return new NativePdfSession(
      document,
      info,
      options.onProgress,
      options.onDiagnostic,
      options.missingFontResolver,
      options.imageCodecResolver,
      options.iccTransformResolver,
      optionalContent,
      options.iccEngine
    );
  } catch (error) {
    if (document) await document.close().catch(() => undefined);
    else await closeSessionOwnedSource(ownedSource).catch(() => undefined);
    throw error;
  }
}

/** Parse all requested pages atomically and always close the underlying session. */
export async function parsePdf(
  source: PdfSource,
  options: ParsePdfOptions = {}
): Promise<HeprDocumentData> {
  const session = await openPdf(source, options);
  let failed = false;
  try {
    const pages: HeprPageData[] = [];
    for await (const page of session.compilePages({
      sourcePageIndexes: options.sourcePageIndexes,
      signal: options.signal,
      limits: options.limits,
      optimization: options.optimization,
      onProgress: options.onProgress
    })) {
      pages.push(page);
    }
    return {
      kind: "hepr-document",
      version: HEPR_DOCUMENT_DATA_VERSION,
      info: session.info,
      pages,
      diagnostics: session.getDiagnostics()
    };
  } catch (error) {
    failed = true;
    throw error;
  } finally {
    try {
      await session.close();
    } catch (closeError) {
      // Preserve the parser/compiler failure as the primary atomic result.
      // A close failure still rejects an otherwise successful parse.
      if (!failed) throw closeError;
    }
  }
}

/**
 * A retained page program exists only so PDF layer toggles can replay a raster
 * slot: `RetainedPageReplay` re-renders a span when an optional-content
 * snapshot changes its visibility bytes. Without toggleable conditions every
 * `optionalContentConditions` entry is `-1`, the visibility map can never
 * differ, and the retained page — including its decoded image store — is
 * unreachable weight in an exported HEP.
 */
function retainedReplayIsReachable(
  optionalContent: VectorScene["optionalContent"],
  page: HeprPageData
): boolean {
  return optionalContent !== undefined && page.stores.optionalContent.defaultVisible.length > 0;
}

class NativePdfSession implements NativeVectorPdfSession {
  readonly info: Readonly<PdfDocumentInfo>;

  private readonly lifetime = new AbortController();
  private readonly diagnostics: PdfDiagnostic[];
  private readonly diagnosticKeys = new Set<string>();
  private readonly document: NativePdfDocument;
  private readonly formRegistry: NativePdfFormAppearanceRegistry;
  private readonly annotationMetadata: NativePdfAnnotationMetadataRegistry;
  private readonly structure: NativePdfStructureTree;
  private readonly appearanceSynthesizer: NativePdfAppearanceSynthesizer;
  private readonly optionalContent: NativeOptionalContentRegistry;
  private readonly defaultProgress?: PdfCompileOptions["onProgress"];
  private readonly onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
  private readonly missingFontResolver?: NativeMissingFontResolver;
  private readonly imageCodecResolver?: NativeImageCodecResolver;
  private readonly iccTransformResolver?: NativeIccTransformResolver;
  private readonly iccEngine: NonNullable<PdfIccOptions["iccEngine"]>;
  private operationTail: Promise<void> = Promise.resolve();
  private closePromise: Promise<void> | null = null;
  private closed = false;

  constructor(
    document: NativePdfDocument,
    info: PdfDocumentInfo,
    defaultProgress?: PdfCompileOptions["onProgress"],
    onDiagnostic?: (diagnostic: PdfDiagnostic) => void,
    missingFontResolver?: NativeMissingFontResolver,
    imageCodecResolver?: NativeImageCodecResolver,
    iccTransformResolver?: NativeIccTransformResolver,
    optionalContent?: NativeOptionalContentRegistry,
    iccEngine?: PdfIccOptions["iccEngine"]
  ) {
    this.document = document;
    if (!optionalContent) {
      throw new TypeError("NativePdfSession requires an initialized optional-content registry.");
    }
    this.optionalContent = optionalContent;
    this.formRegistry = new NativePdfFormAppearanceRegistry(document, { optionalContent });
    this.annotationMetadata = new NativePdfAnnotationMetadataRegistry(document, this.formRegistry, optionalContent,
      diagnostic => this.appendDiagnostics([diagnostic]));
    this.structure = new NativePdfStructureTree(document, diagnostic => this.appendDiagnostics([diagnostic]));
    this.appearanceSynthesizer = new NativePdfAppearanceSynthesizer(document, {
      missingFontResolver,
      optionalContent
    });
    this.defaultProgress = defaultProgress;
    this.info = deepFreezeInfo(info);
    this.diagnostics = [...document.getDiagnostics()];
    this.diagnostics.push(...optionalContent.getDiagnostics());
    for (const diagnostic of this.diagnostics) {
      this.diagnosticKeys.add(diagnosticKey(diagnostic));
    }
    this.onDiagnostic = onDiagnostic;
    this.missingFontResolver = missingFontResolver;
    this.imageCodecResolver = imageCodecResolver;
    this.iccTransformResolver = iccTransformResolver;
    this.iccEngine = validateIccEngine(iccEngine);
  }

  async getPageAnnotations(sourcePageIndex: number, options: { signal?: AbortSignal } = {}): Promise<readonly PdfAnnotation[]> {
    const signal = combineSignals(this.lifetime.signal, options.signal);
    let release: (() => void) | null = null;
    try {
      release = await this.acquireOperation(signal);
      const annotations = structuredClone(await this.annotationMetadata.getPageAnnotations(sourcePageIndex, signal));
      this.appendDiagnostics(this.formRegistry.getDiagnostics());
      return annotations;
    } catch (error) { throw normalizeAbortError(error, signal); }
    finally { release?.(); }
  }

  async compilePage(
    sourcePageIndex: number,
    options: PdfCompileOptions = {}
  ): Promise<HeprPageData> {
    validateAnnotationAppearanceMode(options.annotationAppearances);
    const operation = new AbortController();
    const signal = combineSignals(this.lifetime.signal, operation.signal, options.signal);
    let release: (() => void) | null = null;
    try {
      release = await this.acquireOperation(signal);
      return await this.compilePageUnlocked(sourcePageIndex, options, signal);
    } catch (error) {
      throw normalizeAbortError(error, signal);
    } finally {
      operation.abort(new PdfError("aborted", "The PDF page operation ended."));
      release?.();
    }
  }

  async compileVectorPage(
    sourcePageIndex: number,
    options: NativeVectorCompileOptions = {}
  ): Promise<VectorScene> {
    validateAnnotationAppearanceMode(options.annotationAppearances);
    if (options.previewMaxDimension !== undefined && (!Number.isSafeInteger(options.previewMaxDimension) ||
        options.previewMaxDimension < 16 || options.previewMaxDimension > 4096)) {
      throw new RangeError("Page preview dimensions must be integers from 16 through 4096.");
    }
    const operation = new AbortController();
    const signal = combineSignals(this.lifetime.signal, operation.signal, options.signal);
    let release: (() => void) | null = null;
    try {
      release = await this.acquireOperation(signal);
      if (options.ocrTextOnly) {
        const { compileNativeOcrTextPage } = await import("./pdf/nativeOcrText");
        const scene = await compileNativeOcrTextPage(this.document, sourcePageIndex, options, signal,
          this.missingFontResolver, this.optionalContent, diagnostic => this.appendDiagnostics([diagnostic]));
        scene.pdfOverviewKind = "vector";
        return scene;
      }
      let overviewKind: VectorScene["pdfOverviewKind"];
      if (options.previewMaxDimension !== undefined) {
        const { inspectNativePageOverview } = await import("./pdf/nativePageOverview");
        try {
          overviewKind = await inspectNativePageOverview(this.document, sourcePageIndex, options, signal, this.optionalContent);
        } catch (error) {
          signal.throwIfAborted();
          if (!(error instanceof PdfError || error instanceof DensePdfSyntaxError) ||
              (error instanceof PdfError && (error.code === "resource-limit" || error.code === "aborted"))) throw error;
          overviewKind = "vector";
          this.appendDiagnostics([{ code: "page-overview-inspection-unavailable", severity: "warning", pageIndex: sourcePageIndex,
            message: "Page content could not be classified for an overview; using the normal compatibility renderer.", details: { reason: error.message } }]);
        }
        if (overviewKind === "ocr") {
          try {
            const { compileNativeOcrTextPage } = await import("./pdf/nativeOcrText");
            const overview = await compileNativeOcrTextPage(this.document, sourcePageIndex, options, signal,
              this.missingFontResolver, this.optionalContent, diagnostic => this.appendDiagnostics([diagnostic]));
            if (overview.textInstanceCount > 0 && overview.textIndex?.pages.some(page => /[^\s\ufffd]/u.test(page.text))) {
              overview.pdfOverviewKind = "ocr";
              return overview;
            }
            this.appendDiagnostics([{ code: "page-ocr-overview-unavailable", severity: "warning", pageIndex: sourcePageIndex,
              message: "Stored OCR text has no drawable readable characters; using a bounded scan instead." }]);
          } catch (error) {
            signal.throwIfAborted();
            if (!(error instanceof PdfError || error instanceof DensePdfSyntaxError) ||
                (error instanceof PdfError && (error.code === "resource-limit" || error.code === "aborted"))) throw error;
            this.appendDiagnostics([{ code: "page-ocr-overview-unavailable", severity: "warning", pageIndex: sourcePageIndex,
              message: "Stored OCR text could not supply the overview; using a bounded scan instead.", details: { reason: error.message } }]);
          }
          overviewKind = "raster";
        }
      }
      const scene = await this.compileVectorPageWithLayerFallback(sourcePageIndex, options, signal);
      if (options.previewMaxDimension === undefined) return scene;
      scene.pdfOverviewKind = overviewKind;
      if (overviewKind === "raster") {
        const { buildRasterScenePreview } = await import("./pageRasterPreview");
        return buildRasterScenePreview(scene, options.previewMaxDimension);
      }
      // Unsupported vector paint can still use the existing bounded compatibility fallback.
      // Such a page needs detail later; supported vector pages are complete at every zoom.
      if (scene.rasterLayers.length && !scene.segmentCount && !scene.textInstanceCount && !scene.fillPathCount &&
          !(scene.gradientFillPathCount ?? 0) && !(scene.gradientStrokeRunCount ?? 0) &&
          scene.rasterLayers.some(layer => layer.width <= options.previewMaxDimension! && layer.height <= options.previewMaxDimension! &&
            Math.abs(layer.matrix[0] * layer.matrix[3] - layer.matrix[1] * layer.matrix[2]) >=
              (scene.pageBounds.maxX - scene.pageBounds.minX) * (scene.pageBounds.maxY - scene.pageBounds.minY) * .75)) {
        scene.pdfOverviewKind = "raster";
      }
      return scene;
    } catch (error) {
      throw normalizeAbortError(error, signal);
    } finally {
      operation.abort(new PdfError("aborted", "The PDF vector-page operation ended."));
      release?.();
    }
  }

  /**
   * Toggleable layers also compile content that is hidden by default. When only
   * that content is unusable, open the page in its default view without layer
   * controls instead of refusing it, and say why.
   */
  private async compileVectorPageWithLayerFallback(
    sourcePageIndex: number,
    options: NativeVectorCompileOptions,
    signal: AbortSignal
  ): Promise<VectorScene> {
    try {
      return await this.compileVectorPageUnlocked(sourcePageIndex, options, signal);
    } catch (error) {
      signal.throwIfAborted();
      if (options.retainOptionalContent === false || this.optionalContent.groupCount === 0 ||
          !(error instanceof PdfError) || error.code === "resource-limit" || error.code === "aborted") {
        throw error;
      }
      // When the default view fails as well, its error is why the page cannot
      // open at all.
      const scene = await this.compileVectorPageUnlocked(
        sourcePageIndex,
        { ...options, retainOptionalContent: false },
        signal
      );
      this.appendDiagnostics([{
        code: "optional-content.default-view-fallback",
        severity: "warning",
        pageIndex: sourcePageIndex,
        message: "PDF layers are unavailable on this page because content hidden by default " +
          "could not be compiled; the page shows its default view.",
        details: { code: error.code, reason: error.message }
      }]);
      return scene;
    }
  }

  /** @internal Benchmark-only direct-engine instrumentation. */
  async compileVectorPageWithTimings(
    sourcePageIndex: number,
    options: NativeVectorCompileOptions = {},
    instrumentation: {
      readonly reusePageResources?: boolean;
      readonly reuseCompositeSurfaces?: boolean;
      readonly boundCompositeWork?: boolean;
    } = {}
  ): Promise<NativeVectorCompileProfile> {
    validateAnnotationAppearanceMode(options.annotationAppearances);
    const operation = new AbortController();
    const signal = combineSignals(this.lifetime.signal, operation.signal, options.signal);
    const timings = createNativeVectorCompileTimings();
    let release: (() => void) | null = null;
    try {
      release = await this.acquireOperation(signal);
      const scene = await this.compileVectorPageUnlocked(
        sourcePageIndex,
        options,
        signal,
        timings,
        instrumentation.reusePageResources !== false,
        instrumentation.reuseCompositeSurfaces !== false,
        instrumentation.boundCompositeWork !== false
      );
      return Object.freeze({ scene, timings: Object.freeze({ ...timings }) });
    } catch (error) {
      throw normalizeAbortError(error, signal);
    } finally {
      operation.abort(new PdfError("aborted", "The PDF vector-page profiling operation ended."));
      release?.();
    }
  }

  compilePages(options: PdfCompilePagesOptions = {}): AsyncIterable<HeprPageData> {
    validateAnnotationAppearanceMode(options.annotationAppearances);
    const indexes = normalizePageIndexes(
      options.sourcePageIndexes,
      this.info.pageCount
    );
    const session = this;
    const operation = new AbortController();
    const signal = combineSignals(session.lifetime.signal, operation.signal, options.signal);
    let cursor = 0;
    let finished = false;
    let release: (() => void) | null = null;
    let acquire: Promise<() => void> | null = null;
    let activeNext: Promise<IteratorResult<HeprPageData>> | null = null;

    const releaseOperation = (): void => {
      if (release) {
        const current = release;
        release = null;
        current();
      } else if (acquire) {
        void acquire.then((current) => current(), () => undefined);
        acquire = null;
      }
    };
    const finish = (reason: PdfError): void => {
      if (finished) return;
      finished = true;
      operation.abort(reason);
      if (!activeNext) releaseOperation();
    };
    const next = async (): Promise<IteratorResult<HeprPageData>> => {
      if (activeNext) {
        throw new PdfError("invalid-object", "Concurrent PDF iterator next() calls are not supported.");
      }
      if (finished || cursor >= indexes.length) {
        finish(new PdfError("aborted", "PDF page iteration ended."));
        return { done: true, value: undefined };
      }
      if (!acquire && !release) acquire = session.acquireOperation(signal);
      const currentAcquire = acquire;
      const promise = (async (): Promise<IteratorResult<HeprPageData>> => {
        try {
          if (!release) {
            release = await currentAcquire!;
            acquire = null;
          }
          if (finished) return { done: true, value: undefined };
          signal.throwIfAborted();
          // Work begins only when the caller asks for the next page, providing
          // actual backpressure instead of a background page queue.
          const page = await session.compilePageUnlocked(indexes[cursor], options, signal);
          cursor += 1;
          if (cursor >= indexes.length) {
            finish(new PdfError("aborted", "PDF page iteration completed."));
          }
          return { done: false, value: page };
        } catch (error) {
          const normalized = normalizeAbortError(error, signal);
          finish(new PdfError("aborted", "PDF page iteration failed.", { cause: normalized }));
          throw normalized;
        } finally {
          activeNext = null;
          if (finished) releaseOperation();
        }
      })();
      activeNext = promise;
      return await promise;
    };
    const iterator: AsyncIterator<HeprPageData> & AsyncIterable<HeprPageData> = {
      next,
      async return() {
        finish(new PdfError("aborted", "PDF page iteration ended."));
        return { done: true, value: undefined };
      },
      [Symbol.asyncIterator]() { return this; }
    };
    return iterator;
  }

  getDiagnostics(): readonly PdfDiagnostic[] {
    this.appendDiagnostics(this.document.getDiagnostics(), false);
    this.appendDiagnostics(this.optionalContent.getDiagnostics(), false);
    this.appendDiagnostics(this.appearanceSynthesizer.getDiagnostics(), false);
    return Object.freeze(this.diagnostics.map((diagnostic) => Object.freeze({ ...diagnostic })));
  }

  close(): Promise<void> {
    if (this.closePromise) return this.closePromise;
    this.closed = true;
    this.lifetime.abort(new PdfError("closed", "The PDF session is closed."));
    this.closePromise = this.document.close();
    return this.closePromise;
  }

  private async compilePageUnlocked(
    sourcePageIndex: number,
    options: PdfCompileOptions,
    signal: AbortSignal,
    capturePaintSourceIdentities = false,
    timings?: NativeVectorCompileTimings,
    reuse?: NativePagePreparationReuse
  ): Promise<HeprPageData> {
    this.assertOpen();
    signal.throwIfAborted();
    try {
      const annotations = await this.annotationMetadata.getPageAnnotations(sourcePageIndex, signal);
      const initialFonts = reuse?.prepared?.fontRegistry.resources.length ?? 0;
      const initialImages = reuse?.prepared?.imageResources.registry.size ?? 0;
      const {
        pageInfo,
        compiled,
        textCompiler,
        maxGlyphs,
        fontRegistry,
        formGraph,
        imageResources,
        totalBytes,
        onProgress
      } = await this.preparePageCompilation(
        sourcePageIndex,
        options,
        signal,
        "display-program",
        timings,
        capturePaintSourceIdentities,
        reuse
      );
      if (compiled.paintRuns.length / 3 > (options.limits?.maxCommandsPerPage ?? this.document.limits.maxCommandsPerPage)) {
        throw new PdfError("resource-limit", "The page exceeds the configured display-command limit.", {
          details: { sourcePageIndex, commandCount: compiled.paintRuns.length / 3 }
        });
      }
      const textCompilation = textCompiler.build();
      const textAccumulator = new NativePageTextAccumulator(maxGlyphs);
      textAccumulator.append(textCompilation);
      const initialFormPrograms = await compileNativeFormPrograms(
        this.document,
        formGraph,
        compiled,
        imageResources,
        options,
        sourcePageIndex,
        signal,
        this.optionalContent,
        fontRegistry,
        textAccumulator,
        true
      );
      const nestedPrograms = await compileNativeType3Programs(
        this.document,
        compiled,
        initialFormPrograms,
        imageResources,
        options,
        sourcePageIndex,
        signal,
        this.optionalContent,
        this.formRegistry,
        fontRegistry,
        textAccumulator
      );
      const compositingPrograms = await compileNativeCompositingPrograms(
        this.document,
        compiled,
        nestedPrograms.forms,
        imageResources,
        options,
        sourcePageIndex,
        signal,
        this.optionalContent,
        this.formRegistry,
        nestedPrograms.type3,
        fontRegistry,
        textAccumulator
      );
      const accumulatedText = textAccumulator.build();
      const allFontResources = fontRegistry.resources;
      const compiledType3 = extendType3GlyphBindings(
        compositingPrograms.type3,
        accumulatedText.compilation.glyphs.glyphIds.length
      );
      if (accumulatedText.compilation.glyphs.glyphIds.length !== 0) {
        onProgress?.(progress(
          "font",
          accumulatedText.compilation.glyphs.glyphIds.length,
          accumulatedText.compilation.glyphs.glyphIds.length,
          sourcePageIndex,
          totalBytes,
          this.info.byteLength
        ));
      }
      const text = compiled.textShowOpCount > 0 || accumulatedText.compilation.textIndex.text.length > 0 ||
        accumulatedText.compilation.glyphs.glyphIds.length > 0
        ? buildNativePageTextResources(
            accumulatedText.compilation,
            allFontResources,
            {
              maxPaths: options.limits?.maxPathsPerPage ??
                this.document.limits.maxPathsPerPage,
              type3ProgramIndices: compiledType3.fontGlyphProgramIndices,
              signal
            }
          )
        : undefined;
      if (text) this.appendDiagnostics(text.diagnostics);
      this.appendDiagnostics(fontRegistry.getDiagnostics());
      // The registry owns its diagnostic callback. Retain newly discovered
      // memberships in the session without notifying the caller twice.
      this.appendDiagnostics(this.optionalContent.getDiagnostics(), false);
      imageResources.assertReferencedCodecsAvailable(compiled.referencedXObjects);
      if (imageResources.registry.size > 0) {
        onProgress?.(progress(
          "image",
          imageResources.registry.size,
          imageResources.registry.size,
          sourcePageIndex,
          totalBytes,
          this.info.byteLength
        ));
      }
      const colorResourceCount = compiled.referencedColorSpaces.length +
        imageResources.shadings.size;
      if (colorResourceCount > 0) {
        onProgress?.(progress(
          "color",
          colorResourceCount,
          colorResourceCount,
          sourcePageIndex,
          totalBytes,
          this.info.byteLength
        ));
      }
      const densePageData = createHeprPageDataFromDense(pageInfo, compiled, {
        retainOptionalContent: (options as NativeVectorCompileOptions).retainOptionalContent === true,
        text,
        forms: compositingPrograms.forms,
        patterns: compositingPrograms.patterns,
        type3: compiledType3,
        compositing: compositingPrograms.compositing,
        images: {
          store: imageResources.registry.buildStore(),
          colors: imageResources.registry.colors.buildStore(),
          functions: imageResources.registry.colors.functions.buildStore(),
          gradients: imageResources.shadings.buildGradientStore(),
          meshes: imageResources.shadings.buildMeshStore()
        },
        optionalContent: buildOptionalContentStore(this.optionalContent),
        limits: densePathCompileLimits(this.document, options)
      });
      const invocationText = text
        ? buildInvocationOrderedTextIndex(
            compiled,
            compositingPrograms.forms,
            accumulatedText,
            allFontResources,
            maxGlyphs,
            signal
          )
        : undefined;
      const pageData = invocationText
        ? { ...densePageData, textIndex: invocationText.textIndex }
        : densePageData;
      pageData.annotations = annotations;
      if (invocationText?.positions) retainedTextPositions.set(pageData.textIndex, invocationText.positions);
      const commandCount = pageData.displayProgram.groups.reduce(
        (sum, group) => sum + group.commands.length,
        0
      ) + pageData.displayProgram.programs.reduce(
        (sum, program) => sum + program.commands.length,
        0
      );
      const maxCommands = options.limits?.maxCommandsPerPage ??
        this.document.limits.maxCommandsPerPage;
      if (commandCount > maxCommands || annotations.length > maxCommands) {
        throw new PdfError("resource-limit", "The compiled display program exceeds the command limit.", {
          pageIndex: sourcePageIndex,
          details: { reason: "display-command-count", commandCount, maxCommands }
        });
      }
      enforcePageGeometryLimits(pageData, this.document, options, sourcePageIndex);
      try {
        validateHeprPageData(pageData);
      } catch (error) {
        if (
          error instanceof HeprDataValidationError &&
          error.code === HEPR_DATA_VALIDATION_CODES.ResourceCycle
        ) {
          throw new PdfError("unsupported-content", "The reusable display-program graph is cyclic.", {
            pageIndex: sourcePageIndex,
            cause: error,
            details: { reason: "reusable-program-cycle", path: error.path }
          });
        }
        throw error;
      }
      enforceReusableProgramDepth(
        pageData,
        this.document.limits.maxRecursionDepth,
        sourcePageIndex
      );
      this.appendDiagnostics(pageData.diagnostics);
      measurePreparedResources(timings, fontRegistry, imageResources.registry, initialFonts, initialImages);
      // Root content's nodes come first; only their MCIDs resolve through the page's /StructParents.
      pageMarkedContentCounts.set(pageData, compiled.markedContent.length);
      return pageData;
    } catch (error) {
      throw normalizeCompileError(error, sourcePageIndex);
    }
  }

  private async compileVectorPageUnlocked(
    sourcePageIndex: number, options: NativeVectorCompileOptions, signal: AbortSignal,
    timings?: NativeVectorCompileTimings, reusePageResources = true, reuseCompositeSurfaces = true,
    boundCompositeWork = true
  ): Promise<VectorScene> {
    options = { ...options, ...(options.limits ? { limits: { ...options.limits } } : {}) };
    const hadOptionalContent = this.optionalContent.groupCount > 0;
    const annotations = await this.annotationMetadata.getPageAnnotations(sourcePageIndex, signal);
    let scene = await this.compileVectorPageContentUnlocked(sourcePageIndex, options, signal,
      timings, reusePageResources, reuseCompositeSurfaces, boundCompositeWork);
    if (!hadOptionalContent && this.optionalContent.groupCount > 0 && options.retainOptionalContent !== false) {
      // Missing catalog groups may be discovered only while compiling paint.
      // Recompile with their scopes retained instead of dropping layer controls.
      scene = await this.compileVectorPageContentUnlocked(sourcePageIndex, options, signal,
        timings, reusePageResources, reuseCompositeSurfaces, boundCompositeWork);
    }
    if (annotations.length > (options.limits?.maxCommandsPerPage ?? this.document.limits.maxCommandsPerPage)) {
      throw new PdfError("resource-limit", "Annotations exceed the page command limit.", { pageIndex: sourcePageIndex });
    }
    scene.pdfPages = [{ sourcePageIndex, pageIndex: 0,
      pdfToScene: computePageGeometry(this.document.getPage(sourcePageIndex)).pageMatrix }];
    // Annotation layers alone can give a page optional content; a membership
    // index is only valid when the page also retained its PDF layers.
    const pdfLayers = scene.optionalContent !== undefined && options.retainOptionalContent !== false &&
      this.optionalContent.groupCount > 0;
    scene.annotations = annotations.map(annotation => {
      const result = placeSceneAnnotation(annotation, 0);
      if (!pdfLayers) delete result.optionalContent;
      return result;
    });
    if (options.annotationAppearances && options.annotationAppearances !== "render") {
      scene.annotationAppearances = options.annotationAppearances;
    }
    if (scene.markedContent?.items.length) await this.attachStructureElements(scene, sourcePageIndex, signal);
    return scene;
  }

  /**
   * Resolve a page's structure content items to their elements. Malformed or
   * oversized structure leaves the items unresolved; the page still opens.
   */
  private async attachStructureElements(scene: VectorScene, sourcePageIndex: number, signal: AbortSignal): Promise<void> {
    const content = scene.markedContent!;
    try {
      const owners = await this.structure.resolvePageContentItems(sourcePageIndex, content.items.map(item => item.mcid), signal);
      if (!owners.size) return;
      const elements = await this.structure.readElements(content.items.flatMap(item => owners.get(item.mcid) ?? []), signal);
      const read = new Set(elements.map(element => element.id));
      scene.markedContent = { ...content, items: content.items.map(item => {
        const elementId = owners.get(item.mcid);
        return elementId !== undefined && read.has(elementId) ? { ...item, elementId } : item;
      }) };
      if (elements.length) scene.structureElements = elements;
    } catch (error) {
      signal.throwIfAborted();
      if (!(error instanceof PdfError) || error.code === "aborted" || error.code === "closed") throw error;
      this.appendDiagnostics([{ code: "structure.unavailable", severity: "warning", pageIndex: sourcePageIndex,
        message: `Structure elements for this page could not be read: ${error.message}` }]);
    }
  }

  private async compileVectorPageContentUnlocked(
    sourcePageIndex: number,
    options: NativeVectorCompileOptions,
    signal: AbortSignal,
    timings?: NativeVectorCompileTimings,
    reusePageResources = true,
    reuseCompositeSurfaces = true,
    boundCompositeWork = true
  ): Promise<VectorScene> {
    this.assertOpen();
    signal.throwIfAborted();
    // Both passes use one limits snapshot, even if a progress callback mutates
    // the caller's options. Subsequent operations still take their own snapshot.
    options = { ...options, retainOptionalContent: options.retainOptionalContent !== false && this.optionalContent.groupCount > 0,
      ...(options.limits ? { limits: { ...options.limits } } : {}) };
    let retainedAttempted = false;
    const lowerRetained = async (page: HeprPageData): Promise<VectorScene | null> => {
      retainedAttempted = true;
      try {
        return await lowerRetainedPageToVectorScene(page, {
          optionalContent: options.retainOptionalContent ? await this.optionalContent.sceneData(signal) : undefined,
          textPositions: retainedTextPositions.get(page.textIndex),
          pageMarkedContentCount: pageMarkedContentCounts.get(page),
          signal,
          onDiagnostic: diagnostic => this.appendDiagnostics([diagnostic]),
          maxPrimitives: options.limits?.maxPathsPerPage ?? this.document.limits.maxPathsPerPage,
          maxCoordinates: options.limits?.maxPathCoordinatesPerPage ?? this.document.limits.maxPathCoordinatesPerPage,
          maxPatternCells: options.retainedVectorMaxPatternCells
        });
      } catch (error) {
        signal.throwIfAborted();
        const expansionLimit = error instanceof PdfError && error.code === "resource-limit" && error.details?.reason === "vector-expansion-limit";
        if (!isNativeVectorRepresentationFailure(error) && !expansionLimit) throw error;
        if (options.vectorFallback === "error") throw error;
        // Naming what the retained lowering could not represent is the only
        // record of why the page then needs raster layers at all; the capture
        // itself reports which paints, not what defeated the vector path.
        this.appendDiagnostics([{ code: "retained-vector-fallback", severity: "warning", pageIndex: sourcePageIndex,
          message: `Retained vector lowering could not represent this page: ${(error as Error).message}`,
          details: { reason: (error instanceof PdfError ? error.details?.reason : undefined) ?? "unrepresentable" } }]);
        // Layer visibility must be replayable even when a paint feature still
        // needs the reference renderer. Keep the all-command retained page.
        if (options.retainOptionalContent || expansionLimit) return this.buildRetainedRasterScene(page, options, signal, error as Error);
        return null;
      }
    };
    try {
      // Stack-local to this operation: never shared across pages, queued calls,
      // changed limits, cancellation, or session close. Graphics/text compilers
      // remain independent; only prepared input and resource registries are reused.
      const reuse: NativePagePreparationReuse | undefined = reusePageResources ? {} : undefined;
      const {
        pageInfo,
        pageBounds,
        compiled,
        textCompiler,
        maxGlyphs,
        fontRegistry,
        formGraph,
        imageResources,
        totalBytes,
        onProgress
      } = await this.preparePageCompilation(
        sourcePageIndex,
        options,
        signal,
        "vector-scene",
        timings,
        false,
        reuse
      );
      let textCompilation = textCompiler.build();
      const vectorRoot = appendNativeVectorAnnotationPaints(
        compiled, formGraph, imageResources.colorSpaceResolver, pageBounds, sourcePageIndex,
        options.limits?.maxCommandsPerPage ?? this.document.limits.maxCommandsPerPage, signal,
        options.retainOptionalContent !== false ? this.optionalContent : undefined,
        diagnostic => this.appendDiagnostics([diagnostic])
      );
      let vectorCompiled = vectorRoot;
      let selectiveCompositeFormPaintIndices: readonly number[] = [];
      let selectiveCompositeFormPaintOrders: readonly number[] = [];
      let selectiveImagePaintOrdinalSpans: readonly (readonly [number, number])[] = [];
      let selectivePaintSourceSpans: readonly (readonly [number, number])[] = [];
      let selectivePaintSourceIntervals: readonly (readonly [number, number, number, number])[] = [];
      imageResources.assertReferencedCodecsAvailable(compiled.referencedXObjects);
      if (vectorRoot.formPaints.length !== 0) {
        const formCompileStartedAt = timings ? nativeVectorTimingNow() : 0;
        const flattened = await flattenNativeVectorFormOccurrences({
          document: this.document,
          graph: formGraph,
          rootCompiled: vectorRoot,
          rootText: textCompilation,
          imageResources,
          options,
          pageIndex: sourcePageIndex,
          pageBounds,
          signal,
          optionalContent: this.optionalContent,
          fontRegistry,
          maxGlyphs,
          timings
        });
        vectorCompiled = flattened.compiled;
        textCompilation = flattened.textCompilation;
        selectiveCompositeFormPaintIndices = flattened.selectiveCompositeFormPaintIndices;
        selectiveCompositeFormPaintOrders = flattened.selectiveCompositeFormPaintOrders;
        selectiveImagePaintOrdinalSpans = flattened.selectiveImagePaintOrdinalSpans;
        selectivePaintSourceSpans = flattened.selectivePaintSourceSpans;
        selectivePaintSourceIntervals = flattened.selectivePaintSourceIntervals;
        if (flattened.ignoredFormContentItems) this.appendDiagnostics([{
          code: "structure.form-content-items", severity: "warning", pageIndex: sourcePageIndex,
          message: "Structure content items (MCIDs) inside Form XObjects are not attributed; their paint belongs to the enclosing page item, if any.",
          details: { eventCount: flattened.ignoredFormContentItems }
        }]);
        if (timings) {
          timings.compileScanMs += nativeVectorTimingNow() - formCompileStartedAt;
        }
      } else {
        const selective = suppressVectorSelectiveImageSpans(compiled, sourcePageIndex);
        vectorCompiled = selective.compiled;
        selectiveImagePaintOrdinalSpans = selective.paintOrdinalSpans;
        selectivePaintSourceSpans = selective.paintSourceSpans;
        selectivePaintSourceIntervals = selective.paintSourceIntervals;
      }
      const adaptationStartedAt = timings ? nativeVectorTimingNow() : 0;
      this.appendDiagnostics(textCompilation.diagnostics);
      this.appendDiagnostics(this.optionalContent.getDiagnostics(), false);
      if (textCompilation.glyphs.glyphIds.length !== 0) {
        onProgress?.(progress(
          "font",
          textCompilation.glyphs.glyphIds.length,
          textCompilation.glyphs.glyphIds.length,
          sourcePageIndex,
          totalBytes,
          this.info.byteLength
        ));
      }
      if (imageResources.registry.size !== 0) {
        onProgress?.(progress(
          "image",
          imageResources.registry.size,
          imageResources.registry.size,
          sourcePageIndex,
          totalBytes,
          this.info.byteLength
        ));
      }
      const optionalContentData = options.retainOptionalContent !== false ? await this.optionalContent.sceneData(signal) : undefined;
      const buildScene = (compositeRasterLayers: VectorScene["rasterLayers"]) => buildNativeVectorPage({
        compositeRasterLayers,
        optionalContent: optionalContentData,
        onDiagnostic: diagnostic => this.appendDiagnostics([diagnostic]),
        pageInfo,
        pageBounds,
        compiled: vectorCompiled,
        textCompilation,
        fontResources: fontRegistry.resources,
        imageRegistry: imageResources.registry,
        shadingRegistry: imageResources.shadings,
        maxPaths: options.limits?.maxPathsPerPage ??
          this.document.limits.maxPathsPerPage,
        maxPathCoordinates: options.limits?.maxPathCoordinatesPerPage ??
          this.document.limits.maxPathCoordinatesPerPage,
        signal
      });
      const compositeRasterLayers: VectorScene["rasterLayers"] = [];
      let retainedCompositePage: HeprPageData | undefined;
      let compositeTextIndex: VectorScene["textIndex"] = null;
      measurePreparedResources(timings, fontRegistry, imageResources.registry);
      if (selectiveCompositeFormPaintIndices.length !== 0 ||
          selectiveImagePaintOrdinalSpans.length !== 0 ||
          selectivePaintSourceSpans.length !== 0 ||
          selectivePaintSourceIntervals.length !== 0) {
        const retryTimings = timings ? createNativeVectorCompileTimings() : undefined;
        const retryStartedAt = timings ? nativeVectorTimingNow() : 0;
        const pageData = await this.compilePageUnlocked(sourcePageIndex, options, signal, true, retryTimings, reuse);
        retainedCompositePage = pageData;
        if (timings) {
          timings.selectiveCompileMs = nativeVectorTimingNow() - retryStartedAt;
          timings.selectiveCompilation = Object.freeze(retryTimings!);
        }
        if (options.preserveDrawingOrder !== false || options.retainOptionalContent) {
          const retainedScene = await lowerRetained(pageData);
          if (retainedScene) return retainedScene;
        }
        const rasterStartedAt = timings ? nativeVectorTimingNow() : 0;
        compositeRasterLayers.push(...await renderNativeSelectiveCompositeLayers(
          pageData,
          selectiveCompositeFormPaintIndices,
          selectiveCompositeFormPaintOrders,
          selectiveImagePaintOrdinalSpans,
          selectivePaintSourceSpans,
          selectivePaintSourceIntervals,
          signal,
          timings,
          reuseCompositeSurfaces,
          boundCompositeWork,
          (diagnostic) => this.appendDiagnostics([diagnostic]),
          options.preserveDrawingOrder !== false ? () => {
            compositeTextIndex ??= buildNativeFallbackTextIndex(pageData, signal);
          } : undefined,
          { ...this.document.limits, ...options.limits }
        ));
        if (timings) timings.selectiveRasterMs = nativeVectorTimingNow() - rasterStartedAt;
      }
      const scene = buildScene(compositeRasterLayers);
      // Glyph outlines can discover font warnings lazily while building the scene.
      this.appendDiagnostics(fontRegistry.getDiagnostics());
      if (compositeTextIndex) scene.textIndex = compositeTextIndex;
      if (compositeRasterLayers.length > 0) {
        if (retainedCompositePage && retainedReplayIsReachable(scene.optionalContent, retainedCompositePage)) {
          const page = retainedCompositePage;
          scene.retainedPages = [{ page,
            optionalContentConditions: Int32Array.from(page.stores.optionalContent.defaultVisible, (_, index) => scene.optionalContent ? index : -1),
            matrix: Float32Array.of(1, 0, 0, 1, 0, 0) }];
          // Raster replay slots own singleton runs; ordinary raster images retain
          // their existing paint runs and do not acquire retained resources.
          const runs = scene.drawRuns ?? defaultVectorDrawRuns(scene);
          const oldGraph = scene.paintGraph;
          const remapped: number[][] = [];
          let nextRun = 0;
          scene.drawRuns = runs.flatMap(run => {
            const split = run.kind === "raster"
              ? Array.from({ length: run.count }, (_, offset) => ({ ...run, first: run.first + offset, count: 1 })) : [run];
            remapped.push(split.map(() => nextRun++)); return split;
          });
          const nodes = scene.drawRuns.map((run, runIndex): import("./scenePaintGraph").ScenePaintNode => {
            const layer = run.kind === "raster" ? scene.rasterLayers[run.first] as NativeSelectiveRasterLayer : undefined;
            return layer?.retainedFirstCommand === undefined ? { kind: "draw", runIndex }
              : { kind: "retained", retainedPage: 0, firstCommand: layer.retainedFirstCommand,
                count: layer.retainedCommandCount!, rasterIndex: run.first };
          });
          const remapGraph = (source: readonly import("./scenePaintGraph").ScenePaintNode[]): import("./scenePaintGraph").ScenePaintNode[] =>
            source.flatMap(node => node.kind === "draw" ? remapped[node.runIndex].map(index => nodes[index])
              : node.kind === "group" ? [{ ...node, children: remapGraph(node.children),
                ...(node.softMask ? { softMask: { ...node.softMask, children: remapGraph(node.softMask.children) } } : {}) }] : [node]);
          scene.paintGraph = { roots: oldGraph ? remapGraph(oldGraph.roots) : nodes };
        }
        // Naming the features turns "why is this pixelated?" into one line.
        const reasons = vectorCompiled.vectorSceneData?.selectivePaintReasons ?? [];
        this.appendDiagnostics([{ code: "selective-raster-fallback", severity: "warning", pageIndex: sourcePageIndex,
          message: reasons.length === 0
            ? "Some unsupported paint or compositing features use bounded raster layers; surrounding vector content is retained."
            : `Paints using ${reasons.join(", ")} use bounded raster layers; surrounding vector content is retained.`,
          details: { layers: compositeRasterLayers.length, ...(reasons.length ? { reasons: reasons.join(",") } : {}) } }]);
      }
      if (timings) {
        timings.vectorSceneAdaptationMs += nativeVectorTimingNow() - adaptationStartedAt;
      }
      return scene;
    } catch (error) {
      signal.throwIfAborted();
      const normalized = normalizeCompileError(error, sourcePageIndex);
      if (options.vectorFallback === "error" && normalized instanceof PdfError &&
          isNativeGlyphStrokeRepresentationReason(normalized.details?.reason)) throw normalized;
      if (!retainedAttempted && isNativeVectorRepresentationFailure(normalized)) {
        const retainedPage = await this.compilePageUnlocked(sourcePageIndex, options, signal);
        const retainedScene = await lowerRetained(retainedPage);
        if (retainedScene) return retainedScene;
      }
      if (options.preserveDrawingOrder === undefined && isNativeVectorRepresentationFailure(normalized)) {
        return this.compileVectorPageUnlocked(sourcePageIndex, { ...options, preserveDrawingOrder: false },
          signal, timings, reusePageResources, reuseCompositeSurfaces, boundCompositeWork);
      }
      if (options.vectorFallback === "error" || !isNativeVectorRepresentationFailure(normalized)) throw normalized;
      return await this.compileRasterPageUnlocked(sourcePageIndex, options, signal, normalized);
    }
  }

  private async buildRetainedRasterScene(page: HeprPageData, options: NativeVectorCompileOptions,
    signal: AbortSignal, reason: Error): Promise<VectorScene> {
    const commandCount = page.displayProgram.groups[page.displayProgram.rootGroupIndex].commands.length;
    if (!commandCount) return lowerRetainedPageToVectorScene(page, { signal, textPositions: retainedTextPositions.get(page.textIndex) });
    const layer = await renderNativeRetainedCommandSpan(page, 0, commandCount, signal,
      { ...this.document.limits, ...options.limits }, diagnostic => this.appendDiagnostics([diagnostic]));
    if (!layer) throw new PdfError("invalid-object", "A retained page replay produced no structural raster slot.");
    const scene = buildNativeRasterPage(page, { rgba: new Uint8ClampedArray(layer.data), width: layer.width,
      height: layer.height, scale: layer.width / layer.matrix[0] }, signal);
    scene.rasterLayers[0] = layer;
    scene.rasterLayerData = layer.data; scene.rasterLayerMatrix = layer.matrix;
    scene.drawRuns = [{ kind: "raster", first: 0, count: 1 }];
    scene.optionalContent = options.retainOptionalContent ? await this.optionalContent.sceneData(signal) : undefined;
    if (scene.optionalContent && scene.textIndex) scene.optionalContent = await attachRetainedTextOptionalContent(page, scene.textIndex, scene.optionalContent, signal);
    if (retainedReplayIsReachable(scene.optionalContent, page)) {
      scene.retainedPages = [{ page,
        optionalContentConditions: Int32Array.from(page.stores.optionalContent.defaultVisible, (_, index) => scene.optionalContent ? index : -1),
        matrix: Float32Array.of(1, 0, 0, 1, 0, 0) }];
      scene.paintGraph = { roots: [{ kind: "retained", retainedPage: 0, firstCommand: 0, count: commandCount, rasterIndex: 0 }] };
    }
    this.appendDiagnostics([{ code: "retained-raster-fallback", severity: "warning", pageIndex: page.pageInfo.sourcePageIndex,
      message: scene.retainedPages
        ? "This paint program uses replayable raster rendering; PDF layer toggles remain available, with reduced drawing geometry."
        : "This paint program uses raster rendering, with reduced drawing geometry. This document has no toggleable layers, so no replay program is retained.",
      details: { reason: reason.message, replayable: scene.retainedPages !== undefined } }]);
    return scene;
  }

  private async compileRasterPageUnlocked(
    sourcePageIndex: number,
    options: NativeVectorCompileOptions,
    signal: AbortSignal,
    reason: Error,
    previewMaxDimension = options.previewMaxDimension
  ): Promise<VectorScene> {
    const page = await this.compilePageUnlocked(sourcePageIndex, options, signal);
    const limits = { ...this.document.limits, ...options.limits };
    const maxPixels = Math.min(limits.maxImagePixels,
      Math.floor(limits.maxDecodedStreamBytes / 4));
    if (maxPixels < 1) throw new PdfError("resource-limit", "No pixel budget for page fallback.");
    const maxDimension = limits.maxImageDimension;
    const { width, height } = page.pageInfo;
    let scale = Math.min(2, maxDimension / width, maxDimension / height,
      Math.sqrt(maxPixels / (width * height)),
      previewMaxDimension === undefined ? Infinity : previewMaxDimension / Math.max(width, height));
    // Account for rounding each dimension up to an integer pixel.
    while (scale > 0 && Math.ceil(width * scale) * Math.ceil(height * scale) > maxPixels) scale *= 0.99;
    if (!(scale > 0)) throw new PdfError("resource-limit", "No pixel budget for page fallback.");
    const surfaceFactory = await createNativeCompositeSurfaceFactory();
    const { renderHeprPageToCanvas2d, HEPR_CANVAS_2D_ERROR_CODES } = await import("./heprCanvas2dRenderer");
    const onDiagnostic = (diagnostic: PdfDiagnostic) => this.appendDiagnostics([diagnostic]);
    const renderOptions = { scale, surfaceFactory, signal, onDiagnostic,
      maxCanvasPixels: maxPixels, maxWorkingPixels: Math.floor(limits.maxDecodedStreamBytes / 4) };
    try {
      let pixels;
      try {
        pixels = await renderNativeCompositePixels(page, renderOptions, renderHeprPageToCanvas2d);
      } catch (renderError) {
        signal.throwIfAborted();
        const code = (renderError as { code?: string })?.code;
        if (code !== HEPR_CANVAS_2D_ERROR_CODES.UnsupportedComposite &&
            code !== HEPR_CANVAS_2D_ERROR_CODES.UnsupportedStroke) throw renderError;
        const approximate = createSelectiveCompositePage(page,
          page.displayProgram.groups[page.displayProgram.rootGroupIndex].commands);
        approximate.displayProgram = { ...approximate.displayProgram, groups:
          approximate.displayProgram.groups.map(group => ({ ...group, knockout: false })) };
        pixels = await renderNativeCompositePixels(approximate, renderOptions, renderHeprPageToCanvas2d);
        onDiagnostic({ code: "compositing-approximation", severity: "warning", pageIndex: sourcePageIndex,
          message: "Page compositing uses an sRGB approximation; overlapping colors may differ.",
          details: { reason: renderError instanceof Error ? renderError.message : String(renderError) } });
      }
      const scene = buildNativeRasterPage(page, pixels, signal);
      const count = page.displayProgram.groups[page.displayProgram.rootGroupIndex].commands.length;
      if (count) {
        scene.optionalContent = options.retainOptionalContent ? await this.optionalContent.sceneData(signal) : undefined;
        if (scene.optionalContent && scene.textIndex) scene.optionalContent = await attachRetainedTextOptionalContent(page, scene.textIndex, scene.optionalContent, signal);
        if (previewMaxDimension === undefined && retainedReplayIsReachable(scene.optionalContent, page)) {
          scene.retainedPages = [{ page,
            optionalContentConditions: Int32Array.from(page.stores.optionalContent.defaultVisible, (_, index) => scene.optionalContent ? index : -1),
            matrix: Float32Array.of(1, 0, 0, 1, 0, 0) }];
          scene.drawRuns = [{ kind: "raster", first: 0, count: 1 }];
          scene.paintGraph = { roots: [{ kind: "retained", retainedPage: 0, firstCommand: 0, count, rasterIndex: 0 }] };
        }
      }
      onDiagnostic({ code: previewMaxDimension === undefined ? "page-raster-fallback" : "page-preview",
        severity: previewMaxDimension === undefined ? "warning" : "info", pageIndex: sourcePageIndex,
        message: previewMaxDimension === undefined
          ? "This page was rasterized to keep the PDF usable; vector sharpness and drawing geometry are unavailable."
          : "This overview uses a bounded raster preview; detailed page content is compiled on demand.",
        details: { reason: reason.message, width: pixels.width, height: pixels.height, scale } });
      signal.throwIfAborted();
      return scene;
    } finally {
      surfaceFactory.releaseAll();
    }
  }

  private async preparePageResources(
    sourcePageIndex: number,
    options: PdfCompileOptions,
    signal: AbortSignal,
    output: "display-program" | "vector-scene",
    timings?: NativeVectorCompileTimings
  ): Promise<PreparedNativePageResources> {
    const page = this.document.getPage(sourcePageIndex);
    const pageInfo = this.info.pages[sourcePageIndex];
    const { pageMatrix, pageBounds } = computePageGeometry(page);
    const decodeStartedAt = timings ? nativeVectorTimingNow() : 0;
    const decoded = await this.document.getDecodedPageContents(sourcePageIndex, signal);
    if (timings) timings.decodeMs += nativeVectorTimingNow() - decodeStartedAt;
    const contentOnlyStartedAt = timings ? nativeVectorTimingNow() : 0;
    const contentOnlyPageContent = createDecodedContentOnlySource(decoded, signal);
    if (timings) {
      timings.inlinePreparationMs += nativeVectorTimingNow() - contentOnlyStartedAt;
    }
    const initialResourceScanStartedAt = timings ? nativeVectorTimingNow() : 0;
    const initialResourceScan = tryScanFastPreparedResourceReferences(
      contentOnlyPageContent.segments,
      { signal }
    );
    if (timings) {
      timings.resourceScanMs += nativeVectorTimingNow() - initialResourceScanStartedAt;
    }
    let preparedPageContent: PreparedInlineContentSource;
    let references: DensePdfResourceReferences;
    if (initialResourceScan.kind === "complete") {
      // The fast scanner rejects every lexical BI/ID/EI operator. A complete
      // raw-content scan therefore proves that the content-only segments are
      // already the exact prepared representation, while also supplying the
      // resource references needed below.
      preparedPageContent = contentOnlyPageContent;
      references = initialResourceScan.references;
      if (timings) timings.inlinePreparationSkipped = true;
    } else {
      const inlineStartedAt = timings ? nativeVectorTimingNow() : 0;
      preparedPageContent = prepareDecodedInlineContentStreams(
        this.document,
        decoded,
        signal,
        options.limits?.maxCommandsPerPage
      );
      if (timings) {
        timings.inlinePreparationMs += nativeVectorTimingNow() - inlineStartedAt;
      }
      const resourceScanStartedAt = timings ? nativeVectorTimingNow() : 0;
      references = scanPreparedResourceReferencesFastOrExact(
        preparedPageContent.segments,
        { signal }
      ).references;
      if (timings) {
        timings.resourceScanMs += nativeVectorTimingNow() - resourceScanStartedAt;
      }
    }
    const resourceLoadStartedAt = timings ? nativeVectorTimingNow() : 0;
    const resources = await loadReferencedPageResourceScope(
      this.document,
      page,
      signal
    );
    const fontStartedAt = timings ? nativeVectorTimingNow() : 0;
    const type3Registry = new NativePdfType3Registry(this.document);
    const fontRegistry = new NativePageFontRegistry(
      this.document,
      sourcePageIndex,
      this.missingFontResolver,
      type3Registry
    );
    const fontResources = await fontRegistry.loadScope(
      resources,
      references.fonts,
      signal,
      { label: "Page", allowType3: true }
    );
    if (timings) timings.fontLoadMs += nativeVectorTimingNow() - fontStartedAt;
    const imageStartedAt = timings ? nativeVectorTimingNow() : 0;
    const imageResources = await loadPageImages(
      this.document,
      page,
      resources,
      references,
      signal,
      this.optionalContent,
      this.imageCodecResolver,
      { iccTransformResolver: this.iccTransformResolver, iccEngine: this.iccEngine },
      (diagnostic) => this.appendDiagnostics([{ ...diagnostic, pageIndex: sourcePageIndex }]),
      options.limits,
      (options as NativeVectorCompileOptions).retainOptionalContent === true
    );
    const xObjectReferences = imageResources.xObjectReferences;
    const pageContentSegments = await bindPreparedInlineImages(
      preparedPageContent,
      imageResources.registry,
      imageResources.colorSpaces,
      signal
    );
    if (timings) timings.imageLoadMs += nativeVectorTimingNow() - imageStartedAt;
    const extGStates = await loadResourceExtGStates(
      imageResources.extGStates,
      resources,
      references.extGStates,
      signal,
      fontRegistry
    );
    const hasReferencedForms = xObjectReferences.some(({ kind }) => kind === "Form");
    const formGraph = output === "vector-scene" && !hasReferencedForms && page.annotations == null
      ? EMPTY_NATIVE_FORM_DEFINITION_GRAPH
      : await buildNativePdfFormDefinitionGraph(
          this.document,
          this.formRegistry,
          sourcePageIndex,
          decoded,
          pageMatrix,
          {
            pageImageNames: new Set(imageResources.indexes.keys()),
            pageXObjectReferences: xObjectReferences,
            pageResourceReferences: references,
            optionalContent: this.optionalContent,
            retainOptionalContent: (options as NativeVectorCompileOptions).retainOptionalContent === true,
            appearanceSynthesizer: this.appearanceSynthesizer,
            annotationAppearances: options.annotationAppearances,
            signal
          }
        );
    const pageMarkedContentProperties = await loadMarkedContentProperties(
      this.document,
      this.optionalContent,
      resources,
      references.properties,
      references.optionalContentProperties,
      signal
    );
    this.appendDiagnostics(this.formRegistry.getDiagnostics());
    this.appendDiagnostics(this.appearanceSynthesizer.getDiagnostics());
    const totalBytes = preparedPageContent.sourceLength;
    if (timings) timings.resourceLoadMs += nativeVectorTimingNow() - resourceLoadStartedAt;
    return {
      pageInfo, pageMatrix, pageBounds, fontRegistry, fontResources,
      imageResources, pageContentSegments, extGStates, formGraph,
      pageMarkedContentProperties, totalBytes
    };
  }

  private async preparePageCompilation(
    sourcePageIndex: number,
    options: PdfCompileOptions,
    signal: AbortSignal,
    output: "display-program" | "vector-scene",
    timings?: NativeVectorCompileTimings,
    capturePaintSourceIdentities = false,
    reuse?: NativePagePreparationReuse
  ) {
    signal.throwIfAborted();
    // A later compilation of the same page streams its content again and
    // reuses the resources the first one loaded.
    const streamed = reuse?.prepared?.streamed
      ? reuse.prepared
      : output === "vector-scene" && !reuse?.prepared
        ? await this.prepareStreamedPageResources(sourcePageIndex, options, signal)
        : null;
    if (streamed) {
      try {
        const result = await this.compilePreparedPage(
          streamed, sourcePageIndex, options, signal, output, timings, capturePaintSourceIdentities
        );
        if (reuse) reuse.prepared = streamed;
        return result;
      } catch (error) {
        signal.throwIfAborted();
        // A property first used as metadata and later as /OC still needs
        // lookahead. Other failures, including a caller's resolver, are
        // reported once rather than retried with prepared input.
        if (!(error instanceof DensePdfStreamingUnsupportedError)) throw error;
        if (reuse) reuse.prepared = undefined;
      }
    }
    const prepared = reuse?.prepared ?? await this.preparePageResources(
      sourcePageIndex, options, signal, output, timings
    );
    if (reuse) reuse.prepared = prepared;
    return await this.compilePreparedPage(
      prepared, sourcePageIndex, options, signal, output, timings, capturePaintSourceIdentities
    );
  }

  /**
   * Prepare a page whose content streams straight into the compiler. Its
   * fonts, ExtGStates, properties, color spaces, XObjects, patterns and shadings
   * load when the content first uses them, so the decoded content is neither
   * held whole nor scanned for references first.
   */
  private async prepareStreamedPageResources(
    sourcePageIndex: number,
    options: PdfCompileOptions,
    signal: AbortSignal
  ): Promise<PreparedNativePageResources | null> {
    const page = this.document.getPage(sourcePageIndex);
    const resources = await loadReferencedPageResourceScope(this.document, page, signal);
    const pageInfo = this.info.pages[sourcePageIndex];
    const { pageMatrix, pageBounds } = computePageGeometry(page);
    const streams = await this.document.getPageContentStreams(sourcePageIndex, signal);
    const retainOptionalContent = (options as NativeVectorCompileOptions).retainOptionalContent === true;
    const fontRegistry = new NativePageFontRegistry(
      this.document,
      sourcePageIndex,
      this.missingFontResolver,
      new NativePdfType3Registry(this.document)
    );
    const imageResources = await loadPageImages(
      this.document,
      page,
      resources,
      EMPTY_RESOURCE_REFERENCES,
      signal,
      this.optionalContent,
      this.imageCodecResolver,
      { iccTransformResolver: this.iccTransformResolver, iccEngine: this.iccEngine },
      (diagnostic) => this.appendDiagnostics([{ ...diagnostic, pageIndex: sourcePageIndex }]),
      options.limits,
      retainOptionalContent
    );
    // Forms join the graph as the content first names them; annotation
    // appearances follow once the content is compiled, as in preparation.
    const forms = new NativePdfFormGraphBuilder(this.document, this.formRegistry, sourcePageIndex, pageMatrix, {
      optionalContent: this.optionalContent,
      retainOptionalContent,
      appearanceSynthesizer: this.appearanceSynthesizer,
      annotationAppearances: options.annotationAppearances,
      signal
    });
    let inlineImageCount = 0;
    const maxInlineImages = Math.min(DEFAULT_NATIVE_INLINE_IMAGE_LIMITS.maxImages,
      options.limits?.maxCommandsPerPage ?? this.document.limits.maxCommandsPerPage);
    const content = new StreamedPageContent(this.document, streams, signal, async (bytes, sourceOffset) => {
      const prepared = prepareNativeInlineImages(bytes, {
        sourceOffset, signal, limits: inlineImageLimits(this.document, maxInlineImages)
      });
      inlineImageCount += prepared.images.length;
      if (inlineImageCount > maxInlineImages) {
        throw new PdfError("resource-limit", "Inline image count exceeds the page limit.", {
          details: { reason: "inline-image-count", count: inlineImageCount, limit: maxInlineImages }
        });
      }
      return bindPreparedInlineImages(prepared, imageResources.registry, imageResources.colorSpaces, signal);
    });
    return {
      pageInfo, pageMatrix, pageBounds, fontRegistry, fontResources: [],
      imageResources, pageContentSegments: [], extGStates: [], formGraph: EMPTY_NATIVE_FORM_DEFINITION_GRAPH,
      pageMarkedContentProperties: new Map(), totalBytes: content.estimatedBytes,
      streamed: {
        resources, content, forms, formOptionalContent: new Map(),
        properties: new Map(), optionalContentProperties: new Set(), graph: null,
        fonts: new Map(), extGStates: new Map(), colorSpaces: new Set(), xObjects: new Set()
      }
    };
  }

  /** Load a streamed page's resources exactly as preparation loads scanned references. */
  private streamedResourceLoader(
    prepared: PreparedNativePageResources,
    streamed: NativeStreamedPageResources,
    fontsByName: Map<string, NativeTextFontResource>,
    vectorShadings: Set<number>,
    signal: AbortSignal,
    timings?: NativeVectorCompileTimings
  ): DensePdfResourceLoader {
    const { resources, properties, optionalContentProperties } = streamed;
    const { fontRegistry, imageResources } = prepared;
    const timed = async <T>(phase: "fontLoadMs" | "resourceLoadMs", load: () => Promise<T>): Promise<T> => {
      const startedAt = timings ? nativeVectorTimingNow() : 0;
      try {
        return await load();
      } finally {
        if (timings) timings[phase] += nativeVectorTimingNow() - startedAt;
      }
    };
    return {
      font: (resourceName) => timed("fontLoadMs", async () => {
        const loaded = await fontRegistry.loadScope(
          resources, [resourceName], signal, { label: "Page", allowType3: true }
        );
        for (const [name, font] of loaded) {
          fontsByName.set(name, font);
          streamed.fonts.set(name, font);
        }
      }),
      extGState: (resourceName) => timed("resourceLoadMs", async () => {
        const [definition] = await loadResourceExtGStates(
          imageResources.extGStates, resources, [resourceName], signal, fontRegistry
        );
        streamed.extGStates.set(resourceName, definition);
        return definition;
      }),
      markedContentProperty: (resourceName, optionalContent) => timed("resourceLoadMs", async () => {
        if (properties.has(resourceName)) {
          // Preparation resolves a property once, as optional content when
          // any /OC tag names it; a property already resolved otherwise
          // cannot become optional content after the fact.
          if (optionalContent && !optionalContentProperties.has(resourceName)) {
            throw new DensePdfStreamingUnsupportedError(
              `Marked-content property /${resourceName} is also named by an /OC tag.`, "BDC");
          }
          return properties.get(resourceName);
        }
        const loaded = await loadMarkedContentProperties(
          this.document, this.optionalContent, resources, [resourceName],
          optionalContent ? [resourceName] : [], signal
        );
        properties.set(resourceName, loaded.get(resourceName));
        if (optionalContent) optionalContentProperties.add(resourceName);
        return loaded.get(resourceName);
      }),
      colorSpace: (resourceName) => timed("resourceLoadMs", async () => {
        await imageResources.loadColorSpace(resourceName);
        streamed.colorSpaces.add(resourceName);
      }),
      xObject: (resourceName) => timed("resourceLoadMs", async () => {
        const [reference] = await classifyNativePdfXObjectReferences(this.document, resources, [resourceName], signal);
        if (reference.kind === "Image") {
          await imageResources.loadImage(resourceName);
        } else {
          const association = streamed.forms.optionalContentOf(await streamed.forms.addPageForm(resourceName));
          if (association.optionalContentIndex >= 0) {
            streamed.formOptionalContent.set(resourceName, Object.freeze(association));
          }
        }
        streamed.xObjects.add(resourceName);
      }),
      shading: (resourceName) => timed("resourceLoadMs", async () => {
        await imageResources.loadShading(resourceName);
        for (const index of supportedNativeVectorShadings(imageResources.shadings)) vectorShadings.add(index);
      }),
      pattern: (resourceName) => timed("resourceLoadMs", async () => {
        await imageResources.loadPattern(resourceName);
      })
    };
  }

  private async compilePreparedPage(
    prepared: PreparedNativePageResources,
    sourcePageIndex: number,
    options: PdfCompileOptions,
    signal: AbortSignal,
    output: "display-program" | "vector-scene",
    timings?: NativeVectorCompileTimings,
    capturePaintSourceIdentities = false
  ) {
    const {
      pageInfo, pageMatrix, pageBounds, fontRegistry, fontResources,
      imageResources, pageContentSegments, extGStates,
      pageMarkedContentProperties, streamed
    } = prepared;
    let { totalBytes, formGraph } = prepared;
    const pageForms = streamed ? streamed.forms.pageForms : formGraph.pageForms;
    const pageFormOptionalContent = streamed
      ? streamed.formOptionalContent
      : formOptionalContentForScope(pageForms, formGraph.definitions);
    const fontsByName = new Map(streamed ? streamed.fonts : fontResources);
    const emittedTextRuns: NativeTextDrawRun[] = [];
    const maxGlyphs = options.limits?.maxGlyphsPerPage ?? this.document.limits.maxGlyphsPerPage;
    const textCompiler = new NativeTextCompiler({
      fonts: fontsByName,
      initialTransform: pageMatrix,
      maxGlyphs,
      maxGraphicsStateDepth: this.document.limits.maxRecursionDepth,
      signal,
      onRun: (run) => { emittedTextRuns.push(run); }
    });
    const textOperatorSink = {
      getFontSelection: () => textCompiler.getFontSelection(),
      applyOperator(
        operator: string,
        operands: readonly unknown[],
        context: Readonly<DensePdfTextOperatorContext>
      ) {
        emittedTextRuns.length = 0;
        textCompiler.setOutputEnabled(context.outputEnabled);
        if (context.font) {
          textCompiler.setFontResource(fontRegistry.resources[context.font.fontIndex], context.font.size);
        }
        textCompiler.applyOperator(operator, operands);
        return emittedTextRuns;
      }
    };
    const onProgress = options.onProgress ?? this.defaultProgress;
    onProgress?.(progress(
      "content", 0, totalBytes, sourcePageIndex, 0, this.info.byteLength
    ));
    const compileStartedAt = timings ? nativeVectorTimingNow() : 0;
    const streamedLoadMsBefore = timings ? timings.fontLoadMs + timings.resourceLoadMs + timings.inlinePreparationMs : 0;
    const vectorShadings = new Set(supportedNativeVectorShadings(imageResources.shadings));
    let finalizeStartedAt: number | null = null;
    const retainOptionalContent = (options as NativeVectorCompileOptions).retainOptionalContent === true;
    const compileOptions: DensePdfContentInputOptions = {
      retainOptionalContent,
      ...(retainOptionalContent ? { combineOptionalContent: (parent: number, own: number) => this.optionalContent.combineMemberships(parent, own) } : {}),
      pageMatrix,
      pageBounds,
      enableSegmentMerge: nativeVectorSegmentMergeEnabled(options),
      enableInvisibleCull: nativeVectorInvisibleCullEnabled(options),
      ...(output === "display-program" && capturePaintSourceIdentities
        ? { capturePaintSourceIdentities: true }
        : {}),
      textOperatorSink,
      extGStates: streamed ? [...streamed.extGStates.values()] : extGStates,
      imageXObjects: imageResources.indexes,
      imageOptionalContent: imageResources.optionalContent,
      shadings: imageResources.shadingIndexes,
      ...(output === "vector-scene" ? {
        vectorShadings
      } : {}),
      patterns: imageResources.patternDefinitions,
      patternColorSpaces: imageResources.patternColorSpaces,
      formXObjects: pageForms,
      formOptionalContent: pageFormOptionalContent,
      markedContentProperties: streamed
        ? loadedMarkedContentProperties(streamed.properties)
        : pageMarkedContentProperties,
      maxMarkedContentDepth: this.document.limits.maxRecursionDepth,
      maxMarkedContent: options.limits?.maxCommandsPerPage ??
        this.document.limits.maxCommandsPerPage,
      ...densePathCompileLimits(this.document, options),
      colorSpaceResolver: imageResources.colorSpaceResolver,
      ...(streamed ? {
        resourceLoader: this.streamedResourceLoader(prepared, streamed, fontsByName, vectorShadings, signal, timings),
        inlineImageLoader: (offset, buffered) => streamed.content.prepareInlineRemainder(offset, buffered),
        loadedResources: {
          fonts: streamed.fonts.keys(),
          extGStates: streamed.extGStates.keys(),
          properties: streamed.properties.keys(),
          optionalContentProperties: streamed.optionalContentProperties,
          colorSpaces: streamed.colorSpaces,
          xObjects: streamed.xObjects,
          shadings: imageResources.shadingIndexes.keys(),
          patterns: imageResources.patternDefinitions.keys()
        }
      } : { totalBytes }),
      signal,
      onProgress: (update) => {
        if (timings && update.phase === "finalizing" && finalizeStartedAt === null) {
          finalizeStartedAt = nativeVectorTimingNow();
        }
        onProgress?.(progress(
          update.phase === "scanning" ? "content" : "optimize",
          update.processedBytes,
          update.totalBytes ?? streamed?.content.estimateTotal(update.processedBytes) ?? totalBytes,
          sourcePageIndex,
          update.processedBytes,
          this.info.byteLength
        ));
      }
    };
    const content = streamed ? streamed.content.chunks(timings) : pageContentSegments;
    const compiled = output === "vector-scene" && !nativeVectorOrderedPaintEnabled(options)
      ? await compileGroupedVectorPageContent(content, compileOptions)
      : await compileDensePdfContent(content, { ...compileOptions, output });
    if (streamed) {
      totalBytes = streamed.content.decodedBytes;
      if (timings) timings.inlinePreparationSkipped = !streamed.content.hasInlineImages;
      if (!streamed.graph) {
        await streamed.forms.addAnnotations();
        streamed.graph = streamed.forms.build();
        this.appendDiagnostics(this.formRegistry.getDiagnostics());
        this.appendDiagnostics(this.appearanceSynthesizer.getDiagnostics());
      }
      formGraph = streamed.graph;
    }
    if (timings) {
      const compileFinishedAt = nativeVectorTimingNow();
      const finalizeSplitAt = finalizeStartedAt ?? compileFinishedAt;
      // Streamed decoding and resource loading happen inside the scan.
      const streamedMs = streamed
        ? streamed.content.decodeMs + timings.fontLoadMs + timings.resourceLoadMs + timings.inlinePreparationMs - streamedLoadMsBefore
        : 0;
      if (streamed) timings.decodeMs += streamed.content.decodeMs;
      timings.compileScanMs += finalizeSplitAt - compileStartedAt - streamedMs;
      timings.compileFinalizeMs += compileFinishedAt - finalizeSplitAt;
    }
    return {
      pageInfo,
      pageBounds,
      compiled,
      textCompiler,
      maxGlyphs,
      fontRegistry,
      formGraph,
      imageResources,
      totalBytes,
      onProgress
    };
  }

  private async acquireOperation(signal?: AbortSignal): Promise<() => void> {
    this.assertOpen();
    signal?.throwIfAborted();
    const previous = this.operationTail;
    let release!: () => void;
    this.operationTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    try {
      await waitForOperationTurn(previous, signal);
    } catch (error) {
      // Keep the abandoned position as a barrier until its predecessor ends;
      // releasing it immediately would let later work overlap that predecessor.
      void previous.then(release, release);
      throw error;
    }
    try {
      signal?.throwIfAborted();
      this.assertOpen();
    } catch (error) {
      release();
      throw error;
    }
    return release;
  }

  private assertOpen(): void {
    if (this.closed) throw new PdfError("closed", "The PDF session is closed.");
  }

  private appendDiagnostics(diagnostics: readonly PdfDiagnostic[], notify = true): void {
    for (const diagnostic of diagnostics) {
      const key = diagnosticKey(diagnostic);
      if (this.diagnosticKeys.has(key)) continue;
      this.diagnosticKeys.add(key);
      this.diagnostics.push(diagnostic);
      if (notify) this.onDiagnostic?.(diagnostic);
    }
  }
}

async function loadReferencedPageResourceScope(
  document: NativePdfDocument,
  page: NativePdfPage,
  signal: AbortSignal
): Promise<PdfDictionary> {
  if (page.resources === undefined || page.resources === null) return new Map();
  // Resolving the resource dictionary itself does not resolve any of its
  // entries. It is still required for PDF DefaultGray/DefaultRGB/DefaultCMYK
  // semantics; category loaders below touch only exact names from the scan.
  return await document.resolveDictionary(page.resources, signal);
}

interface NativeAccumulatedText {
  readonly compilation: NativeTextCompilation;
  readonly glyphPrefixes: readonly string[];
  readonly glyphTexts: readonly string[];
}

interface NativeAccumulatedGlyphView {
  readonly fontIndices: readonly number[];
  readonly characterCodes: readonly number[];
  readonly glyphIds: readonly number[];
  readonly flags: readonly number[];
}

/** Merge program-local text stores while retaining global glyph identity. */
class NativePageTextAccumulator {
  private readonly maxGlyphs: number;
  private readonly maxTransforms: number;
  private readonly fontIndices: number[] = [];
  private readonly characterCodes: number[] = [];
  private readonly glyphIds: number[] = [];
  private readonly transformIndices: number[] = [];
  private readonly advances: number[] = [];
  private readonly flags: number[] = [];
  private readonly glyphAdvanceEms: number[] = [];
  private readonly glyphWidthEms: number[] = [];
  private readonly glyphGapBefore: number[] = [];
  private hasCompleteGlyphAdvanceEms = true;
  private hasCompleteGlyphWidthEms = true;
  private hasCompleteGlyphGapBefore = true;
  private readonly transforms: number[] = [1, 0, 0, 1, 0, 0];
  private readonly transformKeys = new Map<string, number>([["1,0,0,1,0,0", 0]]);
  private readonly textParts: string[] = [];
  private readonly charGlyphIndices: number[] = [];
  private readonly fallbackQuads: number[] = [];
  private readonly runs: NativeTextDrawRun[] = [];
  private readonly diagnostics: PdfDiagnostic[] = [];
  private readonly glyphPrefixes: string[] = [];
  private readonly glyphTexts: string[] = [];
  private readonly actualTextEndPositions = new Map<number, readonly [number, number]>();
  private readonly runSourcesWithDiagnostics = new WeakSet<object>();
  /** Every run slice of a Form shares its transform store; remap it once. */
  private readonly transformRemaps = new WeakMap<object, Uint32Array>();
  private readonly runTexts = new WeakMap<NativeTextCompilation, NativeRunTextIndex>();
  private pendingOccurrenceBoundary = false;

  constructor(maxGlyphs: number) {
    this.maxGlyphs = maxGlyphs;
    this.maxTransforms = maxGlyphs + 1;
  }

  append(compilation: NativeTextCompilation): number {
    const glyphOffset = this.glyphIds.length;
    const glyphCount = compilation.glyphs.glyphIds.length;
    if (glyphCount > this.maxGlyphs - glyphOffset) {
      throw new PdfError("resource-limit", "Page and reusable-program text exceeds the glyph limit.", {
        details: { reason: "page-glyph-count", maxGlyphs: this.maxGlyphs }
      });
    }
    const transformRemap = this.remapTransforms(compilation.transforms);
    for (let index = 0; index < glyphCount; index += 1) {
      this.fontIndices.push(compilation.glyphs.fontIndices[index]);
      this.characterCodes.push(compilation.glyphs.characterCodes[index]);
      this.glyphIds.push(compilation.glyphs.glyphIds[index]);
      this.transformIndices.push(transformRemap[compilation.glyphs.transformIndices[index]]);
      this.advances.push(
        compilation.glyphs.advances[index * 2],
        compilation.glyphs.advances[index * 2 + 1]
      );
      this.flags.push(compilation.glyphs.flags[index]);
      if (compilation.glyphAdvanceEms?.length === glyphCount) {
        this.glyphAdvanceEms.push(compilation.glyphAdvanceEms[index]);
      } else {
        this.hasCompleteGlyphAdvanceEms = false;
        this.glyphAdvanceEms.push(0);
      }
      if (compilation.glyphWidthEms?.length === glyphCount) {
        this.glyphWidthEms.push(compilation.glyphWidthEms[index]);
      } else {
        this.hasCompleteGlyphWidthEms = false;
        this.glyphWidthEms.push(0);
      }
      if (compilation.glyphGapBefore?.length === glyphCount) {
        this.glyphGapBefore.push(compilation.glyphGapBefore[index]);
      } else {
        this.hasCompleteGlyphGapBefore = false;
        this.glyphGapBefore.push(0);
      }
      this.glyphPrefixes.push("");
      this.glyphTexts.push("");
      const endPosition = compilation.actualTextEndPositions?.get(index);
      if (endPosition) this.actualTextEndPositions.set(glyphOffset + index, endPosition);
    }
    for (const run of compilation.runs) {
      this.runs.push(Object.freeze({ ...run, first: glyphOffset + run.first }));
    }
    const fallbackOffset = this.fallbackQuads.length / 4;
    this.fallbackQuads.push(...compilation.textIndex.fallbackQuads);
    if (compilation.textIndex.text.length > 0 && this.pendingOccurrenceBoundary) {
      this.pendingOccurrenceBoundary = false;
      const previous = this.textParts.at(-1)?.at(-1) ?? "";
      const next = compilation.textIndex.text[0] ?? "";
      if (previous.length > 0 && next.length > 0 && !/\s/u.test(previous) && !/\s/u.test(next)) {
        this.textParts.push(" ");
        this.charGlyphIndices.push(-1);
      }
    }
    let pendingPrefix = "";
    for (let index = 0; index < compilation.textIndex.text.length; index += 1) {
      const character = compilation.textIndex.text[index];
      const reference = compilation.textIndex.charGlyphIndices[index];
      this.textParts.push(character);
      if (reference >= 0) {
        const globalIndex = glyphOffset + reference;
        this.charGlyphIndices.push(globalIndex);
        if (pendingPrefix.length > 0) {
          this.glyphPrefixes[globalIndex] += pendingPrefix;
          pendingPrefix = "";
        }
        this.glyphTexts[globalIndex] += character;
      } else if (reference === -1) {
        this.charGlyphIndices.push(-1);
        pendingPrefix += character;
      } else {
        this.charGlyphIndices.push(reference - fallbackOffset);
        pendingPrefix = "";
      }
    }
    this.diagnostics.push(...compilation.diagnostics);
    return glyphOffset;
  }

  /**
   * Map a transform store into the page store, in local order, on first use.
   * Later slices of the same compilation reuse the table instead of rekeying
   * every transform of the Form for each glyph run.
   */
  private remapTransforms(transforms: NativeTextCompilation["transforms"]): Uint32Array {
    const cached = this.transformRemaps.get(transforms);
    if (cached) return cached;
    const transformRemap = new Uint32Array(transforms.values.length / 6);
    for (let localIndex = 0; localIndex < transformRemap.length; localIndex += 1) {
      const offset = localIndex * 6;
      const matrix = transforms.values.subarray(offset, offset + 6);
      const key = Array.from(matrix).join(",");
      let globalIndex = this.transformKeys.get(key);
      if (globalIndex === undefined) {
        globalIndex = this.transforms.length / 6;
        if (globalIndex >= this.maxTransforms) {
          throw new PdfError("resource-limit", "Page text exceeds the transform limit.", {
            details: { reason: "page-text-transform-count", maxTransforms: this.maxTransforms }
          });
        }
        this.transforms.push(...matrix);
        this.transformKeys.set(key, globalIndex);
      }
      transformRemap[localIndex] = globalIndex;
    }
    this.transformRemaps.set(transforms, transformRemap);
    return transformRemap;
  }

  appendRun(compilation: NativeTextCompilation, runIndex: number): number {
    const run = compilation.runs[runIndex];
    if (!run || !Number.isSafeInteger(run.first) || !Number.isSafeInteger(run.count) ||
        run.count <= 0 || run.first < 0 ||
        run.first > compilation.glyphs.glyphIds.length - run.count) {
      throw new PdfError("invalid-object", "A native text event references an invalid glyph run.", {
        details: { reason: "vector-form-glyph-run", runIndex }
      });
    }
    this.appendDiagnosticsFrom(compilation);
    let runTexts = this.runTexts.get(compilation);
    if (!runTexts) {
      runTexts = indexNativeTextRuns(compilation);
      this.runTexts.set(compilation, runTexts);
    }
    return this.appendRunGlyphs(compilation, run, runTexts, runIndex);
  }

  /**
   * Append one glyph run of a larger compilation as if it were its own
   * compilation: its glyphs, a copy of the run starting at the new glyphs,
   * and its share of the Unicode text.
   */
  private appendRunGlyphs(
    compilation: NativeTextCompilation,
    run: Readonly<NativeTextDrawRun>,
    runTexts: NativeRunTextIndex,
    runIndex: number
  ): number {
    const glyphOffset = this.glyphIds.length;
    const { first, count } = run;
    if (count > this.maxGlyphs - glyphOffset) {
      throw new PdfError("resource-limit", "Page and reusable-program text exceeds the glyph limit.", {
        details: { reason: "page-glyph-count", maxGlyphs: this.maxGlyphs }
      });
    }
    const glyphs = compilation.glyphs;
    const total = glyphs.glyphIds.length;
    const advanceEms = compilation.glyphAdvanceEms?.length === total ? compilation.glyphAdvanceEms : null;
    const widthEms = compilation.glyphWidthEms?.length === total ? compilation.glyphWidthEms : null;
    const gapBefore = compilation.glyphGapBefore?.length === total ? compilation.glyphGapBefore : null;
    const transformRemap = this.remapTransforms(compilation.transforms);
    for (let index = first; index < first + count; index += 1) {
      const endPosition = compilation.actualTextEndPositions?.get(index);
      if (endPosition) this.actualTextEndPositions.set(glyphOffset + index - first, endPosition);
      this.fontIndices.push(glyphs.fontIndices[index]);
      this.characterCodes.push(glyphs.characterCodes[index]);
      this.glyphIds.push(glyphs.glyphIds[index]);
      this.transformIndices.push(transformRemap[glyphs.transformIndices[index]]);
      this.advances.push(glyphs.advances[index * 2], glyphs.advances[index * 2 + 1]);
      this.flags.push(glyphs.flags[index]);
      if (advanceEms) {
        this.glyphAdvanceEms.push(advanceEms[index]);
      } else {
        this.hasCompleteGlyphAdvanceEms = false;
        this.glyphAdvanceEms.push(0);
      }
      if (widthEms) {
        this.glyphWidthEms.push(widthEms[index]);
      } else {
        this.hasCompleteGlyphWidthEms = false;
        this.glyphWidthEms.push(0);
      }
      if (gapBefore) {
        this.glyphGapBefore.push(gapBefore[index]);
      } else {
        this.hasCompleteGlyphGapBefore = false;
        this.glyphGapBefore.push(0);
      }
      this.glyphPrefixes.push("");
      this.glyphTexts.push("");
    }
    this.runs.push(Object.freeze({ ...run, first: glyphOffset }));
    const text = compilation.textIndex.text;
    const start = runTexts.starts[runIndex];
    const end = runTexts.starts[runIndex + 1];
    if (end > start && this.pendingOccurrenceBoundary) {
      this.pendingOccurrenceBoundary = false;
      const previous = this.textParts.at(-1)?.at(-1) ?? "";
      const next = text[runTexts.positions[start]] ?? "";
      if (previous.length > 0 && next.length > 0 && !/\s/u.test(previous) && !/\s/u.test(next)) {
        this.textParts.push(" ");
        this.charGlyphIndices.push(-1);
      }
    }
    let pendingPrefix = "";
    for (let entry = start; entry < end; entry += 1) {
      const character = text[runTexts.positions[entry]];
      const reference = runTexts.references[entry];
      this.textParts.push(character);
      if (reference >= 0) {
        const globalIndex = glyphOffset + reference;
        this.charGlyphIndices.push(globalIndex);
        if (pendingPrefix.length > 0) {
          this.glyphPrefixes[globalIndex] += pendingPrefix;
          pendingPrefix = "";
        }
        this.glyphTexts[globalIndex] += character;
      } else {
        this.charGlyphIndices.push(-1);
        pendingPrefix += character;
      }
    }
    return glyphOffset;
  }

  appendDiagnosticsFrom(compilation: NativeTextCompilation): void {
    if (this.runSourcesWithDiagnostics.has(compilation)) return;
    this.runSourcesWithDiagnostics.add(compilation);
    this.diagnostics.push(...compilation.diagnostics);
  }

  beginOccurrenceBoundary(): { readonly pending: boolean; readonly textLength: number } {
    const state = Object.freeze({
      pending: this.pendingOccurrenceBoundary,
      textLength: this.charGlyphIndices.length
    });
    if (this.charGlyphIndices.length !== 0) this.pendingOccurrenceBoundary = true;
    return state;
  }

  endOccurrenceBoundary(
    state: { readonly pending: boolean; readonly textLength: number }
  ): void {
    this.pendingOccurrenceBoundary = this.charGlyphIndices.length > state.textLength
      ? true
      : state.pending;
  }

  /**
   * Expose the live glyph columns to the reusable-program expansion loop.
   * CharProc compilation may append nested glyphs, so this deliberately
   * retains the backing arrays instead of snapshotting them into typed arrays.
   */
  glyphView(): NativeAccumulatedGlyphView {
    return Object.freeze({
      fontIndices: this.fontIndices,
      characterCodes: this.characterCodes,
      glyphIds: this.glyphIds,
      flags: this.flags
    });
  }

  get glyphCount(): number {
    return this.glyphIds.length;
  }

  build(): NativeAccumulatedText {
    return Object.freeze({
      compilation: Object.freeze({
        transforms: { values: Float32Array.from(this.transforms) },
        glyphs: {
          fontIndices: Uint32Array.from(this.fontIndices),
          characterCodes: Uint32Array.from(this.characterCodes),
          glyphIds: Uint32Array.from(this.glyphIds),
          transformIndices: Uint32Array.from(this.transformIndices),
          advances: Float32Array.from(this.advances),
          flags: Uint8Array.from(this.flags)
        },
        textIndex: {
          version: 1 as const,
          text: this.textParts.join(""),
          charGlyphIndices: Int32Array.from(this.charGlyphIndices),
          fallbackQuads: Float32Array.from(this.fallbackQuads)
        },
        ...(this.hasCompleteGlyphAdvanceEms ? {
          glyphAdvanceEms: Float32Array.from(this.glyphAdvanceEms)
        } : {}),
        ...(this.hasCompleteGlyphWidthEms ? {
          glyphWidthEms: Float32Array.from(this.glyphWidthEms)
        } : {}),
        ...(this.hasCompleteGlyphGapBefore ? {
          glyphGapBefore: Uint8Array.from(this.glyphGapBefore)
        } : {}),
        ...(this.actualTextEndPositions.size > 0 ? { actualTextEndPositions: new Map(this.actualTextEndPositions) } : {}),
        runs: Object.freeze([...this.runs]),
        diagnostics: Object.freeze([...this.diagnostics])
      }),
      glyphPrefixes: Object.freeze([...this.glyphPrefixes]),
      glyphTexts: Object.freeze([...this.glyphTexts])
    });
  }
}

/**
 * Each glyph run's share of a compilation's Unicode text: entries
 * `[starts[run], starts[run + 1])` give the text position of a character and
 * its glyph relative to the run, or -1 for a separator.
 */
interface NativeRunTextIndex {
  readonly starts: Int32Array;
  readonly positions: Int32Array;
  readonly references: Int32Array;
}

/**
 * Index every glyph run's text in one pass over the Unicode index. Separators
 * attach to the run of the next non-separator character; any other character
 * clears them, exactly as a per-run scan would.
 */
function indexNativeTextRuns(compilation: NativeTextCompilation): NativeRunTextIndex {
  const runs = compilation.runs;
  const glyphRuns = new Int32Array(compilation.glyphs.glyphIds.length).fill(-1);
  let overlapping = false;
  for (let runIndex = 0; runIndex < runs.length && !overlapping; runIndex += 1) {
    const { first, count } = runs[runIndex];
    for (let glyph = first; glyph < first + count; glyph += 1) {
      if (glyphRuns[glyph] !== -1) {
        overlapping = true;
        break;
      }
      glyphRuns[glyph] = runIndex;
    }
  }
  const text = compilation.textIndex.text;
  const charGlyphIndices = compilation.textIndex.charGlyphIndices;
  const positions: number[][] = runs.map(() => []);
  const references: number[][] = runs.map(() => []);
  if (overlapping) {
    // Overlapping runs cannot share one pass; scan the text once per run.
    for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
      const first = runs[runIndex].first;
      const end = first + runs[runIndex].count;
      const pending: number[] = [];
      for (let index = 0; index < text.length; index += 1) {
        const reference = charGlyphIndices[index];
        if (reference === -1) {
          pending.push(index);
          continue;
        }
        if (reference <= -2) throw standaloneFallbackTextError();
        if (reference >= first && reference < end) {
          for (const separator of pending) {
            positions[runIndex].push(separator);
            references[runIndex].push(-1);
          }
          positions[runIndex].push(index);
          references[runIndex].push(reference - first);
        }
        pending.length = 0;
      }
    }
  } else {
    const pending: number[] = [];
    for (let index = 0; index < text.length; index += 1) {
      const reference = charGlyphIndices[index];
      if (reference === -1) {
        pending.push(index);
        continue;
      }
      if (reference <= -2) throw standaloneFallbackTextError();
      const runIndex = reference < glyphRuns.length ? glyphRuns[reference] : -1;
      if (runIndex >= 0) {
        for (const separator of pending) {
          positions[runIndex].push(separator);
          references[runIndex].push(-1);
        }
        positions[runIndex].push(index);
        references[runIndex].push(reference - runs[runIndex].first);
      }
      pending.length = 0;
    }
  }
  const starts = new Int32Array(runs.length + 1);
  for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
    starts[runIndex + 1] = starts[runIndex] + positions[runIndex].length;
  }
  const flatPositions = new Int32Array(starts[runs.length]);
  const flatReferences = new Int32Array(starts[runs.length]);
  for (let runIndex = 0; runIndex < runs.length; runIndex += 1) {
    flatPositions.set(positions[runIndex], starts[runIndex]);
    flatReferences.set(references[runIndex], starts[runIndex]);
  }
  return { starts, positions: flatPositions, references: flatReferences };
}

function standaloneFallbackTextError(): PdfError {
  return new PdfError(
    "unsupported-content",
    "Standalone fallback text cannot be ordered while flattening a Form XObject.",
    { details: { reason: "vector-form-fallback-text" } }
  );
}

async function loadResourceExtGStates(
  registry: NativePdfExtGStateRegistry,
  resources: PdfDictionary,
  resourceNames: readonly string[],
  signal: AbortSignal,
  fontRegistry: NativePageFontRegistry,
  allowType3 = true
): Promise<readonly DensePdfExtGStateDefinition[]> {
  const definitions: DensePdfExtGStateDefinition[] = [];
  for (const resourceName of resourceNames) {
    signal.throwIfAborted();
    const index = await registry.resolveExtGState(resources, resourceName, signal);
    const state = registry.describe(index);
    let font: DensePdfExtGStateDefinition["font"];
    if (state.font) {
      const resource = await fontRegistry.loadDirect(
        state.font.value, resources, signal, { label: `ExtGState /${resourceName}`, allowType3 }
      );
      font = Object.freeze({ fontIndex: resource.fontIndex, size: state.font.size });
    }
    definitions.push(Object.freeze({
      ...denseExtGStateDefinition(resourceName, state),
      ...(font ? { font } : {})
    }));
  }
  return definitions;
}

function denseExtGStateDefinition(
  resourceName: string,
  state: Readonly<NativePdfExtGStateDescription>
): DensePdfExtGStateDefinition {
  return Object.freeze({
    resourceName,
    ...(state.strokingAlpha === null ? {} : { strokeAlpha: state.strokingAlpha }),
    ...(state.nonstrokingAlpha === null ? {} : { fillAlpha: state.nonstrokingAlpha }),
    ...(state.effectiveBlendMode === null ? {} : { blendMode: state.effectiveBlendMode }),
    ...(state.softMask === null ? {} : {
      softMaskIndex: state.softMask.kind === "none" ? null : state.index
    }),
    ...(state.strokingOverprint === null ? {} : {
      strokeOverprint: state.strokingOverprint
    }),
    ...(state.nonstrokingOverprint === null ? {} : {
      fillOverprint: state.nonstrokingOverprint
    }),
    ...(state.overprintMode === null ? {} : { overprintMode: state.overprintMode }),
    ...(state.alphaIsShape === null ? {} : { alphaIsShape: state.alphaIsShape }),
    ...(state.textKnockout === null ? {} : { textKnockout: state.textKnockout }),
    ...(state.lineWidth === null ? {} : { lineWidth: state.lineWidth }),
    ...(state.lineCap === null ? {} : { lineCap: state.lineCap }),
    ...(state.lineJoin === null ? {} : { lineJoin: state.lineJoin }),
    ...(state.miterLimit === null ? {} : { miterLimit: state.miterLimit }),
    ...(state.lineDash === null ? {} : {
      lineDash: state.lineDash.array,
      dashPhase: state.lineDash.phase
    }),
    ...(state.renderingIntent === null ? {} : { renderingIntent: state.renderingIntent }),
    ...(state.flatnessTolerance === null ? {} : {
      flatnessTolerance: state.flatnessTolerance
    }),
    ...(state.smoothnessTolerance === null ? {} : {
      smoothnessTolerance: state.smoothnessTolerance
    }),
    ...(state.strokeAdjustment === null ? {} : {
      strokeAdjustment: state.strokeAdjustment
    })
  });
}

interface PreparedNativePageResources {
  readonly pageInfo: PdfPageInfo;
  readonly pageMatrix: DensePdfMatrix;
  readonly pageBounds: DensePdfBounds;
  readonly fontRegistry: NativePageFontRegistry;
  readonly fontResources: Array<readonly [string, NativeTextFontResource]>;
  readonly imageResources: LoadedPageImages;
  readonly pageContentSegments: readonly DensePdfContentSegment[];
  readonly extGStates: readonly DensePdfExtGStateDefinition[];
  readonly formGraph: NativePdfFormDefinitionGraph;
  readonly pageMarkedContentProperties: ReadonlyMap<string, Readonly<DensePdfMarkedContentPropertyDefinition>>;
  /** Decoded content length; an estimate until streamed content is compiled. */
  readonly totalBytes: number;
  /** Content decoded while it compiles; its resources load on first use. */
  readonly streamed?: NativeStreamedPageResources;
}

interface NativeStreamedPageResources {
  readonly resources: PdfDictionary;
  readonly content: StreamedPageContent;
  /** Page Forms, added on first use; annotations follow compilation. */
  readonly forms: NativePdfFormGraphBuilder;
  readonly formOptionalContent: Map<string, { optionalContentIndex: number; defaultVisible: boolean }>;
  /** Marked-content properties resolved so far, and which of them as optional content. */
  readonly properties: Map<string, Readonly<DensePdfMarkedContentPropertyDefinition> | undefined>;
  readonly optionalContentProperties: Set<string>;
  /** Everything else loaded so far, for a later compilation of the same content. */
  readonly fonts: Map<string, NativeTextFontResource>;
  readonly extGStates: Map<string, DensePdfExtGStateDefinition>;
  readonly colorSpaces: Set<string>;
  readonly xObjects: Set<string>;
  /** The completed Form graph, once the first compilation has finished. */
  graph: NativePdfFormDefinitionGraph | null;
}

/** Resolved properties of a streamed page, as prepared compilation passes them. */
function loadedMarkedContentProperties(
  properties: ReadonlyMap<string, Readonly<DensePdfMarkedContentPropertyDefinition> | undefined>
): Map<string, Readonly<DensePdfMarkedContentPropertyDefinition>> {
  const definitions = new Map<string, Readonly<DensePdfMarkedContentPropertyDefinition>>();
  for (const [name, definition] of properties) if (definition) definitions.set(name, definition);
  return definitions;
}

const EMPTY_RESOURCE_REFERENCES: DensePdfResourceReferences = Object.freeze({
  xObjects: Object.freeze([]),
  properties: Object.freeze([]),
  optionalContentProperties: Object.freeze([]),
  fonts: Object.freeze([]),
  extGStates: Object.freeze([]),
  colorSpaces: Object.freeze([]),
  shadings: Object.freeze([]),
  patterns: Object.freeze([])
});

/** Decoded streamed content is handed to the compiler in slices of this size. */
const STREAMED_CONTENT_CHUNK_BYTES = 256 * 1024;
/**
 * Streamed content has no decoded length up front. Progress estimates it from
 * the encoded length, typical for compressed CAD content, and never reports
 * more than 95% of an estimate before the content ends.
 */
const STREAMED_CONTENT_EXPANSION_ESTIMATE = 6;

/**
 * A page's content streams decoded on demand, joined by one newline exactly
 * as prepared content joins them, so source offsets match.
 */
class StreamedPageContent {
  readonly estimatedBytes: number;
  decodedBytes = 0;
  decodeMs = 0;

  private iterator: AsyncIterator<Uint8Array> | undefined;
  private remainder: Uint8Array = new Uint8Array(0);
  private preparedRemainder = false;
  private timings?: NativeVectorCompileTimings;
  private readonly inlineTails = new Map<number, {
    end: number; segments: readonly DensePdfContentSegment[];
  }>();

  private readonly document: NativePdfDocument;
  private readonly streams: readonly PdfStream[];
  private readonly signal: AbortSignal;
  private readonly prepareInline: (bytes: Uint8Array, offset: number) => Promise<readonly DensePdfContentSegment[]>;

  constructor(
    document: NativePdfDocument,
    streams: readonly PdfStream[],
    signal: AbortSignal,
    prepareInline: (bytes: Uint8Array, offset: number) => Promise<readonly DensePdfContentSegment[]>
  ) {
    this.document = document;
    this.streams = streams;
    this.signal = signal;
    this.prepareInline = prepareInline;
    let encodedBytes = streams.length > 0 ? streams.length - 1 : 0;
    for (const stream of streams) encodedBytes += stream.bytes.length;
    this.estimatedBytes = Math.max(1, encodedBytes * STREAMED_CONTENT_EXPANSION_ESTIMATE);
  }

  get hasInlineImages(): boolean { return this.inlineTails.size > 0; }

  estimateTotal(processedBytes: number): number {
    return Math.max(this.estimatedBytes, Math.ceil(processedBytes / 0.95));
  }

  private async nextChunk(): Promise<IteratorResult<Uint8Array>> {
    this.signal.throwIfAborted();
    if (!this.iterator) return { done: true, value: undefined };
    const startedAt = this.timings ? nativeVectorTimingNow() : 0;
    const next = await this.iterator.next();
    if (this.timings) this.decodeMs += nativeVectorTimingNow() - startedAt;
    if (!next.done) this.decodedBytes += next.value.length;
    return next;
  }

  /** Drain only this stream, starting at the lexer's clean BI boundary. */
  async prepareInlineRemainder(offset: number, buffered: Uint8Array): Promise<readonly DensePdfContentSegment[]> {
    this.signal.throwIfAborted();
    this.preparedRemainder = true;
    const cached = this.inlineTails.get(offset);
    if (cached) {
      await this.iterator?.return?.();
      this.decodedBytes = cached.end;
      this.remainder = new Uint8Array(0);
      return cached.segments;
    }
    const chunks = [buffered, this.remainder];
    let length = buffered.length + this.remainder.length;
    this.remainder = new Uint8Array(0);
    for (;;) {
      const next = await this.nextChunk();
      if (next.done) break;
      chunks.push(next.value);
      length += next.value.length;
    }
    this.signal.throwIfAborted();
    const startedAt = this.timings ? nativeVectorTimingNow() : 0;
    const bytes = new Uint8Array(length);
    let cursor = 0;
    for (const chunk of chunks) { bytes.set(chunk, cursor); cursor += chunk.length; }
    const segments = await this.prepareInline(bytes, offset);
    if (this.timings) this.timings.inlinePreparationMs += nativeVectorTimingNow() - startedAt;
    this.inlineTails.set(offset, { end: this.decodedBytes, segments });
    return segments;
  }

  /** A second compilation reuses bound inline tails, fonts and image pixels. */
  async *chunks(timings?: NativeVectorCompileTimings): AsyncGenerator<DensePdfContentSegment> {
    this.decodedBytes = 0;
    this.decodeMs = 0;
    this.timings = timings;
    let sourceOffset = 0;
    for (let index = 0; index < this.streams.length; index += 1) {
      this.preparedRemainder = false;
      this.iterator = this.document.decodeStreamChunks(this.streams[index], { signal: this.signal })[Symbol.asyncIterator]();
      let pending = new Uint8Array(STREAMED_CONTENT_CHUNK_BYTES);
      let pendingLength = 0;
      try {
        while (!this.preparedRemainder) {
          const next = await this.nextChunk();
          if (next.done) break;
          const chunk = next.value;
          let offset = 0;
          while (offset < chunk.length) {
            // Pass through large decoded chunks without another copy. The
            // compiler hands back their unconsumed suffix if it reaches BI.
            if (pendingLength === 0 && chunk.length - offset >= STREAMED_CONTENT_CHUNK_BYTES) {
              const bytes = chunk.subarray(offset);
              this.remainder = new Uint8Array(0);
              yield { kind: "content", bytes, sourceOffset, sourceLength: bytes.length };
              sourceOffset += bytes.length;
              break;
            }
            const copied = Math.min(pending.length - pendingLength, chunk.length - offset);
            pending.set(chunk.subarray(offset, offset + copied), pendingLength);
            pendingLength += copied;
            offset += copied;
            if (pendingLength === pending.length) {
              this.remainder = chunk.subarray(offset);
              yield { kind: "content", bytes: pending, sourceOffset, sourceLength: pendingLength };
              sourceOffset += pendingLength;
              pending = new Uint8Array(STREAMED_CONTENT_CHUNK_BYTES);
              pendingLength = 0;
              if (this.preparedRemainder) break;
            }
          }
          this.remainder = new Uint8Array(0);
        }
        if (pendingLength > 0) {
          yield { kind: "content", bytes: pending.subarray(0, pendingLength), sourceOffset, sourceLength: pendingLength };
        }
        sourceOffset = this.decodedBytes;
        // End the stream's last token before advancing to the next decoder.
        // An incomplete inline image must never consume another stream.
        if (index + 1 < this.streams.length) {
          this.decodedBytes += 1;
          yield { kind: "content", bytes: Uint8Array.of(0x0a), sourceOffset, sourceLength: 1 };
          sourceOffset = this.decodedBytes;
        }
      } finally {
        await this.iterator.return?.();
        this.iterator = undefined;
        this.remainder = new Uint8Array(0);
      }
    }
  }
}

interface NativePagePreparationReuse {
  prepared?: PreparedNativePageResources;
}

interface LoadedPageImages {
  readonly registry: NativePdfImageRegistry;
  readonly xObjectReferences: readonly NativePdfXObjectReference[];
  /** Exact page `/ColorSpace` dictionary used for image resource lookup. */
  readonly colorSpaces?: PdfDictionary;
  readonly indexes: ReadonlyMap<string, number>;
  readonly shadings: NativePdfShadingRegistry;
  readonly shadingIndexes: ReadonlyMap<string, number>;
  readonly patterns: NativePdfPatternRegistry;
  readonly extGStates: NativePdfExtGStateRegistry;
  readonly patternDefinitions: ReadonlyMap<string, Readonly<DensePdfPatternDefinition>>;
  readonly patternColorSpaces: ReadonlyMap<
    string,
    Readonly<DensePdfPatternColorSpaceDefinition>
  >;
  readonly colorSpaceResolver: DensePdfColorSpaceResolver;
  readonly optionalContent: ReadonlyMap<
    string,
    { optionalContentIndex: number; defaultVisible: boolean }
  >;
  /** Resolve one more page `/ColorSpace` name, as for a scanned reference. */
  loadColorSpace(resourceName: string): Promise<void>;
  /** Load one more page Image XObject into `indexes` and `optionalContent`. */
  loadImage(resourceName: string): Promise<void>;
  loadShading(resourceName: string): Promise<void>;
  loadPattern(resourceName: string): Promise<void>;
  assertReferencedCodecsAvailable(
    referencedNames: readonly string[],
    scopedIndexes?: ReadonlyMap<string, number>
  ): void;
}

const EMPTY_NATIVE_FORM_DEFINITION_GRAPH: NativePdfFormDefinitionGraph = Object.freeze({
  pageForms: new Map<string, number>(),
  definitions: Object.freeze([]),
  annotationPlacements: Object.freeze([])
});

interface ScopedImageResources {
  readonly indexes: ReadonlyMap<string, number>;
  readonly optionalContent: ReadonlyMap<
    string,
    { optionalContentIndex: number; defaultVisible: boolean }
  >;
}

interface ScopedColorResolver {
  readonly resolver: DensePdfColorSpaceResolver;
  readonly colorSpaces?: PdfDictionary;
  readonly patternColorSpaces: ReadonlyMap<
    string,
    Readonly<DensePdfPatternColorSpaceDefinition>
  >;
}

interface NativeVectorFormFlattenInput {
  readonly document: NativePdfDocument;
  readonly graph: NativePdfFormDefinitionGraph;
  readonly rootCompiled: DensePdfCompiledPage;
  readonly rootText: NativeTextCompilation;
  readonly imageResources: LoadedPageImages;
  readonly options: NativeVectorCompileOptions;
  readonly pageIndex: number;
  readonly pageBounds: DensePdfBounds;
  readonly signal: AbortSignal;
  readonly optionalContent: NativeOptionalContentRegistry;
  readonly fontRegistry: NativePageFontRegistry;
  readonly maxGlyphs: number;
  readonly timings?: NativeVectorCompileTimings;
}

interface NativeVectorCompiledOccurrence {
  readonly compiled: DensePdfCompiledPage;
  readonly text: NativeTextCompilation;
  readonly clipBounds: DensePdfBounds;
  readonly formDefinitionIndex: number;
}

interface NativeVectorFlattenResult {
  readonly compiled: DensePdfCompiledPage;
  readonly textCompilation: NativeTextCompilation;
  /** Root Form paint indexes omitted for an internal ordered raster composite. */
  readonly selectiveCompositeFormPaintIndices: readonly number[];
  readonly selectiveCompositeFormPaintOrders: readonly number[];
  readonly selectiveImagePaintOrdinalSpans: readonly (readonly [number, number])[];
  readonly selectivePaintSourceSpans: readonly (readonly [number, number])[];
  readonly selectivePaintSourceIntervals: readonly (readonly [number, number, number, number])[];
  /** Paint events inside Forms whose own structure content items could not be attributed. */
  readonly ignoredFormContentItems: number;
}

/**
 * Expand conservative Form occurrences directly into the established flat
 * VectorScene stores. Every occurrence is compiled in final page coordinates;
 * no reusable-program or page-native display ABI leaks into this path.
 */
async function flattenNativeVectorFormOccurrences(
  input: NativeVectorFormFlattenInput
): Promise<NativeVectorFlattenResult> {
  const {
    document,
    graph,
    rootCompiled,
    rootText,
    imageResources,
    options,
    pageIndex,
    pageBounds,
    signal,
    optionalContent,
    fontRegistry,
    maxGlyphs,
    timings
  } = input;
  signal.throwIfAborted();

  const colorScopes = new Map<number, Promise<ScopedColorResolver>>();
  const extGStateScopes = new Map<
    number,
    Promise<readonly DensePdfExtGStateDefinition[]>
  >();
  const imageScopes = new Map<number, Promise<ScopedImageResources>>();
  const vectorShadingScopes = new Map<number, Promise<ReadonlyMap<string, number>>>();
  const inlineScopes = new Map<number, Promise<readonly DensePdfContentSegment[]>>();
  const fontScopes = new Map<
    number,
    Promise<Array<readonly [string, NativeTextFontResource]>>
  >();
  const occurrenceCache = new Map<string, NativeVectorCompiledOccurrence | null>();
  const emptyTransparencyGroups = new Map<number, boolean>();

  const scopedColors = (definition: NativePdfFormDefinition): Promise<ScopedColorResolver> => {
    let pending = colorScopes.get(definition.definitionIndex);
    if (!pending) {
      pending = loadScopedColorResolver(
        document,
        definition.resources,
        imageResources.registry.colors,
        imageResources.colorSpaceResolver,
        definition.resourceReferences.colorSpaces,
        pageIndex,
        signal
      );
      colorScopes.set(definition.definitionIndex, pending);
    }
    return pending;
  };
  const scopedExtGStates = (
    definition: NativePdfFormDefinition
  ): Promise<readonly DensePdfExtGStateDefinition[]> => {
    let pending = extGStateScopes.get(definition.definitionIndex);
    if (!pending) {
      pending = loadResourceExtGStates(
        imageResources.extGStates,
        definition.resources,
        definition.resourceReferences.extGStates,
        signal,
        fontRegistry,
        false
      );
      extGStateScopes.set(definition.definitionIndex, pending);
    }
    return pending;
  };
  const scopedImages = (definition: NativePdfFormDefinition): Promise<ScopedImageResources> => {
    let pending = imageScopes.get(definition.definitionIndex);
    if (!pending) {
      pending = scopedColors(definition).then((colors) => loadScopedImageResources(
        document,
        imageResources.registry,
        optionalContent,
        definition.resources,
        definition.imageResourceNames,
        colors.colorSpaces,
        pageIndex,
        signal,
        options.retainOptionalContent !== false
      ));
      imageScopes.set(definition.definitionIndex, pending);
    }
    return pending;
  };
  const scopedContent = (
    definition: NativePdfFormDefinition
  ): Promise<readonly DensePdfContentSegment[]> => {
    let pending = inlineScopes.get(definition.definitionIndex);
    if (!pending) {
      pending = scopedColors(definition).then((colors) => bindPreparedInlineImages(
        definition.preparedContent,
        imageResources.registry,
        colors.colorSpaces,
        signal
      ));
      inlineScopes.set(definition.definitionIndex, pending);
    }
    return pending;
  };
  const scopedFonts = (
    definition: NativePdfFormDefinition
  ): Promise<Array<readonly [string, NativeTextFontResource]>> => {
    let pending = fontScopes.get(definition.definitionIndex);
    if (!pending) {
      pending = fontRegistry.loadScope(
        definition.resources,
        definition.resourceReferences.fonts,
        signal,
        { label: `Form XObject /${definition.resourceName}`, allowType3: false }
      );
      fontScopes.set(definition.definitionIndex, pending);
    }
    return pending;
  };

  const clipIdentities = new Map<DensePdfTextClip, number>();
  const scopedVectorShadings = (definition: NativePdfFormDefinition): Promise<ReadonlyMap<string, number>> => {
    let pending = vectorShadingScopes.get(definition.definitionIndex);
    if (!pending) {
      pending = (async () => {
        const indices = new Map<string, number>();
        for (const name of definition.resourceReferences.shadings) {
          signal.throwIfAborted();
          indices.set(name, await imageResources.shadings.add({ kind: "name", value: name }, definition.resources, signal));
        }
        return indices;
      })();
      vectorShadingScopes.set(definition.definitionIndex, pending);
    }
    return pending;
  };
  const compileOccurrence = async (
    definitionIndex: number,
    paint: DensePdfCompiledPage["formPaints"][number]
  ): Promise<NativeVectorCompiledOccurrence | null> => {
    signal.throwIfAborted();
    const definition = graph.definitions[definitionIndex];
    if (!definition) {
      throw new PdfError("invalid-object", "A Form event references a missing definition.", {
        pageIndex,
        details: { reason: "vector-form-definition", definitionIndex }
      });
    }
    if (options.retainOptionalContent === false && !definition.defaultVisible) {
      throw new PdfError("invalid-object", "A hidden Form reached native vector flattening.", {
        pageIndex,
        details: { reason: "vector-form-hidden", definitionIndex }
      });
    }
    if (definition.form.group && !emptyTransparencyGroups.has(definitionIndex)) {
      emptyTransparencyGroups.set(definitionIndex,
        nativeVectorTransparencyGroupIsEmpty(definition.content));
    }
    const group = definition.form.group;
    // A non-isolated group containing one opaque path paint is equivalent to
    // painting that path with the group's blend/opacity. Restrict this proof to
    // paths without internal compositing changes, then verify its paint count
    // after compilation. Multiple paints must retain their offscreen boundary.
    const singlePaintGroup = group && !emptyTransparencyGroups.get(definitionIndex) &&
      nativeVectorOrderedPaintEnabled(options) && !group.isolated && !group.knockout &&
      group.colorSpace === undefined && definition.resourceReferences.extGStates.length === 0 &&
      definition.resourceReferences.fonts.length === 0 && definition.formResources.size === 0 &&
      definition.imageResourceNames.length === 0 && definition.preparedContent.images.length === 0 &&
      (paint.initialGraphicsState.softMaskIndex ?? -1) < 0 && !paint.initialGraphicsState.alphaIsShape;
    if (group && !emptyTransparencyGroups.get(definitionIndex) && !singlePaintGroup) {
      throw vectorFormUnsupported(
        `Transparency-group Form /${definition.resourceName} requires an offscreen compositing pass.`,
        pageIndex,
        "vector-form-transparency-group",
        definition.resourceName
      );
    }
    if (!nativeVectorOrderedPaintEnabled(options) && !paint.clipIsDefault && paint.clipIsExactRectangle !== true) {
      throw vectorFormUnsupported(
        `Form /${definition.resourceName} is invoked through a non-default caller clip.`,
        pageIndex,
        "vector-form-caller-clip",
        definition.resourceName
      );
    }
    const shadingIndices = await scopedVectorShadings(definition);
    const vectorShadings = supportedNativeVectorShadings(imageResources.shadings);
    if (definition.resourceReferences.patterns.length !== 0 ||
        [...shadingIndices.values()].some(index => !nativeVectorOrderedPaintEnabled(options) || !vectorShadings.has(index))) {
      throw vectorFormUnsupported(
        `Form /${definition.resourceName} uses a shading or pattern that the flat VectorScene cannot order.`,
        pageIndex,
        "vector-form-procedural-paint",
        definition.resourceName
      );
    }
    const transform = multiplyNativePdfMatrices(paint.transform, definition.form.matrix);
    if (!nativeVectorOrderedPaintEnabled(options) && !mapsRectangleToAxisAlignedBounds(transform)) {
      throw vectorFormUnsupported(
        `Form /${definition.resourceName} has a rotated or sheared BBox clip.`,
        pageIndex,
        "vector-form-bbox-transform",
        definition.resourceName
      );
    }
    const transformedBox = transformNativePdfRectangle(definition.form.bbox, transform);
    const clipBounds = intersectVectorBounds(paint.clipBounds, transformedBox);
    if (paint.vectorClip && !clipIdentities.has(paint.vectorClip)) clipIdentities.set(paint.vectorClip, clipIdentities.size);
    const cacheKey = nativeVectorFormOccurrenceCacheKey(
      definitionIndex,
      paint,
      transform,
      clipBounds,
      options.optimization
    ) + (paint.vectorClip ? `:clip:${clipIdentities.get(paint.vectorClip)}` : "");
    if (occurrenceCache.has(cacheKey)) {
      if (timings) timings.formOccurrenceCacheHits += 1;
      const cached = occurrenceCache.get(cacheKey) ?? null;
      return cached ? materializeNativeVectorFormOccurrence(cached) : null;
    }
    if (timings) timings.formOccurrenceCacheMisses += 1;
    if (!clipBounds) {
      occurrenceCache.set(cacheKey, null);
      return null;
    }

    const colors = await scopedColors(definition);
    const images = await scopedImages(definition);
    const extGStates = await scopedExtGStates(definition);
    const fontResources = await scopedFonts(definition);
    const fontsByName = new Map<string, NativeTextFontResource>(fontResources);
    const markedContentProperties = await loadMarkedContentProperties(
      document,
      optionalContent,
      definition.resources,
      definition.resourceReferences.properties,
      definition.resourceReferences.optionalContentProperties,
      signal
    );
    const emittedTextRuns: NativeTextDrawRun[] = [];
    const textCompiler = new NativeTextCompiler({
      fonts: fontsByName,
      initialTransform: transform,
      maxGlyphs,
      maxGraphicsStateDepth: document.limits.maxRecursionDepth,
      signal,
      onRun(run) {
        emittedTextRuns.push(run);
      }
    });
    const textOperatorSink = {
      getFontSelection: () => textCompiler.getFontSelection(),
      applyOperator(
        operator: string,
        operands: readonly unknown[],
        context: Readonly<DensePdfTextOperatorContext>
      ) {
        emittedTextRuns.length = 0;
        textCompiler.setOutputEnabled(context.outputEnabled);
        if (context.font) {
          textCompiler.setFontResource(fontRegistry.resources[context.font.fontIndex], context.font.size);
        }
        textCompiler.applyOperator(operator, operands);
        return emittedTextRuns;
      }
    };
    if (paint.initialGraphicsState.font) {
      const { fontIndex, size } = paint.initialGraphicsState.font;
      textCompiler.setFontResource(fontRegistry.resources[fontIndex], size);
    }
    const compiled = await compileVectorFormContent(await scopedContent(definition), {
      pageMatrix: transform,
      pageBounds: clipBounds,
      initialGraphicsState: singlePaintGroup ? {
        ...paint.initialGraphicsState,
        strokeAlpha: paint.initialGraphicsState.fillAlpha
      } : paint.initialGraphicsState,
      retainOptionalContent: options.retainOptionalContent !== false && optionalContent.groupCount > 0,
      combineOptionalContent: (parent, own) => optionalContent.combineMemberships(parent, own),
      enableSegmentMerge: nativeVectorSegmentMergeEnabled(options),
      enableInvisibleCull: nativeVectorInvisibleCullEnabled(options),
      ...(nativeVectorOrderedPaintEnabled(options) ? { initialVectorClip: rectangleVectorClip({
        minX: definition.form.bbox[0], minY: definition.form.bbox[1],
        maxX: definition.form.bbox[2], maxY: definition.form.bbox[3]
      }, transform, paint.vectorClip ?? null) } : {}),
      textOperatorSink,
      extGStates,
      imageXObjects: images.indexes,
      imageOptionalContent: images.optionalContent,
      shadings: shadingIndices,
      vectorShadings,
      formXObjects: definition.formResources,
      formOptionalContent: formOptionalContentForScope(
        definition.formResources,
        graph.definitions
      ),
      markedContentProperties,
      maxMarkedContentDepth: document.limits.maxRecursionDepth,
      maxMarkedContent: options.limits?.maxCommandsPerPage ??
        document.limits.maxCommandsPerPage,
      ...densePathCompileLimits(document, options),
      colorSpaceResolver: colors.resolver,
      patternColorSpaces: colors.patternColorSpaces,
      totalBytes: definition.content.length,
      signal
    }, nativeVectorOrderedPaintEnabled(options) ? "source" : "grouped");
    if (singlePaintGroup && !nativeVectorGroupHasSinglePathPaint(compiled)) {
      throw vectorFormUnsupported(
        `Transparency-group Form /${definition.resourceName} requires an offscreen compositing pass.`,
        pageIndex,
        "vector-form-transparency-group",
        definition.resourceName
      );
    }
    imageResources.assertReferencedCodecsAvailable(compiled.referencedXObjects, images.indexes);
    const text = textCompiler.build();
    if (!nativeVectorOrderedPaintEnabled(options)) assertVectorFormPathsWithinClip(
      compiled,
      clipBounds,
      pageIndex,
      definition.resourceName
    );
    if (!nativeVectorOrderedPaintEnabled(options)) assertVectorFormTextWithinClip(
      text,
      compiled.vectorSceneData,
      fontRegistry.resources,
      clipBounds,
      pageIndex,
      definition.resourceName,
      signal
    );
    const cachedOccurrence: NativeVectorCompiledOccurrence = Object.freeze({
      compiled,
      text,
      clipBounds: Object.freeze({ ...clipBounds }),
      formDefinitionIndex: definitionIndex
    });
    occurrenceCache.set(cacheKey, cachedOccurrence);
    return materializeNativeVectorFormOccurrence(cachedOccurrence);
  };

  const ordered = nativeVectorOrderedPaintEnabled(options);
  // Resolve complete subtrees before appending any geometry or text. If a nested
  // effect needs compositing, its outer invocation must be captured atomically.
  const children = new Map<NativeVectorCompiledOccurrence, (NativeVectorCompiledOccurrence | null)[]>();
  const rejectedRootForms = new Map<number, string>();
  const preflightActive = new Set<number>();
  let preflightCommands = 0;
  let preflightPaths = 0;
  const preflight = async (owner: NativeVectorCompiledOccurrence): Promise<void> => {
    signal.throwIfAborted();
    preflightCommands += owner.compiled.operatorCount + 1;
    preflightPaths += owner.compiled.pathCount;
    if (preflightCommands > (options.limits?.maxCommandsPerPage ?? document.limits.maxCommandsPerPage) ||
        preflightPaths > (options.limits?.maxPathsPerPage ?? document.limits.maxPathsPerPage) ||
        preflightActive.size > document.limits.maxRecursionDepth) {
      throw new PdfError("resource-limit", "Expanded Form content exceeds its limits.", { pageIndex });
    }
    const resolved: (NativeVectorCompiledOccurrence | null)[] = [];
    children.set(owner, resolved);
    const sidecar = owner.compiled.vectorSceneData!;
    if (!ordered && owner.formDefinitionIndex >= 0) {
      for (let i = 0; i < sidecar.imageIndices.length; i++) {
        if (!unitSquareInsideBounds(sidecar.imageTransforms.subarray(i * 6, i * 6 + 6), owner.clipBounds)) {
          throw vectorFormUnsupported("A Form image crosses its BBox clip.", pageIndex, "vector-form-image-bbox");
        }
      }
    }
    for (let i = 0; i < owner.compiled.formPaints.length; i++) {
      const paint = owner.compiled.formPaints[i];
      if (preflightActive.has(paint.definitionIndex)) {
        throw vectorFormUnsupported("The Form invocation graph is cyclic.", pageIndex, "vector-form-cycle");
      }
      preflightActive.add(paint.definitionIndex);
      try {
        const child = await compileOccurrence(paint.definitionIndex, paint);
        if (child) await preflight(child);
        resolved[i] = child;
      } catch (error) {
        if (owner.formDefinitionIndex !== -1 || !(isSelectiveCompositeCandidateError(error) ||
            isOrderedFormClipFailure(error))) throw error;
        rejectedRootForms.set(i, describeSelectiveFormCause(error));
        resolved[i] = null;
      } finally {
        preflightActive.delete(paint.definitionIndex);
      }
    }
  };
  const pathPaintRanges: number[] = [];
  let mergedFillCount = 0;
  let mergedStrokeCount = 0;
  const textAccumulator = new NativePageTextAccumulator(maxGlyphs);
  const allOccurrences: NativeVectorCompiledOccurrence[] = [];
  const geometryOccurrences: NativeVectorCompiledOccurrence[] = [];
  const sourceEvents: number[] = [];
  const sourceClips: (DensePdfTextClip | null)[] = [];
  const sourceBlendModes: number[] = [];
  const sourceOptionalContentIndices: number[] = [];
  const sourceAnnotationIndices: number[] = [];
  const sourceContentItems: number[] = [];
  // Form content's own MCIDs resolve through the Form's /StructParents, which
  // no compiled page carries; that paint keeps its caller's item instead.
  let ignoredFormContentItems = 0;
  const appendSourceEvent = (kind: number, index: number, clip: DensePdfTextClip | null = null, blendMode = 0, condition = -1,
    annotation = -1, item = -1): void => {
    sourceEvents.push(kind, index); sourceClips.push(clip); sourceBlendModes.push(blendMode); sourceOptionalContentIndices.push(condition);
    sourceAnnotationIndices.push(annotation); sourceContentItems.push(item);
  };
  const glyphRunMeta: number[] = [];
  const glyphFillColors: number[] = [];
  const glyphStrokePaints: NonNullable<DensePdfVectorSceneData["glyphStrokePaints"]>[number][] = [];
  const glyphClipBounds: number[] = [];
  const glyphRunFlags: number[] = [];
  const glyphRunClips: NonNullable<DensePdfVectorSceneData["glyphRunClips"]>[number][] = [];
  const imageIndices: number[] = [];
  const imageTransforms: number[] = [];
  const imageClipBounds: number[] = [];
  const imagePaintOrders: number[] = [];
  const imageFlags: number[] = [];
  const imageOpacities: number[] = [];
  const shadingPaints: NonNullable<DensePdfVectorSceneData["shadingPaints"]>[number][] = [];
  const activeDefinitions = new Set<number>();
  const maxCommands = options.limits?.maxCommandsPerPage ?? document.limits.maxCommandsPerPage;
  const maxPaths = options.limits?.maxPathsPerPage ?? document.limits.maxPathsPerPage;
  let expandedOperatorCount = 0;
  let expandedPathCount = 0;
  let globalSawOrdinaryPaint = false;
  let recordedGlobalOrdinaryBarrier = false;
  let rootPackedFormSinceImage = false;
  let formOccurrenceCount = 0;
  const selectiveCompositeFormPaintIndices: number[] = [];
  // Captured paints live in whichever occurrence painted them, so the reasons
  // are gathered from every one rather than only the page's own content stream.
  const selectivePaintReasons = new Set<string>();
  const selectiveCompositeFormPaintOrders: number[] = [];

  const registerOccurrence = (occurrence: NativeVectorCompiledOccurrence): void => {
    allOccurrences.push(occurrence);
    expandedOperatorCount += occurrence.compiled.operatorCount;
    expandedPathCount += occurrence.compiled.pathCount;
    if (!Number.isSafeInteger(expandedOperatorCount) || expandedOperatorCount > maxCommands) {
      throw new PdfError("resource-limit", "Expanded Form content exceeds the command limit.", {
        pageIndex,
        details: { reason: "vector-form-command-count", count: expandedOperatorCount, limit: maxCommands }
      });
    }
    if (!Number.isSafeInteger(expandedPathCount) || expandedPathCount > maxPaths) {
      throw new PdfError("resource-limit", "Expanded Form content exceeds the path limit.", {
        pageIndex,
        details: { reason: "vector-form-path-count", count: expandedPathCount, limit: maxPaths }
      });
    }
  };

  const walkOccurrence = async (
    occurrence: NativeVectorCompiledOccurrence,
    inheritedFormPaintOrder: number | null = null,
    inheritedOptionalContent = -1,
    // An annotation appearance owns everything its Form paints, however nested.
    inheritedAnnotation = -1,
    // So does a page structure content item that invokes a Form.
    inheritedItem = -1
  ): Promise<boolean> => {
    signal.throwIfAborted();
    registerOccurrence(occurrence);
    textAccumulator.appendDiagnosticsFrom(occurrence.text);
    const sidecar = occurrence.compiled.vectorSceneData;
    for (const reason of sidecar?.selectivePaintReasons ?? []) selectivePaintReasons.add(reason);
    if (!sidecar || !(sidecar.sourceEvents instanceof Uint32Array) ||
        sidecar.sourceEvents.length % 2 !== 0) {
      throw new PdfError("invalid-object", "A Form occurrence has no valid source-event tape.", {
        pageIndex,
        details: { reason: "vector-form-event-tape" }
      });
    }
    const seenGlyphRuns = new Uint8Array(sidecar.glyphRunMeta.length / 3);
    const seenImages = new Uint8Array(sidecar.imageIndices.length);
    const seenForms = new Uint8Array(occurrence.compiled.formPaints.length);
    const seenShadings = new Uint8Array(sidecar.shadingPaints?.length ?? 0);
    let fillBase = 0;
    let strokeBase = 0;
    let ownerSawOrdinaryPaint = false;
    let ownerRecordedGeometry = false;
    let occurrenceHasPackedGeometry = false;
    for (let offset = 0; offset < sidecar.sourceEvents.length; offset += 2) {
      signal.throwIfAborted();
      const kind = sidecar.sourceEvents[offset];
      const localIndex = sidecar.sourceEvents[offset + 1];
      const vectorClip = sidecar.sourceClips?.[offset / 2] ?? null;
      const blendMode = sidecar.sourceBlendModes?.[offset / 2] ?? 0;
      const condition = optionalContent.combineMemberships(inheritedOptionalContent, sidecar.sourceOptionalContentIndices?.[offset / 2] ?? -1);
      const annotation = inheritedAnnotation >= 0 ? inheritedAnnotation : sidecar.sourceAnnotationIndices?.[offset / 2] ?? -1;
      const ownItem = sidecar.sourceContentItems?.[offset / 2] ?? -1;
      if (occurrence.formDefinitionIndex !== -1 && ownItem >= 0 && kind !== DENSE_PDF_VECTOR_SCENE_EVENT_ORDINARY_PAINT) ignoredFormContentItems += 1;
      const item = occurrence.formDefinitionIndex === -1 ? ownItem : inheritedItem;
      if (kind === DENSE_PDF_VECTOR_SCENE_EVENT_GLYPH) {
        if (localIndex >= seenGlyphRuns.length || seenGlyphRuns[localIndex] !== 0) {
          throw invalidVectorFormEvent(pageIndex, "glyph", localIndex);
        }
        seenGlyphRuns[localIndex] = 1;
        const localMeta = localIndex * 3;
        const count = sidecar.glyphRunMeta[localMeta + 1];
        const renderingMode = sidecar.glyphRunMeta[localMeta + 2];
        const globalFirst = textAccumulator.appendRun(occurrence.text, localIndex);
        if (globalFirst > 0xffff_ffff - count) {
          throw new PdfError("resource-limit", "Expanded Form glyph indexes exceed 32 bits.", {
            pageIndex,
            details: { reason: "vector-form-glyph-index" }
          });
        }
        glyphRunMeta.push(globalFirst, count, renderingMode);
        glyphFillColors.push(...sidecar.glyphFillColors.subarray(
          localIndex * 4,
          localIndex * 4 + 4
        ));
        glyphStrokePaints.push(sidecar.glyphStrokePaints?.[localIndex] ?? null);
        glyphClipBounds.push(...(sidecar.glyphClipBounds?.subarray(
          localIndex * 4,
          localIndex * 4 + 4
        ) ?? [
          occurrence.clipBounds.minX,
          occurrence.clipBounds.minY,
          occurrence.clipBounds.maxX,
          occurrence.clipBounds.maxY
        ]));
        glyphRunFlags.push(
          (sidecar.glyphRunFlags?.[localIndex] ?? 0) |
          (occurrence.formDefinitionIndex >= 0
            ? DENSE_PDF_VECTOR_SCENE_GLYPH_FLAG_CLIPPED
            : 0)
        );
        glyphRunClips.push(sidecar.glyphRunClips?.[localIndex] ?? null);
        appendSourceEvent(
          DENSE_PDF_VECTOR_SCENE_EVENT_GLYPH,
          glyphRunMeta.length / 3 - 1, vectorClip, blendMode, condition, annotation, item
        );
      } else if (kind === DENSE_PDF_VECTOR_SCENE_EVENT_IMAGE) {
        if (localIndex >= seenImages.length || seenImages[localIndex] !== 0) {
          throw invalidVectorFormEvent(pageIndex, "image", localIndex);
        }
        if (!ordered && globalSawOrdinaryPaint && occurrence.formDefinitionIndex !== -1) {
          throw vectorFormUnsupported(
            "A flattened Form paints an image after vector or text content.",
            pageIndex,
            "vector-form-image-order"
          );
        }
        if (!ordered && occurrence.formDefinitionIndex === -1 && rootPackedFormSinceImage) {
          throw vectorFormUnsupported(
            "A root late-image selective span crosses painted Form geometry.",
            pageIndex,
            "vector-form-image-order"
          );
        }
        seenImages[localIndex] = 1;
        const transformOffset = localIndex * 6;
        const transform = sidecar.imageTransforms.subarray(transformOffset, transformOffset + 6);
        if (!ordered && occurrence.formDefinitionIndex >= 0 &&
            !unitSquareInsideBounds(transform, occurrence.clipBounds)) {
          throw vectorFormUnsupported(
            "A Form image crosses its BBox clip and cannot be flattened exactly.",
            pageIndex,
            "vector-form-image-bbox"
          );
        }
        const globalIndex = imageIndices.length;
        imageIndices.push(sidecar.imageIndices[localIndex]);
        imageTransforms.push(...transform);
        imageClipBounds.push(...sidecar.imageClipBounds.subarray(
          localIndex * 4,
          localIndex * 4 + 4
        ));
        imagePaintOrders.push(
          occurrence.formDefinitionIndex === -1
            ? sidecar.imagePaintOrders[localIndex]
            : inheritedFormPaintOrder ?? globalIndex
        );
        imageFlags.push(sidecar.imageFlags[localIndex]);
        imageOpacities.push(sidecar.imageOpacities?.[localIndex] ?? 1);
        appendSourceEvent(DENSE_PDF_VECTOR_SCENE_EVENT_IMAGE, globalIndex, vectorClip, blendMode, condition, annotation, item);
        if (occurrence.formDefinitionIndex === -1) rootPackedFormSinceImage = false;
      } else if (kind === DENSE_PDF_VECTOR_SCENE_EVENT_FORM) {
        if (localIndex >= seenForms.length || seenForms[localIndex] !== 0) {
          throw invalidVectorFormEvent(pageIndex, "Form", localIndex);
        }
        seenForms[localIndex] = 1;
        const paint = occurrence.compiled.formPaints[localIndex];
        const formPaintOrder = occurrence.formDefinitionIndex === -1
          ? sidecar.formPaintOrders?.[localIndex]
          : inheritedFormPaintOrder;
        if (formPaintOrder === undefined || formPaintOrder === null) {
          throw new PdfError("invalid-object", "A Form occurrence has no source paint order.", {
            pageIndex,
            details: { reason: "vector-form-paint-order", localIndex }
          });
        }
        formOccurrenceCount += 1;
        if (formOccurrenceCount > maxCommands) {
          throw new PdfError("resource-limit", "Expanded Form occurrences exceed the command limit.", {
            pageIndex,
            details: { reason: "vector-form-occurrence-count", limit: maxCommands }
          });
        }
        if (activeDefinitions.has(paint.definitionIndex)) {
          throw vectorFormUnsupported(
            "The Form XObject invocation graph is cyclic.",
            pageIndex,
            "vector-form-cycle"
          );
        }
        activeDefinitions.add(paint.definitionIndex);
        const textBoundary = textAccumulator.beginOccurrenceBoundary();
        let childHasPackedGeometry = false;
        let childClipBounds: DensePdfBounds | null = null;
        try {
          try {
            if (ordered && occurrence.formDefinitionIndex === -1 && rejectedRootForms.has(localIndex)) {
              selectivePaintReasons.add(rejectedRootForms.get(localIndex) ?? "composited-form");
              selectiveCompositeFormPaintIndices.push(localIndex);
              selectiveCompositeFormPaintOrders.push(formPaintOrder);
              appendSourceEvent(DENSE_PDF_VECTOR_SCENE_EVENT_COMPOSITE, formPaintOrder, null, 0, condition, annotation, item);
            }
            const child = ordered ? children.get(occurrence)![localIndex]
              : await compileOccurrence(paint.definitionIndex, paint);
            if (child) {
              childClipBounds = child.clipBounds;
              childHasPackedGeometry = await walkOccurrence(child, formPaintOrder, condition, annotation, item);
            }
          } catch (error) {
            if (occurrence.formDefinitionIndex !== -1 ||
                !isSelectiveCompositeCandidateError(error)) {
              throw error;
            }
            // Suppress only the outermost invocation. Its complete reusable
            // display-program subtree is captured later as one ordered layer,
            // so no nested paint can leak into the packed VectorScene stores.
            selectivePaintReasons.add(describeSelectiveFormCause(error));
            selectiveCompositeFormPaintIndices.push(localIndex);
            selectiveCompositeFormPaintOrders.push(formPaintOrder);
          }
        } finally {
          activeDefinitions.delete(paint.definitionIndex);
          textAccumulator.endOccurrenceBoundary(textBoundary);
        }
        if (!ordered && ownerSawOrdinaryPaint && childHasPackedGeometry &&
            (!childClipBounds || !callerOrdinaryPaintIsDisjointFromForm(
              occurrence.compiled,
              occurrence.text,
              sidecar,
              fontRegistry.resources,
              childClipBounds
            ))) {
          throw vectorFormUnsupported(
            "A painted Form is interleaved with its caller's packed paint store.",
            pageIndex,
            "vector-form-interleaved-paint"
          );
        }
        occurrenceHasPackedGeometry = childHasPackedGeometry || occurrenceHasPackedGeometry;
        if (occurrence.formDefinitionIndex === -1 && childHasPackedGeometry) {
          rootPackedFormSinceImage = true;
        }
      } else if (kind === DENSE_PDF_VECTOR_SCENE_EVENT_ORDINARY_PAINT) {
        if (localIndex !== 0 || ownerSawOrdinaryPaint) {
          throw invalidVectorFormEvent(pageIndex, "ordinary-paint", localIndex);
        }
        ownerSawOrdinaryPaint = true;
        globalSawOrdinaryPaint = true;
        if (!recordedGlobalOrdinaryBarrier) {
          appendSourceEvent(DENSE_PDF_VECTOR_SCENE_EVENT_ORDINARY_PAINT, 0);
          recordedGlobalOrdinaryBarrier = true;
        }
        if (occurrence.compiled.fillPathCount !== 0 || occurrence.compiled.segmentCount !== 0) {
          fillBase = mergedFillCount;
          strokeBase = mergedStrokeCount;
          mergedFillCount += occurrence.compiled.fillPathCount;
          mergedStrokeCount += occurrence.compiled.segmentCount;
          geometryOccurrences.push(occurrence);
          ownerRecordedGeometry = true;
          occurrenceHasPackedGeometry = true;
        }
      } else if (ordered && kind === DENSE_PDF_VECTOR_SCENE_EVENT_GRADIENT) {
        if (localIndex >= seenShadings.length || seenShadings[localIndex] !== 0) {
          throw invalidVectorFormEvent(pageIndex, "shading", localIndex);
        }
        seenShadings[localIndex] = 1;
        appendSourceEvent(kind, shadingPaints.length, vectorClip, blendMode, condition, annotation, item);
        const paint = sidecar.shadingPaints![localIndex];
        shadingPaints.push({ ...paint, paintOrder: inheritedFormPaintOrder ?? paint.paintOrder });
      } else if (ordered && kind === DENSE_PDF_VECTOR_SCENE_EVENT_COMPOSITE) {
        appendSourceEvent(kind, localIndex, null, 0, -1, annotation, item);
      } else if (ordered && (kind === DENSE_PDF_VECTOR_SCENE_EVENT_FILL ||
          kind === DENSE_PDF_VECTOR_SCENE_EVENT_STROKE)) {
        const ranges = sidecar.pathPaintRanges;
        if (!ranges || localIndex * 2 + 1 >= ranges.length || !ownerRecordedGeometry) {
          throw invalidVectorFormEvent(pageIndex, "path", localIndex);
        }
        appendSourceEvent(kind, pathPaintRanges.length / 2, vectorClip, blendMode, condition, annotation, item);
        pathPaintRanges.push(ranges[localIndex * 2] +
          (kind === DENSE_PDF_VECTOR_SCENE_EVENT_FILL ? fillBase : strokeBase), ranges[localIndex * 2 + 1]);
      } else {
        throw invalidVectorFormEvent(pageIndex, "unknown", localIndex);
      }
    }
    if (seenGlyphRuns.some((value) => value === 0) ||
        seenImages.some((value) => value === 0) ||
        seenShadings.some((value) => value === 0) ||
        seenForms.some((value) => value === 0)) {
      throw new PdfError("invalid-object", "A Form source-event tape is incomplete.", {
        pageIndex,
        details: { reason: "vector-form-event-coverage" }
      });
    }
    if ((occurrence.compiled.fillPathCount !== 0 || occurrence.compiled.segmentCount !== 0) &&
        !ownerRecordedGeometry) {
      throw new PdfError("invalid-object", "Packed Form geometry has no paint barrier.", {
        pageIndex,
        details: { reason: "vector-form-geometry-event" }
      });
    }
    return occurrenceHasPackedGeometry;
  };

  const selectiveImageSpans = suppressVectorSelectiveImageSpans(rootCompiled, pageIndex);
  for (const reason of rootCompiled.vectorSceneData?.selectivePaintReasons ?? []) selectivePaintReasons.add(reason);
  const rootOccurrence = Object.freeze({
    compiled: selectiveImageSpans.compiled,
    text: rootText,
    clipBounds: pageBounds,
    formDefinitionIndex: -1
  });
  if (ordered) await preflight(rootOccurrence);
  await walkOccurrence(rootOccurrence);
  const accumulatedText = textAccumulator.build().compilation;
  const annotationIds = rootCompiled.vectorSceneData?.annotationIds;
  const contentItems = rootCompiled.vectorSceneData?.contentItems;
  const vectorSceneData: DensePdfVectorSceneData = Object.freeze({
    sourceEvents: Uint32Array.from(sourceEvents),
    ...(optionalContent.groupCount > 0 ? { sourceOptionalContentIndices: Int32Array.from(sourceOptionalContentIndices) } : {}),
    ...(annotationIds?.length ? { sourceAnnotationIndices: Int32Array.from(sourceAnnotationIndices), annotationIds } : {}),
    ...(contentItems?.length ? { sourceContentItems: Int32Array.from(sourceContentItems), contentItems } : {}),
    sourceBlendModes: Uint8Array.from(sourceBlendModes),
    ...(ordered ? { pathPaintRanges: Uint32Array.from(pathPaintRanges), sourceClips } : {}),
    glyphRunMeta: Uint32Array.from(glyphRunMeta),
    glyphFillColors: Float32Array.from(glyphFillColors),
    ...(glyphStrokePaints.some(paint => paint !== null) ? { glyphStrokePaints: Object.freeze(glyphStrokePaints) } : {}),
    glyphClipBounds: Float32Array.from(glyphClipBounds),
    glyphRunFlags: Uint8Array.from(glyphRunFlags),
    ...(glyphRunClips.some(clip => clip !== null) ? { glyphRunClips: Object.freeze(glyphRunClips) } : {}),
    imageIndices: Uint32Array.from(imageIndices),
    imageTransforms: Float32Array.from(imageTransforms),
    imageClipBounds: Float32Array.from(imageClipBounds),
    imagePaintOrders: Uint32Array.from(imagePaintOrders),
    imageFlags: Uint8Array.from(imageFlags),
    imageOpacities: Float32Array.from(imageOpacities),
    ...(shadingPaints.length ? { shadingPaints: Object.freeze(shadingPaints) } : {}),
    ...(selectivePaintReasons.size
      ? { selectivePaintReasons: Object.freeze([...selectivePaintReasons].sort()) } : {})
  });
  return Object.freeze({
    compiled: mergeNativeVectorOccurrences(
      rootCompiled,
      geometryOccurrences,
      allOccurrences,
      vectorSceneData
    ),
    textCompilation: accumulatedText,
    selectiveCompositeFormPaintIndices: Object.freeze(selectiveCompositeFormPaintIndices),
    selectiveCompositeFormPaintOrders: Object.freeze(selectiveCompositeFormPaintOrders),
    selectiveImagePaintOrdinalSpans: selectiveImageSpans.paintOrdinalSpans,
    selectivePaintSourceSpans: selectiveImageSpans.paintSourceSpans,
    selectivePaintSourceIntervals: selectiveImageSpans.paintSourceIntervals,
    ignoredFormContentItems
  });
}

function suppressVectorSelectiveImageSpans(
  compiled: DensePdfCompiledPage,
  pageIndex: number
): {
  compiled: DensePdfCompiledPage;
  paintOrdinalSpans: readonly (readonly [number, number])[];
  paintSourceSpans: readonly (readonly [number, number])[];
  paintSourceIntervals: readonly (readonly [number, number, number, number])[];
} {
  const sidecar = compiled.vectorSceneData;
  const checkpoints = sidecar?.imagePathSpanCheckpoints;
  const imageSourceSpans = sidecar?.imagePathSourceSpans;
  const standalone = sidecar?.selectivePaintOrdinalSpans;
  const sourceIdentities = sidecar?.selectivePaintSourceSpans;
  const paintSourceSpans: Array<readonly [number, number]> = [];
  const paintSourceIntervals: Array<readonly [number, number, number, number]> = [];
  if (sourceIdentities) {
    if (sourceIdentities.length % 2 !== 0) {
      throw new PdfError("invalid-object", "Selective source identities have an invalid length.", {
        pageIndex,
        details: { reason: "selective-source-identity-count" }
      });
    }
    for (let offset = 0; offset < sourceIdentities.length; offset += 2) {
      paintSourceSpans.push([sourceIdentities[offset], sourceIdentities[offset + 1]]);
    }
  }
  const standaloneSpans: Array<readonly [number, number]> = [];
  if (standalone) {
    if (standalone.length % 2 !== 0) {
      throw new PdfError("invalid-object", "Selective paint spans have an invalid length.", {
        pageIndex,
        details: { reason: "selective-paint-span-count" }
      });
    }
    for (let offset = 0; offset < standalone.length; offset += 2) {
      standaloneSpans.push(Object.freeze([standalone[offset], standalone[offset + 1]] as const));
    }
  }
  if (standaloneSpans.length !== paintSourceSpans.length) {
    throw new PdfError("invalid-object", "Selective paint identities and ordinals disagree.", {
      pageIndex,
      details: { reason: "selective-paint-identity-count" }
    });
  }
  if (!sidecar || !checkpoints || checkpoints.length === 0) {
    return { compiled, paintOrdinalSpans: Object.freeze(standaloneSpans), paintSourceSpans, paintSourceIntervals };
  }
  if (checkpoints.length !== sidecar.imageIndices.length * 6) {
    throw new PdfError("invalid-object", "Selective image checkpoints have an invalid length.", {
      pageIndex,
      details: { reason: "selective-image-checkpoint-count" }
    });
  }
  if (imageSourceSpans && imageSourceSpans.length !== sidecar.imageIndices.length * 4) {
    throw new PdfError("invalid-object", "Selective image source spans have an invalid length.", {
      pageIndex,
      details: { reason: "selective-image-source-span-count" }
    });
  }
  const fillSuppressed = new Uint8Array(compiled.fillPathCount);
  const strokeSuppressed = new Uint8Array(compiled.segmentCount);
  const imageSuppressed = new Uint8Array(sidecar.imageIndices.length);
  const spans: Array<readonly [number, number]> = [...standaloneSpans];
  for (let image = 0; image < sidecar.imageIndices.length; image += 1) {
    if ((sidecar.imageFlags[image] & DENSE_PDF_VECTOR_SCENE_IMAGE_FLAG_SELECTIVE_PATH_SPAN) === 0) continue;
    const offset = image * 6;
    const fillStart = checkpoints[offset];
    const fillEnd = checkpoints[offset + 1];
    const strokeStart = checkpoints[offset + 2];
    const strokeEnd = checkpoints[offset + 3];
    const ordinalStart = checkpoints[offset + 4];
    const ordinalEnd = checkpoints[offset + 5];
    if (fillStart > fillEnd || fillEnd > compiled.fillPathCount ||
        strokeStart > strokeEnd || strokeEnd > compiled.segmentCount ||
        ordinalStart > ordinalEnd) {
      throw new PdfError("invalid-object", "Selective image checkpoints are out of bounds.", {
        pageIndex,
        details: { reason: "selective-image-checkpoint-bounds", image }
      });
    }
    fillSuppressed.fill(1, fillStart, fillEnd);
    strokeSuppressed.fill(1, strokeStart, strokeEnd);
    imageSuppressed[image] = 1;
    spans.push(Object.freeze([ordinalStart, ordinalEnd] as const));
    if (imageSourceSpans) {
      paintSourceIntervals.push(Object.freeze([
        imageSourceSpans[image * 4],
        imageSourceSpans[image * 4 + 1],
        imageSourceSpans[image * 4 + 2],
        imageSourceSpans[image * 4 + 3]
      ] as const));
    }
  }
  if (spans.length === standaloneSpans.length) {
    return { compiled, paintOrdinalSpans: Object.freeze(spans), paintSourceSpans, paintSourceIntervals };
  }

  const fillMetaA: number[] = [];
  const fillMetaB: number[] = [];
  const fillMetaC: number[] = [];
  const fillSegmentsA: number[] = [];
  const fillSegmentsB: number[] = [];
  for (let path = 0; path < compiled.fillPathCount; path += 1) {
    if (fillSuppressed[path]) continue;
    const meta = path * 4;
    const sourceFirst = compiled.fillPathMetaA[meta];
    const count = compiled.fillPathMetaA[meta + 1];
    fillMetaA.push(fillSegmentsA.length / 4, count,
      compiled.fillPathMetaA[meta + 2], compiled.fillPathMetaA[meta + 3]);
    fillMetaB.push(...compiled.fillPathMetaB.subarray(meta, meta + 4));
    fillMetaC.push(...compiled.fillPathMetaC.subarray(meta, meta + 4));
    fillSegmentsA.push(...compiled.fillSegmentsA.subarray(sourceFirst * 4, (sourceFirst + count) * 4));
    fillSegmentsB.push(...compiled.fillSegmentsB.subarray(sourceFirst * 4, (sourceFirst + count) * 4));
  }
  const endpoints: number[] = [];
  const primitiveMeta: number[] = [];
  const primitiveBounds: number[] = [];
  const styles: number[] = [];
  for (let stroke = 0; stroke < compiled.segmentCount; stroke += 1) {
    if (strokeSuppressed[stroke]) continue;
    const offset = stroke * 4;
    endpoints.push(...compiled.endpoints.subarray(offset, offset + 4));
    primitiveMeta.push(...compiled.primitiveMeta.subarray(offset, offset + 4));
    primitiveBounds.push(...compiled.primitiveBounds.subarray(offset, offset + 4));
    styles.push(...compiled.styles.subarray(offset, offset + 4));
  }
  const imageMap = new Int32Array(sidecar.imageIndices.length).fill(-1);
  const imageIndices: number[] = [];
  const imageTransforms: number[] = [];
  const imageClipBounds: number[] = [];
  const imagePaintOrders: number[] = [];
  const imageFlags: number[] = [];
  const imageOpacities: number[] = [];
  const imageCheckpoints: number[] = [];
  for (let image = 0; image < sidecar.imageIndices.length; image += 1) {
    if (imageSuppressed[image]) continue;
    imageMap[image] = imageIndices.length;
    imageIndices.push(sidecar.imageIndices[image]);
    imageTransforms.push(...sidecar.imageTransforms.subarray(image * 6, image * 6 + 6));
    imageClipBounds.push(...sidecar.imageClipBounds.subarray(image * 4, image * 4 + 4));
    imagePaintOrders.push(sidecar.imagePaintOrders[image]);
    imageFlags.push(sidecar.imageFlags[image]);
    imageOpacities.push(sidecar.imageOpacities?.[image] ?? 1);
    imageCheckpoints.push(...checkpoints.subarray(image * 6, image * 6 + 6));
  }
  const sourceEvents: number[] = [];
  const sourceBlendModes: number[] = [];
  // Every per-event array keeps its alignment with the surviving events.
  const sourceOptionalContentIndices: number[] = [];
  const sourceAnnotationIndices: number[] = [];
  const sourceContentItems: number[] = [];
  const sourceClips: (DensePdfTextClip | null)[] = [];
  for (let offset = 0; offset < sidecar.sourceEvents.length; offset += 2) {
    const kind = sidecar.sourceEvents[offset];
    const index = sidecar.sourceEvents[offset + 1];
    if (kind === DENSE_PDF_VECTOR_SCENE_EVENT_IMAGE && imageSuppressed[index]) continue;
    sourceEvents.push(kind, kind === DENSE_PDF_VECTOR_SCENE_EVENT_IMAGE ? imageMap[index] : index);
    sourceBlendModes.push(sidecar.sourceBlendModes?.[offset / 2] ?? 0);
    sourceOptionalContentIndices.push(sidecar.sourceOptionalContentIndices?.[offset / 2] ?? -1);
    sourceAnnotationIndices.push(sidecar.sourceAnnotationIndices?.[offset / 2] ?? -1);
    sourceContentItems.push(sidecar.sourceContentItems?.[offset / 2] ?? -1);
    sourceClips.push(sidecar.sourceClips?.[offset / 2] ?? null);
  }
  const reducedFillBounds = aggregateFloat4Bounds(fillMetaA, fillMetaB, 2, 3, 0, 1);
  const reducedStrokeBounds = aggregateFloat4Bounds(
    primitiveBounds,
    primitiveBounds,
    0,
    1,
    2,
    3
  );
  return {
    compiled: {
      ...compiled,
      fillPathCount: fillMetaA.length / 4,
      fillSegmentCount: fillSegmentsA.length / 4,
      fillPathMetaA: Float32Array.from(fillMetaA),
      fillPathMetaB: Float32Array.from(fillMetaB),
      fillPathMetaC: Float32Array.from(fillMetaC),
      fillSegmentsA: Float32Array.from(fillSegmentsA),
      fillSegmentsB: Float32Array.from(fillSegmentsB),
      segmentCount: endpoints.length / 4,
      imageLayerSegmentCount: (compiled.imageLayerSegmentCount ?? 0) +
        compiled.segmentCount - endpoints.length / 4,
      endpoints: Float32Array.from(endpoints),
      primitiveMeta: Float32Array.from(primitiveMeta),
      primitiveBounds: Float32Array.from(primitiveBounds),
      styles: Float32Array.from(styles),
      fillBounds: reducedFillBounds,
      strokeBounds: reducedStrokeBounds,
      bounds: unionDenseBounds(reducedFillBounds, reducedStrokeBounds) ?? compiled.bounds,
      vectorSceneData: {
        ...sidecar,
        sourceEvents: Uint32Array.from(sourceEvents),
        sourceBlendModes: Uint8Array.from(sourceBlendModes),
        ...(sidecar.sourceOptionalContentIndices ? { sourceOptionalContentIndices: Int32Array.from(sourceOptionalContentIndices) } : {}),
        ...(sidecar.sourceAnnotationIndices ? { sourceAnnotationIndices: Int32Array.from(sourceAnnotationIndices) } : {}),
        ...(sidecar.sourceContentItems ? { sourceContentItems: Int32Array.from(sourceContentItems) } : {}),
        ...(sidecar.sourceClips ? { sourceClips } : {}),
        imageIndices: Uint32Array.from(imageIndices),
        imageTransforms: Float32Array.from(imageTransforms),
        imageClipBounds: Float32Array.from(imageClipBounds),
        imagePaintOrders: Uint32Array.from(imagePaintOrders),
        imageFlags: Uint8Array.from(imageFlags),
        imageOpacities: Float32Array.from(imageOpacities),
        imagePathSpanCheckpoints: Uint32Array.from(imageCheckpoints)
      }
    },
    paintOrdinalSpans: Object.freeze(spans),
    paintSourceSpans: Object.freeze(paintSourceSpans),
    paintSourceIntervals: Object.freeze(paintSourceIntervals)
  };
}

function aggregateFloat4Bounds(
  minima: readonly number[],
  maxima: readonly number[],
  minXIndex: number,
  minYIndex: number,
  maxXIndex: number,
  maxYIndex: number
): DensePdfBounds | null {
  if (minima.length === 0) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (let offset = 0; offset < minima.length; offset += 4) {
    minX = Math.min(minX, minima[offset + minXIndex]);
    minY = Math.min(minY, minima[offset + minYIndex]);
    maxX = Math.max(maxX, maxima[offset + maxXIndex]);
    maxY = Math.max(maxY, maxima[offset + maxYIndex]);
  }
  return { minX, minY, maxX, maxY };
}

function unionDenseBounds(
  left: DensePdfBounds | null,
  right: DensePdfBounds | null
): DensePdfBounds | null {
  if (!left) return right;
  if (!right) return left;
  return {
    minX: Math.min(left.minX, right.minX),
    minY: Math.min(left.minY, right.minY),
    maxX: Math.max(left.maxX, right.maxX),
    maxY: Math.max(left.maxY, right.maxY)
  };
}

function isOrderedFormClipFailure(error: unknown): boolean {
  if (error instanceof DensePdfUnsupportedError) {
    return /^(VectorScene output cannot (?:represent|prove) an? arbitrary|VectorScene output cannot prove an arbitrarily)/.test(error.message);
  }
  return error instanceof PdfError && error.code === "unsupported-content" &&
    ["vector-form-caller-clip", "vector-form-path-bbox", "vector-form-image-bbox",
      "vector-form-text-bbox", "vector-form-bbox-transform"].includes(String(error.details?.reason));
}

/**
 * The feature that stopped a Form from compiling into vectors, named so the
 * fallback warning says what to look for rather than only that a Form was
 * captured. Unrecognized causes report their reason code verbatim.
 */
function describeSelectiveFormCause(error: unknown): string {
  if (error instanceof DensePdfUnsupportedError) {
    if (error.message.includes("alpha-as-shape")) return "composited-form:alpha-as-shape";
    if (error.message.includes("soft mask")) return "composited-form:soft-mask";
    if (/rendering mode/.test(error.message)) return "composited-form:text-rendering-mode";
    const blend = /cannot represent \/(.+) blending/.exec(error.message);
    if (blend) return `composited-form:blend-${blend[1].toLowerCase()}`;
    return "composited-form";
  }
  const reason = error instanceof PdfError ? error.details?.reason : undefined;
  return typeof reason === "string" ? `composited-form:${reason.replace(/^vector-form-/, "")}` : "composited-form";
}

function isSelectiveCompositeCandidateError(error: unknown): boolean {
  if (error instanceof DensePdfUnsupportedError) {
    return error.message === "VectorScene output cannot represent alpha-as-shape compositing." ||
      error.message === "VectorScene output cannot represent a soft mask." ||
      /^VectorScene output supports only fill and invisible text, not rendering mode [12]\.$/.test(error.message) ||
      /^VectorScene output cannot represent \/.+ blending\.$/.test(error.message);
  }
  if (!(error instanceof PdfError) || error.code !== "unsupported-content") return false;
  const reason = error.details?.reason;
  return typeof reason === "string" && (
    reason === "vector-form-transparency-group" ||
    reason === "vector-form-procedural-paint" ||
    reason === "vector-form-image-order"
  );
}

async function renderNativeSelectiveCompositeLayers(
  page: HeprPageData,
  suppressedFormPaintIndices: readonly number[],
  suppressedFormPaintOrders: readonly number[],
  imagePaintOrdinalSpans: readonly (readonly [number, number])[],
  paintSourceSpans: readonly (readonly [number, number])[],
  paintSourceIntervals: readonly (readonly [number, number, number, number])[],
  signal: AbortSignal,
  timings?: NativeVectorCompileTimings,
  reuseCompositeSurfaces = true,
  boundCompositeWork = true,
  onDiagnostic?: (diagnostic: PdfDiagnostic) => void,
  onCompositeText?: () => void,
  limits?: Readonly<PdfResourceLimits>
): Promise<NativeSelectiveRasterLayer[]> {
  signal.throwIfAborted();
  const root = page.displayProgram.groups[page.displayProgram.rootGroupIndex];
  if (!root) throw new PdfError("invalid-object", "The page display program has no root group.");
  const formCommandPositions: number[] = [];
  for (let index = 0; index < root.commands.length; index += 1) {
    const command = root.commands[index];
    if (command.kind === "invoke-program" &&
        page.displayProgram.programs[command.programIndex]?.kind === "form") {
      formCommandPositions.push(index);
    }
  }
  if (suppressedFormPaintIndices.length !== suppressedFormPaintOrders.length) {
    throw new PdfError("invalid-object", "Suppressed Forms have inconsistent paint-order metadata.", {
      details: { reason: "selective-composite-form-order" }
    });
  }
  const selectedPositions = suppressedFormPaintIndices.map((paintIndex, index) => {
    const position = formCommandPositions[paintIndex];
    if (position === undefined) {
      throw new PdfError("invalid-object", "A suppressed Form has no display-program invocation.", {
        details: { reason: "selective-composite-form-map", paintIndex }
      });
    }
    return { position, paintOrder: suppressedFormPaintOrders[index] };
  }).sort((left, right) => left.position - right.position);
  interface SelectiveCommandRange {
    readonly first: number;
    readonly last: number;
    readonly paintOrder: number;
  }
  const ranges: SelectiveCommandRange[] = [];
  const sourceSelectedCommandIndices = new Set<number>();
  const standaloneSpanCount = paintSourceSpans.length;
  for (const selected of selectedPositions) {
    ranges.push({
      first: selected.position,
      last: selected.position,
      paintOrder: selected.paintOrder
    });
  }
  let logicalOrdinal = 0;
  for (let commandIndex = 0; commandIndex < root.commands.length; commandIndex += 1) {
    for (const [spanFirst, spanLast] of (paintSourceIntervals.length === 0
      ? imagePaintOrdinalSpans.slice(standaloneSpanCount)
      : [])) {
      if (spanFirst === logicalOrdinal) {
        const lastCommand = commandIndex + spanLast - spanFirst;
        if (lastCommand >= root.commands.length) {
          throw new PdfError("unsupported-content", "A selective paint span exceeds the root program.", {
            details: { reason: "selective-image-command-boundary" }
          });
        }
        ranges.push({ first: commandIndex, last: lastCommand, paintOrder: spanLast });
      }
    }
    logicalOrdinal += 1;
  }
  ranges.sort((left, right) => left.first - right.first);
  for (let intervalIndex = 0; intervalIndex < paintSourceIntervals.length; intervalIndex += 1) {
    const [firstOffset, firstLength, lastOffset, lastLength] =
      paintSourceIntervals[intervalIndex];
    const paintOrder = imagePaintOrdinalSpans[standaloneSpanCount + intervalIndex]?.[1];
    if (paintOrder === undefined) {
      throw new PdfError("invalid-object", "A selective source interval has no paint order.", {
        details: { reason: "selective-source-interval-order", intervalIndex }
      });
    }
    const intervalEnd = lastOffset + lastLength;
    let foundFirst = false;
    let foundLast = false;
    for (let commandIndex = 0; commandIndex < root.commands.length; commandIndex += 1) {
      const command = root.commands[commandIndex];
      const identity = getHeprCommandPaintSourceIdentity(command);
      if (!identity) continue;
      foundFirst ||= identity[0] === firstOffset && identity[1] === firstLength;
      foundLast ||= identity[0] === lastOffset && identity[1] === lastLength;
      if (identity[0] < firstOffset || identity[0] + identity[1] > intervalEnd) continue;
      if (command.kind === "invoke-program" || heprCommandContainsGlyph(page, command)) continue;
      ranges.push({ first: commandIndex, last: commandIndex, paintOrder });
      sourceSelectedCommandIndices.add(commandIndex);
    }
    if (!foundFirst || !foundLast) {
      throw new PdfError("unsupported-content", "A selective source interval endpoint is missing.", {
        details: { reason: "selective-source-interval-endpoint", firstOffset, lastOffset }
      });
    }
  }
  ranges.sort((left, right) => left.first - right.first);
  for (let spanIndex = 0; spanIndex < paintSourceSpans.length; spanIndex += 1) {
    const [sourceOffset, sourceLength] = paintSourceSpans[spanIndex];
    const paintOrder = imagePaintOrdinalSpans[spanIndex]?.[1];
    if (paintOrder === undefined) {
      throw new PdfError("invalid-object", "A selective source paint has no paint order.", {
        details: { reason: "selective-source-paint-order", spanIndex }
      });
    }
    const matches = root.commands.flatMap((command, index) => {
      const identity = getHeprCommandPaintSourceIdentity(command);
      return identity?.[0] === sourceOffset && identity[1] === sourceLength ? [index] : [];
    });
    if (matches.length === 0) {
      throw new PdfError("unsupported-content", "A selective source paint identity is ambiguous or missing.", {
        details: { reason: "selective-source-identity-missing", sourceOffset, sourceLength }
      });
    }
    for (const commandIndex of matches) {
      ranges.push({ first: commandIndex, last: commandIndex, paintOrder });
      sourceSelectedCommandIndices.add(commandIndex);
    }
  }
  ranges.sort((left, right) => left.first - right.first);
  const coalescedRanges: SelectiveCommandRange[] = [];
  for (const range of ranges) {
    const previous = coalescedRanges[coalescedRanges.length - 1];
    if (previous && range.first <= previous.last + 1) {
      coalescedRanges[coalescedRanges.length - 1] = {
        first: previous.first,
        last: Math.max(previous.last, range.last),
        paintOrder: Math.max(previous.paintOrder, range.paintOrder)
      };
    } else {
      coalescedRanges.push(range);
    }
  }
  const surfaceFactory = await createNativeCompositeSurfaceFactory();
  const { renderHeprPageToCanvas2d, HeprCanvas2dImageSurfaceCache } = await import("./heprCanvas2dRenderer");
  const compositeTimings = timings ? (timings.selectiveCompositing = {
    renderMs: 0, imageSurfaceMs: 0, imageSurfaces: 0, imageSurfacePixels: 0,
    imageSurfaceHits: 0, softMaskMs: 0, softMaskPixels: 0,
    readbackMs: 0, readbackPixels: 0, renders: 0
  }) : undefined;
  const layers: NativeSelectiveRasterLayer[] = [];
  const imageSurfaces = reuseCompositeSurfaces ? new HeprCanvas2dImageSurfaceCache(
    page, surfaceFactory,
    surface => surfaceFactory.retain(surface.canvas),
    surface => surfaceFactory.release(surface.canvas)
  ) : undefined;
  const renderInternals = { timings: compositeTimings, imageSurfaces, boundSoftMasks: boundCompositeWork, onDiagnostic };
  try {
    for (const { first, last, paintOrder } of coalescedRanges) {
      signal.throwIfAborted();
      const commands = root.commands.slice(first, last + 1);
      const unselectedGlyphOffset = commands.findIndex((command, offset) =>
        heprCommandContainsGlyph(page, command) &&
        !sourceSelectedCommandIndices.has(first + offset));
      if (unselectedGlyphOffset >= 0 && !onCompositeText) {
        throw new PdfError(
          "unsupported-content",
          "A selective composite contains text and cannot preserve VectorScene search semantics.",
          {
            details: {
              reason: "selective-composite-nonvector-resource",
              firstCommandIndex: first,
              lastCommandIndex: last,
              glyphCommandIndex: first + unselectedGlyphOffset,
              paintOrder
            }
          }
        );
      }
      if (unselectedGlyphOffset >= 0) onCompositeText?.();
      const layer = await renderNativeCompositeCommandSpan(page, first, last, paintOrder,
        signal, surfaceFactory, renderHeprPageToCanvas2d, renderInternals, boundCompositeWork, limits);
      if (layer) layers.push(layer);
    }
    return layers;
  } finally {
    imageSurfaces?.dispose();
    surfaceFactory.releaseAll();
  }
}

function heprCommandContainsGlyph(
  page: HeprPageData,
  command: HeprDisplayCommand
): boolean {
  if (command.kind === "draw") return command.source === "glyphs";
  const commands = command.kind === "invoke-program"
    ? page.displayProgram.programs[command.programIndex]?.commands
    : page.displayProgram.groups[command.groupIndex]?.commands;
  if (command.kind === "invoke-group") {
    const softMask = page.displayProgram.groups[command.groupIndex]?.softMaskGroupIndex ?? -1;
    if (softMask >= 0 && (page.displayProgram.groups[softMask]?.commands ?? []).some(
      (nested) => heprCommandContainsGlyph(page, nested)
    )) return true;
  }
  return (commands ?? []).some((nested) => heprCommandContainsGlyph(page, nested));
}

/**
 * Empty groups have no source alpha and therefore cannot change their backdrop.
 * Restrict this proof to balanced saved-state wrappers and PDF comments/white
 * space; zero-opacity paints or invisible text can still affect group shape.
 * The ordinary compiler still processes these operators and enforces limits.
 */
function nativeVectorTransparencyGroupIsEmpty(content: Uint8Array): boolean {
  let depth = 0;
  for (let offset = 0; offset < content.length; offset += 1) {
    const byte = content[offset];
    if (byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32) continue;
    if (byte === 37) {
      while (offset + 1 < content.length && content[offset + 1] !== 10 && content[offset + 1] !== 13) offset += 1;
      continue;
    }
    if (byte === 113) depth += 1;
    else if (byte === 81 && depth > 0) depth -= 1;
    else return false;
    const next = content[offset + 1];
    if (next !== undefined && next !== 0 && next !== 9 && next !== 10 &&
        next !== 12 && next !== 13 && next !== 32 && next !== 37) return false;
  }
  return depth === 0;
}

function nativeVectorGroupHasSinglePathPaint(compiled: DensePdfCompiledPage): boolean {
  const events = compiled.vectorSceneData?.sourceEvents;
  if (!events) return false;
  let paints = 0;
  for (let offset = 0; offset < events.length; offset += 2) {
    const kind = events[offset];
    if (kind === DENSE_PDF_VECTOR_SCENE_EVENT_ORDINARY_PAINT) continue;
    if (kind !== DENSE_PDF_VECTOR_SCENE_EVENT_FILL && kind !== DENSE_PDF_VECTOR_SCENE_EVENT_STROKE) return false;
    paints += 1;
  }
  // Adjacent compatible paths share an event; count the paint operations.
  return paints === 1 && (compiled.vectorSceneData?.pathPaintCount ?? paints) === 1;
}

function nativeVectorFormOccurrenceCacheKey(
  definitionIndex: number,
  paint: DensePdfCompiledPage["formPaints"][number],
  finalTransform: DensePdfMatrix,
  effectiveClipBounds: DensePdfBounds | null,
  optimization: PdfCompileOptions["optimization"]
): string {
  return JSON.stringify([
    "legacy-vector-form-occurrence-v1",
    formSpecializationKey(definitionIndex, paint.initialGraphicsState),
    paint.transform,
    finalTransform,
    [
      paint.clipBounds.minX,
      paint.clipBounds.minY,
      paint.clipBounds.maxX,
      paint.clipBounds.maxY
    ],
    effectiveClipBounds === null ? null : [
      effectiveClipBounds.minX,
      effectiveClipBounds.minY,
      effectiveClipBounds.maxX,
      effectiveClipBounds.maxY
    ],
    paint.clipIsDefault,
    paint.clipIsExactRectangle,
    optimization === "none" ? "none" : "safe"
  ]);
}

function materializeNativeVectorFormOccurrence(
  cached: NativeVectorCompiledOccurrence
): NativeVectorCompiledOccurrence {
  // Cached typed arrays stay internal and read-only. The accumulator and
  // mergeNativeVectorOccurrences allocate every outgoing text/vector store,
  // so worker transfer can never detach a buffer retained by this cache. A
  // fresh text wrapper also preserves per-occurrence diagnostic accounting.
  return Object.freeze({
    compiled: cached.compiled,
    text: Object.freeze({ ...cached.text }),
    clipBounds: Object.freeze({ ...cached.clipBounds }),
    formDefinitionIndex: cached.formDefinitionIndex
  });
}

function mergeNativeVectorOccurrences(
  root: DensePdfCompiledPage,
  geometry: readonly NativeVectorCompiledOccurrence[],
  all: readonly NativeVectorCompiledOccurrence[],
  vectorSceneData: DensePdfVectorSceneData
): DensePdfCompiledPage {
  const fillPathCount = sumOccurrenceField(geometry, "fillPathCount");
  const fillSegmentCount = sumOccurrenceField(geometry, "fillSegmentCount");
  const segmentCount = sumOccurrenceField(geometry, "segmentCount");
  const fillPathMetaA = new Float32Array(fillPathCount * 4);
  const fillPathMetaB = new Float32Array(fillPathCount * 4);
  const fillPathMetaC = new Float32Array(fillPathCount * 4);
  const fillSegmentsA = new Float32Array(fillSegmentCount * 4);
  const fillSegmentsB = new Float32Array(fillSegmentCount * 4);
  const endpoints = new Float32Array(segmentCount * 4);
  const primitiveMeta = new Float32Array(segmentCount * 4);
  const primitiveBounds = new Float32Array(segmentCount * 4);
  const styles = new Float32Array(segmentCount * 4);
  let fillPathOffset = 0;
  let fillSegmentOffset = 0;
  let segmentOffset = 0;
  for (const { compiled } of geometry) {
    for (let path = 0; path < compiled.fillPathCount; path += 1) {
      const sourceOffset = path * 4;
      const targetOffset = (fillPathOffset + path) * 4;
      fillPathMetaA[targetOffset] = compiled.fillPathMetaA[sourceOffset] + fillSegmentOffset;
      fillPathMetaA.set(compiled.fillPathMetaA.subarray(sourceOffset + 1, sourceOffset + 4), targetOffset + 1);
      fillPathMetaB.set(compiled.fillPathMetaB.subarray(sourceOffset, sourceOffset + 4), targetOffset);
      fillPathMetaC.set(compiled.fillPathMetaC.subarray(sourceOffset, sourceOffset + 4), targetOffset);
    }
    fillSegmentsA.set(compiled.fillSegmentsA, fillSegmentOffset * 4);
    fillSegmentsB.set(compiled.fillSegmentsB, fillSegmentOffset * 4);
    endpoints.set(compiled.endpoints, segmentOffset * 4);
    primitiveMeta.set(compiled.primitiveMeta, segmentOffset * 4);
    primitiveBounds.set(compiled.primitiveBounds, segmentOffset * 4);
    styles.set(compiled.styles, segmentOffset * 4);
    fillPathOffset += compiled.fillPathCount;
    fillSegmentOffset += compiled.fillSegmentCount;
    segmentOffset += compiled.segmentCount;
  }
  const combinedBounds = combineOccurrenceBounds(all, "bounds") ?? root.bounds;
  return {
    ...root,
    operatorCount: sumOccurrenceField(all, "operatorCount"),
    pathCount: sumOccurrenceField(all, "pathCount"),
    sourceSegmentCount: sumOccurrenceField(all, "sourceSegmentCount"),
    mergedSegmentCount: sumOccurrenceField(all, "mergedSegmentCount"),
    imageLayerSegmentCount: all.reduce(
      (count, occurrence) => count + (occurrence.compiled.imageLayerSegmentCount ?? 0), 0
    ),
    segmentCount,
    endpoints,
    primitiveMeta,
    primitiveBounds,
    styles,
    fillPathCount,
    fillSegmentCount,
    fillPathMetaA,
    fillPathMetaB,
    fillPathMetaC,
    fillSegmentsA,
    fillSegmentsB,
    vectorSceneData,
    paintRuns: new Uint32Array(0),
    paintRunOptionalContentIndices: new Int32Array(0),
    paintRunMarkedContentIndices: new Int32Array(0),
    paintRunCompositeStates: Object.freeze([]),
    paintRunClipIndices: new Int32Array(0),
    markedContent: Object.freeze([]),
    glyphPaints: Object.freeze([]),
    pathPaints: Object.freeze([]),
    pagePaths: Object.freeze([]),
    genericPathPaints: Object.freeze([]),
    clipPaths: Object.freeze([]),
    imageTransforms: Object.freeze([]),
    imagePaints: Object.freeze([]),
    formPaints: Object.freeze([]),
    shadingPaints: Object.freeze([]),
    patternPaints: Object.freeze([]),
    bounds: combinedBounds,
    strokeBounds: combineOccurrenceBounds(all, "strokeBounds"),
    fillBounds: combineOccurrenceBounds(all, "fillBounds"),
    maxHalfWidth: all.reduce(
      (maximum, occurrence) => Math.max(maximum, occurrence.compiled.maxHalfWidth),
      0
    ),
    discardedTransparentCount: sumOccurrenceField(all, "discardedTransparentCount"),
    discardedDegenerateCount: sumOccurrenceField(all, "discardedDegenerateCount"),
    discardedDuplicateCount: sumOccurrenceField(all, "discardedDuplicateCount"),
    discardedContainedCount: sumOccurrenceField(all, "discardedContainedCount"),
    referencedFonts: unionOccurrenceStrings(all, "referencedFonts"),
    referencedProperties: unionOccurrenceStrings(all, "referencedProperties"),
    referencedExtGStates: unionOccurrenceStrings(all, "referencedExtGStates"),
    referencedXObjects: unionOccurrenceStrings(all, "referencedXObjects"),
    referencedColorSpaces: unionOccurrenceStrings(all, "referencedColorSpaces"),
    referencedShadings: unionOccurrenceStrings(all, "referencedShadings"),
    referencedPatterns: unionOccurrenceStrings(all, "referencedPatterns"),
    textShowOpCount: sumOccurrenceField(all, "textShowOpCount")
  };
}

type NativeVectorNumericField =
  | "operatorCount"
  | "pathCount"
  | "sourceSegmentCount"
  | "mergedSegmentCount"
  | "segmentCount"
  | "fillPathCount"
  | "fillSegmentCount"
  | "maxHalfWidth"
  | "discardedTransparentCount"
  | "discardedDegenerateCount"
  | "discardedDuplicateCount"
  | "discardedContainedCount"
  | "textShowOpCount";

function sumOccurrenceField(
  occurrences: readonly NativeVectorCompiledOccurrence[],
  field: NativeVectorNumericField
): number {
  let total = 0;
  for (const occurrence of occurrences) {
    total += occurrence.compiled[field] as number;
    if (!Number.isSafeInteger(total) || total > 0xffff_ffff) {
      throw new PdfError("resource-limit", "Expanded Form stores exceed the 32-bit ABI limit.", {
        details: { reason: "vector-form-store-size", field }
      });
    }
  }
  return total;
}

function combineOccurrenceBounds(
  occurrences: readonly NativeVectorCompiledOccurrence[],
  field: "bounds" | "strokeBounds" | "fillBounds"
): DensePdfBounds | null {
  let result: DensePdfBounds | null = null;
  for (const occurrence of occurrences) {
    const bounds = occurrence.compiled[field];
    if (!bounds) continue;
    result = result ? {
      minX: Math.min(result.minX, bounds.minX),
      minY: Math.min(result.minY, bounds.minY),
      maxX: Math.max(result.maxX, bounds.maxX),
      maxY: Math.max(result.maxY, bounds.maxY)
    } : { ...bounds };
  }
  return result;
}

function unionOccurrenceStrings(
  occurrences: readonly NativeVectorCompiledOccurrence[],
  field: "referencedFonts" | "referencedProperties" | "referencedExtGStates" |
    "referencedXObjects" | "referencedColorSpaces" | "referencedShadings" |
    "referencedPatterns"
): string[] {
  const values = new Set<string>();
  for (const occurrence of occurrences) {
    for (const value of occurrence.compiled[field]) values.add(value);
  }
  return [...values];
}

function mapsRectangleToAxisAlignedBounds(matrix: DensePdfMatrix): boolean {
  const scale = Math.max(1, ...matrix.map(Math.abs));
  const epsilon = scale * 1e-10;
  const ordinaryAxes = Math.abs(matrix[1]) <= epsilon && Math.abs(matrix[2]) <= epsilon;
  const swappedAxes = Math.abs(matrix[0]) <= epsilon && Math.abs(matrix[3]) <= epsilon;
  const determinant = matrix[0] * matrix[3] - matrix[1] * matrix[2];
  return (ordinaryAxes || swappedAxes) && Math.abs(determinant) > epsilon * epsilon;
}

function intersectVectorBounds(
  first: Readonly<DensePdfBounds>,
  second: Readonly<DensePdfBounds>
): DensePdfBounds | null {
  const result = {
    minX: Math.max(first.minX, second.minX),
    minY: Math.max(first.minY, second.minY),
    maxX: Math.min(first.maxX, second.maxX),
    maxY: Math.min(first.maxY, second.maxY)
  };
  return result.minX < result.maxX && result.minY < result.maxY ? result : null;
}

function unitSquareInsideBounds(
  matrix: ArrayLike<number>,
  bounds: Readonly<DensePdfBounds>
): boolean {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of [[0, 0], [1, 0], [1, 1], [0, 1]] as const) {
    const transformedX = matrix[0] * x + matrix[2] * y + matrix[4];
    const transformedY = matrix[1] * x + matrix[3] * y + matrix[5];
    minX = Math.min(minX, transformedX);
    minY = Math.min(minY, transformedY);
    maxX = Math.max(maxX, transformedX);
    maxY = Math.max(maxY, transformedY);
  }
  const epsilon = Math.max(1e-5, Math.max(
    bounds.maxX - bounds.minX,
    bounds.maxY - bounds.minY
  ) * 1e-6);
  return minX >= bounds.minX - epsilon && minY >= bounds.minY - epsilon &&
    maxX <= bounds.maxX + epsilon && maxY <= bounds.maxY + epsilon;
}

function assertVectorFormTextWithinClip(
  text: NativeTextCompilation,
  vectorData: DensePdfVectorSceneData | undefined,
  fonts: readonly NativeTextFontResource[],
  clipBounds: Readonly<DensePdfBounds>,
  pageIndex: number,
  resourceName: string,
  signal: AbortSignal
): void {
  if (!vectorData) {
    throw new PdfError("invalid-object", "A compiled Form has no VectorScene sidecar.", {
      pageIndex,
      details: { reason: "vector-form-sidecar", resourceName }
    });
  }
  for (let runIndex = 0; runIndex < text.runs.length; runIndex += 1) {
    signal.throwIfAborted();
    const run = text.runs[runIndex];
    if (run.renderingMode !== 0 || vectorData.glyphFillColors[runIndex * 4 + 3] <= 1e-5) continue;
    let activeClip = clipBounds;
    if ((vectorData.glyphRunFlags?.[runIndex] ?? 0) !== 0) {
      const offset = runIndex * 4;
      if (!vectorData.glyphClipBounds || offset + 4 > vectorData.glyphClipBounds.length) {
        throw new PdfError("invalid-object", "A clipped Form text run has no clip bounds.", {
          pageIndex,
          details: { reason: "vector-form-text-clip", resourceName }
        });
      }
      activeClip = {
        minX: vectorData.glyphClipBounds[offset],
        minY: vectorData.glyphClipBounds[offset + 1],
        maxX: vectorData.glyphClipBounds[offset + 2],
        maxY: vectorData.glyphClipBounds[offset + 3]
      };
    }
    for (let glyph = run.first; glyph < run.first + run.count; glyph += 1) {
      const font = fonts[text.glyphs.fontIndices[glyph]]?.font;
      const outline = font?.getGlyphOutline(text.glyphs.glyphIds[glyph]);
      if (!outline || outline.commands.length === 0) continue;
      const transformIndex = text.glyphs.transformIndices[glyph] * 6;
      const transform = text.transforms.values.subarray(transformIndex, transformIndex + 6);
      const glyphBounds = transformRectangleBounds(outline.bounds, transform);
      if (!boundsOverlap(glyphBounds, activeClip)) continue;
      if (!boundsContain(activeClip, glyphBounds)) {
        throw vectorFormUnsupported(
          `Visible text in Form /${resourceName} crosses its BBox clip.`,
          pageIndex,
          "vector-form-text-bbox",
          resourceName
        );
      }
    }
  }
}

function assertVectorFormPathsWithinClip(
  compiled: DensePdfCompiledPage,
  clipBounds: Readonly<DensePdfBounds>,
  pageIndex: number,
  resourceName: string
): void {
  const pointInside = (x: number, y: number): boolean => {
    const epsilon = Math.max(1e-5, Math.max(
      clipBounds.maxX - clipBounds.minX,
      clipBounds.maxY - clipBounds.minY
    ) * 1e-6);
    return x >= clipBounds.minX - epsilon && x <= clipBounds.maxX + epsilon &&
      y >= clipBounds.minY - epsilon && y <= clipBounds.maxY + epsilon;
  };
  // Fill primitives intentionally retain the complete source path. The fill
  // shader evaluates its winding rule only inside the path's metadata quad,
  // which the dense compiler intersects with the active rectangular clip.
  // Keeping off-clip edges is both safe and necessary: those edges can still
  // contribute to nonzero or even-odd winding for points inside the clip.
  for (let pathIndex = 0; pathIndex < compiled.fillPathCount; pathIndex += 1) {
    const offset = pathIndex * 4;
    if (!pointInside(compiled.fillPathMetaA[offset + 2], compiled.fillPathMetaA[offset + 3]) ||
        !pointInside(compiled.fillPathMetaB[offset], compiled.fillPathMetaB[offset + 1])) {
      throw vectorFormUnsupported(
        `A fill in Form /${resourceName} crosses its BBox clip.`,
        pageIndex,
        "vector-form-path-bbox",
        resourceName
      );
    }
  }
  for (let offset = 0; offset < compiled.endpoints.length; offset += 4) {
    const halfWidth = Math.max(0, compiled.styles[offset]);
    const strokeMinX = Math.min(
      compiled.endpoints[offset],
      compiled.endpoints[offset + 2],
      compiled.primitiveMeta[offset]
    ) - halfWidth;
    const strokeMinY = Math.min(
      compiled.endpoints[offset + 1],
      compiled.endpoints[offset + 3],
      compiled.primitiveMeta[offset + 1]
    ) - halfWidth;
    const strokeMaxX = Math.max(
      compiled.endpoints[offset],
      compiled.endpoints[offset + 2],
      compiled.primitiveMeta[offset]
    ) + halfWidth;
    const strokeMaxY = Math.max(
      compiled.endpoints[offset + 1],
      compiled.endpoints[offset + 3],
      compiled.primitiveMeta[offset + 1]
    ) + halfWidth;
    const packedStyle = compiled.primitiveMeta[offset + 3];
    const styleFlags = Math.max(0, Math.trunc(packedStyle / 2 + 1e-6));
    const hasClipBounds = (styleFlags & DENSE_PDF_STROKE_STYLE_FLAG_CLIPPED) !== 0;
    const sourcePaintCrossesClip =
      !pointInside(strokeMinX, strokeMinY) || !pointInside(strokeMaxX, strokeMaxY);
    const retainedClipIsValid = hasClipBounds &&
      compiled.primitiveBounds[offset] <= compiled.primitiveBounds[offset + 2] &&
      compiled.primitiveBounds[offset + 1] <= compiled.primitiveBounds[offset + 3] &&
      pointInside(compiled.primitiveBounds[offset], compiled.primitiveBounds[offset + 1]) &&
      pointInside(compiled.primitiveBounds[offset + 2], compiled.primitiveBounds[offset + 3]);
    // Clipped stroke primitives keep their full source line/curve (and hence
    // dash/cap geometry) while primitiveBounds becomes a page-space fragment
    // clip. Every active renderer consumes the flag before evaluating stroke
    // coverage, so no analytic endpoint or curve mutation is necessary.
    if ((sourcePaintCrossesClip && !retainedClipIsValid) ||
        (hasClipBounds && !retainedClipIsValid)) {
      throw vectorFormUnsupported(
        `A stroke in Form /${resourceName} crosses its BBox clip.`,
        pageIndex,
        "vector-form-path-bbox",
        resourceName
      );
    }
  }
}

function transformRectangleBounds(
  rectangle: readonly number[],
  matrix: ArrayLike<number>
): DensePdfBounds {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const [x, y] of [
    [rectangle[0], rectangle[1]],
    [rectangle[2], rectangle[1]],
    [rectangle[2], rectangle[3]],
    [rectangle[0], rectangle[3]]
  ] as const) {
    const transformedX = matrix[0] * x + matrix[2] * y + matrix[4];
    const transformedY = matrix[1] * x + matrix[3] * y + matrix[5];
    minX = Math.min(minX, transformedX);
    minY = Math.min(minY, transformedY);
    maxX = Math.max(maxX, transformedX);
    maxY = Math.max(maxY, transformedY);
  }
  return { minX, minY, maxX, maxY };
}

function boundsOverlap(
  first: Readonly<DensePdfBounds>,
  second: Readonly<DensePdfBounds>
): boolean {
  return first.maxX >= second.minX && first.minX <= second.maxX &&
    first.maxY >= second.minY && first.minY <= second.maxY;
}

function boundsContain(
  outer: Readonly<DensePdfBounds>,
  inner: Readonly<DensePdfBounds>
): boolean {
  const epsilon = Math.max(1e-5, Math.max(
    outer.maxX - outer.minX,
    outer.maxY - outer.minY
  ) * 1e-6);
  return inner.minX >= outer.minX - epsilon && inner.minY >= outer.minY - epsilon &&
    inner.maxX <= outer.maxX + epsilon && inner.maxY <= outer.maxY + epsilon;
}

function invalidVectorFormEvent(
  pageIndex: number,
  kind: string,
  index: number
): PdfError {
  return new PdfError("invalid-object", `A Form has an invalid ${kind} source event.`, {
    pageIndex,
    details: { reason: "vector-form-event", kind, index }
  });
}

function vectorFormUnsupported(
  message: string,
  pageIndex: number,
  reason: string,
  resourceName?: string
): PdfError {
  return new PdfError("unsupported-content", message, {
    pageIndex,
    details: { reason, operator: "Do", ...(resourceName ? { resourceName } : {}) }
  });
}

async function compileNativeFormPrograms(
  document: NativePdfDocument,
  graph: NativePdfFormDefinitionGraph,
  rootCompiled: DensePdfCompiledPage,
  imageResources: LoadedPageImages,
  options: PdfCompileOptions,
  pageIndex: number,
  signal: AbortSignal,
  optionalContent: NativeOptionalContentRegistry,
  fontRegistry: NativePageFontRegistry,
  textAccumulator: NativePageTextAccumulator,
  allowType3Text: boolean
): Promise<DensePdfFormPageData> {
  const specializationByKey = new Map<string, number>();
  const programs: Array<DensePdfFormProgramData | undefined> = [];
  const colorScopes = new Map<number, Promise<ScopedColorResolver>>();
  const shadingScopes = new Map<number, Promise<ReadonlyMap<string, number>>>();
  const patternScopes = new Map<
    number,
    Promise<ReadonlyMap<string, Readonly<DensePdfPatternDefinition>>>
  >();
  const extGStateScopes = new Map<number, Promise<readonly DensePdfExtGStateDefinition[]>>();
  const inlineScopes = new Map<number, Promise<readonly DensePdfContentSegment[]>>();
  const imageScopes = new Map<number, Promise<ScopedImageResources>>();
  const fontScopes = new Map<
    number,
    Promise<Array<readonly [string, NativeTextFontResource]>>
  >();
  const scopedColors = (definition: NativePdfFormDefinition): Promise<ScopedColorResolver> => {
    let pending = colorScopes.get(definition.definitionIndex);
    if (!pending) {
      pending = loadScopedColorResolver(
        document,
        definition.resources,
        imageResources.registry.colors,
        imageResources.colorSpaceResolver,
        definition.resourceReferences.colorSpaces,
        pageIndex,
        signal
      );
      colorScopes.set(definition.definitionIndex, pending);
    }
    return pending;
  };
  const scopedExtGStates = (
    definition: NativePdfFormDefinition
  ): Promise<readonly DensePdfExtGStateDefinition[]> => {
    let pending = extGStateScopes.get(definition.definitionIndex);
    if (!pending) {
      pending = loadResourceExtGStates(
        imageResources.extGStates,
        definition.resources,
        definition.resourceReferences.extGStates,
        signal,
        fontRegistry,
        allowType3Text
      );
      extGStateScopes.set(definition.definitionIndex, pending);
    }
    return pending;
  };
  const scopedImages = (
    definition: NativePdfFormDefinition
  ): Promise<ScopedImageResources> => {
    let pending = imageScopes.get(definition.definitionIndex);
    if (!pending) {
      pending = scopedColors(definition).then((colorScope) => loadScopedImageResources(
        document,
        imageResources.registry,
        optionalContent,
        definition.resources,
        definition.imageResourceNames,
        colorScope.colorSpaces,
        pageIndex,
        signal,
        (options as NativeVectorCompileOptions).retainOptionalContent === true
      ));
      imageScopes.set(definition.definitionIndex, pending);
    }
    return pending;
  };
  const scopedInlineContent = (
    definition: NativePdfFormDefinition
  ): Promise<readonly DensePdfContentSegment[]> => {
    let pending = inlineScopes.get(definition.definitionIndex);
    if (!pending) {
      pending = scopedColors(definition).then((colorScope) => bindPreparedInlineImages(
        definition.preparedContent,
        imageResources.registry,
        colorScope.colorSpaces,
        signal
      ));
      inlineScopes.set(definition.definitionIndex, pending);
    }
    return pending;
  };
  const scopedFonts = (
    definition: NativePdfFormDefinition
  ): Promise<Array<readonly [string, NativeTextFontResource]>> => {
    let pending = fontScopes.get(definition.definitionIndex);
    if (!pending) {
      pending = fontRegistry.loadScope(
        definition.resources,
        definition.resourceReferences.fonts,
        signal,
        { label: `Form XObject /${definition.resourceName}`, allowType3: allowType3Text }
      );
      fontScopes.set(definition.definitionIndex, pending);
    }
    return pending;
  };
  const scopedShadings = (
    definition: NativePdfFormDefinition
  ): Promise<ReadonlyMap<string, number>> => {
    let pending = shadingScopes.get(definition.definitionIndex);
    if (!pending) {
      pending = (async () => {
        const indexes = new Map<string, number>();
        for (const resourceName of definition.resourceReferences.shadings) {
          signal.throwIfAborted();
          indexes.set(
            resourceName,
            await imageResources.shadings.add(
              { kind: "name", value: resourceName },
              definition.resources,
              signal
            )
          );
        }
        return indexes;
      })();
      shadingScopes.set(definition.definitionIndex, pending);
    }
    return pending;
  };
  const scopedPatterns = (
    definition: NativePdfFormDefinition
  ): Promise<ReadonlyMap<string, Readonly<DensePdfPatternDefinition>>> => {
    let pending = patternScopes.get(definition.definitionIndex);
    if (!pending) {
      pending = loadPatternDefinitions(
        imageResources.patterns,
        imageResources.extGStates,
        definition.resources,
        definition.resourceReferences.patterns,
        signal
      );
      patternScopes.set(definition.definitionIndex, pending);
    }
    return pending;
  };

  const specialize = async (
    definitionIndex: number,
    initialGraphicsState: DensePdfInitialGraphicsState
  ): Promise<number> => {
    signal.throwIfAborted();
    const definition = graph.definitions[definitionIndex];
    if (!definition) {
      throw new PdfError("invalid-object", "A Form paint references a missing definition.", {
        pageIndex,
        details: { reason: "form-definition-missing", definitionIndex }
      });
    }
    if ((options as NativeVectorCompileOptions).retainOptionalContent !== true && !definition.defaultVisible) {
      throw new PdfError(
        "invalid-object",
        "A hidden default-view Form reached display-program specialization.",
        { pageIndex, details: { reason: "hidden-form-specialized", definitionIndex } }
      );
    }
    const key = formSpecializationKey(definitionIndex, initialGraphicsState);
    const cached = specializationByKey.get(key);
    if (cached !== undefined) return cached;
    if (programs.length >= 0xffffffff) {
      throw new PdfError("resource-limit", "Form program specializations exceed the Uint32 index range.", {
        pageIndex,
        details: {
          reason: "form-program-specialization-count",
          maxFormPrograms: 0xffffffff
        }
      });
    }
    const programIndex = programs.length;
    specializationByKey.set(key, programIndex);
    programs.push(undefined);

    // Color spaces and shadings share one append-only color/function registry.
    // Resolve them serially so page-local resource indexes remain deterministic.
    const colorScope = await scopedColors(definition);
    const scopedImageResources = await scopedImages(definition);
    const shadingIndexes = await scopedShadings(definition);
    const patternDefinitions = await scopedPatterns(definition);
    const extGStates = await scopedExtGStates(definition);
    const formFontResources = await scopedFonts(definition);
    const formFontsByName = new Map<string, NativeTextFontResource>(formFontResources);
    const emittedTextRuns: NativeTextDrawRun[] = [];
    const textCompiler = new NativeTextCompiler({
      fonts: formFontsByName,
      maxGlyphs: options.limits?.maxGlyphsPerPage ?? document.limits.maxGlyphsPerPage,
      maxGraphicsStateDepth: document.limits.maxRecursionDepth,
      signal,
      onRun(run) {
        emittedTextRuns.push(run);
      }
    });
    const textOperatorSink = {
      getFontSelection: () => textCompiler.getFontSelection(),
      applyOperator(
        operator: string,
        operands: readonly unknown[],
        context: Readonly<DensePdfTextOperatorContext>
      ) {
        emittedTextRuns.length = 0;
        textCompiler.setOutputEnabled(context.outputEnabled);
        if (context.font) {
          textCompiler.setFontResource(fontRegistry.resources[context.font.fontIndex], context.font.size);
        }
        textCompiler.applyOperator(operator, operands);
        return emittedTextRuns;
      }
    };
    const bounds: DensePdfBounds = {
      minX: definition.form.bbox[0],
      minY: definition.form.bbox[1],
      maxX: definition.form.bbox[2],
      maxY: definition.form.bbox[3]
    };
    const formInitialGraphicsState = definition.form.group
      ? resetTransparencyGroupCompositing(initialGraphicsState)
      : initialGraphicsState;
    if (formInitialGraphicsState.font) {
      const { fontIndex, size } = formInitialGraphicsState.font;
      textCompiler.setFontResource(fontRegistry.resources[fontIndex], size);
    }
    const markedContentProperties = await loadMarkedContentProperties(
      document,
      optionalContent,
      definition.resources,
      definition.resourceReferences.properties,
      definition.resourceReferences.optionalContentProperties,
      signal
    );
    const compiled = await compileDensePdfContent(await scopedInlineContent(definition), {
      pageMatrix: [1, 0, 0, 1, 0, 0],
      pageBounds: bounds,
      initialGraphicsState: formInitialGraphicsState,
      textOperatorSink,
      formXObjects: definition.formResources,
      formOptionalContent: formOptionalContentForScope(
        definition.formResources,
        graph.definitions
      ),
      imageXObjects: scopedImageResources.indexes,
      imageOptionalContent: scopedImageResources.optionalContent,
      markedContentProperties,
      retainOptionalContent: (options as NativeVectorCompileOptions).retainOptionalContent === true,
      ...((options as NativeVectorCompileOptions).retainOptionalContent === true ? { combineOptionalContent: (parent: number, own: number) => optionalContent.combineMemberships(parent, own) } : {}),
      maxMarkedContentDepth: document.limits.maxRecursionDepth,
      maxMarkedContent: options.limits?.maxCommandsPerPage ??
        document.limits.maxCommandsPerPage,
      ...densePathCompileLimits(document, options),
      colorSpaceResolver: colorScope.resolver,
      patternColorSpaces: colorScope.patternColorSpaces,
      patterns: patternDefinitions,
      shadings: shadingIndexes,
      extGStates,
      enableSegmentMerge: nativeVectorSegmentMergeEnabled(options),
      enableInvisibleCull: nativeVectorInvisibleCullEnabled(options),
      output: "display-program",
      totalBytes: definition.content.length,
      signal
    });
    imageResources.assertReferencedCodecsAvailable(
      compiled.referencedXObjects,
      scopedImageResources.indexes
    );
    const formText = textCompiler.build();
    const glyphOffset = textAccumulator.append(formText);
    const invocationProgramIndices: number[] = [];
    for (const paint of compiled.formPaints) {
      invocationProgramIndices.push(await specialize(
        paint.definitionIndex,
        paint.initialGraphicsState
      ));
    }
    let blendingColorSpaceIndex = -1;
    if (definition.form.group?.colorSpace !== undefined) {
      blendingColorSpaceIndex = await imageResources.registry.colors.add(
        definition.form.group.colorSpace,
        colorScope.colorSpaces,
        signal
      );
    }
    programs[programIndex] = Object.freeze({
      compiled,
      glyphOffset,
      invocationProgramIndices: Uint32Array.from(invocationProgramIndices),
      matrix: [...definition.form.matrix] as DensePdfMatrix,
      bounds: [...definition.form.bbox] as [number, number, number, number],
      resourceName: definition.resourceName,
      ...(definition.form.group ? {
        group: Object.freeze({
          isolated: definition.form.group.isolated,
          knockout: definition.form.group.knockout,
          // A Form XObject is a nonstroking paint operation. Its caller's
          // nonstroking alpha applies to the completed transparency group;
          // alpha constants inside the group start at 1.
          alpha: initialGraphicsState.fillAlpha,
          alphaIsShape: initialGraphicsState.alphaIsShape ?? false,
          blendMode: initialGraphicsState.blendMode ?? "Normal",
          softMaskIndex: initialGraphicsState.softMaskIndex ?? -1,
          blendingColorSpaceIndex
        })
      } : {})
    });
    return programIndex;
  };

  const rootInvocationProgramIndices: number[] = [];
  for (const paint of rootCompiled.formPaints) {
    rootInvocationProgramIndices.push(await specialize(
      paint.definitionIndex,
      paint.initialGraphicsState
    ));
  }
  const defaultState = createDefaultInitialGraphicsState(imageResources.colorSpaceResolver);
  const annotations: DensePdfFormPageData["annotations"][number][] = [];
  for (const placement of graph.annotationPlacements) {
    const definition = graph.definitions[placement.definitionIndex];
    if (!definition || ((options as NativeVectorCompileOptions).retainOptionalContent !== true && !definition.defaultVisible)) continue;
    annotations.push(Object.freeze({
      programIndex: await specialize(placement.definitionIndex, defaultState),
      transform: placement.invocationMatrix,
      clipBounds: placement.pageBounds,
      annotationId: placement.annotation.id,
      optionalContentIndex: (options as NativeVectorCompileOptions).retainOptionalContent === true
        ? optionalContent.combineMemberships(placement.appearance.optionalContentIndex, definition.optionalContentIndex)
        : placement.appearance.optionalContentIndex >= 0 ? placement.appearance.optionalContentIndex : definition.optionalContentIndex,
      viewTransformFlags:
        ((placement.annotation.flags & NATIVE_PDF_ANNOTATION_VIEW_FLAGS.NoZoom) !== 0
          ? HEPR_VIEW_TRANSFORM_FLAG.NoZoom
          : 0) |
        ((placement.annotation.flags & NATIVE_PDF_ANNOTATION_VIEW_FLAGS.NoRotate) !== 0
          ? HEPR_VIEW_TRANSFORM_FLAG.NoRotate
          : 0)
    }));
  }
  if (programs.some((program) => program === undefined)) {
    throw new PdfError("invalid-object", "A Form specialization was not completed.", {
      pageIndex,
      details: { reason: "form-specialization-incomplete" }
    });
  }
  const typedPrograms = programs as DensePdfFormProgramData[];
  const commandCount = rootCompiled.paintRuns.length / 3 + annotations.length +
    typedPrograms.reduce((sum, program) => sum + program.compiled.paintRuns.length / 3, 0) +
    typedPrograms.filter((program) => program.group !== undefined).length;
  const maxCommands = options.limits?.maxCommandsPerPage ?? document.limits.maxCommandsPerPage;
  if (commandCount > maxCommands) {
    throw new PdfError("resource-limit", "The page exceeds the configured display-command limit.", {
      pageIndex,
      details: { commandCount, maxCommands }
    });
  }
  return Object.freeze({
    rootInvocationProgramIndices: Uint32Array.from(rootInvocationProgramIndices),
    programs: Object.freeze(typedPrograms),
    annotations: Object.freeze(annotations)
  });
}

interface NativePdfType3Compilation extends DensePdfType3PageData {
  /** Canonical local Type3 program indexes keyed by `fontIndex:glyphId`. */
  readonly fontGlyphProgramIndices: ReadonlyMap<string, number>;
  /** Internal specialization cache retained across reusable-resource expansion passes. */
  readonly programByDefinition: ReadonlyMap<string, number>;
}

interface NativePdfType3AndFormCompilation {
  readonly type3: NativePdfType3Compilation;
  readonly forms: DensePdfFormPageData;
}

async function compileNativeType3Programs(
  document: NativePdfDocument,
  rootCompiled: DensePdfCompiledPage,
  initialForms: DensePdfFormPageData,
  resources: LoadedPageImages,
  options: PdfCompileOptions,
  pageIndex: number,
  signal: AbortSignal,
  optionalContent: NativeOptionalContentRegistry,
  formRegistry: NativePdfFormAppearanceRegistry,
  fontRegistry: NativePageFontRegistry,
  textAccumulator: NativePageTextAccumulator,
  initialType3?: NativePdfType3Compilation,
  sourcePatterns?: DensePdfPatternPageData
): Promise<NativePdfType3AndFormCompilation> {
  const glyphProgramIndices: number[] = initialType3
    ? Array.from(initialType3.glyphProgramIndices)
    : [];
  const fontGlyphProgramIndices = new Map(initialType3?.fontGlyphProgramIndices);
  const programs: DensePdfType3ProgramData[] = [...(initialType3?.programs ?? [])];
  const programByDefinition = new Map(initialType3?.programByDefinition);
  const preparedByCharProc = new Map<string, NativeInlineImageResult>();
  const boundInlineByCharProc = new Map<string, Promise<readonly DensePdfContentSegment[]>>();
  const maxCommands = options.limits?.maxCommandsPerPage ?? document.limits.maxCommandsPerPage;
  let commandCount = programs.reduce(
    (sum, program) => sum + program.compiled.paintRuns.length / 3,
    0
  );
  let forms = initialForms;

  const glyphInitialStates: Array<DensePdfInitialGraphicsState | undefined> = [];
  const registeredTextSources = new WeakMap<DensePdfCompiledPage, Set<number>>();
  const registerTextSource = (compiled: DensePdfCompiledPage, glyphOffset: number): void => {
    let offsets = registeredTextSources.get(compiled);
    if (!offsets) {
      offsets = new Set();
      registeredTextSources.set(compiled, offsets);
    }
    if (offsets.has(glyphOffset)) return;
    offsets.add(glyphOffset);
    let glyphPaintIndex = 0;
    for (let offset = 0; offset < compiled.paintRuns.length; offset += 3) {
      if (compiled.paintRuns[offset] !== DENSE_PDF_PAINT_RUN_GLYPH) continue;
      const first = glyphOffset + compiled.paintRuns[offset + 1];
      const count = compiled.paintRuns[offset + 2];
      const paint = compiled.glyphPaints[glyphPaintIndex++];
      if (!paint) {
        throw new PdfError("invalid-object", "Reusable text paint metadata is inconsistent.", {
          pageIndex,
          details: { reason: "type3-glyph-paint-state" }
        });
      }
      for (let index = first; index < first + count; index += 1) {
        if (glyphInitialStates[index] !== undefined) {
          throw new PdfError("invalid-object", "Reusable glyph ranges overlap.", {
            pageIndex,
            details: { reason: "type3-glyph-range-overlap", glyphIndex: index }
          });
        }
        glyphInitialStates[index] = paint.initialGraphicsState;
      }
    }
    if (glyphPaintIndex !== compiled.glyphPaints.length) {
      throw new PdfError("invalid-object", "Reusable text has unreferenced paint state.", {
        pageIndex,
        details: { reason: "type3-glyph-paint-state" }
      });
    }
  };
  registerTextSource(rootCompiled, 0);
  for (const program of forms.programs) registerTextSource(program.compiled, program.glyphOffset);
  for (const program of programs) registerTextSource(program.compiled, program.glyphOffset);
  for (const program of sourcePatterns?.programs ?? []) {
    registerTextSource(program.compiled, program.glyphOffset);
  }

  const compileGlyph = async (
    resource: NativeTextFontResource,
    glyph: NativePdfType3GlyphInvocation,
    initialGraphicsState: DensePdfInitialGraphicsState
  ): Promise<number> => {
    const prepared = resource.type3;
    if (!prepared) {
      throw new PdfError("unsupported-font", "A visible Type3 glyph lost its prepared font dictionary.", {
        pageIndex,
        details: {
          reason: "type3-font-not-prepared",
          fontIndex: resource.fontIndex,
          characterCode: glyph.code
        }
      });
    }
    const definitionKey = `${prepared.id}|${glyph.charProc.id}|${type3SpecializationKey(initialGraphicsState)}`;
    const cached = programByDefinition.get(definitionKey);
    if (cached !== undefined) return cached;
    if (programs.length >= 0xffffffff) {
      throw new PdfError("resource-limit", "Type3 CharProc programs exceed the Uint32 index range.", {
        pageIndex,
        details: {
          reason: "type3-program-count",
          maxType3Programs: 0xffffffff
        }
      });
    }

    const localProgramIndex = programs.length;
    // Reserve before compiling so aliases dedupe deterministically. Resource
    // recursion is rejected below rather than producing a partial program.
    programByDefinition.set(definitionKey, localProgramIndex);
    const charProcScopeKey = `${prepared.id}|${glyph.charProc.id}`;
    const content = glyph.charProc.decodedBytes.subarray(glyph.charProc.metrics.contentOffset);
    let preparedContent = preparedByCharProc.get(charProcScopeKey);
    if (!preparedContent) {
      preparedContent = prepareNativeInlineImages(content, {
        sourceOffset: glyph.charProc.metrics.contentOffset,
        signal,
        limits: inlineImageLimits(document, maxCommands)
      });
      preparedByCharProc.set(charProcScopeKey, preparedContent);
    }
    const references = scanPreparedResourceReferencesFastOrExact(
      preparedContent.segments,
      { signal }
    ).references;
    const xObjects = await classifyNativePdfXObjectReferences(
      document,
      glyph.charProc.resources,
      references.xObjects,
      signal
    );
    const formXObjects = xObjects.filter((reference) => reference.kind === "Form");
    const formGraph = formXObjects.length === 0
      ? emptyFormDefinitionGraph()
      : await buildNativePdfResourceFormDefinitionGraph(
          document,
          formRegistry,
          glyph.charProc.resources,
          references,
          {
            pageIndex,
            ownerLabel: `Type3 CharProc /${glyph.charProcName}`,
            optionalContent,
            retainOptionalContent: (options as NativeVectorCompileOptions).retainOptionalContent === true,
            signal
          }
        );
    const charProcFonts = await fontRegistry.loadScope(
      glyph.charProc.resources,
      references.fonts,
      signal,
      { label: `Type3 CharProc /${glyph.charProcName}`, allowType3: true }
    );
    const fontsByName = new Map<string, NativeTextFontResource>(charProcFonts);
    const emittedTextRuns: NativeTextDrawRun[] = [];
    const textCompiler = new NativeTextCompiler({
      fonts: fontsByName,
      maxGlyphs: options.limits?.maxGlyphsPerPage ?? document.limits.maxGlyphsPerPage,
      maxGraphicsStateDepth: document.limits.maxRecursionDepth,
      signal,
      onRun(run) {
        emittedTextRuns.push(run);
      }
    });
    const textOperatorSink = {
      getFontSelection: () => textCompiler.getFontSelection(),
      applyOperator(
        operator: string,
        operands: readonly unknown[],
        context: Readonly<DensePdfTextOperatorContext>
      ) {
        emittedTextRuns.length = 0;
        textCompiler.setOutputEnabled(context.outputEnabled);
        if (context.font) {
          textCompiler.setFontResource(fontRegistry.resources[context.font.fontIndex], context.font.size);
        }
        textCompiler.applyOperator(operator, operands);
        return emittedTextRuns;
      }
    };
    const colorScope = await loadScopedColorResolver(
      document,
      glyph.charProc.resources,
      resources.registry.colors,
      resources.colorSpaceResolver,
      references.colorSpaces,
      pageIndex,
      signal,
      false
    );
    const scopedImages = await loadScopedImageResources(
      document,
      resources.registry,
      optionalContent,
      glyph.charProc.resources,
      xObjects
        .filter((reference) => reference.kind === "Image")
        .map((reference) => reference.resourceName),
      colorScope.colorSpaces,
      pageIndex,
      signal,
      (options as NativeVectorCompileOptions).retainOptionalContent === true
    );
    const shadings = new Map<string, number>();
    for (const resourceName of references.shadings) {
      signal.throwIfAborted();
      shadings.set(
        resourceName,
        await resources.shadings.add(
          { kind: "name", value: resourceName },
          glyph.charProc.resources,
          signal
        )
      );
    }
    const patterns = await loadPatternDefinitions(
      resources.patterns,
      resources.extGStates,
      glyph.charProc.resources,
      references.patterns,
      signal
    );
    const extGStates = await loadResourceExtGStates(
      resources.extGStates,
      glyph.charProc.resources,
      references.extGStates,
      signal,
      fontRegistry
    );
    const markedContentProperties = await loadMarkedContentProperties(
      document,
      optionalContent,
      glyph.charProc.resources,
      references.properties,
      references.optionalContentProperties,
      signal
    );
    let boundContent = boundInlineByCharProc.get(charProcScopeKey);
    if (!boundContent) {
      boundContent = bindPreparedInlineImages(
        preparedContent,
        resources.registry,
        colorScope.colorSpaces,
        signal
      );
      boundInlineByCharProc.set(charProcScopeKey, boundContent);
    }
    const contentSegments = await boundContent;
    if (!glyph.charProc.metrics.colored) {
      for (const [resourceName, imageIndex] of scopedImages.indexes) {
        if ((options as NativeVectorCompileOptions).retainOptionalContent !== true && scopedImages.optionalContent.get(resourceName)?.defaultVisible === false) continue;
        if (!resources.registry.describe(imageIndex).imageMask) {
          throw new PdfError(
            "unsupported-content",
            `Uncolored Type3 CharProc /${glyph.charProcName} contains a non-stencil named image.`,
            {
              pageIndex,
              details: {
                reason: "type3-uncolored-named-image",
                charProcName: glyph.charProcName,
                resourceName
              }
            }
          );
        }
      }
      for (const segment of contentSegments) {
        if (
          segment.kind === "image" &&
          !resources.registry.describe(segment.imageIndex).imageMask
        ) {
          throw new PdfError(
            "unsupported-content",
            `Uncolored Type3 CharProc /${glyph.charProcName} contains a non-stencil inline image.`,
            {
              pageIndex,
              details: {
                reason: "type3-uncolored-inline-image",
                charProcName: glyph.charProcName
              }
            }
          );
        }
      }
    }
    const glyphBounds = glyph.charProc.metrics.boundingBox ?? prepared.fontBBox;
    const bounds: DensePdfBounds = {
      minX: glyphBounds[0],
      minY: glyphBounds[1],
      maxX: glyphBounds[2],
      maxY: glyphBounds[3]
    };
    const compiled = await compileDensePdfContent(contentSegments, {
      pageMatrix: [1, 0, 0, 1, 0, 0],
      pageBounds: bounds,
      initialGraphicsState,
      textOperatorSink,
      formXObjects: formGraph.pageForms,
      formOptionalContent: formOptionalContentForScope(
        formGraph.pageForms,
        formGraph.definitions
      ),
      extGStates,
      imageXObjects: scopedImages.indexes,
      imageOptionalContent: scopedImages.optionalContent,
      shadings,
      patterns,
      patternColorSpaces: colorScope.patternColorSpaces,
      markedContentProperties,
      retainOptionalContent: (options as NativeVectorCompileOptions).retainOptionalContent === true,
      ...((options as NativeVectorCompileOptions).retainOptionalContent === true ? { combineOptionalContent: (parent: number, own: number) => optionalContent.combineMemberships(parent, own) } : {}),
      maxMarkedContentDepth: document.limits.maxRecursionDepth,
      maxMarkedContent: maxCommands,
      ...densePathCompileLimits(document, options),
      colorSpaceResolver: colorScope.resolver,
      enableSegmentMerge: nativeVectorSegmentMergeEnabled(options),
      enableInvisibleCull: nativeVectorInvisibleCullEnabled(options),
      output: "display-program",
      type3PaintMode: glyph.charProc.metrics.colored ? "colored" : "uncolored",
      totalBytes: content.length,
      signal
    });
    resources.assertReferencedCodecsAvailable(
      compiled.referencedXObjects,
      scopedImages.indexes
    );
    const charProcText = textCompiler.build();
    const glyphOffset = textAccumulator.append(charProcText);
    registerTextSource(compiled, glyphOffset);
    let invocationProgramIndices = new Uint32Array(0);
    if (compiled.formPaints.length > 0) {
      const scopedForms = await compileNativeFormPrograms(
        document,
        formGraph,
        compiled,
        resources,
        options,
        pageIndex,
        signal,
        optionalContent,
        fontRegistry,
        textAccumulator,
        true
      );
      const formOffset = forms.programs.length;
      invocationProgramIndices = Uint32Array.from(
        scopedForms.rootInvocationProgramIndices,
        (index) => index + formOffset
      );
      forms = appendFormPrograms(forms, scopedForms);
      for (let index = formOffset; index < forms.programs.length; index += 1) {
        const program = forms.programs[index];
        registerTextSource(program.compiled, program.glyphOffset);
      }
    }
    let inheritsFillPaint = false;
    let inheritsStrokePaint = false;
    let pathPaintIndex = 0;
    let genericPathPaintCount = 0;
    let imagePaintIndex = 0;
    let glyphPaintIndex = 0;
    for (let offset = 0; offset < compiled.paintRuns.length; offset += 3) {
      const kind = compiled.paintRuns[offset];
      if (kind === DENSE_PDF_PAINT_RUN_GLYPH) {
        const paint = compiled.glyphPaints[glyphPaintIndex++];
        if (!paint) {
          throw new PdfError("invalid-object", "A Type3 CharProc lost glyph-paint provenance.", {
            pageIndex,
            details: { reason: "type3-glyph-paint-provenance", charProcName: glyph.charProcName }
          });
        }
        const mode = paint.renderingMode;
        if (
          paint.fillPaintInherited === true &&
          (mode === 0 || mode === 2 || mode === 4 || mode === 6)
        ) inheritsFillPaint = true;
        if (
          paint.strokePaintInherited === true &&
          (mode === 1 || mode === 2 || mode === 5 || mode === 6)
        ) inheritsStrokePaint = true;
        continue;
      }
      if (kind === DENSE_PDF_PAINT_RUN_IMAGE) {
        const paint = compiled.imagePaints[imagePaintIndex++];
        const imageIndex = compiled.paintRuns[offset + 1];
        if (!paint || imageIndex >= resources.registry.size) {
          throw new PdfError("invalid-object", "A Type3 CharProc lost image-paint provenance.", {
            pageIndex,
            details: { reason: "type3-image-paint-provenance", charProcName: glyph.charProcName }
          });
        }
        if (
          paint.inheritType3Paint === true &&
          resources.registry.describe(imageIndex).imageMask
        ) {
          inheritsFillPaint = true;
        }
        continue;
      }
      if (kind === DENSE_PDF_PAINT_RUN_PATH) {
        const paintIndex = compiled.paintRuns[offset + 1];
        const count = compiled.paintRuns[offset + 2];
        const paint = compiled.genericPathPaints[paintIndex];
        if (count !== 1 || paintIndex !== genericPathPaintCount || !paint) {
          throw new PdfError("invalid-object", "A Type3 CharProc lost generic path provenance.", {
            pageIndex,
            details: { reason: "type3-generic-path-provenance", charProcName: glyph.charProcName }
          });
        }
        if (paint.fill?.inheritType3Paint === true) inheritsFillPaint = true;
        if (paint.stroke?.inheritType3Paint === true) inheritsStrokePaint = true;
        genericPathPaintCount += 1;
        continue;
      }
      if (kind !== DENSE_PDF_PAINT_RUN_FILL && kind !== DENSE_PDF_PAINT_RUN_STROKE) continue;
      const paint = compiled.pathPaints[pathPaintIndex++];
      if (!paint) {
        throw new PdfError("invalid-object", "A Type3 CharProc lost path-paint provenance.", {
          pageIndex,
          details: { reason: "type3-paint-provenance", charProcName: glyph.charProcName }
        });
      }
      if (paint.inheritType3Paint === true) {
        if (kind === DENSE_PDF_PAINT_RUN_STROKE) inheritsStrokePaint = true;
        else inheritsFillPaint = true;
      }
    }
    if (
      pathPaintIndex !== compiled.pathPaints.length ||
      genericPathPaintCount !== compiled.genericPathPaints.length ||
      imagePaintIndex !== compiled.imagePaints.length ||
      glyphPaintIndex !== compiled.glyphPaints.length
    ) {
      throw new PdfError("invalid-object", "A Type3 CharProc has unreferenced path-paint provenance.", {
        pageIndex,
        details: { reason: "type3-paint-provenance", charProcName: glyph.charProcName }
      });
    }
    for (const formProgramIndex of invocationProgramIndices) {
      const inherited = inheritedPaintRolesForFormProgram(forms, formProgramIndex);
      inheritsFillPaint ||= inherited.fill;
      inheritsStrokePaint ||= inherited.stroke;
    }
    commandCount += compiled.paintRuns.length / 3;
    if (commandCount > maxCommands) {
      throw new PdfError("resource-limit", "Type3 CharProc programs exceed the page command limit.", {
        pageIndex,
        details: { reason: "type3-command-count", commandCount, maxCommands }
      });
    }
    const unitsPerEm = resource.font.unitsPerEm;
    const matrix = prepared.fontMatrix.map((value) => value * unitsPerEm) as DensePdfMatrix;
    programs.push(Object.freeze({
      compiled,
      glyphOffset,
      invocationProgramIndices,
      matrix,
      bounds: Object.freeze([...glyphBounds]) as readonly [number, number, number, number],
      resourceName: `${resource.font.baseFont || "Type3"}/${glyph.charProcName}`,
      colored: glyph.charProc.metrics.colored,
      inheritedPaintRole: inheritsFillPaint && inheritsStrokePaint
        ? "both"
        : inheritsFillPaint
          ? "fill"
          : inheritsStrokePaint
            ? "stroke"
            : "none"
    }));
    return localProgramIndex;
  };

  const accumulatedGlyphs = textAccumulator.glyphView();
  let glyphIndex = glyphProgramIndices.length;
  while (glyphIndex < accumulatedGlyphs.glyphIds.length) {
    signal.throwIfAborted();
    glyphProgramIndices.push(-1);
    if ((accumulatedGlyphs.flags[glyphIndex] & HEPR_GLYPH_FLAG.Type3) === 0) {
      glyphIndex += 1;
      continue;
    }
    // Invisible OCR text advances and remains indexed without decoding a
    // potentially malformed CharProc that has no default-view paint effect.
    if ((accumulatedGlyphs.flags[glyphIndex] & HEPR_GLYPH_FLAG.Invisible) !== 0) {
      glyphIndex += 1;
      continue;
    }
    const fontIndex = accumulatedGlyphs.fontIndices[glyphIndex];
    const resource = fontRegistry.resources[fontIndex];
    if (!resource || resource.fontIndex !== fontIndex || !resource.type3) {
      throw new PdfError("unsupported-font", "A Type3 glyph references an unprepared page font.", {
        pageIndex,
        details: { reason: "type3-font-resource", fontIndex, glyphIndex }
      });
    }
    const characterCode = accumulatedGlyphs.characterCodes[glyphIndex];
    const initialGraphicsState = glyphInitialStates[glyphIndex];
    if (!initialGraphicsState) {
      throw new PdfError("invalid-object", "A visible Type3 glyph has no source graphics state.", {
        pageIndex,
        details: { reason: "type3-glyph-paint-state", glyphIndex }
      });
    }
    const glyph = await resource.type3.resolveGlyph(characterCode, signal);
    const programIndex = await compileGlyph(resource, glyph, initialGraphicsState);
    glyphProgramIndices[glyphIndex] = programIndex;
    const glyphId = accumulatedGlyphs.glyphIds[glyphIndex];
    const key = `${fontIndex}:${glyphId}`;
    const existing = fontGlyphProgramIndices.get(key);
    // The font store keeps one canonical definition for discovery. Ordered
    // glyph invocations retain their exact state-specialized program, so the
    // same glyph may safely appear under different alpha/blend/line states.
    if (existing === undefined) fontGlyphProgramIndices.set(key, programIndex);
    glyphIndex += 1;
  }

  return Object.freeze({
    type3: Object.freeze({
      glyphProgramIndices: Int32Array.from(glyphProgramIndices),
      programs: Object.freeze(programs),
      fontGlyphProgramIndices,
      programByDefinition
    }),
    forms
  });
}

interface NativePdfCompositingCompilation {
  readonly forms: DensePdfFormPageData;
  readonly type3: NativePdfType3Compilation;
  readonly patterns: DensePdfPatternPageData | undefined;
  readonly compositing: DensePdfCompositingPageData | undefined;
}

interface NativePdfPatternAndFormCompilation {
  readonly patterns: DensePdfPatternPageData | undefined;
  readonly forms: DensePdfFormPageData;
}

async function compileNativeCompositingPrograms(
  document: NativePdfDocument,
  rootCompiled: DensePdfCompiledPage,
  initialForms: DensePdfFormPageData,
  resources: LoadedPageImages,
  options: PdfCompileOptions,
  pageIndex: number,
  signal: AbortSignal,
  optionalContent: NativeOptionalContentRegistry,
  formRegistry: NativePdfFormAppearanceRegistry,
  type3: NativePdfType3Compilation,
  fontRegistry: NativePageFontRegistry,
  textAccumulator: NativePageTextAccumulator
): Promise<NativePdfCompositingCompilation> {
  let forms = initialForms;
  let patterns: DensePdfPatternPageData | undefined;
  let currentType3 = type3;
  const maskPrograms = new Map<number, number>();
  const maskDependencies = new Map<number, Set<number>>();
  const formProgramCache = new Map<
    string,
    { readonly programIndex: number; readonly dependencies: Set<number>; readonly optionalContentIndex: number }
  >();
  const softMasks: DensePdfCompositingPageData["softMasks"][number][] = [];
  const maxPasses = document.limits.maxRecursionDepth;

  const compilePendingMasks = async (): Promise<boolean> => {
    let compiledAny = false;
    // Registry resolution while compiling one mask may append another record;
    // intentionally observe the live size so the whole reachable graph is
    // compiled in deterministic registry order.
    for (let index = 0; index < resources.extGStates.size; index += 1) {
      signal.throwIfAborted();
      if (maskPrograms.has(index)) continue;
      const description = resources.extGStates.describe(index);
      const softMask = description.softMask;
      if (softMask === null || softMask.kind === "none") continue;
      const formId = softMask.formHandle.form.id;
      let cached = formProgramCache.get(formId);
      if (!cached) {
        const compiledMask = await compileNativeSoftMaskProgram(
          document,
          resources,
          softMask,
          options,
          pageIndex,
          signal,
          optionalContent,
          formRegistry,
          fontRegistry,
          textAccumulator
        );
        const baseProgramIndex = forms.programs.length;
        forms = appendFormPrograms(forms, compiledMask.forms);
        cached = Object.freeze({
          programIndex: baseProgramIndex + compiledMask.rootProgramIndex,
          optionalContentIndex: compiledMask.optionalContentIndex,
          dependencies: compiledMask.dependencies
        });
        formProgramCache.set(formId, cached);
      }
      const rootProgramIndex = cached.programIndex;
      maskPrograms.set(index, rootProgramIndex);
      maskDependencies.set(index, cached.dependencies);
      const backdropColor = softMask.backdropColor === null
        ? null
        : toSoftMaskBackdropColor(resources.extGStates, softMask);
      softMasks.push(Object.freeze({
        extGStateIndex: index,
        programIndex: rootProgramIndex,
        optionalContentIndex: cached.optionalContentIndex,
        subtype: softMask.subtype,
        isolated: softMask.formHandle.group.isolated,
        knockout: softMask.formHandle.group.knockout,
        blendingColorSpaceIndex: softMask.formHandle.group.colorSpaceIndex,
        backdropColor,
        transferFunctionIndex: softMask.transferFunctionIndex
      }));
      compiledAny = true;
    }
    return compiledAny;
  };

  for (let pass = 0; pass < maxPasses; pass += 1) {
    await compilePendingMasks();
    const type3Expansion = await compileNativeType3Programs(
      document,
      rootCompiled,
      forms,
      resources,
      options,
      pageIndex,
      signal,
      optionalContent,
      formRegistry,
      fontRegistry,
      textAccumulator,
      currentType3,
      patterns
    );
    forms = type3Expansion.forms;
    currentType3 = type3Expansion.type3;
    const patternCompilation = await compileNativePatternPrograms(
      document,
      rootCompiled,
      forms,
      currentType3,
      resources,
      options,
      pageIndex,
      signal,
      optionalContent,
      formRegistry,
      fontRegistry,
      textAccumulator,
      patterns
    );
    patterns = patternCompilation.patterns;
    forms = patternCompilation.forms;
    let pending = currentType3.glyphProgramIndices.length < textAccumulator.glyphCount;
    for (let index = 0; index < resources.extGStates.size; index += 1) {
      const mask = resources.extGStates.describe(index).softMask;
      if (mask !== null && mask.kind === "mask" && !maskPrograms.has(index)) {
        pending = true;
        break;
      }
    }
    if (!pending) {
      assertAcyclicSoftMasks(maskDependencies, pageIndex);
      return Object.freeze({
        forms,
        type3: currentType3,
        patterns,
        compositing: softMasks.length === 0
          ? undefined
          : Object.freeze({ softMasks: Object.freeze(softMasks) })
      });
    }
  }
  throw new PdfError("resource-limit", "Reusable resource expansion exceeds the recursion limit.", {
    pageIndex,
    details: { reason: "reusable-resource-depth", maxDepth: maxPasses }
  });
}

interface CompiledNativeSoftMask {
  readonly optionalContentIndex: number;
  readonly forms: DensePdfFormPageData;
  readonly rootProgramIndex: number;
  readonly dependencies: Set<number>;
}

async function compileNativeSoftMaskProgram(
  document: NativePdfDocument,
  resources: LoadedPageImages,
  mask: Readonly<NativePdfSoftMaskDefinition>,
  options: PdfCompileOptions,
  pageIndex: number,
  signal: AbortSignal,
  optionalContent: NativeOptionalContentRegistry,
  formRegistry: NativePdfFormAppearanceRegistry,
  fontRegistry: NativePageFontRegistry,
  textAccumulator: NativePageTextAccumulator
): Promise<CompiledNativeSoftMask> {
  const sourceForm = mask.formHandle.form;
  const content = await resources.extGStates.decodeSoftMaskFormContent(sourceForm, signal);
  // The `/G` transparency group is represented by the dedicated HEPR
  // soft-mask group. Suppress the ordinary Form wrapper for this root only so
  // isolation, knockout and blending-space semantics are applied exactly once.
  const compilationForm = Object.freeze({ ...sourceForm, group: undefined });
  const resourceName = "SMaskRoot";
  let graph = await buildNativePdfScopedFormDefinitionGraph(
    document,
    formRegistry,
    compilationForm,
    content,
    { pageIndex, resourceName, optionalContent, signal, retainOptionalContent: (options as NativeVectorCompileOptions).retainOptionalContent === true }
  );
  if ((options as NativeVectorCompileOptions).retainOptionalContent !== true) {
    // The static API still needs a valid empty mask program. Its Form content
    // was pruned by the graph builder, and the mask invocation keeps its OCG.
    graph = { ...graph, definitions: graph.definitions.map(definition => definition.resourceName === resourceName && !definition.defaultVisible
      ? { ...definition, defaultVisible: true } : definition) };
  }
  const bounds: DensePdfBounds = {
    minX: sourceForm.bbox[0],
    minY: sourceForm.bbox[1],
    maxX: sourceForm.bbox[2],
    maxY: sourceForm.bbox[3]
  };
  const root = await compileDensePdfContent(
    new TextEncoder().encode(`/${resourceName} Do\n`),
    {
      pageMatrix: [1, 0, 0, 1, 0, 0],
      pageBounds: bounds,
      formXObjects: graph.pageForms,
      retainOptionalContent: (options as NativeVectorCompileOptions).retainOptionalContent === true,
      output: "display-program",
      enableSegmentMerge: false,
      enableInvisibleCull: false,
      colorSpaceResolver: resources.colorSpaceResolver,
      ...densePathCompileLimits(document, options),
      signal
    }
  );
  const forms = await compileNativeFormPrograms(
    document,
    graph,
    root,
    resources,
    options,
    pageIndex,
    signal,
    optionalContent,
    fontRegistry,
    textAccumulator,
    true
  );
  if (forms.rootInvocationProgramIndices.length !== 1) {
    throw new PdfError("invalid-object", "A soft-mask Form did not compile to one root program.", {
      pageIndex,
      details: { reason: "soft-mask-root-program" }
    });
  }
  const dependencies = new Set<number>();
  for (const program of forms.programs) {
    for (const state of program.compiled.paintRunCompositeStates) {
      if (state.softMaskIndex >= 0) dependencies.add(state.softMaskIndex);
    }
    if (program.group && program.group.softMaskIndex >= 0) {
      dependencies.add(program.group.softMaskIndex);
    }
  }
  return Object.freeze({
    forms,
    rootProgramIndex: forms.rootInvocationProgramIndices[0],
    optionalContentIndex: graph.definitions.find(definition => definition.resourceName === resourceName)?.optionalContentIndex ?? -1,
    dependencies
  });
}

function appendFormPrograms(
  base: DensePdfFormPageData,
  addition: DensePdfFormPageData
): DensePdfFormPageData {
  const offset = base.programs.length;
  if (offset + addition.programs.length > 0xffff_ffff) {
    throw new PdfError("resource-limit", "Reusable Form program indexes exceed the Uint32 ABI.", {
      details: { reason: "form-program-index" }
    });
  }
  const programs = addition.programs.map((program): DensePdfFormProgramData => Object.freeze({
    ...program,
    invocationProgramIndices: Uint32Array.from(
      program.invocationProgramIndices,
      (index) => index + offset
    )
  }));
  const annotations = addition.annotations.map((annotation) => Object.freeze({
    ...annotation,
    programIndex: annotation.programIndex + offset
  }));
  return Object.freeze({
    rootInvocationProgramIndices: base.rootInvocationProgramIndices,
    programs: Object.freeze([...base.programs, ...programs]),
    annotations: Object.freeze([...base.annotations, ...annotations])
  });
}

function emptyFormDefinitionGraph(): NativePdfFormDefinitionGraph {
  return Object.freeze({
    pageForms: new Map(),
    definitions: Object.freeze([]),
    annotationPlacements: Object.freeze([])
  });
}

function inheritedPaintRolesForFormProgram(
  forms: DensePdfFormPageData,
  rootProgramIndex: number
): { readonly fill: boolean; readonly stroke: boolean } {
  const active = new Set<number>();
  const memo = new Map<number, { readonly fill: boolean; readonly stroke: boolean }>();
  const visit = (programIndex: number): { readonly fill: boolean; readonly stroke: boolean } => {
    const cached = memo.get(programIndex);
    if (cached) return cached;
    if (active.has(programIndex)) {
      throw new PdfError("unsupported-content", "A nested Form paint graph is cyclic.", {
        details: { reason: "reusable-program-cycle", programIndex }
      });
    }
    const program = forms.programs[programIndex];
    if (!program) {
      throw new PdfError("invalid-object", "A Type3 CharProc references a missing Form program.", {
        details: { reason: "type3-form-program-missing", programIndex }
      });
    }
    active.add(programIndex);
    let fill = false;
    let stroke = false;
    let pathPaintIndex = 0;
    let glyphPaintIndex = 0;
    let imagePaintIndex = 0;
    for (let offset = 0; offset < program.compiled.paintRuns.length; offset += 3) {
      const kind = program.compiled.paintRuns[offset];
      if (kind === DENSE_PDF_PAINT_RUN_FILL || kind === DENSE_PDF_PAINT_RUN_STROKE) {
        const paint = program.compiled.pathPaints[pathPaintIndex++];
        if (paint?.inheritType3Paint === true) {
          if (kind === DENSE_PDF_PAINT_RUN_FILL) fill = true;
          else stroke = true;
        }
      } else if (kind === DENSE_PDF_PAINT_RUN_PATH) {
        const paint = program.compiled.genericPathPaints[program.compiled.paintRuns[offset + 1]];
        fill ||= paint?.fill?.inheritType3Paint === true;
        stroke ||= paint?.stroke?.inheritType3Paint === true;
      } else if (kind === DENSE_PDF_PAINT_RUN_IMAGE) {
        fill ||= program.compiled.imagePaints[imagePaintIndex++]?.inheritType3Paint === true;
      } else if (kind === DENSE_PDF_PAINT_RUN_GLYPH) {
        const paint = program.compiled.glyphPaints[glyphPaintIndex++];
        if (paint) {
          const mode = paint.renderingMode;
          fill ||= paint.fillPaintInherited === true &&
            (mode === 0 || mode === 2 || mode === 4 || mode === 6);
          stroke ||= paint.strokePaintInherited === true &&
            (mode === 1 || mode === 2 || mode === 5 || mode === 6);
        }
      } else if (kind === DENSE_PDF_PAINT_RUN_FORM) {
        const child = visit(program.invocationProgramIndices[program.compiled.paintRuns[offset + 1]]);
        fill ||= child.fill;
        stroke ||= child.stroke;
      }
    }
    active.delete(programIndex);
    const result = Object.freeze({ fill, stroke });
    memo.set(programIndex, result);
    return result;
  };
  return visit(rootProgramIndex);
}

function extendType3GlyphBindings(
  source: NativePdfType3Compilation,
  glyphCount: number
): NativePdfType3Compilation {
  if (glyphCount < source.glyphProgramIndices.length) {
    throw new PdfError("invalid-object", "The accumulated glyph store lost Type3 bindings.", {
      details: { reason: "type3-glyph-binding-count", glyphCount }
    });
  }
  if (glyphCount === source.glyphProgramIndices.length) return source;
  const glyphProgramIndices = new Int32Array(glyphCount).fill(-1);
  glyphProgramIndices.set(source.glyphProgramIndices);
  return Object.freeze({ ...source, glyphProgramIndices });
}

/**
 * Expand reusable Form text in dynamic invocation order. Root glyphs retain
 * their direct store references; reusable occurrences use page-space fallback
 * quads so repeated invocations never alias selection geometry.
 */
/** Pen geometry captured with a compiled page's text index, for the retained vector lowering. */
const retainedTextPositions = new WeakMap<HeprTextIndex, RetainedTextPositions>();
const pageMarkedContentCounts = new WeakMap<HeprPageData, number>();

function buildInvocationOrderedTextIndex(
  root: DensePdfCompiledPage,
  forms: DensePdfFormPageData,
  accumulated: NativeAccumulatedText,
  fontResources: readonly NativeTextFontResource[],
  maxGlyphOccurrences: number,
  signal: AbortSignal
): { textIndex: HeprTextIndex; positions: RetainedTextPositions | undefined } {
  const textParts: string[] = [];
  const references: number[] = [];
  const fallbackQuads: number[] = [];
  const charOccurrences: number[] = [];
  const pens: number[] = [];
  const gapBefore: number[] = [];
  const activePrograms = new Set<number>();
  const compilation = accumulated.compilation;
  const maxTextCodeUnits = Math.min(
    0x7fff_ffff,
    Math.max(1_024, maxGlyphOccurrences * 8)
  );
  let textLength = 0;
  let occurrenceCount = 0;
  let boundaryPending = false;

  const glyphCount = compilation.glyphs.glyphIds.length;
  const widthEms = compilation.glyphWidthEms?.length === glyphCount ? compilation.glyphWidthEms : undefined;
  const gaps = compilation.glyphGapBefore?.length === glyphCount ? compilation.glyphGapBefore : undefined;

  // The same pen geometry an ordinary vector page derives its word breaks from.
  const appendPen = (glyphIndex: number, outerTransform: PdfMatrix): number => {
    const occurrence = gapBefore.length;
    const offset = compilation.glyphs.transformIndices[glyphIndex] * 6, values = compilation.transforms.values;
    const matrix = multiplyPdfMatrices(outerTransform, [values[offset], values[offset + 1], values[offset + 2],
      values[offset + 3], values[offset + 4], values[offset + 5]]);
    const units = fontResources[compilation.glyphs.fontIndices[glyphIndex]]?.font.unitsPerEm ?? 1000;
    const vertical = (compilation.glyphs.flags[glyphIndex] & HEPR_GLYPH_FLAG.Vertical) !== 0;
    const advance = (widthEms?.[glyphIndex] ?? 0) * units;
    const end = compilation.actualTextEndPositions?.get(glyphIndex);
    pens.push(matrix[4], matrix[5],
      end ? outerTransform[0] * end[0] + outerTransform[2] * end[1] + outerTransform[4]
        : matrix[4] + (vertical ? matrix[2] : matrix[0]) * advance,
      end ? outerTransform[1] * end[0] + outerTransform[3] * end[1] + outerTransform[5]
        : matrix[5] + (vertical ? matrix[3] : matrix[1]) * advance,
      Math.hypot(matrix[2] * units, matrix[3] * units));
    gapBefore.push(gaps?.[glyphIndex] ?? 0);
    return occurrence;
  };

  const appendCodeUnits = (text: string, reference: number, occurrence = -1): void => {
    if (text.length === 0) return;
    if (textLength > maxTextCodeUnits - text.length) {
      throw new PdfError("resource-limit", "Expanded reusable text exceeds the Unicode limit.", {
        details: { reason: "expanded-text-code-units", maxTextCodeUnits }
      });
    }
    textParts.push(text);
    textLength += text.length;
    for (let index = 0; index < text.length; index += 1) {
      references.push(reference);
      charOccurrences.push(occurrence);
    }
  };

  const appendBoundaryIfNeeded = (prefix: string, text: string): void => {
    if (!boundaryPending || textLength === 0) return;
    const next = prefix[0] ?? text[0] ?? "";
    const previous = lastTextCodeUnit(textParts);
    if (!isPdfSearchWhitespace(previous) && !isPdfSearchWhitespace(next)) {
      appendCodeUnits(" ", -1);
    }
    boundaryPending = false;
  };

  const appendGlyph = (
    glyphIndex: number,
    outerTransform: PdfMatrix,
    directReference: boolean
  ): boolean => {
    signal.throwIfAborted();
    const prefix = accumulated.glyphPrefixes[glyphIndex] ?? "";
    const text = accumulated.glyphTexts[glyphIndex] ?? "";
    if (prefix.length === 0 && text.length === 0) return false;
    appendBoundaryIfNeeded(prefix, text);
    appendCodeUnits(prefix, -1);
    if (text.length === 0) return prefix.length > 0;
    occurrenceCount += 1;
    if (occurrenceCount > maxGlyphOccurrences) {
      throw new PdfError("resource-limit", "Expanded reusable text exceeds the glyph limit.", {
        details: { reason: "expanded-glyph-count", maxGlyphs: maxGlyphOccurrences }
      });
    }
    const invisible = (compilation.glyphs.flags[glyphIndex] & HEPR_GLYPH_FLAG.Invisible) !== 0;
    const occurrence = appendPen(glyphIndex, outerTransform);
    if (directReference && !invisible) {
      appendCodeUnits(text, glyphIndex, occurrence);
      return true;
    }
    const fallbackIndex = fallbackQuads.length / 4;
    if (fallbackIndex >= maxGlyphOccurrences) {
      throw new PdfError("resource-limit", "Expanded reusable text exceeds the geometry limit.", {
        details: { reason: "expanded-fallback-quads", maxFallbackQuads: maxGlyphOccurrences }
      });
    }
    fallbackQuads.push(...expandedGlyphBounds(
      compilation,
      glyphIndex,
      fontResources,
      outerTransform
    ));
    appendCodeUnits(text, -fallbackIndex - 2, occurrence);
    return true;
  };

  const walkCompiled = (
    source: DensePdfCompiledPage,
    glyphOffset: number,
    outerTransform: PdfMatrix,
    invocationProgramIndices: Uint32Array,
    directReferences: boolean
  ): boolean => {
    let appended = false;
    for (let offset = 0; offset < source.paintRuns.length; offset += 3) {
      signal.throwIfAborted();
      const kind = source.paintRuns[offset];
      const first = source.paintRuns[offset + 1];
      const count = source.paintRuns[offset + 2];
      if (kind === DENSE_PDF_PAINT_RUN_GLYPH) {
        for (let index = 0; index < count; index += 1) {
          appended = appendGlyph(
            glyphOffset + first + index,
            outerTransform,
            directReferences
          ) || appended;
        }
      } else if (kind === DENSE_PDF_PAINT_RUN_FORM) {
        const paint = source.formPaints[first];
        const programIndex = invocationProgramIndices[first];
        if (!paint || programIndex === undefined || !forms.programs[programIndex]) {
          throw new PdfError("invalid-object", "A text-index Form invocation is inconsistent.", {
            details: { reason: "text-index-form-invocation", programIndex }
          });
        }
        const previousBoundary: boolean = boundaryPending;
        boundaryPending = true;
        const childAppended = walkProgram(
          programIndex,
          multiplyPdfMatrices(outerTransform, paint.transform)
        );
        if (childAppended) {
          appended = true;
          boundaryPending = true;
        } else {
          boundaryPending = previousBoundary;
        }
      }
    }
    return appended;
  };

  const walkProgram = (programIndex: number, invocationTransform: PdfMatrix): boolean => {
    if (activePrograms.has(programIndex)) {
      throw new PdfError("unsupported-content", "The reusable text program graph is cyclic.", {
        details: { reason: "text-index-program-cycle", programIndex }
      });
    }
    const program = forms.programs[programIndex];
    if (!program) {
      throw new PdfError("invalid-object", "A reusable text program is missing.", {
        details: { reason: "text-index-program-missing", programIndex }
      });
    }
    activePrograms.add(programIndex);
    try {
      return walkCompiled(
        program.compiled,
        program.glyphOffset,
        multiplyPdfMatrices(invocationTransform, program.matrix),
        program.invocationProgramIndices,
        false
      );
    } finally {
      activePrograms.delete(programIndex);
    }
  };

  // Deliberately walk only page/annotation Form invocations. Text painted as
  // implementation detail of a Type3 glyph is represented by the outer
  // character's Unicode mapping, while a tiling-cell program may execute an
  // unbounded number of times and therefore contributes no repeated index
  // entries. Forms reachable exclusively through either program kind inherit
  // the same exclusion.
  walkCompiled(
    root,
    0,
    IDENTITY_PDF_MATRIX,
    forms.rootInvocationProgramIndices,
    true
  );
  for (const annotation of forms.annotations) {
    const previousBoundary: boolean = boundaryPending;
    boundaryPending = true;
    const appended = walkProgram(annotation.programIndex, annotation.transform);
    boundaryPending = appended ? true : previousBoundary;
  }
  return {
    textIndex: {
      version: 1,
      text: textParts.join(""),
      charGlyphIndices: Int32Array.from(references),
      fallbackQuads: Float32Array.from(fallbackQuads)
    },
    positions: widthEms ? {
      charOccurrences: Int32Array.from(charOccurrences),
      pens: Float32Array.from(pens),
      gapBefore: Uint8Array.from(gapBefore)
    } : undefined
  };
}

const IDENTITY_PDF_MATRIX: PdfMatrix = Object.freeze([1, 0, 0, 1, 0, 0]);

function multiplyPdfMatrices(outer: PdfMatrix, local: PdfMatrix): PdfMatrix {
  return [
    outer[0] * local[0] + outer[2] * local[1],
    outer[1] * local[0] + outer[3] * local[1],
    outer[0] * local[2] + outer[2] * local[3],
    outer[1] * local[2] + outer[3] * local[3],
    outer[0] * local[4] + outer[2] * local[5] + outer[4],
    outer[1] * local[4] + outer[3] * local[5] + outer[5]
  ];
}

function expandedGlyphBounds(
  compilation: NativeTextCompilation,
  glyphIndex: number,
  fontResources: readonly NativeTextFontResource[],
  outerTransform: PdfMatrix
): [number, number, number, number] {
  const fontIndex = compilation.glyphs.fontIndices[glyphIndex];
  const resource = fontResources[fontIndex];
  if (!resource || resource.fontIndex !== fontIndex) {
    throw new PdfError("invalid-object", "Expanded text references a missing font.", {
      details: { reason: "expanded-text-font", fontIndex, glyphIndex }
    });
  }
  const font = resource.font;
  const unitsPerEm = font.unitsPerEm;
  const descriptorBounds = font.descriptor.fontBBox ?? [
    0,
    Math.min(font.descriptor.descent, -250),
    1000,
    Math.max(font.descriptor.ascent, 850)
  ];
  let minX = descriptorBounds[0] * unitsPerEm / 1000;
  let minY = descriptorBounds[1] * unitsPerEm / 1000;
  let maxX = descriptorBounds[2] * unitsPerEm / 1000;
  let maxY = descriptorBounds[3] * unitsPerEm / 1000;
  if (minX === maxX) [minX, maxX] = [0, unitsPerEm];
  if (minY === maxY) [minY, maxY] = [-unitsPerEm / 4, unitsPerEm * 0.85];
  const transformIndex = compilation.glyphs.transformIndices[glyphIndex];
  const offset = transformIndex * 6;
  const local = compilation.transforms.values.subarray(offset, offset + 6);
  if (local.length !== 6) {
    throw new PdfError("invalid-object", "Expanded text references a missing transform.", {
      details: { reason: "expanded-text-transform", transformIndex, glyphIndex }
    });
  }
  const matrix = multiplyPdfMatrices(outerTransform, [
    local[0], local[1], local[2], local[3], local[4], local[5]
  ]);
  const points = [
    transformPdfPoint(matrix, minX, minY),
    transformPdfPoint(matrix, minX, maxY),
    transformPdfPoint(matrix, maxX, minY),
    transformPdfPoint(matrix, maxX, maxY)
  ];
  return [
    Math.min(...points.map(([x]) => x)),
    Math.min(...points.map(([, y]) => y)),
    Math.max(...points.map(([x]) => x)),
    Math.max(...points.map(([, y]) => y))
  ];
}

function transformPdfPoint(
  matrix: PdfMatrix,
  x: number,
  y: number
): readonly [number, number] {
  return [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5]
  ];
}

function lastTextCodeUnit(parts: readonly string[]): string {
  for (let index = parts.length - 1; index >= 0; index -= 1) {
    const part = parts[index];
    if (part.length > 0) return part[part.length - 1];
  }
  return "";
}

function isPdfSearchWhitespace(value: string): boolean {
  return value.length > 0 && /\s/u.test(value);
}

function toSoftMaskBackdropColor(
  registry: NativePdfExtGStateRegistry,
  mask: Readonly<NativePdfSoftMaskDefinition>
): readonly [number, number, number, number] {
  if (mask.backdropColor === null || mask.formHandle.group.colorSpaceIndex < 0) {
    throw new PdfError("invalid-object", "A soft-mask backdrop has no blending color space.", {
      details: { reason: "soft-mask-backdrop-color-space" }
    });
  }
  const rgb = registry.colors.convertToSrgb(
    mask.formHandle.group.colorSpaceIndex,
    mask.backdropColor
  );
  return Object.freeze([rgb[0], rgb[1], rgb[2], 1]);
}

function assertAcyclicSoftMasks(
  dependencies: ReadonlyMap<number, ReadonlySet<number>>,
  pageIndex: number
): void {
  const states = new Map<number, 0 | 1 | 2>();
  const visit = (index: number): void => {
    const state = states.get(index) ?? 0;
    if (state === 2) return;
    if (state === 1) {
      throw new PdfError("unsupported-content", "The reachable soft-mask graph is cyclic.", {
        pageIndex,
        details: { reason: "soft-mask-cycle", extGStateIndex: index }
      });
    }
    states.set(index, 1);
    for (const dependency of dependencies.get(index) ?? []) {
      if (dependencies.has(dependency)) visit(dependency);
    }
    states.set(index, 2);
  };
  for (const index of dependencies.keys()) visit(index);
}

async function compileNativePatternPrograms(
  document: NativePdfDocument,
  rootCompiled: DensePdfCompiledPage,
  initialForms: DensePdfFormPageData,
  type3: NativePdfType3Compilation,
  resources: LoadedPageImages,
  options: PdfCompileOptions,
  pageIndex: number,
  signal: AbortSignal,
  optionalContent: NativeOptionalContentRegistry,
  formRegistry: NativePdfFormAppearanceRegistry,
  fontRegistry: NativePageFontRegistry,
  textAccumulator: NativePageTextAccumulator,
  initialPatterns?: DensePdfPatternPageData
): Promise<NativePdfPatternAndFormCompilation> {
  let forms = initialForms;
  const usedPatternIndexes = new Set<number>();
  for (const paint of rootCompiled.patternPaints) usedPatternIndexes.add(paint.patternIndex);
  for (const program of forms.programs) {
    for (const paint of program.compiled.patternPaints) {
      usedPatternIndexes.add(paint.patternIndex);
    }
  }
  for (const program of type3.programs) {
    for (const paint of program.compiled.patternPaints) {
      usedPatternIndexes.add(paint.patternIndex);
    }
  }
  for (const program of initialPatterns?.programs ?? []) {
    for (const paint of program.compiled.patternPaints) {
      usedPatternIndexes.add(paint.patternIndex);
    }
  }
  if (usedPatternIndexes.size === 0 && !initialPatterns) {
    return Object.freeze({ patterns: undefined, forms });
  }

  const programs: Array<DensePdfPatternProgramData | undefined> = [
    ...(initialPatterns?.programs ?? [])
  ];
  const programByPatternIndex = new Map<number, number>(
    programs.map((program, index) => [program!.patternIndex, index])
  );
  const maxCommands = options.limits?.maxCommandsPerPage ??
    document.limits.maxCommandsPerPage;

  const compileInvocation = async (
    invocation: NativePdfPatternInvocation
  ): Promise<void> => {
    signal.throwIfAborted();
    const pattern = invocation.pattern;
    if (pattern.patternType === 2) return;
    if (programByPatternIndex.has(pattern.index)) return;
    if (programs.length >= 0xffffffff) {
      throw new PdfError("resource-limit", "Tiling-pattern programs exceed the Uint32 index range.", {
        pageIndex,
        details: {
          reason: "pattern-program-count",
          maxPatternPrograms: 0xffffffff
        }
      });
    }
    const programIndex = programs.length;
    programByPatternIndex.set(pattern.index, programIndex);
    programs.push(undefined);

    const content = await resources.patterns.decodeTilingContent(pattern.index, signal);
    const preparedContent = prepareNativeInlineImages(content, {
      signal,
      limits: inlineImageLimits(document, maxCommands)
    });
    const references = scanPreparedResourceReferencesFastOrExact(
      preparedContent.segments,
      { signal }
    ).references;
    const xObjects = await classifyNativePdfXObjectReferences(
      document,
      pattern.resources,
      references.xObjects,
      signal
    );
    const formXObjects = xObjects.filter((reference) => reference.kind === "Form");
    const formGraph = formXObjects.length === 0
      ? emptyFormDefinitionGraph()
      : await buildNativePdfResourceFormDefinitionGraph(
          document,
          formRegistry,
          pattern.resources,
          references,
          {
            pageIndex,
            ownerLabel: `tiling pattern ${pattern.id}`,
            optionalContent,
            retainOptionalContent: (options as NativeVectorCompileOptions).retainOptionalContent === true,
            signal
          }
        );
    const patternFonts = await fontRegistry.loadScope(
      pattern.resources,
      references.fonts,
      signal,
      { label: `Tiling pattern ${pattern.id}`, allowType3: true }
    );
    const fontsByName = new Map<string, NativeTextFontResource>(patternFonts);
    const emittedTextRuns: NativeTextDrawRun[] = [];
    const textCompiler = new NativeTextCompiler({
      fonts: fontsByName,
      maxGlyphs: options.limits?.maxGlyphsPerPage ?? document.limits.maxGlyphsPerPage,
      maxGraphicsStateDepth: document.limits.maxRecursionDepth,
      signal,
      onRun(run) {
        emittedTextRuns.push(run);
      }
    });
    const textOperatorSink = {
      getFontSelection: () => textCompiler.getFontSelection(),
      applyOperator(
        operator: string,
        operands: readonly unknown[],
        context: Readonly<DensePdfTextOperatorContext>
      ) {
        emittedTextRuns.length = 0;
        textCompiler.setOutputEnabled(context.outputEnabled);
        if (context.font) {
          textCompiler.setFontResource(fontRegistry.resources[context.font.fontIndex], context.font.size);
        }
        textCompiler.applyOperator(operator, operands);
        return emittedTextRuns;
      }
    };
    const colorScope = await loadScopedColorResolver(
      document,
      pattern.resources,
      resources.registry.colors,
      resources.colorSpaceResolver,
      references.colorSpaces,
      pageIndex,
      signal
    );
    const scopedImages = await loadScopedImageResources(
      document,
      resources.registry,
      optionalContent,
      pattern.resources,
      xObjects
        .filter((reference) => reference.kind === "Image")
        .map((reference) => reference.resourceName),
      colorScope.colorSpaces,
      pageIndex,
      signal,
      (options as NativeVectorCompileOptions).retainOptionalContent === true
    );
    const shadings = new Map<string, number>();
    for (const resourceName of references.shadings) {
      signal.throwIfAborted();
      shadings.set(
        resourceName,
        await resources.shadings.add(
          { kind: "name", value: resourceName },
          pattern.resources,
          signal
        )
      );
    }
    const nestedInvocations = new Map<number, NativePdfPatternInvocation>();
    const nestedPatterns = new Map<string, Readonly<DensePdfPatternDefinition>>();
    for (const resourceName of references.patterns) {
      signal.throwIfAborted();
      const nested = await resources.patterns.resolveNestedPattern(
        invocation,
        resourceName,
        signal
      );
      nestedInvocations.set(nested.pattern.index, nested);
      const extGState = nested.pattern.patternType === 2 && nested.pattern.extGState !== null
        ? denseExtGStateDefinition(
          `${resourceName}:ExtGState`,
          resources.extGStates.describe(await resources.extGStates.add(
            nested.pattern.extGState,
            nested.pattern.resources,
            signal
          ))
        )
        : undefined;
      nestedPatterns.set(resourceName, Object.freeze({
        resourceName,
        patternIndex: nested.pattern.index,
        kind: nested.pattern.kind,
        hasExtGState: extGState !== undefined,
        ...(extGState ? { extGState } : {})
      }));
    }
    const extGStates = await loadResourceExtGStates(
      resources.extGStates,
      pattern.resources,
      references.extGStates,
      signal,
      fontRegistry
    );
    const markedContentProperties = await loadMarkedContentProperties(
      document,
      optionalContent,
      pattern.resources,
      references.properties,
      references.optionalContentProperties,
      signal
    );
    const contentSegments = await bindPreparedInlineImages(
      preparedContent,
      resources.registry,
      colorScope.colorSpaces,
      signal
    );
    const bounds: DensePdfBounds = {
      minX: pattern.boundingBox[0],
      minY: pattern.boundingBox[1],
      maxX: pattern.boundingBox[2],
      maxY: pattern.boundingBox[3]
    };
    const compiled = await compileDensePdfContent(contentSegments, {
      pageMatrix: [1, 0, 0, 1, 0, 0],
      pageBounds: bounds,
      textOperatorSink,
      formXObjects: formGraph.pageForms,
      formOptionalContent: formOptionalContentForScope(
        formGraph.pageForms,
        formGraph.definitions
      ),
      extGStates,
      imageXObjects: scopedImages.indexes,
      imageOptionalContent: scopedImages.optionalContent,
      shadings,
      patterns: nestedPatterns,
      patternColorSpaces: colorScope.patternColorSpaces,
      markedContentProperties,
      retainOptionalContent: (options as NativeVectorCompileOptions).retainOptionalContent === true,
      ...((options as NativeVectorCompileOptions).retainOptionalContent === true ? { combineOptionalContent: (parent: number, own: number) => optionalContent.combineMemberships(parent, own) } : {}),
      maxMarkedContentDepth: document.limits.maxRecursionDepth,
      maxMarkedContent: maxCommands,
      ...densePathCompileLimits(document, options),
      colorSpaceResolver: colorScope.resolver,
      enableSegmentMerge: nativeVectorSegmentMergeEnabled(options),
      enableInvisibleCull: nativeVectorInvisibleCullEnabled(options),
      output: "display-program",
      uncoloredPatternPaint: pattern.kind === "uncolored-tiling",
      totalBytes: content.length,
      signal
    });
    resources.assertReferencedCodecsAvailable(
      compiled.referencedXObjects,
      scopedImages.indexes
    );
    const glyphOffset = textAccumulator.append(textCompiler.build());
    let invocationProgramIndices = new Uint32Array(0);
    if (compiled.formPaints.length > 0) {
      const scopedForms = await compileNativeFormPrograms(
        document,
        formGraph,
        compiled,
        resources,
        options,
        pageIndex,
        signal,
        optionalContent,
        fontRegistry,
        textAccumulator,
        true
      );
      const formOffset = forms.programs.length;
      invocationProgramIndices = Uint32Array.from(
        scopedForms.rootInvocationProgramIndices,
        (index) => index + formOffset
      );
      forms = appendFormPrograms(forms, scopedForms);
      for (const scopedProgram of scopedForms.programs) {
        for (const paint of scopedProgram.compiled.patternPaints) {
          await compileInvocation(resources.patterns.createInvocation(paint.patternIndex));
        }
      }
    }
    for (const paint of compiled.patternPaints) {
      const nested = nestedInvocations.get(paint.patternIndex);
      if (!nested) {
        throw new PdfError("invalid-object", "A pattern paint lost its invocation ancestry.", {
          pageIndex,
          details: { reason: "pattern-invocation-missing", patternIndex: paint.patternIndex }
        });
      }
      await compileInvocation(nested);
    }
    programs[programIndex] = Object.freeze({
      compiled,
      glyphOffset,
      invocationProgramIndices,
      patternIndex: pattern.index,
      bounds: pattern.boundingBox,
      resourceName: pattern.id,
      colored: pattern.kind === "colored-tiling"
    });
  };

  for (const patternIndex of usedPatternIndexes) {
    await compileInvocation(resources.patterns.createInvocation(patternIndex));
  }
  if (programs.some((program) => program === undefined)) {
    throw new PdfError("invalid-object", "A tiling-pattern program was not completed.", {
      pageIndex,
      details: { reason: "pattern-program-incomplete" }
    });
  }
  const typedPrograms = programs as DensePdfPatternProgramData[];
  const existingCommands = rootCompiled.paintRuns.length / 3 +
    forms.annotations.length +
    forms.programs.reduce(
      (sum, program) => sum + program.compiled.paintRuns.length / 3,
      0
    ) +
    forms.programs.filter((program) => program.group !== undefined).length +
    type3.programs.reduce(
      (sum, program) => sum + program.compiled.paintRuns.length / 3,
      0
    );
  const patternCommands = typedPrograms.reduce(
    (sum, program) => sum + program.compiled.paintRuns.length / 3,
    0
  );
  if (existingCommands + patternCommands > maxCommands) {
    throw new PdfError("resource-limit", "The page exceeds the display-command limit.", {
      pageIndex,
      details: { commandCount: existingCommands + patternCommands, maxCommands }
    });
  }
  const sidecars = await resources.patterns.buildSidecars(signal);
  return Object.freeze({
    patterns: Object.freeze({
      store: sidecars.patterns,
      matrices: sidecars.matrices,
      programs: Object.freeze(typedPrograms)
    }),
    forms
  });
}

function resetTransparencyGroupCompositing(
  state: DensePdfInitialGraphicsState
): DensePdfInitialGraphicsState {
  if (
    state.strokeAlpha === 1 && state.fillAlpha === 1 &&
    (state.blendMode ?? "Normal") === "Normal" &&
    (state.softMaskIndex ?? -1) === -1
  ) return state;
  return Object.freeze({
    ...state,
    strokeAlpha: 1,
    fillAlpha: 1,
    blendMode: "Normal",
    softMaskIndex: -1
  });
}

function formSpecializationKey(
  definitionIndex: number,
  state: DensePdfInitialGraphicsState
): string {
  return JSON.stringify([
    definitionIndex,
    state.lineWidth,
    state.lineCap,
    state.lineDash,
    state.dashPhase,
    state.strokeColorSpace.resourceName,
    state.strokeColorSpace.colorSpaceIndex,
    state.strokeColor,
    state.fillColorSpace.resourceName,
    state.fillColorSpace.colorSpaceIndex,
    state.fillColor,
    state.strokePaintInherited ?? false,
    state.fillPaintInherited ?? false,
    state.strokeAlpha,
    state.fillAlpha,
    state.alphaIsShape ?? false,
    state.blendMode ?? "Normal",
    state.softMaskIndex ?? -1,
    state.strokeOverprint ?? false,
    state.fillOverprint ?? false,
    state.overprintMode ?? 0,
    state.textKnockout ?? true,
    state.lineJoin ?? 0,
    state.miterLimit ?? 10,
    state.renderingIntent ?? null,
    state.flatnessTolerance ?? null,
    state.smoothnessTolerance ?? null,
    state.strokeAdjustment ?? false,
    state.font?.fontIndex ?? -1,
    state.font?.size ?? 0
  ]);
}

function type3SpecializationKey(state: DensePdfInitialGraphicsState): string {
  // Source fill/stroke colors are late-bound through type3PaintIndex. Keeping
  // them out of the program key lets the common uncoloured glyph case share
  // one reusable program across differently coloured text-show operations.
  // Color-space identity remains relevant to explicit SC/SCN operators.
  return JSON.stringify([
    state.lineWidth,
    state.lineCap,
    state.lineDash,
    state.dashPhase,
    state.strokeColorSpace.resourceName,
    state.strokeColorSpace.colorSpaceIndex,
    state.fillColorSpace.resourceName,
    state.fillColorSpace.colorSpaceIndex,
    state.strokePaintInherited ?? false,
    state.fillPaintInherited ?? false,
    state.strokeAlpha,
    state.fillAlpha,
    state.alphaIsShape ?? false,
    state.blendMode ?? "Normal",
    state.softMaskIndex ?? -1,
    state.strokeOverprint ?? false,
    state.fillOverprint ?? false,
    state.overprintMode ?? 0,
    state.textKnockout ?? true,
    state.lineJoin ?? 0,
    state.miterLimit ?? 10,
    state.renderingIntent ?? null,
    state.flatnessTolerance ?? null,
    state.smoothnessTolerance ?? null,
    state.strokeAdjustment ?? false
  ]);
}

function createDefaultInitialGraphicsState(
  resolver: DensePdfColorSpaceResolver
): DensePdfInitialGraphicsState {
  const gray = resolver("DeviceGray");
  if (!gray) throw new PdfError("unsupported-color", "DeviceGray is unavailable.");
  const converted = gray.convertToSrgb(gray.initialComponents);
  const color = [converted[0], converted[1], converted[2]] as const;
  return Object.freeze({
    lineWidth: 1,
    lineCap: 0,
    lineDash: Object.freeze([]),
    dashPhase: 0,
    strokeColor: color,
    fillColor: color,
    strokeColorSpace: gray,
    fillColorSpace: gray,
    strokeAlpha: 1,
    fillAlpha: 1,
    alphaIsShape: false
  });
}

async function loadScopedColorResolver(
  document: NativePdfDocument,
  resources: PdfDictionary,
  colors: NativePdfColorRegistry,
  fallback: DensePdfColorSpaceResolver,
  resourceNames: readonly string[],
  pageIndex: number,
  signal: AbortSignal,
  allowOuterResourceFallback = true
): Promise<ScopedColorResolver> {
  const colorSpaceValue = resources.get("ColorSpace");
  const colorSpaces = colorSpaceValue === undefined || colorSpaceValue === null
    ? undefined
    : await document.resolveDictionary(colorSpaceValue, signal);
  const definitions = new Map<string, Readonly<DensePdfColorSpaceDefinition>>();
  const patternColorSpaces = new Map<
    string,
    Readonly<DensePdfPatternColorSpaceDefinition>
  >();
  const failures = new Map<string, unknown>();
  for (const resourceName of resourceNames) {
    try {
      const pattern = await resolvePatternColorSpaceDefinition(
        document,
        colors,
        colorSpaces,
        resourceName,
        signal
      );
      if (pattern) {
        patternColorSpaces.set(resourceName, pattern);
        continue;
      }
      if (!colorSpaces && !isDeviceColorSpaceName(resourceName)) continue;
      const colorSpaceIndex = await colors.add(
        { kind: "name", value: resourceName },
        colorSpaces,
        signal
      );
      const description = colors.describe(colorSpaceIndex);
      const initialComponents = description.kind === "DeviceCMYK"
        ? [0, 0, 0, 1]
        : description.kind === "Separation" || description.kind === "DeviceN"
          ? new Array<number>(description.componentCount).fill(1)
          : new Array<number>(description.componentCount).fill(0);
      definitions.set(resourceName, Object.freeze({
        resourceName,
        colorSpaceIndex,
        componentCount: description.componentCount,
        initialComponents: Object.freeze(initialComponents),
        convertToSrgb(components: readonly number[]) {
          return colors.convertToSrgb(colorSpaceIndex, components);
        }
      }));
    } catch (error) {
      signal.throwIfAborted();
      failures.set(resourceName, error);
    }
  }
  return {
    colorSpaces,
    patternColorSpaces,
    resolver(resourceName) {
      const failure = failures.get(resourceName);
      if (failure !== undefined) throw failure;
      const definition = definitions.get(resourceName);
      if (definition) return definition;
      if (!allowOuterResourceFallback) {
        throw new PdfError(
          "unsupported-color",
          `Unknown color space /${resourceName} in this resource scope.`,
          {
            pageIndex,
            details: { reason: "scoped-color-space-missing", colorSpace: resourceName }
          }
        );
      }
      try {
        return fallback(resourceName);
      } catch (error) {
        throw new PdfError("unsupported-color", `Unknown Form color space /${resourceName}.`, {
          cause: error,
          pageIndex,
          details: { colorSpace: resourceName }
        });
      }
    }
  };
}

function isDeviceColorSpaceName(resourceName: string): boolean {
  return resourceName === "DeviceGray" || resourceName === "G" ||
    resourceName === "DeviceRGB" || resourceName === "RGB" ||
    resourceName === "DeviceCMYK" || resourceName === "CMYK";
}

async function resolvePatternColorSpaceDefinition(
  document: NativePdfDocument,
  colors: NativePdfColorRegistry,
  colorSpaces: PdfDictionary | undefined,
  resourceName: string,
  signal: AbortSignal
): Promise<Readonly<DensePdfPatternColorSpaceDefinition> | undefined> {
  const names = new Set<string>();
  const resolve = async (
    value: PdfValue,
    depth: number
  ): Promise<Readonly<DensePdfPatternColorSpaceDefinition> | undefined> => {
    signal.throwIfAborted();
    if (depth > document.limits.maxRecursionDepth) {
      throw new PdfError("resource-limit", "Pattern color-space aliases exceed the recursion limit.", {
        details: { resourceName, feature: "pattern-color-space" }
      });
    }
    const resolved = await document.resolveValue(value, signal);
    if (isPdfName(resolved)) {
      if (resolved.value === "Pattern") {
        return Object.freeze({ resourceName, baseColorSpace: null });
      }
      const nested = colorSpaces?.get(resolved.value);
      if (nested === undefined || nested === null) return undefined;
      if (names.has(resolved.value)) {
        throw new PdfError("unsupported-color", `Pattern color-space /${resourceName} is recursive.`, {
          details: { resourceName }
        });
      }
      names.add(resolved.value);
      return await resolve(nested, depth + 1);
    }
    if (!Array.isArray(resolved)) return undefined;
    const family = resolved[0] === undefined
      ? undefined
      : await document.resolveValue(resolved[0], signal);
    if (!isPdfName(family, "Pattern")) return undefined;
    if (resolved.length !== 1 && resolved.length !== 2) {
      throw new PdfError(
        "unsupported-color",
        `Pattern color space /${resourceName} must contain zero or one base color space.`,
        { details: { resourceName, componentCount: resolved.length - 1 } }
      );
    }
    if (resolved.length === 1) {
      return Object.freeze({ resourceName, baseColorSpace: null });
    }
    const colorSpaceIndex = await colors.add(resolved[1], colorSpaces, signal);
    return Object.freeze({
      resourceName,
      baseColorSpace: denseColorSpaceDefinition(colors, colorSpaceIndex, `${resourceName}:base`)
    });
  };

  if (resourceName === "Pattern") {
    return Object.freeze({ resourceName, baseColorSpace: null });
  }
  const value = colorSpaces?.get(resourceName);
  if (value === undefined || value === null) return undefined;
  names.add(resourceName);
  return await resolve(value, 0);
}

function denseColorSpaceDefinition(
  colors: NativePdfColorRegistry,
  colorSpaceIndex: number,
  resourceName: string
): Readonly<DensePdfColorSpaceDefinition> {
  const description = colors.describe(colorSpaceIndex);
  const initialComponents = description.kind === "DeviceCMYK"
    ? [0, 0, 0, 1]
    : description.kind === "Separation" || description.kind === "DeviceN"
      ? new Array<number>(description.componentCount).fill(1)
      : new Array<number>(description.componentCount).fill(0);
  return Object.freeze({
    resourceName,
    colorSpaceIndex,
    componentCount: description.componentCount,
    initialComponents: Object.freeze(initialComponents),
    convertToSrgb(components: readonly number[]) {
      return colors.convertToSrgb(colorSpaceIndex, components);
    }
  });
}

async function loadPatternDefinitions(
  patterns: NativePdfPatternRegistry,
  extGStates: NativePdfExtGStateRegistry,
  resources: PdfDictionary,
  resourceNames: readonly string[],
  signal: AbortSignal
): Promise<ReadonlyMap<string, Readonly<DensePdfPatternDefinition>>> {
  const definitions = new Map<string, Readonly<DensePdfPatternDefinition>>();
  for (const resourceName of resourceNames) {
    signal.throwIfAborted();
    const patternIndex = await patterns.add(
      { kind: "name", value: resourceName },
      resources,
      signal
    );
    const pattern = patterns.describe(patternIndex);
    const solidColor = await resolveNativeSolidPattern(patterns, extGStates, patternIndex, signal);
    const extGState = pattern.patternType === 2 && pattern.extGState !== null
      ? denseExtGStateDefinition(
        `${resourceName}:ExtGState`,
        extGStates.describe(await extGStates.add(pattern.extGState, pattern.resources, signal))
      )
      : undefined;
    definitions.set(resourceName, Object.freeze({
      resourceName,
      patternIndex,
      kind: pattern.kind,
      ...(solidColor ? { solidColor } : {}),
      hasExtGState: extGState !== undefined,
      ...(extGState ? { extGState } : {})
    }));
  }
  return definitions;
}

async function loadScopedImageResources(
  document: NativePdfDocument,
  registry: NativePdfImageRegistry,
  optionalContentRegistry: NativeOptionalContentRegistry,
  resources: PdfDictionary,
  resourceNames: readonly string[],
  colorSpaces: PdfDictionary | undefined,
  pageIndex: number,
  signal: AbortSignal,
  retainOptionalContent = false
): Promise<ScopedImageResources> {
  signal.throwIfAborted();
  if (resourceNames.length === 0) {
    return Object.freeze({ indexes: new Map(), optionalContent: new Map() });
  }
  const rawXObjects = resources.get("XObject");
  if (rawXObjects === undefined || rawXObjects === null) {
    throw new PdfError(
      "unsupported-content",
      `Image XObject /${resourceNames[0]} has no resource dictionary.`,
      { pageIndex, details: { reason: "image-resource-missing", resourceName: resourceNames[0] } }
    );
  }
  const xObjects = await document.resolveDictionary(rawXObjects, signal);
  const indexes = new Map<string, number>();
  const optionalContent = new Map<
    string,
    { optionalContentIndex: number; defaultVisible: boolean }
  >();
  for (const resourceName of resourceNames) {
    signal.throwIfAborted();
    const rawImage = xObjects.get(resourceName);
    if (rawImage === undefined || rawImage === null) {
      throw new PdfError("unsupported-content", `Image XObject /${resourceName} is missing.`, {
        pageIndex,
        details: { reason: "image-resource-missing", resourceName }
      });
    }
    const image = await document.resolveValue(rawImage, signal);
    if (!isPdfStream(image) || !isPdfName(image.dictionary.get("Subtype"), "Image")) {
      throw new PdfError("unsupported-image", `XObject /${resourceName} is not an Image stream.`, {
        pageIndex,
        details: { reason: "xobject-not-image", resourceName }
      });
    }
    const rawOptionalContent = image.dictionary.get("OC");
    if (rawOptionalContent !== undefined && rawOptionalContent !== null) {
      const membership = await optionalContentRegistry.resolvePropertyValue(
        rawOptionalContent,
        signal
      );
      if (!membership) {
        throw new PdfError(
          "invalid-object",
          `Image XObject /${resourceName} /OC does not resolve to an OCG or OCMD membership.`,
          { pageIndex, details: { reason: "image-optional-content", resourceName } }
        );
      }
      optionalContent.set(resourceName, Object.freeze({
        optionalContentIndex: membership.index,
        defaultVisible: membership.defaultVisible
      }));
      if (!retainOptionalContent && !membership.defaultVisible) {
        // Keep the exact name recognizable by the compiler without decoding
        // or validating a payload that cannot paint in the default view.
        indexes.set(resourceName, -1);
        continue;
      }
    }
    indexes.set(resourceName, await registry.add(rawImage, colorSpaces, signal));
  }
  return Object.freeze({ indexes, optionalContent });
}

async function loadPageImages(
  document: NativePdfDocument,
  page: NativePdfPage,
  resources: PdfDictionary,
  references: DensePdfResourceReferences,
  signal: AbortSignal,
  optionalContentRegistry: NativeOptionalContentRegistry,
  imageCodecResolver?: NativeImageCodecResolver,
  iccOptions: PdfIccOptions = {},
  onDiagnostic?: (diagnostic: PdfDiagnostic) => void,
  limits?: Partial<PdfResourceLimits>,
  retainOptionalContent = false
): Promise<LoadedPageImages> {
  const colorSpaceValue = resources.get("ColorSpace");
  const colorSpaces = colorSpaceValue === undefined || colorSpaceValue === null
    ? undefined
    : await document.resolveDictionary(colorSpaceValue, signal);
  const colors = new NativePdfColorRegistry(document, undefined, {
    ...iccOptions,
    onDiagnostic,
    maxIccProfileBytes: limits?.maxIccProfileBytes ?? document.limits.maxIccProfileBytes,
    maxIccTransformBytes: limits?.maxIccTransformBytes ?? document.limits.maxIccTransformBytes
  });
  const definitions = new Map<string, Readonly<DensePdfColorSpaceDefinition>>();
  const patternColorSpaces = new Map<
    string,
    Readonly<DensePdfPatternColorSpaceDefinition>
  >();
  const definitionFailures = new Map<string, unknown>();

  const addColorSpace = async (resourceName: string, value: PdfValue): Promise<void> => {
    try {
      const colorSpaceIndex = await colors.add(value, colorSpaces, signal);
      const description = colors.describe(colorSpaceIndex);
      const initialComponents = description.kind === "DeviceCMYK"
        ? [0, 0, 0, 1]
        : description.kind === "Separation" || description.kind === "DeviceN"
          ? new Array<number>(description.componentCount).fill(1)
          : new Array<number>(description.componentCount).fill(0);
      definitions.set(resourceName, Object.freeze({
        resourceName,
        colorSpaceIndex,
        componentCount: description.componentCount,
        initialComponents: Object.freeze(initialComponents),
        convertToSrgb(components: readonly number[]) {
          return colors.convertToSrgb(colorSpaceIndex, components);
        }
      }));
    } catch (error) {
      signal.throwIfAborted();
      definitionFailures.set(resourceName, error);
    }
  };

  for (const resourceName of [
    "DeviceGray", "G", "DeviceRGB", "RGB", "DeviceCMYK", "CMYK"
  ]) {
    await addColorSpace(resourceName, { kind: "name", value: resourceName });
  }
  const loadColorSpace = async (resourceName: string): Promise<void> => {
    signal.throwIfAborted();
    if (
      definitions.has(resourceName) || patternColorSpaces.has(resourceName) ||
      definitionFailures.has(resourceName)
    ) return;
    try {
      const pattern = await resolvePatternColorSpaceDefinition(
        document,
        colors,
        colorSpaces,
        resourceName,
        signal
      );
      if (pattern) patternColorSpaces.set(resourceName, pattern);
      else await addColorSpace(resourceName, { kind: "name", value: resourceName });
    } catch (error) {
      signal.throwIfAborted();
      definitionFailures.set(resourceName, error);
    }
  };
  for (const resourceName of references.colorSpaces) await loadColorSpace(resourceName);

  const codecDecodedByteLimit = Math.min(
    document.limits.maxDecodedStreamBytes,
    limits?.maxDecodedStreamBytes ?? document.limits.maxDecodedStreamBytes
  );
  const usesBundledCodec = imageCodecResolver === undefined;
  const registry = new NativePdfImageRegistry(document, colors, {
    codecPolicy: "request",
    codecResolver: imageCodecResolver ?? createBundledImageCodecResolver(codecDecodedByteLimit),
    trustedCodecResolver: usesBundledCodec,
    limits,
    onDiagnostic
  });
  const shadings = new NativePdfShadingRegistry(document, colors);
  const patterns = new NativePdfPatternRegistry(document, shadings);
  const extGStates = new NativePdfExtGStateRegistry(document, colors, { onDiagnostic });
  const shadingIndexes = new Map<string, number>();
  const patternDefinitions = new Map(await loadPatternDefinitions(
    patterns,
    extGStates,
    resources,
    references.patterns,
    signal
  ));
  const xObjectReferences = await classifyNativePdfXObjectReferences(
    document,
    resources,
    references.xObjects,
    signal
  );
  const scopedImages = await loadScopedImageResources(
    document,
    registry,
    optionalContentRegistry,
    resources,
    xObjectReferences
      .filter((reference) => reference.kind === "Image")
      .map((reference) => reference.resourceName),
    colorSpaces,
    page.sourcePageIndex,
    signal,
    retainOptionalContent
  );
  if (references.shadings.length > 0) {
    for (const resourceName of references.shadings) {
      signal.throwIfAborted();
      shadingIndexes.set(
        resourceName,
        await shadings.add({ kind: "name", value: resourceName }, resources, signal)
      );
    }
  }
  return {
    registry,
    xObjectReferences,
    colorSpaces,
    indexes: scopedImages.indexes,
    shadings,
    shadingIndexes,
    patterns,
    extGStates,
    patternDefinitions,
    patternColorSpaces,
    optionalContent: scopedImages.optionalContent,
    loadColorSpace,
    async loadShading(resourceName) {
      if (shadingIndexes.has(resourceName)) return;
      shadingIndexes.set(resourceName,
        await shadings.add({ kind: "name", value: resourceName }, resources, signal));
    },
    async loadPattern(resourceName) {
      if (patternDefinitions.has(resourceName)) return;
      const loaded = await loadPatternDefinitions(patterns, extGStates, resources, [resourceName], signal);
      for (const [name, definition] of loaded) patternDefinitions.set(name, definition);
    },
    async loadImage(resourceName) {
      const loaded = await loadScopedImageResources(
        document,
        registry,
        optionalContentRegistry,
        resources,
        [resourceName],
        colorSpaces,
        page.sourcePageIndex,
        signal,
        retainOptionalContent
      );
      const indexes = scopedImages.indexes as Map<string, number>;
      const optionalContent = scopedImages.optionalContent as Map<
        string, { optionalContentIndex: number; defaultVisible: boolean }
      >;
      for (const [name, index] of loaded.indexes) indexes.set(name, index);
      for (const [name, association] of loaded.optionalContent) optionalContent.set(name, association);
    },
    colorSpaceResolver(resourceName) {
      const failure = definitionFailures.get(resourceName);
      if (failure !== undefined) throw failure;
      const definition = definitions.get(resourceName);
      if (definition) return definition;
      throw new PdfError("unsupported-color", `Unknown PDF color space /${resourceName}.`, {
        pageIndex: page.sourcePageIndex,
        details: { colorSpace: resourceName }
      });
    },
    assertReferencedCodecsAvailable(referencedNames, scopedIndexes = scopedImages.indexes) {
      const visited = new Set<number>();
      const requireDecoded = (index: number): void => {
        if (visited.has(index)) return;
        visited.add(index);
        const image = registry.describe(index);
        if (image.codecRequest) {
          throw new PdfError(
            "unsupported-image",
            `${image.codecRequest.codec} image data requires its pinned codec kernel.`,
            { pageIndex: page.sourcePageIndex, details: { codec: image.codecRequest.codec } }
          );
        }
        if (image.softMaskImageIndex >= 0) requireDecoded(image.softMaskImageIndex);
      };
      for (const resourceName of referencedNames) {
        const index = scopedIndexes.get(resourceName);
        if (index !== undefined) requireDecoded(index);
      }
    }
  };
}

async function buildDocumentInfo(
  document: NativePdfDocument,
  signal?: AbortSignal
): Promise<PdfDocumentInfo> {
  const pages = document.pages.map(toPageInfo);
  let tagged = false;
  const markInfo = await document.resolveValue(document.catalog.get("MarkInfo"), signal);
  if (isPdfDictionary(markInfo)) tagged = markInfo.get("Marked") === true;
  return {
    pdfVersion: document.info.version,
    byteLength: document.info.byteLength,
    pageCount: pages.length,
    pages,
    label: document.info.label ?? null,
    fingerprint: document.info.fingerprint ?? null,
    linearized: document.info.linearized,
    repaired: document.info.repaired,
    tagged,
    language: document.info.language ?? null,
    metadata: document.info.metadata
  };
}

function toPageInfo(page: NativePdfPage): PdfPageInfo {
  const { pageBounds } = computePageGeometry(page);
  return {
    sourcePageIndex: page.sourcePageIndex,
    mediaBox: normalizeBox(page.mediaBox),
    cropBox: normalizeBox(page.cropBox),
    bleedBox: page.bleedBox ? normalizeBox(page.bleedBox) : null,
    trimBox: page.trimBox ? normalizeBox(page.trimBox) : null,
    artBox: page.artBox ? normalizeBox(page.artBox) : null,
    rotation: page.rotation,
    userUnit: page.userUnit,
    width: pageBounds.maxX - pageBounds.minX,
    height: pageBounds.maxY - pageBounds.minY
  };
}

function normalizeBox(box: readonly number[]): PdfBox {
  if (box.length !== 4 || box.some((value) => !Number.isFinite(value))) {
    throw new PdfError("invalid-page-tree", "A PDF page box is invalid.");
  }
  return [
    Math.min(box[0], box[2]),
    Math.min(box[1], box[3]),
    Math.max(box[0], box[2]),
    Math.max(box[1], box[3])
  ];
}

interface PreparedInlineContentSource {
  readonly segments: readonly DensePdfContentSegment[];
  readonly images: readonly NativeInlineImageRecord[];
  readonly sourceLength: number;
}

function createDecodedContentOnlySource(
  chunks: readonly Uint8Array[],
  signal: AbortSignal
): PreparedInlineContentSource {
  const segments: DensePdfContentSegment[] = [];
  const newline = Uint8Array.of(0x0a);
  let sourceOffset = 0;
  for (let streamIndex = 0; streamIndex < chunks.length; streamIndex += 1) {
    signal.throwIfAborted();
    const bytes = chunks[streamIndex];
    if (bytes.length > 0) {
      segments.push(Object.freeze({
        kind: "content" as const,
        bytes,
        sourceOffset,
        sourceLength: bytes.length
      }));
    }
    sourceOffset += bytes.length;
    if (streamIndex + 1 < chunks.length) {
      segments.push(Object.freeze({
        kind: "content" as const,
        bytes: newline,
        sourceOffset,
        sourceLength: 1
      }));
      sourceOffset += 1;
    }
  }
  return Object.freeze({
    segments: Object.freeze(segments),
    images: Object.freeze([]),
    sourceLength: sourceOffset
  });
}

function prepareDecodedInlineContentStreams(
  document: NativePdfDocument,
  chunks: readonly Uint8Array[],
  signal: AbortSignal,
  maxImagesOverride?: number
): PreparedInlineContentSource {
  const segments: DensePdfContentSegment[] = [];
  const images: NativeInlineImageRecord[] = [];
  const newline = Uint8Array.of(0x0a);
  let sourceOffset = 0;
  const maxImages = Math.min(
    DEFAULT_NATIVE_INLINE_IMAGE_LIMITS.maxImages,
    maxImagesOverride ?? document.limits.maxCommandsPerPage
  );
  for (let streamIndex = 0; streamIndex < chunks.length; streamIndex += 1) {
    signal.throwIfAborted();
    const prepared = prepareNativeInlineImages(chunks[streamIndex], {
      sourceOffset,
      signal,
      limits: inlineImageLimits(document, maxImages)
    });
    for (const segment of prepared.segments) {
      if (segment.kind === "content") {
        segments.push(segment);
        continue;
      }
      if (images.length >= maxImages) {
        throw new PdfError("resource-limit", "Inline image count exceeds the page limit.", {
          details: { reason: "inline-image-count", count: images.length + 1, limit: maxImages }
        });
      }
      const image = Object.freeze({ ...segment, imageIndex: images.length });
      images.push(image);
      segments.push(image);
    }
    sourceOffset += chunks[streamIndex].length;
    if (streamIndex + 1 < chunks.length) {
      segments.push(Object.freeze({
        kind: "content",
        bytes: newline,
        sourceOffset,
        sourceLength: 1
      }));
      sourceOffset += 1;
    }
  }
  return Object.freeze({
    segments: Object.freeze(segments),
    images: Object.freeze(images),
    sourceLength: sourceOffset
  });
}

function inlineImageLimits(
  document: NativePdfDocument,
  maxImages = DEFAULT_NATIVE_INLINE_IMAGE_LIMITS.maxImages
) {
  return {
    maxImages,
    maxPayloadBytes: Math.min(
      DEFAULT_NATIVE_INLINE_IMAGE_LIMITS.maxPayloadBytes,
      document.limits.maxDecodedStreamBytes
    ),
    maxScanBytes: Math.min(
      DEFAULT_NATIVE_INLINE_IMAGE_LIMITS.maxScanBytes,
      document.limits.maxDecodedStreamBytes
    ),
    maxNestingDepth: Math.min(
      DEFAULT_NATIVE_INLINE_IMAGE_LIMITS.maxNestingDepth,
      document.limits.maxRecursionDepth
    )
  };
}

async function bindPreparedInlineImages(
  prepared: {
    readonly segments: readonly DensePdfContentSegment[];
    readonly images: readonly NativeInlineImageRecord[];
  },
  registry: NativePdfImageRegistry,
  colorSpaces: PdfDictionary | undefined,
  signal: AbortSignal
): Promise<readonly DensePdfContentSegment[]> {
  if (prepared.images.length === 0) {
    return prepared.segments as readonly DensePdfContentSegment[];
  }
  const imageIndexes = new Uint32Array(prepared.images.length);
  for (const image of prepared.images) {
    signal.throwIfAborted();
    if (image.imageIndex < 0 || image.imageIndex >= imageIndexes.length) {
      throw new PdfError("invalid-object", "Prepared inline-image indexes are inconsistent.", {
        details: { reason: "inline-image-index", imageIndex: image.imageIndex }
      });
    }
    imageIndexes[image.imageIndex] = await registry.add(image.stream, colorSpaces, signal);
  }
  return Object.freeze(prepared.segments.map((segment): DensePdfContentSegment =>
    segment.kind === "content"
      ? segment
      : Object.freeze({
          kind: "image",
          imageIndex: imageIndexes[segment.imageIndex],
          sourceOffset: segment.sourceOffset,
          sourceLength: segment.sourceLength
        })
  ));
}

async function loadMarkedContentProperties(
  document: NativePdfDocument,
  optionalContent: NativeOptionalContentRegistry,
  resources: PdfDictionary,
  names: readonly string[],
  optionalContentNames: readonly string[],
  signal: AbortSignal
): Promise<ReadonlyMap<string, Readonly<DensePdfMarkedContentPropertyDefinition>>> {
  signal.throwIfAborted();
  if (names.length === 0) return new Map();
  const resolved = await optionalContent.resolvePageProperties(
    resources,
    names,
    signal,
    optionalContentNames
  );
  const optionalNames = new Set(optionalContentNames);
  const definitions = new Map<string, Readonly<DensePdfMarkedContentPropertyDefinition>>();
  for (const property of resolved) {
    signal.throwIfAborted();
    const mcidValue = property.propertyList === null
      ? undefined
      : await document.resolveValue(property.propertyList.get("MCID"), signal);
    let mcid = -1;
    const actualTextValue = property.propertyList === null
      ? undefined
      : await document.resolveValue(property.propertyList.get("ActualText"), signal);
    if (actualTextValue !== undefined && actualTextValue !== null && !isPdfString(actualTextValue)) {
      throw new PdfError("invalid-object", `Marked-content property /${property.name} has an invalid /ActualText.`);
    }
    if (mcidValue !== undefined && mcidValue !== null) {
      if (!Number.isSafeInteger(mcidValue) || (mcidValue as number) < 0) {
        throw new PdfError(
          "invalid-object",
          `Marked-content property /${property.name} has an invalid /MCID.`
        );
      }
      mcid = mcidValue as number;
    }
    definitions.set(property.name, Object.freeze({
      resourceName: property.name,
      optionalContentIndex: property.membershipIndex ?? -1,
      defaultVisible: property.defaultVisible,
      mcid,
      ...(isPdfString(actualTextValue) ? { actualText: actualTextValue.bytes } : {}),
      unresolvedOptionalContent: property.propertyList === null && optionalNames.has(property.name)
    }));
  }
  return definitions;
}

function appendNativeVectorAnnotationPaints(
  compiled: DensePdfCompiledPage,
  graph: NativePdfFormDefinitionGraph,
  resolver: DensePdfColorSpaceResolver,
  pageBounds: DensePdfBounds,
  pageIndex: number,
  maxCommands: number,
  signal: AbortSignal,
  optionalContent?: NativeOptionalContentRegistry,
  onDiagnostic?: (diagnostic: PdfDiagnostic) => void
): DensePdfCompiledPage {
  if (graph.annotationPlacements.length === 0) return compiled;
  const sidecar = compiled.vectorSceneData!;
  const formPaints = [...compiled.formPaints];
  const sourceEvents = Array.from(sidecar.sourceEvents);
  const sourceOptionalContentIndices = Array.from(sidecar.sourceOptionalContentIndices ?? new Int32Array(sidecar.sourceEvents.length / 2).fill(-1));
  // Each appearance remains addressable, so the scene can give it its own
  // visibility condition after its Form is flattened.
  const sourceAnnotationIndices = Array.from(sidecar.sourceAnnotationIndices ?? new Int32Array(sidecar.sourceEvents.length / 2).fill(-1));
  const annotationIds = [...(sidecar.annotationIds ?? [])];
  const sourceContentItems = sidecar.sourceContentItems ? Array.from(sidecar.sourceContentItems) : undefined;
  const sourceBlendModes = Array.from(sidecar.sourceBlendModes ?? new Uint8Array(sidecar.sourceEvents.length / 2));
  const sourceClips = sidecar.sourceClips ? [...sidecar.sourceClips] : undefined;
  const formPaintOrders = Array.from(sidecar.formPaintOrders ?? []);
  const defaultState = createDefaultInitialGraphicsState(resolver);
  const pageClip = rectangleVectorClip(pageBounds, [1, 0, 0, 1, 0, 0], null);
  // Annotation appearances paint after page content and start with a fresh
  // graphics state. Their invocation order also matches the display program's
  // appended annotation Forms, allowing the existing selective fallback to
  // rasterize only an appearance that needs compositing.
  let nextPaintOrder = compiled.operatorCount;
  for (const orders of [sidecar.imagePaintOrders, sidecar.formPaintOrders, sidecar.selectivePaintOrdinalSpans]) {
    for (const order of orders ?? []) nextPaintOrder = Math.max(nextPaintOrder, order + 1);
  }
  let annotationCount = 0;
  let viewTransformCount = 0;
  for (const placement of graph.annotationPlacements) {
    signal.throwIfAborted();
    const definition = graph.definitions[placement.definitionIndex];
    if (!definition || (!optionalContent && !definition.defaultVisible)) continue;
    // A static scene has no viewer zoom or rotation to counter-transform.
    // Keep the page geometry, as raster capture does, instead of rasterizing
    // the whole page for one icon.
    if ((placement.annotation.flags &
        (NATIVE_PDF_ANNOTATION_VIEW_FLAGS.NoZoom | NATIVE_PDF_ANNOTATION_VIEW_FLAGS.NoRotate)) !== 0) {
      viewTransformCount += 1;
    }
    annotationCount += 1;
    if (compiled.operatorCount + annotationCount > maxCommands || nextPaintOrder > 0xffff_ffff) {
      throw new PdfError("resource-limit", "Annotation appearances exceed the page command limit.", { pageIndex });
    }
    sourceEvents.push(DENSE_PDF_VECTOR_SCENE_EVENT_FORM, formPaints.length);
    sourceBlendModes.push(0);
    sourceOptionalContentIndices.push(optionalContent?.combineMemberships(placement.appearance.optionalContentIndex, definition.optionalContentIndex) ?? -1);
    sourceAnnotationIndices.push(annotationIds.length);
    annotationIds.push(placement.annotation.id);
    sourceContentItems?.push(-1);
    sourceClips?.push(null);
    formPaintOrders.push(nextPaintOrder++);
    formPaints.push(Object.freeze({
      definitionIndex: placement.definitionIndex,
      transform: placement.invocationMatrix,
      clipBounds: pageBounds,
      clipIsDefault: true,
      clipIsExactRectangle: true,
      vectorClip: pageClip,
      initialGraphicsState: defaultState
    }));
  }
  if (annotationCount === 0) return compiled;
  if (viewTransformCount !== 0) onDiagnostic?.({
    code: "annotation.view-transform-approximated", severity: "warning", pageIndex,
    message: "NoZoom/NoRotate annotation appearances use page geometry and scale with the page.",
    details: { annotationCount: viewTransformCount }
  });
  return {
    ...compiled,
    operatorCount: compiled.operatorCount + annotationCount,
    formPaints: Object.freeze(formPaints),
    vectorSceneData: {
      ...sidecar,
      sourceEvents: Uint32Array.from(sourceEvents),
      ...(optionalContent?.groupCount ? { sourceOptionalContentIndices: Int32Array.from(sourceOptionalContentIndices) } : {}),
      sourceAnnotationIndices: Int32Array.from(sourceAnnotationIndices),
      annotationIds: Object.freeze(annotationIds),
      ...(sourceContentItems ? { sourceContentItems: Int32Array.from(sourceContentItems) } : {}),
      sourceBlendModes: Uint8Array.from(sourceBlendModes),
      ...(sourceClips ? { sourceClips } : {}),
      formPaintOrders: Uint32Array.from(formPaintOrders)
    }
  };
}

function formOptionalContentForScope(
  resources: ReadonlyMap<string, number>,
  definitions: readonly NativePdfFormDefinition[]
): ReadonlyMap<string, { optionalContentIndex: number; defaultVisible: boolean }> {
  const result = new Map<string, { optionalContentIndex: number; defaultVisible: boolean }>();
  for (const [resourceName, definitionIndex] of resources) {
    const definition = definitions[definitionIndex];
    if (!definition) {
      throw new TypeError(`Form resource /${resourceName} references an invalid definition.`);
    }
    if (definition.optionalContentIndex >= 0) {
      result.set(resourceName, Object.freeze({
        optionalContentIndex: definition.optionalContentIndex,
        defaultVisible: definition.defaultVisible
      }));
    }
  }
  return result;
}

function buildOptionalContentStore(
  registry: NativeOptionalContentRegistry
): HeprOptionalContentStore {
  const groups = registry.listGroups();
  const memberships = registry.listMemberships();
  return {
    names: Object.freeze(memberships.map((membership) => {
      if (membership.kind === "ocg") {
        return groups[membership.groupIndices[0]]?.name ?? membership.identity;
      }
      return membership.identity;
    })),
    defaultVisible: Uint8Array.from(
      memberships,
      (membership) => membership.defaultVisible ? 1 : 0
    )
  };
}

function normalizePageIndexes(
  requested: readonly number[] | undefined,
  pageCount: number
): readonly number[] {
  if (requested === undefined) {
    return Object.freeze(Array.from({ length: pageCount }, (_, index) => index));
  }
  const seen = new Set<number>();
  const indexes: number[] = [];
  for (const value of requested) {
    if (!Number.isSafeInteger(value) || value < 0 || value >= pageCount) {
      throw new PdfError("invalid-page-index", `PDF page index ${value} is out of range.`, {
        details: { pageIndex: value, pageCount }
      });
    }
    if (seen.has(value)) {
      throw new PdfError("invalid-page-index", `PDF page index ${value} was requested more than once.`, {
        details: { pageIndex: value, duplicate: true }
      });
    }
    seen.add(value);
    indexes.push(value);
  }
  return Object.freeze(indexes);
}

function isNativeVectorRepresentationFailure(error: unknown): error is PdfError {
  if (error instanceof PdfError && error.code === "unsupported-font" &&
      error.details?.reason === "program-type3-text-not-integrated") return true;
  if (!(error instanceof PdfError) ||
      (error.code !== "unsupported-content" && error.code !== "unsupported-image")) return false;
  const reason = String(error.details?.reason ?? "");
  return isNativeGlyphStrokeRepresentationReason(reason) ||
    /^(legacy-vector-|vector-|selective-)/.test(reason) ||
    /^(VectorScene|The VectorScene)/i.test(error.message);
}

function isNativeGlyphStrokeRepresentationReason(reason: unknown): boolean {
  return reason === "native-glyph-stroke" || reason === "native-glyph-stroke-complexity";
}

function normalizeCompileError(error: unknown, sourcePageIndex: number): unknown {
  if (error instanceof PdfError) return error;
  if (error instanceof DensePdfResourceLimitError) {
    return new PdfError("resource-limit", error.message, {
      cause: error,
      details: {
        sourcePageIndex,
        ...(error.operator ? { operator: error.operator } : {}),
        ...(error.reason ? { reason: error.reason } : {})
      }
    });
  }
  if (error instanceof DensePdfUnsupportedError) {
    return new PdfError("unsupported-content", error.message, {
      cause: error,
      details: { sourcePageIndex, ...(error.operator ? { operator: error.operator } : {}) }
    });
  }
  if (error instanceof DensePdfSyntaxError) {
    return new PdfError("invalid-object", error.message, {
      cause: error,
      details: { sourcePageIndex }
    });
  }
  return error;
}

function nativeVectorOrderedPaintEnabled(options: PdfCompileOptions): boolean {
  return (options as NativeVectorCompileOptions).preserveDrawingOrder !== false;
}

function nativeVectorSegmentMergeEnabled(options: PdfCompileOptions): boolean {
  const vectorOptions = options as NativeVectorCompileOptions;
  return vectorOptions.enableSegmentMerge === undefined
    ? options.optimization !== "none"
    : vectorOptions.enableSegmentMerge;
}

function nativeVectorInvisibleCullEnabled(options: PdfCompileOptions): boolean {
  const vectorOptions = options as NativeVectorCompileOptions;
  return vectorOptions.enableInvisibleCull === undefined
    ? options.optimization !== "none"
    : vectorOptions.enableInvisibleCull;
}

function densePathCompileLimits(
  document: NativePdfDocument,
  options: Pick<PdfCompileOptions, "limits">
) {
  return {
    maxPathResources: options.limits?.maxPathsPerPage ?? document.limits.maxPathsPerPage,
    maxPathVerbs: options.limits?.maxPathVerbsPerPage ??
      document.limits.maxPathVerbsPerPage,
    maxPathCoordinates: options.limits?.maxPathCoordinatesPerPage ??
      document.limits.maxPathCoordinatesPerPage,
    maxClipPaths: options.limits?.maxClipsPerPage ?? document.limits.maxClipsPerPage,
    maxStrokeStyles: options.limits?.maxStrokeStylesPerPage ??
      document.limits.maxStrokeStylesPerPage,
    maxDashValues: options.limits?.maxDashValuesPerPage ??
      document.limits.maxDashValuesPerPage
  };
}

function enforcePageGeometryLimits(
  page: HeprPageData,
  document: NativePdfDocument,
  options: Pick<PdfCompileOptions, "limits">,
  pageIndex: number
): void {
  const configured = densePathCompileLimits(document, options);
  const resources = [
    ["paths", page.stores.paths.pathVerbOffsets.length - 1, configured.maxPathResources],
    ["path-verbs", page.stores.paths.verbs.length, configured.maxPathVerbs],
    ["path-coordinates", page.stores.paths.coordinates.length, configured.maxPathCoordinates],
    ["clips", page.stores.clips.parentIndices.length, configured.maxClipPaths],
    ["stroke-styles", page.stores.strokes.lineWidths.length, configured.maxStrokeStyles],
    ["dash-values", page.stores.strokes.dashValues.length, configured.maxDashValues]
  ] as const;
  for (const [reason, count, limit] of resources) {
    if (count <= limit) continue;
    throw new PdfError("resource-limit", `The compiled page exceeds the ${reason} limit.`, {
      pageIndex,
      details: { reason, count, limit }
    });
  }
}

function enforceReusableProgramDepth(
  page: HeprPageData,
  maxDepth: number,
  pageIndex: number
): void {
  const groups = page.displayProgram.groups;
  const programs = page.displayProgram.programs;
  const groupCount = groups.length;
  const memo = new Int32Array(groupCount + programs.length).fill(-1);
  const active = new Uint8Array(memo.length);
  const patternPrograms = (command: HeprDisplayCommand): number[] => {
    if (command.kind !== "draw") return [];
    const paintIndices = command.source === "paths"
      ? [command.fillPaintIndex, command.strokePaintIndex]
      : command.source === "fill-paths" || command.source === "stroke-segments" ||
          command.source === "images"
        ? [command.paintIndex]
        : command.source === "glyphs"
          ? [command.fillPaintIndex, command.strokePaintIndex]
          : [];
    const result: number[] = [];
    for (const paintIndex of paintIndices) {
      if (paintIndex < 0 || page.stores.paints.kinds[paintIndex] !== HEPR_PAINT_KIND.Pattern) {
        continue;
      }
      const patternIndex = page.stores.paints.resourceIndices[paintIndex];
      const programIndex = page.stores.patterns.programIndices[patternIndex];
      if (programIndex >= 0) result.push(programIndex);
    }
    if (command.source === "patterns") {
      for (let pattern = command.first; pattern < command.first + command.count; pattern += 1) {
        const programIndex = page.stores.patterns.programIndices[pattern];
        if (programIndex >= 0) result.push(programIndex);
      }
    }
    return result;
  };
  const height = (node: number): number => {
    if (memo[node] >= 0) return memo[node];
    if (active[node] !== 0) {
      throw new PdfError("unsupported-content", "The reusable display-program graph is cyclic.", {
        pageIndex,
        details: { reason: "reusable-program-cycle", node }
      });
    }
    active[node] = 1;
    const group = node < groupCount ? groups[node] : null;
    const commands = group?.commands ?? programs[node - groupCount].commands;
    let result = 0;
    if (group && group.softMaskGroupIndex >= 0) {
      result = Math.max(result, 1 + height(group.softMaskGroupIndex));
    }
    for (const command of commands) {
      if (command.kind === "invoke-group") {
        result = Math.max(result, 1 + height(command.groupIndex));
      } else if (command.kind === "invoke-program") {
        result = Math.max(result, 1 + height(groupCount + command.programIndex));
      }
      for (const programIndex of patternPrograms(command)) {
        result = Math.max(result, 1 + height(groupCount + programIndex));
      }
      if (result > maxDepth) break;
    }
    active[node] = 0;
    memo[node] = result;
    return result;
  };
  const depth = height(page.displayProgram.rootGroupIndex);
  if (depth > maxDepth) {
    throw new PdfError(
      "resource-limit",
      `Reusable display-program invocation exceeds the configured depth limit of ${maxDepth}.`,
      {
        pageIndex,
        details: { reason: "reusable-program-depth", depth, maxDepth }
      }
    );
  }
}

function normalizeAbortError(error: unknown, signal: AbortSignal): unknown {
  if (!signal.aborted || error instanceof PdfError) return error;
  if (signal.reason instanceof PdfError) return signal.reason;
  return new PdfError("aborted", "The PDF operation was aborted.", {
    cause: signal.reason ?? error
  });
}

function deepFreezeInfo(info: PdfDocumentInfo): Readonly<PdfDocumentInfo> {
  const pages = Object.freeze(info.pages.map((page) => Object.freeze({ ...page })));
  return Object.freeze({
    ...info,
    pages,
    metadata: Object.freeze({ ...info.metadata })
  });
}

function progress(
  stage: PdfProgress["stage"],
  completed: number,
  total: number | null,
  sourcePageIndex: number | null,
  bytesRead: number,
  byteLength: number | null
): PdfProgress {
  return { stage, completed, total, sourcePageIndex, bytesRead, byteLength };
}

function sourceByteLength(source: PdfSource): number | null {
  if (source.kind === "bytes") return source.bytes.length;
  if (source.kind === "blob") return source.blob.size;
  if (source.kind === "range") return source.byteLength;
  return null;
}

function createSessionOwnedSource(source: PdfSource): PdfSource {
  if (source.kind !== "range") return source;
  let closePromise: Promise<void> | null = null;
  return {
    kind: "range",
    byteLength: source.byteLength,
    label: source.label,
    read(offset, length, signal) {
      return source.read(offset, length, signal);
    },
    close() {
      if (!closePromise) {
        closePromise = Promise.resolve().then(async () => {
          await source.close?.();
        });
      }
      return closePromise;
    }
  };
}

async function closeSessionOwnedSource(source: PdfSource): Promise<void> {
  if (source.kind === "range") await source.close?.();
}

function diagnosticKey(diagnostic: PdfDiagnostic): string {
  return JSON.stringify([
    diagnostic.code,
    diagnostic.severity,
    diagnostic.message,
    diagnostic.offset ?? null,
    diagnostic.objectNumber ?? null,
    diagnostic.pageIndex ?? null,
    diagnostic.details ?? null
  ]);
}

function combineSignals(...signals: Array<AbortSignal | undefined>): AbortSignal {
  const active = signals.filter((signal): signal is AbortSignal => signal !== undefined);
  if (active.length === 0) return new AbortController().signal;
  if (active.length === 1) return active[0];
  return AbortSignal.any(active);
}

function waitForOperationTurn(
  previous: Promise<void>,
  signal?: AbortSignal
): Promise<void> {
  if (!signal) return previous;
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void): void => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      callback();
    };
    const abort = (): void => finish(() => reject(
      signal.reason instanceof PdfError
        ? signal.reason
        : new PdfError("aborted", "The queued PDF operation was aborted.", {
            cause: signal.reason
          })
    ));
    signal.addEventListener("abort", abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    void previous.then(
      () => finish(resolve),
      (error) => finish(() => reject(error))
    );
  });
}

function throwIfSessionAborted(signal?: AbortSignal): void {
  if (!signal?.aborted) return;
  if (signal.reason instanceof PdfError) throw signal.reason;
  throw new PdfError("aborted", "The PDF session operation was aborted.", {
    cause: signal.reason
  });
}
