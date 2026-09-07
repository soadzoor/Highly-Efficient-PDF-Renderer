import {
  DENSE_PDF_LEGACY_VECTOR_EVENT_FORM,
  DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH,
  DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE,
  DENSE_PDF_LEGACY_VECTOR_EVENT_ORDINARY_PAINT,
  DENSE_PDF_LEGACY_VECTOR_GLYPH_FLAG_CLIPPED,
  DensePdfResourceLimitError,
  DensePdfSyntaxError,
  DensePdfUnsupportedError,
  compileDensePdfContent,
  scanDensePdfResourceReferences,
  type DensePdfBounds,
  type DensePdfColorSpaceDefinition,
  type DensePdfColorSpaceResolver,
  type DensePdfCompiledPage,
  type DensePdfExtGStateDefinition,
  type DensePdfLegacyVectorOutput,
  type DensePdfMarkedContentPropertyDefinition,
  type DensePdfTextOperatorContext
} from "./pdf/nativeContentCompiler";
import type { DensePdfTextFormSummary } from "./densePdfContentCompiler";
import { NativePdfColorRegistry } from "./pdf/nativeColor";
import {
  getNativeDenseRetainedFormSources,
  type NativeDenseRetainedFormSource
} from "./nativeDensePdfDocument";
import {
  isPdfDictionary,
  type PdfDictionary
} from "./pdf/nativeCos";
import type {
  NativePdfDocument,
  NativePdfPage
} from "./pdf/nativeDocument";
import type { NativeMissingFontResolver } from "./pdf/nativeFont";
import { NativePageFontRegistry } from "./pdf/nativeFontResources";
import { computeNativePdfPageGeometry } from "./pdf/nativePageGeometry";
import {
  multiplyNativePdfMatrices,
  transformNativePdfRectangle
} from "./pdf/nativeFormGeometry";
import {
  NativeTextCompiler,
  type NativeTextCompilation,
  type NativeTextDrawRun,
  type NativeTextFontResource
} from "./pdf/nativeText";
import {
  PdfError,
  type PdfDiagnostic,
  type PdfResourceLimits
} from "./pdf/nativeTypes";
import { buildNativeVectorPage } from "./pdf/nativeVectorPage";
import type { VectorScene } from "./pdfVectorExtractor";

export interface NativeDenseRetainedTextCompileOptions {
  readonly signal?: AbortSignal;
  readonly missingFontResolver?: NativeMissingFontResolver;
  /** Resource ceilings may only lower the source document's configured limits. */
  readonly limits?: Partial<PdfResourceLimits>;
  readonly onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
  /** ExtGStates already validated by the native dense structural adapter. */
  readonly extGStates?: readonly DensePdfExtGStateDefinition[];
  /** All-on OCG properties already validated by the structural adapter. */
  readonly alwaysVisibleOptionalContentProperties?: readonly string[];
  /** Form programs already classified by the dense geometry pass. */
  readonly formSummaries?: ReadonlyMap<string, DensePdfTextFormSummary>;
}

const DEVICE_COLOR_SPACE_ALIASES = [
  "DeviceGray", "G", "DeviceRGB", "RGB", "DeviceCMYK", "CMYK"
] as const;
const DEVICE_COLOR_SPACE_NAMES = new Set<string>(DEVICE_COLOR_SPACE_ALIASES);

const EMPTY_IMAGE_REGISTRY = Object.freeze({
  size: 0,
  describe(index: number): never {
    throw new RangeError(`Text-only compilation has no image ${index}.`);
  }
});

/**
 * Compile a dense compiler's retained text program against its original page
 * font resources, without serializing or reparsing a text-only mini-PDF.
 *
 * The returned one-page `VectorScene` is intentionally text-only and can be
 * passed through the same parity gate used by `mergeDenseGeometryWithText`.
 * This first direct boundary rejects every named non-font resource; callers
 * can fall back to the established mini-PDF/PDF.js path without risking a
 * partial or visually different result.
 *
 * The caller retains ownership of `document` and its source. This function
 * never closes either one.
 *
 * @internal
 */
