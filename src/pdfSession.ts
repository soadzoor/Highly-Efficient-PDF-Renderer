import { findRgbaAlphaBounds } from "./rgbaBounds";
import {
  DENSE_PDF_LEGACY_VECTOR_EVENT_FORM,
  DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH,
  DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE,
  DENSE_PDF_LEGACY_VECTOR_EVENT_ORDINARY_PAINT,
  DENSE_PDF_LEGACY_VECTOR_GLYPH_FLAG_CLIPPED,
  DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_SELECTIVE_PATH_SPAN,
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
  type DensePdfBounds,
  type DensePdfColorSpaceDefinition,
  type DensePdfColorSpaceResolver,
  type DensePdfCompiledPage,
  type DensePdfContentSegment,
  type DensePdfExtGStateDefinition,
  type DensePdfInitialGraphicsState,
  type DensePdfLegacyVectorOutput,
  type DensePdfMarkedContentPropertyDefinition,
  type DensePdfMatrix,
  type DensePdfPatternColorSpaceDefinition,
  type DensePdfPatternDefinition,
  type DensePdfResourceReferences,
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
  HEPR_STROKE_FLAG,
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
  createNativeOptionalContentRegistry,
  openNativePdfDocument,
  type NativePdfOpenOptions,
  type NativePdfPage,
  type PdfDictionary,
  type PdfDiagnostic,
  type PdfResourceLimits,
  type PdfSource,
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
import type { NativeIccTransformResolver } from "./pdf/nativeIcc";
import { NativePdfShadingRegistry } from "./pdf/nativeShadings";
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
import {
  NativePdfAppearanceSynthesizer,
  resolveNativePdfAnnotationAppearanceWithSynthesis
} from "./pdf/nativeAppearanceSynthesis";
import {
  buildNativePdfFormDefinitionGraph,
  buildNativePdfResourceFormDefinitionGraph,
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

export const computePageGeometry = computeNativePdfPageGeometry;

export interface OpenPdfOptions {
  /** Strict parsing always runs first. `safe` allows one bounded xref repair scan. */
  readonly repair?: "off" | "safe";
  readonly limits?: Partial<PdfResourceLimits>;
  readonly signal?: AbortSignal;
  readonly onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
  readonly onProgress?: PdfCompileOptions["onProgress"];
  /** Deterministic caller-owned substitute lookup for nonembedded fonts. */
  readonly missingFontResolver?: NativeMissingFontResolver;
  /** Focused decoder bridge returning validated packed image samples. */
  readonly imageCodecResolver?: NativeImageCodecResolver;
  /** Caller-owned batched ICC-to-sRGB transform bridge. */
  readonly iccTransformResolver?: NativeIccTransformResolver;
}

export interface ParsePdfOptions extends OpenPdfOptions {
  readonly sourcePageIndexes?: readonly number[];
  readonly optimization?: PdfCompileOptions["optimization"];
}

export interface PdfSession {
  readonly info: Readonly<PdfDocumentInfo>;
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
      optionalContent
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

class NativePdfSession implements NativeVectorPdfSession {
  readonly info: Readonly<PdfDocumentInfo>;

  private readonly lifetime = new AbortController();
  private readonly diagnostics: PdfDiagnostic[];
  private readonly diagnosticKeys = new Set<string>();
  private readonly document: NativePdfDocument;
  private readonly formRegistry: NativePdfFormAppearanceRegistry;
  private readonly appearanceSynthesizer: NativePdfAppearanceSynthesizer;
  private readonly optionalContent: NativeOptionalContentRegistry;
  private readonly defaultProgress?: PdfCompileOptions["onProgress"];
  private readonly onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
  private readonly missingFontResolver?: NativeMissingFontResolver;
  private readonly imageCodecResolver?: NativeImageCodecResolver;
  private readonly iccTransformResolver?: NativeIccTransformResolver;
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
    optionalContent?: NativeOptionalContentRegistry
  ) {
    this.document = document;
    if (!optionalContent) {
      throw new TypeError("NativePdfSession requires an initialized optional-content registry.");
    }
    this.optionalContent = optionalContent;
    this.formRegistry = new NativePdfFormAppearanceRegistry(document, { optionalContent });
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
  }

  async compilePage(
    sourcePageIndex: number,
    options: PdfCompileOptions = {}
  ): Promise<HeprPageData> {
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
    const operation = new AbortController();
    const signal = combineSignals(this.lifetime.signal, operation.signal, options.signal);
    let release: (() => void) | null = null;
    try {
      release = await this.acquireOperation(signal);
      return await this.compileVectorPageUnlocked(sourcePageIndex, options, signal);
    } catch (error) {
      throw normalizeAbortError(error, signal);
    } finally {
      operation.abort(new PdfError("aborted", "The PDF vector-page operation ended."));
      release?.();
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
        false,
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
      const text = accumulatedText.compilation.textIndex.text.length > 0 ||
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
      const pageData = text
        ? {
            ...densePageData,
            textIndex: buildInvocationOrderedTextIndex(
              compiled,
              compositingPrograms.forms,
              accumulatedText,
              allFontResources,
              maxGlyphs,
              signal
            )
          }
        : densePageData;
      const commandCount = pageData.displayProgram.groups.reduce(
        (sum, group) => sum + group.commands.length,
        0
      ) + pageData.displayProgram.programs.reduce(
        (sum, program) => sum + program.commands.length,
        0
      );
      const maxCommands = options.limits?.maxCommandsPerPage ??
        this.document.limits.maxCommandsPerPage;
      if (commandCount > maxCommands) {
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
      measurePreparedResources(timings, fontRegistry, imageResources.registry, initialFonts, initialImages);
      return pageData;
    } catch (error) {
      throw normalizeCompileError(error, sourcePageIndex);
    }
  }

  private async compileVectorPageUnlocked(
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
    options = { ...options, ...(options.limits ? { limits: { ...options.limits } } : {}) };
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
        true,
        timings,
        false,
        reuse
      );
      let textCompilation = textCompiler.build();
      let vectorCompiled = compiled;
      let selectiveCompositeFormPaintIndices: readonly number[] = [];
      let selectiveCompositeFormPaintOrders: readonly number[] = [];
      let selectiveImagePaintOrdinalSpans: readonly (readonly [number, number])[] = [];
      let selectivePaintSourceSpans: readonly (readonly [number, number])[] = [];
      let selectivePaintSourceIntervals: readonly (readonly [number, number, number, number])[] = [];
      imageResources.assertReferencedCodecsAvailable(compiled.referencedXObjects);
      if (compiled.formPaints.length !== 0) {
        const formCompileStartedAt = timings ? nativeVectorTimingNow() : 0;
        const flattened = await flattenNativeVectorFormOccurrences({
          document: this.document,
          graph: formGraph,
          rootCompiled: compiled,
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
        if (timings) {
          timings.compileScanMs += nativeVectorTimingNow() - formCompileStartedAt;
        }
      } else {
        const selective = suppressLegacySelectiveImageSpans(compiled, sourcePageIndex);
        vectorCompiled = selective.compiled;
        selectiveImagePaintOrdinalSpans = selective.paintOrdinalSpans;
        selectivePaintSourceSpans = selective.paintSourceSpans;
        selectivePaintSourceIntervals = selective.paintSourceIntervals;
      }
      const adaptationStartedAt = timings ? nativeVectorTimingNow() : 0;
      this.appendDiagnostics(textCompilation.diagnostics);
      this.appendDiagnostics(fontRegistry.getDiagnostics());
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
      const scene = buildNativeVectorPage({
        pageInfo,
        pageBounds,
        compiled: vectorCompiled,
        textCompilation,
        fontResources: fontRegistry.resources,
        imageRegistry: imageResources.registry,
        maxPaths: options.limits?.maxPathsPerPage ??
          this.document.limits.maxPathsPerPage,
        signal
      });
      measurePreparedResources(timings, fontRegistry, imageResources.registry);
      if (selectiveCompositeFormPaintIndices.length !== 0 ||
          selectiveImagePaintOrdinalSpans.length !== 0 ||
          selectivePaintSourceSpans.length !== 0 ||
          selectivePaintSourceIntervals.length !== 0) {
        const retryTimings = timings ? createNativeVectorCompileTimings() : undefined;
        const retryStartedAt = timings ? nativeVectorTimingNow() : 0;
        const pageData = await this.compilePageUnlocked(sourcePageIndex, options, signal, true, retryTimings, reuse);
        if (timings) {
          timings.selectiveCompileMs = nativeVectorTimingNow() - retryStartedAt;
          timings.selectiveCompilation = Object.freeze(retryTimings!);
        }
        const rasterStartedAt = timings ? nativeVectorTimingNow() : 0;
        scene.rasterLayers.push(...await renderNativeSelectiveCompositeLayers(
          pageData,
          selectiveCompositeFormPaintIndices,
          selectiveCompositeFormPaintOrders,
          selectiveImagePaintOrdinalSpans,
          selectivePaintSourceSpans,
          selectivePaintSourceIntervals,
          signal,
          timings,
          reuseCompositeSurfaces,
          boundCompositeWork
        ));
        if (timings) timings.selectiveRasterMs = nativeVectorTimingNow() - rasterStartedAt;
        const primary = scene.rasterLayers[0];
        if (primary) {
          scene.rasterLayerWidth = primary.width;
          scene.rasterLayerHeight = primary.height;
          scene.rasterLayerData = primary.data;
          scene.rasterLayerMatrix = primary.matrix;
        }
      }
      if (timings) {
        timings.vectorSceneAdaptationMs += nativeVectorTimingNow() - adaptationStartedAt;
      }
      return scene;
    } catch (error) {
      throw normalizeCompileError(error, sourcePageIndex);
    }
  }

  private async preparePageResources(
    sourcePageIndex: number,
    options: PdfCompileOptions,
    signal: AbortSignal,
    legacyVectorOutput: boolean,
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
    if (legacyVectorOutput) {
      await assertNoNativeVectorAnnotationAppearances(
        this.formRegistry,
        this.appearanceSynthesizer,
        sourcePageIndex,
        signal
      );
    }
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
      this.iccTransformResolver,
      options.limits
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
      signal
    );
    const hasReferencedForms = xObjectReferences.some(({ kind }) => kind === "Form");
    const formGraph = legacyVectorOutput && !hasReferencedForms
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
            appearanceSynthesizer: this.appearanceSynthesizer,
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
    legacyVectorOutput: boolean,
    timings?: NativeVectorCompileTimings,
    capturePaintSourceIdentities = false,
    reuse?: NativePagePreparationReuse
  ) {
    signal.throwIfAborted();
    const prepared = reuse?.prepared ?? await this.preparePageResources(
      sourcePageIndex, options, signal, legacyVectorOutput, timings
    );
    if (reuse) reuse.prepared = prepared;
    const {
      pageInfo, pageMatrix, pageBounds, fontRegistry, fontResources,
      imageResources, pageContentSegments, extGStates, formGraph,
      pageMarkedContentProperties, totalBytes
    } = prepared;
    const pageForms = formGraph.pageForms;
    const pageFormOptionalContent = formOptionalContentForScope(pageForms, formGraph.definitions);
    const fontsByName = new Map(fontResources);
    const emittedTextRuns: NativeTextDrawRun[] = [];
    const maxGlyphs = options.limits?.maxGlyphsPerPage ?? this.document.limits.maxGlyphsPerPage;
    const textCompiler = new NativeTextCompiler({
      fonts: fontsByName,
      initialTransform: pageMatrix,
      maxGlyphs,
      onRun: (run) => { emittedTextRuns.push(run); }
    });
    const textOperatorSink = {
      applyOperator(
        operator: string,
        operands: readonly unknown[],
        context: Readonly<DensePdfTextOperatorContext>
      ) {
        emittedTextRuns.length = 0;
        textCompiler.setOutputEnabled(context.outputEnabled);
        textCompiler.applyOperator(operator, operands);
        return emittedTextRuns;
      }
    };
    const onProgress = options.onProgress ?? this.defaultProgress;
    onProgress?.(progress(
      "content", 0, totalBytes, sourcePageIndex, 0, this.info.byteLength
    ));
    const compileStartedAt = timings ? nativeVectorTimingNow() : 0;
    let finalizeStartedAt: number | null = null;
    const compiled = await compileDensePdfContent(pageContentSegments, {
      pageMatrix,
      pageBounds,
      enableSegmentMerge: nativeVectorSegmentMergeEnabled(options),
      enableInvisibleCull: nativeVectorInvisibleCullEnabled(options),
      preservePaintOrder: !legacyVectorOutput,
      ...(!legacyVectorOutput && capturePaintSourceIdentities
        ? { capturePaintSourceIdentities: true }
        : {}),
      ...(legacyVectorOutput ? { legacyVectorOutput: true } : {}),
      ...(legacyVectorOutput ? { legacyAllowCompositeForms: true } : {}),
      ...(legacyVectorOutput ? { legacySelectiveImageSpans: true } : {}),
      ...(legacyVectorOutput ? { legacySelectiveClippedImages: true } : {}),
      ...(legacyVectorOutput ? {
        legacySelectiveShadings: true,
        legacySelectivePaths: true,
        legacySelectiveTextClips: true,
        legacyIgnoreOverprint: true
      } : {}),
      textOperatorSink,
      extGStates,
      imageXObjects: imageResources.indexes,
      imageOptionalContent: imageResources.optionalContent,
      shadings: imageResources.shadingIndexes,
      patterns: imageResources.patternDefinitions,
      patternColorSpaces: imageResources.patternColorSpaces,
      formXObjects: pageForms,
      formOptionalContent: pageFormOptionalContent,
      markedContentProperties: pageMarkedContentProperties,
      maxMarkedContentDepth: this.document.limits.maxRecursionDepth,
      maxMarkedContent: options.limits?.maxCommandsPerPage ??
        this.document.limits.maxCommandsPerPage,
      ...densePathCompileLimits(this.document, options),
      colorSpaceResolver: imageResources.colorSpaceResolver,
      totalBytes,
      signal,
      onProgress: (update) => {
        if (timings && update.phase === "finalizing" && finalizeStartedAt === null) {
          finalizeStartedAt = nativeVectorTimingNow();
        }
        onProgress?.(progress(
          update.phase === "scanning" ? "content" : "optimize",
          update.processedBytes,
          update.totalBytes ?? totalBytes,
          sourcePageIndex,
          update.processedBytes,
          this.info.byteLength
        ));
      }
    });
    if (timings) {
      const compileFinishedAt = nativeVectorTimingNow();
      const finalizeSplitAt = finalizeStartedAt ?? compileFinishedAt;
      timings.compileScanMs += finalizeSplitAt - compileStartedAt;
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
  private readonly runSourcesWithDiagnostics = new WeakSet<object>();
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
    const transformRemap = new Uint32Array(compilation.transforms.values.length / 6);
    for (let localIndex = 0; localIndex < transformRemap.length; localIndex += 1) {
      const offset = localIndex * 6;
      const matrix = compilation.transforms.values.subarray(offset, offset + 6);
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
    return this.append(sliceNativeTextRun(compilation, run, false));
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
        runs: Object.freeze([...this.runs]),
        diagnostics: Object.freeze([...this.diagnostics])
      }),
      glyphPrefixes: Object.freeze([...this.glyphPrefixes]),
      glyphTexts: Object.freeze([...this.glyphTexts])
    });
  }
}