export async function compileNativeDenseRetainedTextPage(
  document: NativePdfDocument,
  page: NativePdfPage,
  retainedTextContent: Uint8Array,
  referencedFontNames: readonly string[],
  options: NativeDenseRetainedTextCompileOptions = {}
): Promise<VectorScene> {
  if (!(retainedTextContent instanceof Uint8Array)) {
    throw new TypeError("Native retained-text compilation requires Uint8Array content.");
  }
  const fontNames = validateFontNames(referencedFontNames);
  const sourcePageIndex = page?.sourcePageIndex;
  if (!Number.isSafeInteger(sourcePageIndex) || sourcePageIndex < 0) {
    throw new TypeError("Native retained-text compilation requires a valid native page.");
  }
  // This both proves the document remains open and prevents accidentally
  // pairing retained content with a page object from another document.
  if (document.getPage(sourcePageIndex) !== page) {
    throw new TypeError("The native retained-text page does not belong to its document.");
  }

  const localAbort = new AbortController();
  const signal = options.signal ?? localAbort.signal;
  signal.throwIfAborted();

  try {
    const references = scanDensePdfResourceReferences(retainedTextContent, { signal });
    assertExactFontReferences(fontNames, references.fonts, sourcePageIndex);
    const retainedFormSources = selectRetainedFormSources(
      getNativeDenseRetainedFormSources(document, sourcePageIndex),
      references.xObjects,
      sourcePageIndex
    );
    const retainedFormSummaries = new WeakMap<
      NativeDenseRetainedFormSource,
      DensePdfTextFormSummary
    >();
    bindRetainedFormSummaries(
      retainedFormSources,
      options.formSummaries,
      retainedFormSummaries,
      sourcePageIndex
    );
    assertSupportedResourceReferences(
      references,
      options.extGStates ?? [],
      new Set(retainedFormSources.map(({ resourceName }) => resourceName)),
      sourcePageIndex
    );

    const resources = page.resources === undefined || page.resources === null
      ? new Map()
      : await document.resolveDictionary(page.resources, signal);
    const markedContentProperties = await loadRetainedMarkedContentProperties(
      document,
      resources,
      references.properties,
      references.optionalContentProperties,
      options.alwaysVisibleOptionalContentProperties ?? [],
      sourcePageIndex,
      signal
    );
    const colorSpaceResolver = await loadRetainedDeviceColorSpaceResolver(
      document,
      resources,
      signal
    );
    const fontRegistry = new NativePageFontRegistry(
      document,
      sourcePageIndex,
      options.missingFontResolver
    );
    const loadedFonts = await fontRegistry.loadScope(
      resources,
      references.fonts,
      signal,
      { label: `PDF page ${sourcePageIndex + 1}`, allowType3: true }
    );
    const fontsByName = new Map<string, NativeTextFontResource>(loadedFonts);
    const emittedTextRuns: NativeTextDrawRun[] = [];
    const maxGlyphs = readLimit(document, options, "maxGlyphsPerPage");
    const { pageMatrix, pageBounds } = computeNativePdfPageGeometry(page);
    const textCompiler = new NativeTextCompiler({
      fonts: fontsByName,
      initialTransform: pageMatrix,
      maxGlyphs,
      maxGraphicsStateDepth: readLimit(document, options, "maxRecursionDepth"),
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
    const compiled = await compileDensePdfContent(retainedTextContent, {
      pageMatrix,
      pageBounds,
      enableSegmentMerge: false,
      enableInvisibleCull: false,
      legacyVectorOutput: true,
      textOperatorSink,
      extGStates: options.extGStates,
      alwaysVisibleOptionalContentProperties:
        options.alwaysVisibleOptionalContentProperties,
      markedContentProperties,
      colorSpaceResolver,
      ...(retainedFormSources.length > 0 ? {
        formXObjects: new Map(retainedFormSources.map(
          ({ resourceName }, index) => [resourceName, index]
        ))
      } : {}),
      maxPathResources: readLimit(document, options, "maxPathsPerPage"),
      maxPathVerbs: readLimit(document, options, "maxPathVerbsPerPage"),
      maxPathCoordinates: readLimit(document, options, "maxPathCoordinatesPerPage"),
      maxClipPaths: readLimit(document, options, "maxClipsPerPage"),
      maxStrokeStyles: readLimit(document, options, "maxStrokeStylesPerPage"),
      maxDashValues: readLimit(document, options, "maxDashValuesPerPage"),
      maxMarkedContentDepth: readLimit(document, options, "maxRecursionDepth"),
      maxMarkedContent: readLimit(document, options, "maxCommandsPerPage"),
      totalBytes: retainedTextContent.byteLength,
      signal
    });
    let finalCompiled = compiled;
    let textCompilation = textCompiler.build();
    if (retainedFormSources.length > 0) {
      const flattened = await compileAndFlattenTextForms({
        document,
        sourcePageIndex,
        forms: retainedFormSources,
        rootCompiled: compiled,
        rootText: textCompilation,
        fontRegistry,
        options,
        maxGlyphs,
        depth: 0,
        parentVisible: true,
        inheritedInvisibleClip: null,
        formSummaries: retainedFormSummaries,
        signal
      });
      finalCompiled = flattened.compiled;
      textCompilation = flattened.text;
    }
    const diagnostics = deduplicateDiagnostics([
      ...fontRegistry.getDiagnostics(),
      ...textCompilation.diagnostics
    ]);
    for (const diagnostic of diagnostics) options.onDiagnostic?.(diagnostic);
    const blockingDiagnostic = diagnostics.find(
      ({ code }) => !(
        code === "font.sfnt-horizontal-metrics-normalized" ||
        (options.missingFontResolver && code === "font.missing-substituted")
      )
    );
    if (blockingDiagnostic) {
      throw new PdfError(
        blockingDiagnostic.code.startsWith("font.") ? "unsupported-font" : "unsupported-content",
        `Native retained-text compilation emitted ${blockingDiagnostic.code}; ` +
          "the established text fallback is required for this page.",
        {
          pageIndex: sourcePageIndex,
          details: { reason: "retained-text-diagnostic", diagnosticCode: blockingDiagnostic.code }
        }
      );
    }

    const scene = buildNativeVectorPage({
      pageInfo: {
        sourcePageIndex,
        width: pageBounds.maxX - pageBounds.minX,
        height: pageBounds.maxY - pageBounds.minY
      },
      pageBounds,
      compiled: finalCompiled,
      textCompilation,
      fontResources: fontRegistry.resources,
      imageRegistry: EMPTY_IMAGE_REGISTRY,
      maxPaths: readLimit(document, options, "maxPathsPerPage"),
      signal
    });
    assertTextOnlyScene(scene, sourcePageIndex);
    signal.throwIfAborted();
    return scene;
  } catch (error) {
    signal.throwIfAborted();
    throw normalizeCompileError(error, sourcePageIndex);
  }
}

function selectRetainedFormSources(
  sources: readonly NativeDenseRetainedFormSource[] | null,
  referencedNames: readonly string[],
  pageIndex: number
): readonly NativeDenseRetainedFormSource[] {
  if (referencedNames.length === 0) return [];
  if (!sources) {
    throw new PdfError(
      "invalid-object",
      "Retained text references Form XObjects, but the validated page has no Form resources.",
      {
        pageIndex,
        details: {
          reason: "retained-text-form-set",
          referencedForms: referencedNames.length,
          validatedForms: 0
        }
      }
    );
  }
  const sourcesByName = new Map<string, NativeDenseRetainedFormSource>();
  for (const source of sources) {
    if (sourcesByName.has(source.resourceName)) {
      throw new PdfError(
        "invalid-object",
        `The validated page contains duplicate Form resource /${source.resourceName}.`,
        {
          pageIndex,
          details: {
            reason: "retained-text-form-name",
            referencedForm: source.resourceName
          }
        }
      );
    }
    sourcesByName.set(source.resourceName, source);
  }
  return Object.freeze(referencedNames.map((resourceName) => {
    const source = sourcesByName.get(resourceName);
    if (source) return source;
    throw new PdfError(
      "invalid-object",
      `Retained text references /${resourceName}, which is not a validated Form resource.`,
      {
        pageIndex,
        details: {
          reason: "retained-text-form-name",
          referencedForm: resourceName
        }
      }
    );
  }));
}

function selectNestedRetainedFormSources(
  parent: NativeDenseRetainedFormSource,
  referencedNames: readonly string[],
  pageIndex: number
): readonly NativeDenseRetainedFormSource[] {
  if (referencedNames.length === 0) return [];
  return Object.freeze(referencedNames.map((resourceName) => {
    let source: NativeDenseRetainedFormSource | null;
    try {
      source = parent.resolveFormSource(resourceName);
    } catch (error) {
      throw new PdfError(
        "invalid-object",
        `Form XObject /${parent.resourceName} cannot resolve nested Form /${resourceName}.`,
        {
          cause: error,
          pageIndex,
          details: {
            reason: "retained-text-nested-form",
            parentResourceName: parent.resourceName,
            resourceName
          }
        }
      );
    }
    if (source) return source;
    throw new PdfError(
      "unsupported-content",
      `Form XObject /${parent.resourceName} invokes missing or non-Form XObject /${resourceName}.`,
      {
        pageIndex,
        details: {
          reason: "retained-text-nested-form",
          parentResourceName: parent.resourceName,
          resourceName
        }
      }
    );
  }));
}

function bindRetainedFormSummaries(
  sources: readonly NativeDenseRetainedFormSource[],
  summaries: ReadonlyMap<string, DensePdfTextFormSummary> | undefined,
  target: WeakMap<NativeDenseRetainedFormSource, DensePdfTextFormSummary>,
  pageIndex: number
): void {
  if (!summaries) return;
  for (const source of sources) {
    const summary = summaries.get(source.resourceName);
    if (!summary) continue;
    if (summary.dependencyKey !== source.publicForm.dependencyKey) {
      throw new PdfError(
        "invalid-object",
        `Retained Form summary /${source.resourceName} has a mismatched dependency identity.`,
        {
          pageIndex,
          details: {
            reason: "retained-text-form-summary",
            resourceName: source.resourceName
          }
        }
      );
    }
    if (summary.retainedTextContent !== undefined &&
        !(summary.retainedTextContent instanceof Uint8Array)) {
      throw new PdfError(
        "invalid-object",
        `Retained Form summary /${source.resourceName} has an invalid text program.`,
        {
          pageIndex,
          details: {
            reason: "retained-text-form-summary",
            resourceName: source.resourceName
          }
        }
      );
    }
    target.set(source, summary);
  }
}

async function compileAndFlattenTextForms(input: {
  readonly document: NativePdfDocument;
  readonly sourcePageIndex: number;
  readonly forms: readonly NativeDenseRetainedFormSource[];
  readonly rootCompiled: DensePdfCompiledPage;
  readonly rootText: NativeTextCompilation;
  readonly fontRegistry: NativePageFontRegistry;
  readonly options: NativeDenseRetainedTextCompileOptions;
  readonly maxGlyphs: number;
  readonly depth: number;
  readonly parentVisible: boolean;
  readonly inheritedInvisibleClip: DensePdfBounds | null;
  readonly formSummaries: WeakMap<NativeDenseRetainedFormSource, DensePdfTextFormSummary>;
  readonly signal: AbortSignal;
}): Promise<{ readonly compiled: DensePdfCompiledPage; readonly text: NativeTextCompilation }> {
  const {
    document,
    sourcePageIndex,
    forms,
    rootCompiled,
    rootText,
    fontRegistry,
    options,
    maxGlyphs,
    depth,
    parentVisible,
    inheritedInvisibleClip,
    formSummaries,
    signal
  } = input;
  if (rootCompiled.formPaints.length === 0) {
    throw new PdfError(
      "invalid-object",
      "The retained text program references Forms but contains no Form paint events.",
      {
        pageIndex: sourcePageIndex,
        details: {
          reason: "retained-text-form-occurrences",
          occurrences: 0
        }
      }
    );
  }
  const occurrences: CompiledTextFormOccurrence[] = [];
  for (const paint of rootCompiled.formPaints) {
    const form = forms[paint.definitionIndex];
    if (!form) {
      throw new PdfError(
        "invalid-object",
        `Retained text contains invalid Form definition index ${paint.definitionIndex}.`,
        {
          pageIndex: sourcePageIndex,
          details: {
            reason: "retained-text-form-definition",
            definitionIndex: paint.definitionIndex,
            definitionCount: forms.length
          }
        }
      );
    }
    occurrences.push(await compileTextFormOccurrence({
      document,
      sourcePageIndex,
      form,
      paint,
      fontRegistry,
      options,
      maxGlyphs,
      depth,
      parentVisible,
      inheritedInvisibleClip,
      formSummaries,
      signal
    }));
  }
  return flattenTextFormOccurrences(
    rootCompiled,
    rootText,
    occurrences,
    maxGlyphs,
    sourcePageIndex
  );
}

interface CompiledTextFormOccurrence {
  readonly resourceName: string;
  readonly compiled: DensePdfCompiledPage;
  readonly text: NativeTextCompilation;
  readonly bounds: DensePdfBounds;
  readonly visible: boolean;
}

async function compileTextFormOccurrence(input: {
  readonly document: NativePdfDocument;
  readonly sourcePageIndex: number;
  readonly form: NativeDenseRetainedFormSource;
  readonly paint: DensePdfCompiledPage["formPaints"][number];
  readonly fontRegistry: NativePageFontRegistry;
  readonly options: NativeDenseRetainedTextCompileOptions;
  readonly maxGlyphs: number;
  readonly depth: number;
  readonly parentVisible: boolean;
  readonly inheritedInvisibleClip: DensePdfBounds | null;
  readonly formSummaries: WeakMap<NativeDenseRetainedFormSource, DensePdfTextFormSummary>;
  readonly signal: AbortSignal;
}): Promise<CompiledTextFormOccurrence> {
  const {
    document,
    sourcePageIndex,
    form,
    paint,
    fontRegistry,
    options,
    maxGlyphs,
    depth,
    parentVisible,
    inheritedInvisibleClip,
    formSummaries,
    signal
  } = input;
  if (depth >= readLimit(document, options, "maxRecursionDepth")) {
    throw new PdfError(
      "resource-limit",
      "Direct retained-text Form recursion exceeds the configured depth limit.",
      {
        pageIndex: sourcePageIndex,
        details: { reason: "retained-text-form-depth", depth }
      }
    );
  }
  if (!paint.clipIsDefault && !paint.clipIsExactRectangle) {
    throw new PdfError(
      "unsupported-content",
      `Form XObject /${form.resourceName} is invoked through a non-rectangular clip.`,
      {
        pageIndex: sourcePageIndex,
        details: { reason: "retained-text-form-caller-clip", resourceName: form.resourceName }
      }
    );
  }
  const transform = multiplyNativePdfMatrices(paint.transform, form.publicForm.matrix);
  // Axis-preserving transforms include the quarter-turn page matrices emitted
  // by PDF rotation. Their transformed BBox remains an exact rectangle, so the
  // existing VectorScene clip sidecar can represent it without approximation.
  const preservesAxes =
    (transform[1] === 0 && transform[2] === 0) ||
    (transform[0] === 0 && transform[3] === 0);
  if (!preservesAxes) {
    throw new PdfError(
      "unsupported-content",
      `Form XObject /${form.resourceName} uses a rotated or sheared transform.`,
      {
        pageIndex: sourcePageIndex,
        details: { reason: "retained-text-form-transform", resourceName: form.resourceName }
      }
    );
  }
  const box = form.publicForm.bbox;
  const transformedBox = transformNativePdfRectangle(
    [box.left, box.bottom, box.right, box.top],
    transform
  );
  const effectiveFormBounds = intersectBounds(paint.clipBounds, transformedBox);
  // The dense compiler deliberately retains off-clip text Forms for structural
  // operator/font accounting. They are still validated below, but the final
  // text flattener omits their glyphs and searchable text to match PDF.js
  // getTextContent() and the established public search behavior.
  const visible = parentVisible && effectiveFormBounds !== null;
  const formClipBounds = visible
    ? effectiveFormBounds
    : inheritedInvisibleClip ?? paint.clipBounds;
  // Compile invisible occurrences against their disjoint inherited clip, not
  // against the Form BBox. The streaming compiler still consumes graphics
  // state and text positioning, but rejects path paint before expensive packed
  // geometry finalization.
  const compilationBounds = visible ? effectiveFormBounds : formClipBounds;

  const formSummary = formSummaries.get(form);
  const content = formSummary?.retainedTextContent ??
    await document.decodeStream(form.stream, signal);
  const references = scanDensePdfResourceReferences(content, { signal });
  const nestedFormSources = selectNestedRetainedFormSources(
    form,
    references.xObjects,
    sourcePageIndex
  );
  bindRetainedFormSummaries(
    nestedFormSources,
    formSummary?.nestedForms,
    formSummaries,
    sourcePageIndex
  );
  assertSupportedResourceReferences(
    references,
    form.publicForm.extGStates,
    new Set(nestedFormSources.map(({ resourceName }) => resourceName)),
    sourcePageIndex
  );
  const markedContentProperties = await loadRetainedMarkedContentProperties(
    document,
    form.resources,
    references.properties,
    references.optionalContentProperties,
    form.publicForm.alwaysVisibleOptionalContentProperties,
    sourcePageIndex,
    signal
  );
  const colorSpaceResolver = await loadRetainedDeviceColorSpaceResolver(
    document,
    form.resources,
    signal
  );
  const loadedFonts = await fontRegistry.loadScope(
    form.resources,
    references.fonts,
    signal,
    { label: `Form XObject /${form.resourceName}`, allowType3: false }
  );
  const fontsByName = new Map<string, NativeTextFontResource>(loadedFonts);
  const emittedTextRuns: NativeTextDrawRun[] = [];
  const textCompiler = new NativeTextCompiler({
    fonts: fontsByName,
    initialTransform: transform,
    maxGlyphs,
    maxGraphicsStateDepth: readLimit(document, options, "maxRecursionDepth"),
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
  const compiled = await compileDensePdfContent(content, {
    pageMatrix: transform,
    pageBounds: compilationBounds,
    initialGraphicsState: paint.initialGraphicsState,
    enableSegmentMerge: false,
    enableInvisibleCull: false,
    legacyVectorOutput: true,
    textOperatorSink,
    extGStates: form.publicForm.extGStates,
    alwaysVisibleOptionalContentProperties:
      form.publicForm.alwaysVisibleOptionalContentProperties,
    markedContentProperties,
    colorSpaceResolver,
    ...(nestedFormSources.length > 0 ? {
      formXObjects: new Map(nestedFormSources.map(
        ({ resourceName }, index) => [resourceName, index]
      ))
    } : {}),
    maxPathResources: readLimit(document, options, "maxPathsPerPage"),
    maxPathVerbs: readLimit(document, options, "maxPathVerbsPerPage"),
    maxPathCoordinates: readLimit(document, options, "maxPathCoordinatesPerPage"),
    maxClipPaths: readLimit(document, options, "maxClipsPerPage"),
    maxStrokeStyles: readLimit(document, options, "maxStrokeStylesPerPage"),
    maxDashValues: readLimit(document, options, "maxDashValuesPerPage"),
    maxMarkedContentDepth: readLimit(document, options, "maxRecursionDepth"),
    maxMarkedContent: readLimit(document, options, "maxCommandsPerPage"),
    totalBytes: content.byteLength,
    signal
  });
  let finalCompiled = compiled;
  let finalText = textCompiler.build();
  if (nestedFormSources.length > 0) {
    const flattened = await compileAndFlattenTextForms({
      document,
      sourcePageIndex,
      forms: nestedFormSources,
      rootCompiled: compiled,
      rootText: finalText,
      fontRegistry,
      options,
      maxGlyphs,
      depth: depth + 1,
      parentVisible: visible,
      inheritedInvisibleClip: visible ? null : formClipBounds,
      formSummaries,
      signal
    });
    finalCompiled = flattened.compiled;
    finalText = flattened.text;
  }
  if (visible) {
    assertCompiledFormIsTextOnly(finalCompiled, form.resourceName, sourcePageIndex);
  }
  return Object.freeze({
    resourceName: form.resourceName,
    compiled: finalCompiled,
    text: finalText,
    bounds: formClipBounds,
    visible
  });
}

function assertCompiledFormIsTextOnly(
  compiled: DensePdfCompiledPage,
  resourceName: string,
  pageIndex: number
): void {
  const sidecar = compiled.legacyVector;
  const nonTextPaint = compiled.pathCount + compiled.fillPathCount +
    compiled.fillSegmentCount + compiled.segmentCount +
    compiled.imageTransforms.length + compiled.formPaints.length;
  if (
    nonTextPaint === 0 &&
    sidecar &&
    sidecar.imageIndices.length === 0
  ) return;
  throw new PdfError(
    "unsupported-content",
    `Form XObject /${resourceName} contains non-text paint.`,
    {
      pageIndex,
      details: {
        reason: "retained-text-form-painted",
        resourceName,
        nonTextPaint
      }
    }
  );
}

function intersectBounds(
  left: DensePdfBounds,
  right: DensePdfBounds
): DensePdfBounds | null {
  const bounds: DensePdfBounds = {
    minX: Math.max(left.minX, right.minX),
    minY: Math.max(left.minY, right.minY),
    maxX: Math.min(left.maxX, right.maxX),
    maxY: Math.min(left.maxY, right.maxY)
  };
  return bounds.maxX > bounds.minX && bounds.maxY > bounds.minY
    ? Object.freeze(bounds)
    : null;
}

function flattenTextFormOccurrences(
  rootCompiled: DensePdfCompiledPage,
  rootText: NativeTextCompilation,
  occurrences: readonly CompiledTextFormOccurrence[],
  maxGlyphs: number,
  pageIndex: number
): { readonly compiled: DensePdfCompiledPage; readonly text: NativeTextCompilation } {
  const rootSidecar = requireLegacySidecar(rootCompiled, pageIndex, "page");
  const fallbackResourceName = occurrences[0]?.resourceName ?? "unknown";
  if (rootSidecar.imageIndices.length !== 0) {
    throw unsupportedFormFlatten(
      pageIndex,
      fallbackResourceName,
      "has an image event in retained page text"
    );
  }
  const occurrenceSidecars = occurrences.map((occurrence) => {
    const sidecar = requireLegacySidecar(
      occurrence.compiled,
      pageIndex,
      `Form /${occurrence.resourceName}`
    );
    if (occurrence.visible && sidecar.imageIndices.length !== 0) {
      throw unsupportedFormFlatten(pageIndex, occurrence.resourceName, "contains an image event");
    }
    return sidecar;
  });

  const accumulator = new OrderedTextAccumulator(maxGlyphs);
  accumulator.appendDiagnosticsFrom(rootText);
  for (const occurrence of occurrences) {
    if (occurrence.visible) accumulator.appendDiagnosticsFrom(occurrence.text);
  }
  const sourceEvents: number[] = [];
  const glyphRunMeta: number[] = [];
  const glyphFillColors: number[] = [];
  const glyphClipBounds: number[] = [];
  const glyphRunFlags: number[] = [];

  const appendGlyphRun = (
    compiled: DensePdfCompiledPage,
    text: NativeTextCompilation,
    sidecar: DensePdfLegacyVectorOutput,
    localIndex: number,
    defaultBounds: DensePdfBounds,
    fromForm: boolean,
    resourceName: string
  ): void => {
    const runCount = sidecar.glyphRunMeta.length / 3;
    if (!Number.isSafeInteger(localIndex) || localIndex < 0 || localIndex >= runCount) {
      throw unsupportedFormFlatten(pageIndex, resourceName, "has an invalid glyph event");
    }
    const metaOffset = localIndex * 3;
    const count = sidecar.glyphRunMeta[metaOffset + 1];
    const renderingMode = sidecar.glyphRunMeta[metaOffset + 2];
    const first = accumulator.appendRun(text, localIndex);
    glyphRunMeta.push(first, count, renderingMode);
    glyphFillColors.push(...sidecar.glyphFillColors.subarray(
      localIndex * 4,
      localIndex * 4 + 4
    ));
    glyphClipBounds.push(...(sidecar.glyphClipBounds?.subarray(
      localIndex * 4,
      localIndex * 4 + 4
    ) ?? [defaultBounds.minX, defaultBounds.minY, defaultBounds.maxX, defaultBounds.maxY]));
    glyphRunFlags.push(
      (sidecar.glyphRunFlags?.[localIndex] ?? 0) |
      (fromForm ? DENSE_PDF_LEGACY_VECTOR_GLYPH_FLAG_CLIPPED : 0)
    );
    sourceEvents.push(DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH, glyphRunMeta.length / 3 - 1);
    // Keep this argument in the validation surface: the run's owner must be
    // the same compilation whose event tape is being flattened.
    if (compiled.legacyVector !== sidecar) {
      throw unsupportedFormFlatten(pageIndex, resourceName, "has mismatched event ownership");
    }
  };

  const seenOccurrences = new Uint8Array(occurrences.length);
  const appendForm = (occurrenceIndex: number): void => {
    const occurrence = occurrences[occurrenceIndex];
    const formSidecar = occurrenceSidecars[occurrenceIndex];
    if (!occurrence || !formSidecar || seenOccurrences[occurrenceIndex] !== 0) {
      throw unsupportedFormFlatten(
        pageIndex,
        occurrence?.resourceName ?? fallbackResourceName,
        "has a duplicate or invalid Form event"
      );
    }
    seenOccurrences[occurrenceIndex] = 1;
    if (!occurrence.visible) {
      // PDF.js getTextContent() excludes Form text whose exact caller/BBox
      // intersection is empty. Preserve the occurrence's compiled structural
      // counts in the result below, but do not expose glyphs, text-index
      // characters, fallback quads, or diagnostics from invisible content.
      return;
    }
    const seenFormGlyphs = new Uint8Array(formSidecar.glyphRunMeta.length / 3);
    const boundary = accumulator.beginOccurrenceBoundary();
    try {
      for (let offset = 0; offset < formSidecar.sourceEvents.length; offset += 2) {
        const kind = formSidecar.sourceEvents[offset];
        const localIndex = formSidecar.sourceEvents[offset + 1];
        if (
          kind === DENSE_PDF_LEGACY_VECTOR_EVENT_ORDINARY_PAINT &&
          localIndex === 0 &&
          occurrence.compiled.fillPathCount === 0 &&
          occurrence.compiled.fillSegmentCount === 0 &&
          occurrence.compiled.segmentCount === 0
        ) {
          continue;
        }
        if (kind !== DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH) {
          const detail = kind === DENSE_PDF_LEGACY_VECTOR_EVENT_FORM
            ? "contains a nested Form event"
            : kind === DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE
              ? "contains an image event"
              : kind === DENSE_PDF_LEGACY_VECTOR_EVENT_ORDINARY_PAINT
                ? "contains an ordinary paint event"
                : "contains an unknown event";
          throw unsupportedFormFlatten(pageIndex, occurrence.resourceName, detail);
        }
        if (localIndex >= seenFormGlyphs.length || seenFormGlyphs[localIndex] !== 0) {
          throw unsupportedFormFlatten(
            pageIndex,
            occurrence.resourceName,
            "has duplicate or invalid glyph events"
          );
        }
        seenFormGlyphs[localIndex] = 1;
        appendGlyphRun(
          occurrence.compiled,
          occurrence.text,
          formSidecar,
          localIndex,
          occurrence.bounds,
          true,
          occurrence.resourceName
        );
      }
      if (seenFormGlyphs.some((value) => value === 0)) {
        throw unsupportedFormFlatten(
          pageIndex,
          occurrence.resourceName,
          "has an incomplete event tape"
        );
      }
    } finally {
      accumulator.endOccurrenceBoundary(boundary);
    }
  };

  const seenRootGlyphs = new Uint8Array(rootSidecar.glyphRunMeta.length / 3);
  for (let offset = 0; offset < rootSidecar.sourceEvents.length; offset += 2) {
    const kind = rootSidecar.sourceEvents[offset];
    const localIndex = rootSidecar.sourceEvents[offset + 1];
    if (kind === DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH) {
      if (localIndex >= seenRootGlyphs.length || seenRootGlyphs[localIndex] !== 0) {
        throw unsupportedFormFlatten(
          pageIndex,
          fallbackResourceName,
          "has duplicate or invalid page glyph events"
        );
      }
      seenRootGlyphs[localIndex] = 1;
      appendGlyphRun(
        rootCompiled,
        rootText,
        rootSidecar,
        localIndex,
        rootCompiled.bounds,
        false,
        fallbackResourceName
      );
      continue;
    }
    if (kind === DENSE_PDF_LEGACY_VECTOR_EVENT_FORM) {
      appendForm(localIndex);
      continue;
    }
    if (
      kind === DENSE_PDF_LEGACY_VECTOR_EVENT_ORDINARY_PAINT &&
      localIndex === 0 &&
      rootCompiled.fillPathCount === 0 &&
      rootCompiled.fillSegmentCount === 0 &&
      rootCompiled.segmentCount === 0
    ) {
      // The retained program may keep a zero-geometry paint barrier solely
      // for source-order accounting. It has no VectorScene payload to splice.
      continue;
    }
    const detail = kind === DENSE_PDF_LEGACY_VECTOR_EVENT_FORM
      ? "has duplicate or invalid Form events"
      : kind === DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE
        ? "has an image event in retained page text"
        : kind === DENSE_PDF_LEGACY_VECTOR_EVENT_ORDINARY_PAINT
          ? "has ordinary paint in retained page text"
          : "has an unknown page event";
    throw unsupportedFormFlatten(pageIndex, fallbackResourceName, detail);
  }
  if (
    seenRootGlyphs.some((value) => value === 0) ||
    seenOccurrences.some((value) => value === 0)
  ) {
    throw unsupportedFormFlatten(pageIndex, fallbackResourceName, "has an incomplete event tape");
  }

  const legacyVector: DensePdfLegacyVectorOutput = Object.freeze({
    sourceEvents: Uint32Array.from(sourceEvents),
    glyphRunMeta: Uint32Array.from(glyphRunMeta),
    glyphFillColors: Float32Array.from(glyphFillColors),
    glyphClipBounds: Float32Array.from(glyphClipBounds),
    glyphRunFlags: Uint8Array.from(glyphRunFlags),
    imageIndices: new Uint32Array(0),
    imageTransforms: new Float32Array(0),
    imageClipBounds: new Float32Array(0),
    imagePaintOrders: new Uint32Array(0),
    imageFlags: new Uint8Array(0)
  });
  return Object.freeze({
    compiled: Object.freeze({
      ...rootCompiled,
      operatorCount: rootCompiled.operatorCount + occurrences.reduce(
        (total, occurrence) => total + occurrence.compiled.operatorCount,
        0
      ),
      textShowOpCount: rootCompiled.textShowOpCount + occurrences.reduce(
        (total, occurrence) => total + occurrence.compiled.textShowOpCount,
        0
      ),
      referencedFonts: [
        ...new Set([
          ...rootCompiled.referencedFonts,
          ...occurrences.flatMap(({ compiled }) => compiled.referencedFonts)
        ])
      ],
      referencedXObjects: [],
      formPaints: Object.freeze([]),
      legacyVector
    }),
    text: accumulator.build()
  });
}

function requireLegacySidecar(
  compiled: DensePdfCompiledPage,
  pageIndex: number,
  owner: string
): DensePdfLegacyVectorOutput {
  const sidecar = compiled.legacyVector;
  if (
    !sidecar ||
    sidecar.sourceEvents.length % 2 !== 0 ||
    sidecar.glyphRunMeta.length % 3 !== 0 ||
    sidecar.glyphFillColors.length !== sidecar.glyphRunMeta.length / 3 * 4
  ) {
    throw new PdfError(
      "invalid-object",
      `The retained ${owner} compilation has an invalid legacy event tape.`,
      { pageIndex, details: { reason: "retained-text-form-event-tape" } }
    );
  }
  return sidecar;
}

function unsupportedFormFlatten(
  pageIndex: number,
  resourceName: string,
  detail: string
): PdfError {
  return new PdfError(
    "unsupported-content",
    `Form XObject /${resourceName} ${detail}.`,
    {
      pageIndex,
      details: {
        reason: "retained-text-form-flatten",
        resourceName
      }
    }
  );
}

interface IndexedTextRun {
  readonly text: string;
  readonly references: Int32Array;
}

class OrderedTextAccumulator {
  private readonly maxGlyphs: number;
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
  private readonly diagnosticSources = new WeakSet<object>();
  private readonly indexedTextRuns = new WeakMap<NativeTextCompilation, readonly IndexedTextRun[] | null>();
  private readonly transformRemaps = new WeakMap<NativeTextCompilation, Uint32Array>();
  private pendingOccurrenceBoundary = false;

  constructor(maxGlyphs: number) {
    this.maxGlyphs = maxGlyphs;
  }

  appendRun(compilation: NativeTextCompilation, runIndex: number): number {
    const run = compilation.runs[runIndex];
    if (
      !run || !Number.isSafeInteger(run.first) || !Number.isSafeInteger(run.count) ||
      run.count <= 0 || run.first < 0 ||
      run.first > compilation.glyphs.glyphIds.length - run.count
    ) {
      throw new PdfError("invalid-object", "A retained Form references an invalid glyph run.", {
        details: { reason: "retained-text-form-glyph-run", runIndex }
      });
    }
    const indexedRuns = this.getIndexedTextRuns(compilation);
    if (indexedRuns) {
      return this.appendIndexedRun(compilation, run, indexedRuns[runIndex]);
    }
    return this.append(sliceTextRun(compilation, run));
  }

  appendDiagnosticsFrom(compilation: NativeTextCompilation): void {
    if (this.diagnosticSources.has(compilation)) return;
    this.diagnosticSources.add(compilation);
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

  endOccurrenceBoundary(state: { readonly pending: boolean; readonly textLength: number }): void {
    this.pendingOccurrenceBoundary = this.charGlyphIndices.length > state.textLength
      ? true
      : state.pending;
  }

  build(): NativeTextCompilation {
    return Object.freeze({
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
    });
  }

  /**
   * Build the text-to-run ownership table once for a compilation. Form
   * flattening appends each source run separately; rescanning the complete
   * page text index for every run makes that otherwise linear splice
   * quadratic on text-heavy drawing plans.
   *
   * Overlapping run spans are not expected from NativeTextCompiler. Retain the
   * old per-run slicer for that case so this optimization cannot change its
   * duplicate-text semantics.
   */
  private getIndexedTextRuns(
    compilation: NativeTextCompilation
  ): readonly IndexedTextRun[] | null {
    const cached = this.indexedTextRuns.get(compilation);
    if (cached !== undefined) return cached;
    if (
      compilation.textIndex.text.length !==
      compilation.textIndex.charGlyphIndices.length
    ) {
      this.indexedTextRuns.set(compilation, null);
      return null;
    }

    const glyphCount = compilation.glyphs.glyphIds.length;
    const owners = new Int32Array(glyphCount);
    owners.fill(-1);
    for (let runIndex = 0; runIndex < compilation.runs.length; runIndex += 1) {
      const run = compilation.runs[runIndex];
      if (
        !Number.isSafeInteger(run.first) || !Number.isSafeInteger(run.count) ||
        run.count <= 0 || run.first < 0 || run.first > glyphCount - run.count
      ) {
        this.indexedTextRuns.set(compilation, null);
        return null;
      }
      const end = run.first + run.count;
      for (let glyphIndex = run.first; glyphIndex < end; glyphIndex += 1) {
        if (owners[glyphIndex] !== -1) {
          this.indexedTextRuns.set(compilation, null);
          return null;
        }
        owners[glyphIndex] = runIndex;
      }
    }

    const textParts: Array<string[] | undefined> = new Array(compilation.runs.length);
    const references: Array<number[] | undefined> = new Array(compilation.runs.length);
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
          "Fallback-only text cannot be ordered while flattening a Form XObject.",
          { details: { reason: "retained-text-form-fallback-text" } }
        );
      }
      const runIndex = reference < owners.length ? owners[reference] : -1;
      if (runIndex < 0) {
        pendingText.length = 0;
        continue;
      }
      const runText = textParts[runIndex] ??= [];
      const runReferences = references[runIndex] ??= [];
      for (const separator of pendingText) {
        runText.push(separator);
        runReferences.push(-1);
      }
      pendingText.length = 0;
      runText.push(character);
      runReferences.push(reference - compilation.runs[runIndex].first);
    }

    const indexed = Object.freeze(compilation.runs.map((_, runIndex) => Object.freeze({
      text: textParts[runIndex]?.join("") ?? "",
      references: Int32Array.from(references[runIndex] ?? [])
    })));
    this.indexedTextRuns.set(compilation, indexed);
    return indexed;
  }

  private appendIndexedRun(
    compilation: NativeTextCompilation,
    run: Readonly<NativeTextDrawRun>,
    indexedText: IndexedTextRun
  ): number {
    const glyphOffset = this.glyphIds.length;
    if (run.count > this.maxGlyphs - glyphOffset) {
      throw new PdfError("resource-limit", "Page and Form text exceeds the glyph limit.", {
        details: { reason: "retained-text-form-glyph-count", maxGlyphs: this.maxGlyphs }
      });
    }
    const transformRemap = this.getTransformRemap(compilation);
    const end = run.first + run.count;
    const hasGlyphAdvanceEms =
      compilation.glyphAdvanceEms?.length === compilation.glyphs.glyphIds.length;
    const hasGlyphWidthEms =
      compilation.glyphWidthEms?.length === compilation.glyphs.glyphIds.length;
    const hasGlyphGapBefore =
      compilation.glyphGapBefore?.length === compilation.glyphs.glyphIds.length;
    for (let index = run.first; index < end; index += 1) {
      this.fontIndices.push(compilation.glyphs.fontIndices[index]);
      this.characterCodes.push(compilation.glyphs.characterCodes[index]);
      this.glyphIds.push(compilation.glyphs.glyphIds[index]);
      this.transformIndices.push(transformRemap[compilation.glyphs.transformIndices[index]]);
      this.advances.push(
        compilation.glyphs.advances[index * 2],
        compilation.glyphs.advances[index * 2 + 1]
      );
      this.flags.push(compilation.glyphs.flags[index]);
      if (hasGlyphAdvanceEms) {
        this.glyphAdvanceEms.push(compilation.glyphAdvanceEms![index]);
      } else {
        this.hasCompleteGlyphAdvanceEms = false;
        this.glyphAdvanceEms.push(0);
      }
      if (hasGlyphWidthEms) {
        this.glyphWidthEms.push(compilation.glyphWidthEms![index]);
      } else {
        this.hasCompleteGlyphWidthEms = false;
        this.glyphWidthEms.push(0);
      }
      if (hasGlyphGapBefore) {
        this.glyphGapBefore.push(compilation.glyphGapBefore![index]);
      } else {
        this.hasCompleteGlyphGapBefore = false;
        this.glyphGapBefore.push(0);
      }
    }
    this.runs.push(Object.freeze({ ...run, first: glyphOffset }));
    this.appendIndexedText(indexedText, glyphOffset);
    return glyphOffset;
  }

  private appendIndexedText(indexedText: IndexedTextRun, glyphOffset: number): void {
    if (indexedText.text.length > 0 && this.pendingOccurrenceBoundary) {
      this.pendingOccurrenceBoundary = false;
      const previous = this.textParts.at(-1)?.at(-1) ?? "";
      const next = indexedText.text[0] ?? "";
      if (previous && next && !/\s/u.test(previous) && !/\s/u.test(next)) {
        this.textParts.push(" ");
        this.charGlyphIndices.push(-1);
      }
    }
    for (let index = 0; index < indexedText.text.length; index += 1) {
      this.textParts.push(indexedText.text[index]);
      const reference = indexedText.references[index];
      this.charGlyphIndices.push(reference >= 0 ? glyphOffset + reference : -1);
    }
  }

  private getTransformRemap(compilation: NativeTextCompilation): Uint32Array {
    const cached = this.transformRemaps.get(compilation);
    if (cached) return cached;
    const values = compilation.transforms.values;
    const transformRemap = new Uint32Array(values.length / 6);
    for (let localIndex = 0; localIndex < transformRemap.length; localIndex += 1) {
      transformRemap[localIndex] = this.internTransform(values, localIndex);
    }
    this.transformRemaps.set(compilation, transformRemap);
    return transformRemap;
  }

  private internTransform(values: Float32Array, localIndex: number): number {
    const offset = localIndex * 6;
    const key = `${values[offset]},${values[offset + 1]},${values[offset + 2]},` +
      `${values[offset + 3]},${values[offset + 4]},${values[offset + 5]}`;
    let globalIndex = this.transformKeys.get(key);
    if (globalIndex !== undefined) return globalIndex;
    globalIndex = this.transforms.length / 6;
    if (globalIndex > this.maxGlyphs) {
      throw new PdfError("resource-limit", "Page and Form text exceeds the transform limit.", {
        details: { reason: "retained-text-form-transform-count", maxGlyphs: this.maxGlyphs }
      });
    }
    this.transforms.push(
      values[offset],
      values[offset + 1],
      values[offset + 2],
      values[offset + 3],
      values[offset + 4],
      values[offset + 5]
    );
    this.transformKeys.set(key, globalIndex);
    return globalIndex;
  }

  private append(compilation: NativeTextCompilation): number {
    const glyphOffset = this.glyphIds.length;
    const glyphCount = compilation.glyphs.glyphIds.length;
    if (glyphCount > this.maxGlyphs - glyphOffset) {
      throw new PdfError("resource-limit", "Page and Form text exceeds the glyph limit.", {
        details: { reason: "retained-text-form-glyph-count", maxGlyphs: this.maxGlyphs }
      });
    }
    const transformRemap = this.getTransformRemap(compilation);
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
      if (previous && next && !/\s/u.test(previous) && !/\s/u.test(next)) {
        this.textParts.push(" ");
        this.charGlyphIndices.push(-1);
      }
    }
    for (let index = 0; index < compilation.textIndex.text.length; index += 1) {
      this.textParts.push(compilation.textIndex.text[index]);
      const reference = compilation.textIndex.charGlyphIndices[index];
      this.charGlyphIndices.push(reference >= 0
        ? glyphOffset + reference
        : reference === -1
          ? -1
          : reference - fallbackOffset);
    }
    return glyphOffset;
  }
}

function sliceTextRun(
  compilation: NativeTextCompilation,
  run: Readonly<NativeTextDrawRun>
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
        "Fallback-only text cannot be ordered while flattening a Form XObject.",
        { details: { reason: "retained-text-form-fallback-text" } }
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
    diagnostics: Object.freeze([])
  });
}