function sliceNativeTextRun(
  compilation: NativeTextCompilation,
  run: Readonly<NativeTextDrawRun>,
  includeDiagnostics: boolean
): NativeTextCompilation {
  const first = run.first;
  const end = first + run.count;
  const text: string[] = [];
  const references: number[] = [];
  const pendingText: string[] = [];
  for (let index = 0; index < compilation.textIndex.text.length; index += 1) {
    const character = compilation.textIndex.text[index];
    const reference = compilation.textIndex.charGlyphIndices[index];
    if (reference === -1) {
      pendingText.push(character);
      continue;
    }
    if (reference <= -2) {
      throw new PdfError(
        "unsupported-content",
        "Standalone fallback text cannot be ordered while flattening a Form XObject.",
        { details: { reason: "vector-form-fallback-text" } }
      );
    }
    if (reference < first || reference >= end) {
      pendingText.length = 0;
      continue;
    }
    for (const separator of pendingText) {
      text.push(separator);
      references.push(-1);
    }
    pendingText.length = 0;
    text.push(character);
    references.push(reference - first);
  }
  return Object.freeze({
    transforms: compilation.transforms,
    glyphs: {
      fontIndices: compilation.glyphs.fontIndices.slice(first, end),
      characterCodes: compilation.glyphs.characterCodes.slice(first, end),
      glyphIds: compilation.glyphs.glyphIds.slice(first, end),
      transformIndices: compilation.glyphs.transformIndices.slice(first, end),
      advances: compilation.glyphs.advances.slice(first * 2, end * 2),
      flags: compilation.glyphs.flags.slice(first, end)
    },
    textIndex: {
      version: 1 as const,
      text: text.join(""),
      charGlyphIndices: Int32Array.from(references),
      fallbackQuads: new Float32Array(0)
    },
    ...(compilation.glyphAdvanceEms?.length === compilation.glyphs.glyphIds.length ? {
      glyphAdvanceEms: compilation.glyphAdvanceEms.slice(first, end)
    } : {}),
    ...(compilation.glyphWidthEms?.length === compilation.glyphs.glyphIds.length ? {
      glyphWidthEms: compilation.glyphWidthEms.slice(first, end)
    } : {}),
    ...(compilation.glyphGapBefore?.length === compilation.glyphs.glyphIds.length ? {
      glyphGapBefore: compilation.glyphGapBefore.slice(first, end)
    } : {}),
    runs: Object.freeze([{ ...run, first: 0 }]),
    diagnostics: includeDiagnostics ? compilation.diagnostics : Object.freeze([])
  });
}

async function loadResourceExtGStates(
  registry: NativePdfExtGStateRegistry,
  resources: PdfDictionary,
  resourceNames: readonly string[],
  signal: AbortSignal
): Promise<readonly DensePdfExtGStateDefinition[]> {
  const definitions: DensePdfExtGStateDefinition[] = [];
  for (const resourceName of resourceNames) {
    signal.throwIfAborted();
    const index = await registry.resolveExtGState(resources, resourceName, signal);
    definitions.push(denseExtGStateDefinition(resourceName, registry.describe(index)));
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
  readonly totalBytes: number;
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
  readonly options: PdfCompileOptions;
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
  if (graph.annotationPlacements.length !== 0) {
    throw vectorFormUnsupported(
      "Annotation appearances cannot be flattened into the legacy VectorScene.",
      pageIndex,
      "vector-form-annotation"
    );
  }

  const colorScopes = new Map<number, Promise<ScopedColorResolver>>();
  const extGStateScopes = new Map<
    number,
    Promise<readonly DensePdfExtGStateDefinition[]>
  >();
  const imageScopes = new Map<number, Promise<ScopedImageResources>>();
  const inlineScopes = new Map<number, Promise<readonly DensePdfContentSegment[]>>();
  const fontScopes = new Map<
    number,
    Promise<Array<readonly [string, NativeTextFontResource]>>
  >();
  const occurrenceCache = new Map<string, NativeVectorCompiledOccurrence | null>();

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
        signal
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
        signal
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
    if (!definition.defaultVisible) {
      throw new PdfError("invalid-object", "A hidden Form reached native vector flattening.", {
        pageIndex,
        details: { reason: "vector-form-hidden", definitionIndex }
      });
    }
    if (definition.form.group) {
      throw vectorFormUnsupported(
        `Transparency-group Form /${definition.resourceName} requires an offscreen compositing pass.`,
        pageIndex,
        "vector-form-transparency-group",
        definition.resourceName
      );
    }
    if (!paint.clipIsDefault && paint.clipIsExactRectangle !== true) {
      throw vectorFormUnsupported(
        `Form /${definition.resourceName} is invoked through a non-default caller clip.`,
        pageIndex,
        "vector-form-caller-clip",
        definition.resourceName
      );
    }
    if (definition.resourceReferences.shadings.length !== 0 ||
        definition.resourceReferences.patterns.length !== 0) {
      throw vectorFormUnsupported(
        `Form /${definition.resourceName} uses a shading or pattern that the flat VectorScene cannot order.`,
        pageIndex,
        "vector-form-procedural-paint",
        definition.resourceName
      );
    }
    const transform = multiplyNativePdfMatrices(paint.transform, definition.form.matrix);
    if (!mapsRectangleToAxisAlignedBounds(transform)) {
      throw vectorFormUnsupported(
        `Form /${definition.resourceName} has a rotated or sheared BBox clip.`,
        pageIndex,
        "vector-form-bbox-transform",
        definition.resourceName
      );
    }
    const transformedBox = transformNativePdfRectangle(definition.form.bbox, transform);
    const clipBounds = intersectVectorBounds(paint.clipBounds, transformedBox);
    const cacheKey = nativeVectorFormOccurrenceCacheKey(
      definitionIndex,
      paint,
      transform,
      clipBounds,
      options.optimization
    );
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
      applyOperator(
        operator: string,
        operands: readonly unknown[],
        context: Readonly<DensePdfTextOperatorContext>
      ) {
        emittedTextRuns.length = 0;
        textCompiler.setOutputEnabled(context.outputEnabled);
        textCompiler.applyOperator(operator, operands);
        return emittedTextRuns;
      }
    };
    const compiled = await compileDensePdfContent(await scopedContent(definition), {
      pageMatrix: transform,
      pageBounds: clipBounds,
      initialGraphicsState: paint.initialGraphicsState,
      enableSegmentMerge: nativeVectorSegmentMergeEnabled(options),
      enableInvisibleCull: nativeVectorInvisibleCullEnabled(options),
      legacyVectorOutput: true,
      textOperatorSink,
      extGStates,
      imageXObjects: images.indexes,
      imageOptionalContent: images.optionalContent,
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
    });
    imageResources.assertReferencedCodecsAvailable(compiled.referencedXObjects, images.indexes);
    const text = textCompiler.build();
    assertVectorFormPathsWithinClip(
      compiled,
      clipBounds,
      pageIndex,
      definition.resourceName
    );
    assertVectorFormTextWithinClip(
      text,
      compiled.legacyVector,
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

  const textAccumulator = new NativePageTextAccumulator(maxGlyphs);
  const allOccurrences: NativeVectorCompiledOccurrence[] = [];
  const geometryOccurrences: NativeVectorCompiledOccurrence[] = [];
  const sourceEvents: number[] = [];
  const glyphRunMeta: number[] = [];
  const glyphFillColors: number[] = [];
  const glyphClipBounds: number[] = [];
  const glyphRunFlags: number[] = [];
  const glyphRunClips: NonNullable<DensePdfLegacyVectorOutput["glyphRunClips"]>[number][] = [];
  const imageIndices: number[] = [];
  const imageTransforms: number[] = [];
  const imageClipBounds: number[] = [];
  const imagePaintOrders: number[] = [];
  const imageFlags: number[] = [];
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
    inheritedFormPaintOrder: number | null = null
  ): Promise<boolean> => {
    signal.throwIfAborted();
    registerOccurrence(occurrence);
    textAccumulator.appendDiagnosticsFrom(occurrence.text);
    const sidecar = occurrence.compiled.legacyVector;
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
    let ownerSawOrdinaryPaint = false;
    let ownerRecordedGeometry = false;
    let occurrenceHasPackedGeometry = false;
    for (let offset = 0; offset < sidecar.sourceEvents.length; offset += 2) {
      signal.throwIfAborted();
      const kind = sidecar.sourceEvents[offset];
      const localIndex = sidecar.sourceEvents[offset + 1];
      if (kind === DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH) {
        if (localIndex >= seenGlyphRuns.length || seenGlyphRuns[localIndex] !== 0) {
          throw invalidVectorFormEvent(pageIndex, "glyph", localIndex);
        }
        seenGlyphRuns[localIndex] = 1;
        const localMeta = localIndex * 3;
        const first = sidecar.glyphRunMeta[localMeta];
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
            ? DENSE_PDF_LEGACY_VECTOR_GLYPH_FLAG_CLIPPED
            : 0)
        );
        glyphRunClips.push(sidecar.glyphRunClips?.[localIndex] ?? null);
        sourceEvents.push(
          DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH,
          glyphRunMeta.length / 3 - 1
        );
      } else if (kind === DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE) {
        if (localIndex >= seenImages.length || seenImages[localIndex] !== 0) {
          throw invalidVectorFormEvent(pageIndex, "image", localIndex);
        }
        if (globalSawOrdinaryPaint && occurrence.formDefinitionIndex !== -1) {
          throw vectorFormUnsupported(
            "A flattened Form paints an image after vector or text content.",
            pageIndex,
            "vector-form-image-order"
          );
        }
        if (occurrence.formDefinitionIndex === -1 && rootPackedFormSinceImage) {
          throw vectorFormUnsupported(
            "A root late-image selective span crosses painted Form geometry.",
            pageIndex,
            "vector-form-image-order"
          );
        }
        seenImages[localIndex] = 1;
        const transformOffset = localIndex * 6;
        const transform = sidecar.imageTransforms.subarray(transformOffset, transformOffset + 6);
        if (occurrence.formDefinitionIndex >= 0 &&
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
        sourceEvents.push(DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE, globalIndex);
        if (occurrence.formDefinitionIndex === -1) rootPackedFormSinceImage = false;
      } else if (kind === DENSE_PDF_LEGACY_VECTOR_EVENT_FORM) {
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
            const child = await compileOccurrence(paint.definitionIndex, paint);
            if (child) {
              childClipBounds = child.clipBounds;
              childHasPackedGeometry = await walkOccurrence(child, formPaintOrder);
            }
          } catch (error) {
            if (occurrence.formDefinitionIndex !== -1 ||
                !isSelectiveCompositeCandidateError(error)) {
              throw error;
            }
            // Suppress only the outermost invocation. Its complete reusable
            // display-program subtree is captured later as one ordered layer,
            // so no nested paint can leak into the packed legacy stores.
            selectiveCompositeFormPaintIndices.push(localIndex);
            selectiveCompositeFormPaintOrders.push(formPaintOrder);
          }
        } finally {
          activeDefinitions.delete(paint.definitionIndex);
          textAccumulator.endOccurrenceBoundary(textBoundary);
        }
        if (ownerSawOrdinaryPaint && childHasPackedGeometry &&
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
      } else if (kind === DENSE_PDF_LEGACY_VECTOR_EVENT_ORDINARY_PAINT) {
        if (localIndex !== 0 || ownerSawOrdinaryPaint) {
          throw invalidVectorFormEvent(pageIndex, "ordinary-paint", localIndex);
        }
        ownerSawOrdinaryPaint = true;
        globalSawOrdinaryPaint = true;
        if (!recordedGlobalOrdinaryBarrier) {
          sourceEvents.push(DENSE_PDF_LEGACY_VECTOR_EVENT_ORDINARY_PAINT, 0);
          recordedGlobalOrdinaryBarrier = true;
        }
        if (occurrence.compiled.fillPathCount !== 0 || occurrence.compiled.segmentCount !== 0) {
          geometryOccurrences.push(occurrence);
          ownerRecordedGeometry = true;
          occurrenceHasPackedGeometry = true;
        }
      } else {
        throw invalidVectorFormEvent(pageIndex, "unknown", localIndex);
      }
    }
    if (seenGlyphRuns.some((value) => value === 0) ||
        seenImages.some((value) => value === 0) ||
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

  const selectiveImageSpans = suppressLegacySelectiveImageSpans(rootCompiled, pageIndex);
  await walkOccurrence(Object.freeze({
    compiled: selectiveImageSpans.compiled,
    text: rootText,
    clipBounds: pageBounds,
    formDefinitionIndex: -1
  }));
  const accumulatedText = textAccumulator.build().compilation;
  const legacyVector: DensePdfLegacyVectorOutput = Object.freeze({
    sourceEvents: Uint32Array.from(sourceEvents),
    glyphRunMeta: Uint32Array.from(glyphRunMeta),
    glyphFillColors: Float32Array.from(glyphFillColors),
    glyphClipBounds: Float32Array.from(glyphClipBounds),
    glyphRunFlags: Uint8Array.from(glyphRunFlags),
    ...(glyphRunClips.some(clip => clip !== null) ? { glyphRunClips: Object.freeze(glyphRunClips) } : {}),
    imageIndices: Uint32Array.from(imageIndices),
    imageTransforms: Float32Array.from(imageTransforms),
    imageClipBounds: Float32Array.from(imageClipBounds),
    imagePaintOrders: Uint32Array.from(imagePaintOrders),
    imageFlags: Uint8Array.from(imageFlags)
  });
  return Object.freeze({
    compiled: mergeNativeVectorOccurrences(
      rootCompiled,
      geometryOccurrences,
      allOccurrences,
      legacyVector
    ),
    textCompilation: accumulatedText,
    selectiveCompositeFormPaintIndices: Object.freeze(selectiveCompositeFormPaintIndices),
    selectiveCompositeFormPaintOrders: Object.freeze(selectiveCompositeFormPaintOrders),
    selectiveImagePaintOrdinalSpans: selectiveImageSpans.paintOrdinalSpans,
    selectivePaintSourceSpans: selectiveImageSpans.paintSourceSpans,
    selectivePaintSourceIntervals: selectiveImageSpans.paintSourceIntervals
  });
}