function validateFontNames(value: readonly string[]): readonly string[] {
  if (!Array.isArray(value)) {
    throw new TypeError("referencedFontNames must be an array.");
  }
  const seen = new Set<string>();
  for (const name of value) {
    if (typeof name !== "string" || name.length === 0 || name.startsWith("/")) {
      throw new TypeError("referencedFontNames contains an invalid PDF resource name.");
    }
    if (seen.has(name)) {
      throw new TypeError(`referencedFontNames contains duplicate /${name}.`);
    }
    seen.add(name);
  }
  return Object.freeze([...value]);
}

function assertExactFontReferences(
  expected: readonly string[],
  actual: readonly string[],
  pageIndex: number
): void {
  const actualSet = new Set(actual);
  if (
    expected.length === actualSet.size &&
    expected.every((name) => actualSet.has(name))
  ) return;
  throw new PdfError(
    "invalid-object",
    "Retained text and its declared font resource names do not match.",
    {
      pageIndex,
      details: {
        reason: "retained-text-font-set",
        declared: expected.join(","),
        scanned: actual.join(",")
      }
    }
  );
}

function assertSupportedResourceReferences(
  references: ReturnType<typeof scanDensePdfResourceReferences>,
  extGStates: readonly DensePdfExtGStateDefinition[],
  allowedXObjects: ReadonlySet<string>,
  pageIndex: number
): void {
  const unsupported: Array<readonly [string, readonly string[]]> = [
    ["XObject", references.xObjects.filter((name) => !allowedXObjects.has(name))],
    ["Shading", references.shadings],
    ["Pattern", references.patterns],
    [
      "ColorSpace",
      references.colorSpaces.filter((name) => !DEVICE_COLOR_SPACE_NAMES.has(name))
    ]
  ];
  const found = unsupported.find(([, names]) => names.length !== 0);
  if (found) {
    throw new PdfError(
      "unsupported-content",
      `Direct retained-text compilation does not yet resolve /${found[0]} resources.`,
      {
        pageIndex,
        details: {
          reason: "retained-text-unsupported-resource",
          resourceKind: found[0],
          resourceNames: found[1].join(",")
        }
      }
    );
  }
  const supportedExtGStates = new Set(
    extGStates.map(({ resourceName }) => resourceName)
  );
  const missingExtGState = references.extGStates.find(
    (resourceName) => !supportedExtGStates.has(resourceName)
  );
  if (missingExtGState) {
    throw new PdfError(
      "unsupported-content",
      `Direct retained-text compilation has no validated ExtGState /${missingExtGState}.`,
      {
        pageIndex,
        details: {
          reason: "retained-text-ext-gstate",
          resourceName: missingExtGState,
          resourceKind: "ExtGState"
        }
      }
    );
  }
}