function suppressLegacySelectiveImageSpans(
  compiled: DensePdfCompiledPage,
  pageIndex: number
): {
  compiled: DensePdfCompiledPage;
  paintOrdinalSpans: readonly (readonly [number, number])[];
  paintSourceSpans: readonly (readonly [number, number])[];
  paintSourceIntervals: readonly (readonly [number, number, number, number])[];
} {
  const sidecar = compiled.legacyVector;
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
    if ((sidecar.imageFlags[image] & DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_SELECTIVE_PATH_SPAN) === 0) continue;
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
  const imageCheckpoints: number[] = [];
  for (let image = 0; image < sidecar.imageIndices.length; image += 1) {
    if (imageSuppressed[image]) continue;
    imageMap[image] = imageIndices.length;
    imageIndices.push(sidecar.imageIndices[image]);
    imageTransforms.push(...sidecar.imageTransforms.subarray(image * 6, image * 6 + 6));
    imageClipBounds.push(...sidecar.imageClipBounds.subarray(image * 4, image * 4 + 4));
    imagePaintOrders.push(sidecar.imagePaintOrders[image]);
    imageFlags.push(sidecar.imageFlags[image]);
    imageCheckpoints.push(...checkpoints.subarray(image * 6, image * 6 + 6));
  }
  const sourceEvents: number[] = [];
  for (let offset = 0; offset < sidecar.sourceEvents.length; offset += 2) {
    const kind = sidecar.sourceEvents[offset];
    const index = sidecar.sourceEvents[offset + 1];
    if (kind === DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE && imageSuppressed[index]) continue;
    sourceEvents.push(kind, kind === DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE ? imageMap[index] : index);
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
      legacyVector: {
        ...sidecar,
        sourceEvents: Uint32Array.from(sourceEvents),
        imageIndices: Uint32Array.from(imageIndices),
        imageTransforms: Float32Array.from(imageTransforms),
        imageClipBounds: Float32Array.from(imageClipBounds),
        imagePaintOrders: Uint32Array.from(imagePaintOrders),
        imageFlags: Uint8Array.from(imageFlags),
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

function isSelectiveCompositeCandidateError(error: unknown): boolean {
  if (error instanceof DensePdfUnsupportedError) {
    return error.message === "Legacy vector output cannot represent alpha-as-shape compositing." ||
      error.message === "Legacy vector output cannot represent a soft mask." ||
      /^Legacy vector output cannot represent \/.+ blending\.$/.test(error.message);
  }
  if (!(error instanceof PdfError) || error.code !== "unsupported-content") return false;
  const reason = error.details?.reason;
  return typeof reason === "string" && (
    reason === "vector-form-transparency-group" ||
    reason === "vector-form-procedural-paint" ||
    reason === "vector-form-image-order"
  );
}

type NativeSelectiveRasterLayer = VectorScene["rasterLayers"][number];

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
  boundCompositeWork = true
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
  const renderInternals = { timings: compositeTimings, imageSurfaces, boundSoftMasks: boundCompositeWork };
  try {
    for (const { first, last, paintOrder } of coalescedRanges) {
      signal.throwIfAborted();
      const commands = root.commands.slice(first, last + 1);
      const unselectedGlyphOffset = commands.findIndex((command, offset) =>
        heprCommandContainsGlyph(page, command) &&
        !sourceSelectedCommandIndices.has(first + offset));
      if (unselectedGlyphOffset >= 0) {
        throw new PdfError(
          "unsupported-content",
          "A selective composite contains text and cannot preserve legacy search semantics.",
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
      const compatible = createSelectiveCompositePage(page, commands);
      const scale = nativeSelectiveCompositeScale(page, root.commands, last);
      const rendered = await renderNativeCompositePixels(compatible, {
        scale,
        background: null,
        surfaceFactory,
        signal
      }, renderHeprPageToCanvas2d, renderInternals);
      const rgba = rendered.rgba;
      const crop = cropVisibleRgba(rgba, rendered.width, rendered.height, 2, signal);
      if (!crop) continue;
      const backdropGroups = collectHeprBackdropGroups(page, commands);
      const data = backdropGroups.size !== 0 && [...backdropGroups].every(
        (groupIndex) => heprBackdropGroupCanRender(page, groupIndex)
      )
        ? await renderNativeBackdropCorrection({
            page,
            rootCommands: root.commands,
            first,
            last,
            selectionRgba: rgba,
            crop,
            scale,
            backdropGroups,
            surfaceFactory,
            renderInternals,
            boundCompositeWork,
            signal,
            renderHeprPageToCanvas2d
          })
        : crop.data;
      layers.push({
        width: crop.width,
        height: crop.height,
        data,
        matrix: new Float32Array([
          crop.width / rendered.scale,
          0,
          0,
          -crop.height / rendered.scale,
          crop.x / rendered.scale,
          page.pageInfo.height - crop.y / rendered.scale
        ]),
        paintOrder,
        pageIndex: 0
      });
    }
    return layers;
  } finally {
    imageSurfaces?.dispose();
    surfaceFactory.releaseAll();
  }
}

function createSelectiveCompositePage(
  page: HeprPageData,
  commands: readonly HeprDisplayCommand[],
  preserveBackdropGroups: ReadonlySet<number> | null = null
): HeprPageData {
  const groups = page.displayProgram.groups.map((group, index) => ({
    ...group,
    ...(index === page.displayProgram.rootGroupIndex ? { commands } : {}),
    // Canvas2D receives canonical sRGB resources and has no API for an
    // explicit PDF blending-space override or group backdrop color.
    blendingColorSpaceIndex: -1,
    backdropPaintIndex: -1,
    ...(!preserveBackdropGroups?.has(index) ? {
      // A standalone layer has no parent backdrop. Keep every nested scope
      // independent so the resulting RGBA can be moved through the legacy
      // raster-underlay ABI without sampling unrelated page pixels.
      isolated: true,
      alphaIsShape: false,
    } : {})
  }));
  const flags = page.stores.strokes.flags.slice();
  for (let index = 0; index < flags.length; index += 1) {
    flags[index] &= ~HEPR_STROKE_FLAG.StrokeAdjust;
  }
  const overprint = page.stores.paints.overprint.slice();
  overprint.fill(0);
  return {
    ...page,
    displayProgram: { ...page.displayProgram, groups },
    stores: {
      ...page.stores,
      strokes: { ...page.stores.strokes, flags },
      paints: { ...page.stores.paints, overprint }
    }
  };
}

const NATIVE_SELECTIVE_BASE_SCALE = 1.5;
// Four RGBA buffers can be live during backdrop correction. Keep their
// aggregate comfortably below the parser's 512 MiB decoded-stream ceiling.
const NATIVE_SELECTIVE_MAX_CANVAS_PIXELS = 16_000_000;

/**
 * Match the sharpest source image already contributing below a selective
 * layer. This avoids resampling a high-density page image down to the old
 * fixed 1.5 px/unit bridge and then enlarging it again at viewer zoom.
 */
function nativeSelectiveCompositeScale(
  page: HeprPageData,
  rootCommands: readonly HeprDisplayCommand[],
  lastCommandIndex: number
): number {
  let scale = NATIVE_SELECTIVE_BASE_SCALE;
  const transforms = page.stores.transforms.values;
  const images = page.stores.images;
  for (let commandIndex = 0;
    commandIndex <= lastCommandIndex && commandIndex < rootCommands.length;
    commandIndex += 1) {
    const command = rootCommands[commandIndex];
    if (command.kind !== "draw" || command.source !== "images") continue;
    const transformOffset = command.transformIndex * 6;
    const a = transforms[transformOffset];
    const b = transforms[transformOffset + 1];
    const c = transforms[transformOffset + 2];
    const d = transforms[transformOffset + 3];
    const xExtent = Math.hypot(a, b);
    const yExtent = Math.hypot(c, d);
    for (let imageOffset = 0; imageOffset < command.count; imageOffset += 1) {
      const imageIndex = command.first + imageOffset;
      if (xExtent > 0) scale = Math.max(scale, images.widths[imageIndex] / xExtent);
      if (yExtent > 0) scale = Math.max(scale, images.heights[imageIndex] / yExtent);
    }
  }
  const pagePixels = page.pageInfo.width * page.pageInfo.height;
  const cappedScale = pagePixels > 0
    ? Math.sqrt(NATIVE_SELECTIVE_MAX_CANVAS_PIXELS / pagePixels)
    : NATIVE_SELECTIVE_BASE_SCALE;
  return Math.max(
    NATIVE_SELECTIVE_BASE_SCALE,
    Math.min(scale, cappedScale)
  );
}

function collectHeprBackdropGroups(
  page: HeprPageData,
  commands: readonly HeprDisplayCommand[]
): ReadonlySet<number> {
  const result = new Set<number>();
  const activeGroups = new Set<number>();
  const activePrograms = new Set<number>();
  const visit = (command: HeprDisplayCommand): void => {
    if (command.kind === "draw") return;
    if (command.kind === "invoke-program") {
      if (activePrograms.has(command.programIndex)) return;
      activePrograms.add(command.programIndex);
      for (const nested of page.displayProgram.programs[command.programIndex]?.commands ?? []) {
        visit(nested);
      }
      activePrograms.delete(command.programIndex);
      return;
    }
    if (activeGroups.has(command.groupIndex)) return;
    activeGroups.add(command.groupIndex);
    const group = page.displayProgram.groups[command.groupIndex];
    if (group) {
      if (group.blendMode !== "Normal" || group.backdropPaintIndex >= 0 || group.knockout) {
        result.add(command.groupIndex);
      }
      for (const nested of group.commands) visit(nested);
    }
    activeGroups.delete(command.groupIndex);
  };
  for (const command of commands) visit(command);
  return result;
}

function heprBackdropGroupCanRender(page: HeprPageData, groupIndex: number): boolean {
  const group = page.displayProgram.groups[groupIndex];
  if (!group || group.knockout || group.softMaskTransferFunctionIndex >= 0) return false;
  if (group.alphaIsShape && (group.alpha !== 1 || group.softMaskGroupIndex >= 0)) return false;
  if (group.isolated) return true;
  if (group.alpha === 1 && group.blendMode === "Normal" && group.softMaskGroupIndex < 0) {
    return true;
  }
  const only = group.commands.length === 1 ? group.commands[0] : null;
  return only?.kind === "draw" && only.count === 1;
}

interface NativeBackdropCorrectionInput {
  readonly boundCompositeWork: boolean;
  readonly renderInternals: import("./heprCanvas2dRenderer").HeprCanvas2dRenderInternals;
  readonly page: HeprPageData;
  readonly rootCommands: readonly HeprDisplayCommand[];
  readonly first: number;
  readonly last: number;
  readonly selectionRgba: Uint8ClampedArray;
  readonly crop: {
    readonly x: number;
    readonly y: number;
    readonly width: number;
    readonly height: number;
  };
  readonly scale: number;
  readonly backdropGroups: ReadonlySet<number>;
  readonly surfaceFactory: Awaited<ReturnType<typeof createNativeCompositeSurfaceFactory>>;
  readonly signal: AbortSignal;
  readonly renderHeprPageToCanvas2d: typeof import("./heprCanvas2dRenderer")["renderHeprPageToCanvas2d"];
}

/**
 * Convert a backdrop-dependent PDF blend into a normal source-over RGBA patch
 * for the established raster-layer ABI. Rendering the prefix both without and
 * with the selected commands gives the exact target pixel; the standalone
 * selection supplies its shape/coverage alpha.
 */
async function renderNativeBackdropCorrection(
  input: NativeBackdropCorrectionInput
): Promise<Uint8Array> {
  const {
    page,
    rootCommands,
    first,
    last,
    selectionRgba,
    crop,
    scale,
    backdropGroups,
    surfaceFactory,
    signal,
    renderHeprPageToCanvas2d
  } = input;
  const render = async (commands: readonly HeprDisplayCommand[]) => {
    const result = await renderNativeCompositePixels(
      createSelectiveCompositePage(page, commands, backdropGroups),
      {
        scale,
        background: null,
        surfaceFactory,
        signal,
        maxCanvasPixels: NATIVE_SELECTIVE_MAX_CANVAS_PIXELS
      },
      renderHeprPageToCanvas2d,
      { ...input.renderInternals, readback: input.boundCompositeWork ? crop : undefined }
    );
    return result.rgba;
  };
  const backdrop = await render(rootCommands.slice(0, first));
  signal.throwIfAborted();
  const composited = await render(rootCommands.slice(0, last + 1));
  signal.throwIfAborted();
  const width = Math.ceil(page.pageInfo.width * scale);
  const output = new Uint8Array(crop.width * crop.height * 4);
  for (let y = 0; y < crop.height; y += 1) {
    for (let x = 0; x < crop.width; x += 1) {
      const sourceOffset = ((crop.y + y) * width + crop.x + x) * 4;
      const targetOffset = (y * crop.width + x) * 4;
      const backdropOffset = input.boundCompositeWork ? targetOffset : sourceOffset;
      const shapeAlpha = selectionRgba[sourceOffset + 3] / 255;
      if (shapeAlpha <= 0) continue;
      const backdropAlpha = backdrop[backdropOffset + 3] / 255;
      const outputAlpha = composited[backdropOffset + 3] / 255;
      let layerAlpha = backdropAlpha < 1 - 1 / 255
        ? (outputAlpha - backdropAlpha) / (1 - backdropAlpha)
        : shapeAlpha;
      if (!Number.isFinite(layerAlpha) || layerAlpha <= 0) layerAlpha = shapeAlpha;
      if (backdropAlpha >= 1 - 1 / 255) {
        for (let channel = 0; channel < 3; channel += 1) {
          const backdropValue = backdrop[backdropOffset + channel] / 255;
          const outputValue = composited[backdropOffset + channel] / 255;
          if (outputValue < backdropValue && backdropValue > 0) {
            layerAlpha = Math.max(
              layerAlpha,
              (backdropValue - outputValue) / backdropValue
            );
          } else if (outputValue > backdropValue && backdropValue < 1) {
            layerAlpha = Math.max(
              layerAlpha,
              (outputValue - backdropValue) / (1 - backdropValue)
            );
          }
        }
      }
      layerAlpha = Math.max(1 / 255, Math.min(1, layerAlpha));
      for (let channel = 0; channel < 3; channel += 1) {
        const outputPremultiplied = composited[backdropOffset + channel] / 255 * outputAlpha;
        const backdropPremultiplied = backdrop[backdropOffset + channel] / 255 * backdropAlpha;
        const layer = (
          outputPremultiplied - backdropPremultiplied * (1 - layerAlpha)
        ) / layerAlpha;
        output[targetOffset + channel] = Math.round(Math.max(0, Math.min(1, layer)) * 255);
      }
      output[targetOffset + 3] = Math.round(layerAlpha * 255);
      assertNativeBackdropPixelReconstructs(
        output,
        targetOffset,
        backdrop,
        composited,
        backdropOffset
      );
    }
  }
  return output;
}

function assertNativeBackdropPixelReconstructs(
  layer: Uint8Array,
  layerOffset: number,
  backdrop: Uint8ClampedArray,
  composited: Uint8ClampedArray,
  sourceOffset: number
): void {
  const layerAlpha = layer[layerOffset + 3] / 255;
  const backdropAlpha = backdrop[sourceOffset + 3] / 255;
  const reconstructedAlpha = layerAlpha + backdropAlpha * (1 - layerAlpha);
  if (Math.abs(Math.round(reconstructedAlpha * 255) - composited[sourceOffset + 3]) > 1) {
    throw new PdfError("unsupported-content", "A backdrop correction cannot preserve alpha.", {
      details: { reason: "selective-backdrop-reconstruction" }
    });
  }
  for (let channel = 0; channel < 3; channel += 1) {
    const reconstructedPremultiplied =
      layer[layerOffset + channel] / 255 * layerAlpha +
      backdrop[sourceOffset + channel] / 255 * backdropAlpha * (1 - layerAlpha);
    const reconstructed = reconstructedAlpha > 0
      ? reconstructedPremultiplied / reconstructedAlpha
      : 0;
    if (Math.abs(Math.round(reconstructed * 255) - composited[sourceOffset + channel]) > 1) {
      throw new PdfError("unsupported-content", "A backdrop correction cannot preserve color.", {
        details: { reason: "selective-backdrop-reconstruction", channel }
      });
    }
  }
}

type NativeCompositeRenderer = typeof import("./heprCanvas2dRenderer")["renderHeprPageToCanvas2d"];

async function renderNativeCompositePixels(
  page: HeprPageData,
  options: Parameters<NativeCompositeRenderer>[1] & {
    readonly surfaceFactory: Awaited<ReturnType<typeof createNativeCompositeSurfaceFactory>>;
  },
  render: NativeCompositeRenderer,
  internal: import("./heprCanvas2dRenderer").HeprCanvas2dRenderInternals & {
    readonly readback?: { readonly x: number; readonly y: number; readonly width: number; readonly height: number };
  } = {}
) {
  try {
    const { surface, width, height, scale } = await render(page, options, internal);
    // getImageData owns its pixels. Release scratch surfaces after extraction;
    // immutable cached images survive only until this page operation finishes.
    const startedAt = internal.timings ? nativeVectorTimingNow() : 0;
    const rect = internal.readback ?? { x: 0, y: 0, width, height };
    const rgba = surface.context.getImageData(rect.x, rect.y, rect.width, rect.height).data;
    if (internal.timings) {
      internal.timings.readbackMs += nativeVectorTimingNow() - startedAt;
      internal.timings.readbackPixels += rect.width * rect.height;
    }
    return { rgba, width, height, scale };
  } finally {
    options.surfaceFactory.releaseScratch();
  }
}

function countHeprCommandPaints(page: HeprPageData, command: HeprDisplayCommand): number {
  if (command.kind === "draw") return 1;
  const commands = command.kind === "invoke-program"
    ? page.displayProgram.programs[command.programIndex]?.commands
    : page.displayProgram.groups[command.groupIndex]?.commands;
  let count = 0;
  if (command.kind === "invoke-group") {
    const group = page.displayProgram.groups[command.groupIndex];
    if (group && group.softMaskGroupIndex >= 0) {
      for (const nested of page.displayProgram.groups[group.softMaskGroupIndex]?.commands ?? []) {
        count += countHeprCommandPaints(page, nested);
      }
    }
  }
  for (const nested of commands ?? []) count += countHeprCommandPaints(page, nested);
  return count;
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

async function createNativeCompositeSurfaceFactory() {
  type Canvas = { width: number; height: number };
  const canvases = new Set<Canvas>();
  const retained = new Set<Canvas>();
  const release = (canvas: Canvas) => {
    retained.delete(canvas);
    if (canvases.delete(canvas)) {
      try {
        canvas.width = 1;
        canvas.height = 1;
      } catch {
        // Immutable host wrappers must rely on collection instead.
      }
    }
  };
  const releaseScratch = () => {
    for (const canvas of canvases) if (!retained.has(canvas)) release(canvas);
  };
  const releaseAll = () => {
    retained.clear();
    releaseScratch();
  };
  const lifetime = { releaseAll, releaseScratch, release, retain: (canvas: Canvas) => retained.add(canvas) };
  if (typeof OffscreenCanvas === "function") {
    return Object.assign((width: number, height: number) => {
      const canvas = new OffscreenCanvas(width, height);
      canvases.add(canvas);
      const context = canvas.getContext("2d", { willReadFrequently: true });
      if (!context) throw new PdfError("unsupported-content", "OffscreenCanvas 2D is unavailable.");
      return { canvas, context: context as unknown as CanvasRenderingContext2D };
    }, lifetime);
  }
  const moduleName = "@napi-rs/canvas";
  let module: { createCanvas?: (width: number, height: number) => HTMLCanvasElement };
  try {
    module = await import(/* @vite-ignore */ moduleName) as typeof module;
  } catch (cause) {
    throw new PdfError("unsupported-content", "No worker Canvas2D surface is available.", {
      cause,
      details: { reason: "selective-composite-surface" }
    });
  }
  if (typeof module.createCanvas !== "function") {
    throw new PdfError("unsupported-content", "No worker Canvas2D surface is available.", {
      details: { reason: "selective-composite-surface" }
    });
  }
  return Object.assign((width: number, height: number) => {
    const canvas = module.createCanvas!(width, height);
    canvases.add(canvas);
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) throw new PdfError("unsupported-content", "Node Canvas2D is unavailable.");
    return { canvas, context };
  }, lifetime);
}

function cropVisibleRgba(
  source: Uint8ClampedArray,
  width: number,
  height: number,
  padding: number,
  signal: AbortSignal
): { x: number; y: number; width: number; height: number; data: Uint8Array } | null {
  const bounds = findRgbaAlphaBounds(source, width, height, signal);
  if (!bounds) return null;
  const minX = Math.max(0, bounds.x - padding);
  const minY = Math.max(0, bounds.y - padding);
  const maxX = Math.min(width - 1, bounds.x + bounds.width - 1 + padding);
  const maxY = Math.min(height - 1, bounds.y + bounds.height - 1 + padding);
  const cropWidth = maxX - minX + 1;
  const cropHeight = maxY - minY + 1;
  const data = new Uint8Array(cropWidth * cropHeight * 4);
  for (let y = 0; y < cropHeight; y += 1) {
    signal.throwIfAborted();
    const start = ((minY + y) * width + minX) * 4;
    data.set(source.subarray(start, start + cropWidth * 4), y * cropWidth * 4);
  }
  return { x: minX, y: minY, width: cropWidth, height: cropHeight, data };
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
  legacyVector: DensePdfLegacyVectorOutput
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
    legacyVector,
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
  legacy: DensePdfLegacyVectorOutput | undefined,
  fonts: readonly NativeTextFontResource[],
  clipBounds: Readonly<DensePdfBounds>,
  pageIndex: number,
  resourceName: string,
  signal: AbortSignal
): void {
  if (!legacy) {
    throw new PdfError("invalid-object", "A compiled Form has no legacy-vector sidecar.", {
      pageIndex,
      details: { reason: "vector-form-sidecar", resourceName }
    });
  }
  for (let runIndex = 0; runIndex < text.runs.length; runIndex += 1) {
    signal.throwIfAborted();
    const run = text.runs[runIndex];
    if (run.renderingMode !== 0 || legacy.glyphFillColors[runIndex * 4 + 3] <= 1e-5) continue;
    let activeClip = clipBounds;
    if ((legacy.glyphRunFlags?.[runIndex] ?? 0) !== 0) {
      const offset = runIndex * 4;
      if (!legacy.glyphClipBounds || offset + 4 > legacy.glyphClipBounds.length) {
        throw new PdfError("invalid-object", "A clipped Form text run has no clip bounds.", {
          pageIndex,
          details: { reason: "vector-form-text-clip", resourceName }
        });
      }
      activeClip = {
        minX: legacy.glyphClipBounds[offset],
        minY: legacy.glyphClipBounds[offset + 1],
        maxX: legacy.glyphClipBounds[offset + 2],
        maxY: legacy.glyphClipBounds[offset + 3]
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
        signal
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
        signal
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
    if (!definition.defaultVisible) {
      throw new PdfError(
        "invalid-object",
        "A hidden default-view Form reached display-program specialization.",
        { pageIndex, details: { reason: "hidden-form-specialized", definitionIndex } }
      );
    }
    const key = formSpecializationKey(definitionIndex, initialGraphicsState);
    const cached = specializationByKey.get(key);
    if (cached !== undefined) return cached;
    if (programs.length >= document.limits.maxCachedObjects) {
      throw new PdfError("resource-limit", "Form program specializations exceed the object-cache limit.", {
        pageIndex,
        details: {
          reason: "form-program-specialization-count",
          maxFormPrograms: document.limits.maxCachedObjects
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
      applyOperator(
        operator: string,
        operands: readonly unknown[],
        context: Readonly<DensePdfTextOperatorContext>
      ) {
        emittedTextRuns.length = 0;
        textCompiler.setOutputEnabled(context.outputEnabled);
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
      preservePaintOrder: true,
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
    if (!definition || !definition.defaultVisible) continue;
    annotations.push(Object.freeze({
      programIndex: await specialize(placement.definitionIndex, defaultState),
      transform: placement.invocationMatrix,
      clipBounds: placement.pageBounds,
      optionalContentIndex: placement.appearance.optionalContentIndex >= 0
        ? placement.appearance.optionalContentIndex
        : definition.optionalContentIndex,
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
    if (programs.length >= document.limits.maxCachedObjects) {
      throw new PdfError("resource-limit", "Type3 CharProc programs exceed the object-cache limit.", {
        pageIndex,
        details: {
          reason: "type3-program-count",
          maxType3Programs: document.limits.maxCachedObjects
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
      applyOperator(
        operator: string,
        operands: readonly unknown[],
        context: Readonly<DensePdfTextOperatorContext>
      ) {
        emittedTextRuns.length = 0;
        textCompiler.setOutputEnabled(context.outputEnabled);
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
      signal
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
      signal
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
        if (scopedImages.optionalContent.get(resourceName)?.defaultVisible === false) continue;
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
      maxMarkedContentDepth: document.limits.maxRecursionDepth,
      maxMarkedContent: maxCommands,
      ...densePathCompileLimits(document, options),
      colorSpaceResolver: colorScope.resolver,
      enableSegmentMerge: nativeVectorSegmentMergeEnabled(options),
      enableInvisibleCull: nativeVectorInvisibleCullEnabled(options),
      preservePaintOrder: true,
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
    { readonly programIndex: number; readonly dependencies: Set<number> }
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
  const graph = await buildNativePdfScopedFormDefinitionGraph(
    document,
    formRegistry,
    compilationForm,
    content,
    { pageIndex, resourceName, optionalContent, signal }
  );
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
      preservePaintOrder: true,
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
function buildInvocationOrderedTextIndex(
  root: DensePdfCompiledPage,
  forms: DensePdfFormPageData,
  accumulated: NativeAccumulatedText,
  fontResources: readonly NativeTextFontResource[],
  maxGlyphOccurrences: number,
  signal: AbortSignal
): HeprTextIndex {
  const textParts: string[] = [];
  const references: number[] = [];
  const fallbackQuads: number[] = [];
  const activePrograms = new Set<number>();
  const compilation = accumulated.compilation;
  const maxTextCodeUnits = Math.min(
    0x7fff_ffff,
    Math.max(1_024, maxGlyphOccurrences * 8)
  );
  let textLength = 0;
  let occurrenceCount = 0;
  let boundaryPending = false;

  const appendCodeUnits = (text: string, reference: number): void => {
    if (text.length === 0) return;
    if (textLength > maxTextCodeUnits - text.length) {
      throw new PdfError("resource-limit", "Expanded reusable text exceeds the Unicode limit.", {
        details: { reason: "expanded-text-code-units", maxTextCodeUnits }
      });
    }
    textParts.push(text);
    textLength += text.length;
    for (let index = 0; index < text.length; index += 1) references.push(reference);
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
    if (directReference && !invisible) {
      appendCodeUnits(text, glyphIndex);
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
    appendCodeUnits(text, -fallbackIndex - 2);
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
    version: 1,
    text: textParts.join(""),
    charGlyphIndices: Int32Array.from(references),
    fallbackQuads: Float32Array.from(fallbackQuads)
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
    if (programs.length >= document.limits.maxCachedObjects) {
      throw new PdfError("resource-limit", "Tiling-pattern programs exceed the object-cache limit.", {
        pageIndex,
        details: {
          reason: "pattern-program-count",
          maxPatternPrograms: document.limits.maxCachedObjects
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
      applyOperator(
        operator: string,
        operands: readonly unknown[],
        context: Readonly<DensePdfTextOperatorContext>
      ) {
        emittedTextRuns.length = 0;
        textCompiler.setOutputEnabled(context.outputEnabled);
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
      signal
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
      signal
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
      maxMarkedContentDepth: document.limits.maxRecursionDepth,
      maxMarkedContent: maxCommands,
      ...densePathCompileLimits(document, options),
      colorSpaceResolver: colorScope.resolver,
      enableSegmentMerge: nativeVectorSegmentMergeEnabled(options),
      enableInvisibleCull: nativeVectorInvisibleCullEnabled(options),
      preservePaintOrder: true,
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
    state.strokeAdjustment ?? false
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
  signal: AbortSignal
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
      if (!membership.defaultVisible) {
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
  iccTransformResolver?: NativeIccTransformResolver,
  limits?: Partial<PdfResourceLimits>
): Promise<LoadedPageImages> {
  const colorSpaceValue = resources.get("ColorSpace");
  const colorSpaces = colorSpaceValue === undefined || colorSpaceValue === null
    ? undefined
    : await document.resolveDictionary(colorSpaceValue, signal);
  const colors = new NativePdfColorRegistry(document, undefined, {
    iccTransformResolver,
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
  for (const resourceName of references.colorSpaces) {
    signal.throwIfAborted();
    if (
      definitions.has(resourceName) || patternColorSpaces.has(resourceName) ||
      definitionFailures.has(resourceName)
    ) continue;
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
  }

  const codecDecodedByteLimit = Math.min(
    document.limits.maxDecodedStreamBytes,
    limits?.maxDecodedStreamBytes ?? document.limits.maxDecodedStreamBytes
  );
  const usesBundledCodec = imageCodecResolver === undefined;
  const registry = new NativePdfImageRegistry(document, colors, {
    codecPolicy: "request",
    codecResolver: imageCodecResolver ?? createBundledImageCodecResolver(codecDecodedByteLimit),
    trustedCodecResolver: usesBundledCodec,
    limits
  });
  const shadings = new NativePdfShadingRegistry(document, colors);
  const patterns = new NativePdfPatternRegistry(document, shadings);
  const extGStates = new NativePdfExtGStateRegistry(document, colors);
  const shadingIndexes = new Map<string, number>();
  const patternDefinitions = await loadPatternDefinitions(
    patterns,
    extGStates,
    resources,
    references.patterns,
    signal
  );
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
    signal
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
  const definitions = new Map<string, Readonly<DensePdfMarkedContentPropertyDefinition>>();
  for (const property of resolved) {
    signal.throwIfAborted();
    const mcidValue = property.propertyList === null
      ? undefined
      : await document.resolveValue(property.propertyList.get("MCID"), signal);
    let mcid = -1;
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
      mcid
    }));
  }
  return definitions;
}

async function assertNoNativeVectorAnnotationAppearances(
  registry: NativePdfFormAppearanceRegistry,
  synthesizer: NativePdfAppearanceSynthesizer,
  pageIndex: number,
  signal: AbortSignal
): Promise<void> {
  const annotations = await registry.listPageAnnotations(pageIndex, signal);
  let visibleAppearanceCount = 0;
  for (const annotation of annotations) {
    signal.throwIfAborted();
    const appearance = await resolveNativePdfAnnotationAppearanceWithSynthesis(
      registry,
      synthesizer,
      annotation,
      signal
    );
    if (appearance) visibleAppearanceCount += 1;
  }
  if (visibleAppearanceCount === 0) return;
  throw new PdfError(
    "unsupported-content",
    "Visible annotation appearances are not yet representable by the direct VectorScene path.",
    {
      pageIndex,
      details: {
        reason: "vector-annotation-appearance",
        annotationCount: visibleAppearanceCount
      }
    }
  );
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