async function loadRetainedDeviceColorSpaceResolver(
  document: NativePdfDocument,
  resources: PdfDictionary,
  signal: AbortSignal
): Promise<DensePdfColorSpaceResolver> {
  const rawColorSpaces = resources.get("ColorSpace");
  const colorSpaceResources = rawColorSpaces === undefined || rawColorSpaces === null
    ? undefined
    : await document.resolveDictionary(rawColorSpaces, signal);
  const colors = new NativePdfColorRegistry(document);
  const definitions = new Map<string, Readonly<DensePdfColorSpaceDefinition>>();

  for (const resourceName of DEVICE_COLOR_SPACE_ALIASES) {
    signal.throwIfAborted();
    const colorSpaceIndex = await colors.add(
      { kind: "name", value: resourceName },
      colorSpaceResources,
      signal
    );
    const description = colors.describe(colorSpaceIndex);
    const initialComponents = description.kind === "DeviceCMYK"
      ? [0, 0, 0, 1]
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
  }

  return (resourceName) => definitions.get(resourceName);
}

async function loadRetainedMarkedContentProperties(
  document: NativePdfDocument,
  resources: PdfDictionary,
  resourceNames: readonly string[],
  optionalContentResourceNames: readonly string[],
  alwaysVisibleNames: readonly string[],
  pageIndex: number,
  signal: AbortSignal
): Promise<ReadonlyMap<string, Readonly<DensePdfMarkedContentPropertyDefinition>> | undefined> {
  if (resourceNames.length === 0) return new Map();
  const alwaysVisible = new Set(alwaysVisibleNames);
  const optionalContentResources = new Set(optionalContentResourceNames);
  const rawProperties = resources.get("Properties");
  if (rawProperties === undefined || rawProperties === null) {
    if (optionalContentResources.size === 0) {
      // PDF.js tolerates unresolved generic marked-content properties. Passing
      // no resolver preserves that behavior; /OC properties remain strict
      // because they change visible paint.
      return undefined;
    }
    throw new PdfError(
      "invalid-object",
      "Retained text references /Properties but the page has no property resources.",
      { pageIndex, details: { reason: "retained-text-properties-missing" } }
    );
  }
  const properties = await document.resolveDictionary(rawProperties, signal);
  const definitions = new Map<
    string,
    Readonly<DensePdfMarkedContentPropertyDefinition>
  >();
  for (const resourceName of resourceNames) {
    signal.throwIfAborted();
    const rawValue = properties.get(resourceName);
    if (rawValue === undefined || rawValue === null) {
      if (!optionalContentResources.has(resourceName)) {
        definitions.set(resourceName, Object.freeze({
          resourceName,
          optionalContentIndex: -1,
          defaultVisible: true,
          mcid: -1
        }));
        continue;
      }
      throw new PdfError(
        "invalid-object",
        `Retained text property /${resourceName} is missing.`,
        {
          pageIndex,
          details: { reason: "retained-text-property-missing", resourceName }
        }
      );
    }
    const value = await document.resolveValue(rawValue, signal);
    if (!isPdfDictionary(value)) {
      throw new PdfError(
        "invalid-object",
        `Retained text property /${resourceName} is not a dictionary.`,
        {
          pageIndex,
          details: { reason: "retained-text-property-invalid", resourceName }
        }
      );
    }
    const mcidValue = await document.resolveValue(value.get("MCID"), signal);
    if (
      mcidValue !== undefined &&
      mcidValue !== null &&
      (!Number.isSafeInteger(mcidValue) || (mcidValue as number) < 0)
    ) {
      throw new PdfError(
        "invalid-object",
        `Retained text property /${resourceName} has an invalid /MCID.`,
        {
          pageIndex,
          details: { reason: "retained-text-property-mcid", resourceName }
        }
      );
    }
    definitions.set(resourceName, Object.freeze({
      resourceName,
      optionalContentIndex: -1,
      defaultVisible: true,
      mcid: (mcidValue as number | undefined | null) ?? -1
    }));
    if (alwaysVisible.has(resourceName)) alwaysVisible.delete(resourceName);
  }
  return definitions;
}

function readLimit<Key extends keyof PdfResourceLimits>(
  document: NativePdfDocument,
  options: NativeDenseRetainedTextCompileOptions,
  key: Key
): number {
  const documentLimit = document.limits[key];
  const requested = options.limits?.[key];
  if (requested === undefined) return documentLimit;
  if (!Number.isSafeInteger(requested) || requested <= 0) {
    throw new RangeError(`Native retained-text limit ${key} must be a positive safe integer.`);
  }
  return Math.min(documentLimit, requested);
}

function deduplicateDiagnostics(
  diagnostics: readonly PdfDiagnostic[]
): readonly PdfDiagnostic[] {
  const seen = new Set<string>();
  const result: PdfDiagnostic[] = [];
  for (const diagnostic of diagnostics) {
    const key = [
      diagnostic.code,
      diagnostic.severity,
      diagnostic.message,
      diagnostic.pageIndex ?? "",
      diagnostic.objectNumber ?? ""
    ].join("\u0000");
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(Object.freeze({ ...diagnostic }));
  }
  return Object.freeze(result);
}

function assertTextOnlyScene(scene: VectorScene, pageIndex: number): void {
  const nonTextPaint = scene.segmentCount + scene.fillPathCount +
    scene.fillSegmentCount + scene.gradientCount +
    scene.gradientFillPathCount + scene.gradientFillSegmentCount +
    scene.gradientStrokeRunCount + scene.gradientStrokeSegmentCount +
    scene.imagePaintOpCount + scene.pathCount + scene.rasterLayers.length +
    scene.rasterLayerData.length;
  if (nonTextPaint === 0) return;
  throw new PdfError(
    "unsupported-content",
    "Retained text produced non-text paint and cannot be merged with dense geometry.",
    { pageIndex, details: { reason: "retained-text-non-text-paint", nonTextPaint } }
  );
}

function normalizeCompileError(error: unknown, pageIndex: number): unknown {
  if (error instanceof PdfError) return error;
  if (error instanceof DensePdfResourceLimitError) {
    return new PdfError("resource-limit", error.message, {
      cause: error,
      pageIndex,
      details: {
        reason: "retained-text-resource-limit",
        ...(error.operator ? { operator: error.operator } : {})
      }
    });
  }
  if (error instanceof DensePdfUnsupportedError) {
    return new PdfError("unsupported-content", error.message, {
      cause: error,
      pageIndex,
      details: {
        reason: "retained-text-unsupported",
        ...(error.operator ? { operator: error.operator } : {})
      }
    });
  }
  if (error instanceof DensePdfSyntaxError) {
    return new PdfError("invalid-object", error.message, {
      cause: error,
      pageIndex,
      details: { reason: "retained-text-syntax" }
    });
  }
  return error;
}
