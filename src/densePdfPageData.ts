import {
  DENSE_PDF_PAINT_RUN_FILL,
  DENSE_PDF_PAINT_RUN_FORM,
  DENSE_PDF_PAINT_RUN_GRADIENT,
  DENSE_PDF_PAINT_RUN_GLYPH,
  DENSE_PDF_PAINT_RUN_IMAGE,
  DENSE_PDF_PAINT_RUN_PATTERN,
  DENSE_PDF_PAINT_RUN_PATH,
  DENSE_PDF_PAINT_RUN_STROKE,
  DensePdfResourceLimitError,
  DensePdfUnsupportedError,
  getDensePdfPaintSourceIdentity,
  type DensePdfBounds,
  type DensePdfCompositeState,
  type DensePdfCompiledPage,
  type DensePdfMatrix
} from "./pdf/nativeContentCompiler";
import {
  HEPR_COLOR_SPACE_KIND,
  HEPR_DOCUMENT_DATA_VERSION,
  HEPR_GLYPH_FLAG,
  HEPR_PAINT_KIND,
  HEPR_PATTERN_KIND,
  HEPR_PATH_FLAG,
  HEPR_PATH_VERB,
  HEPR_STROKE_FLAG,
  HEPR_VIEW_TRANSFORM_FLAG,
  createEmptyHeprDisplayProgram,
  createEmptyHeprPageStores,
  type HeprColorStore,
  type HeprCompositeGroup,
  type HeprDisplayCommand,
  type HeprFunctionStore,
  type HeprGradientStore,
  type HeprImageStore,
  type HeprMeshStore,
  type HeprOptionalContentStore,
  type HeprPatternStore,
  type HeprPageData,
  type HeprReusableProgram,
  type HeprTextIndex,
  type PdfDiagnostic,
  type PdfPageInfo
} from "./heprDocumentData";
import type { NativePageTextResources } from "./pdf/nativePageText";

const commandPaintSourceIdentities = new WeakMap<
  HeprDisplayCommand,
  readonly [sourceOffset: number, sourceLength: number]
>();

/** Reads transient compiler provenance without adding it to the display/HEP ABI. @internal */
export function getHeprCommandPaintSourceIdentity(
  command: HeprDisplayCommand
): readonly [sourceOffset: number, sourceLength: number] | null {
  return commandPaintSourceIdentities.get(command) ?? null;
}

export interface DensePdfPageDataOptions {
  /** Complete native glyph/text resources. Required when content contains text shows. */
  readonly text?: NativePageTextResources;
  /** Optional non-glyph text index, such as geometry-backed annotation text. */
  readonly textIndex?: HeprTextIndex;
  /** Parsed self-contained image, shading, and shared managed-color resources. */
  readonly images?: {
    readonly store: HeprImageStore;
    readonly colors: HeprColorStore;
    readonly functions: HeprFunctionStore;
    readonly gradients?: HeprGradientStore;
    readonly meshes?: HeprMeshStore;
  };
  readonly diagnostics?: readonly PdfDiagnostic[];
  /** Complete page-local membership table used by command optionalContentIndex values. */
  readonly optionalContent?: HeprOptionalContentStore;
  /** Specialized, self-contained Form programs and trailing annotation appearances. */
  readonly forms?: DensePdfFormPageData;
  /** Lazily resolved PatternType 1/2 resources and compiled tiling cells. */
  readonly patterns?: DensePdfPatternPageData;
  /** Lazily resolved Type3 CharProc programs referenced by visible page glyphs. */
  readonly type3?: DensePdfType3PageData;
  /** Soft-mask programs compiled from lazily referenced ExtGState resources. */
  readonly compositing?: DensePdfCompositingPageData;
  /** Final page-store ceilings, including glyph-backed text-clip references. */
  readonly limits?: {
    readonly maxPathResources: number;
    readonly maxPathVerbs: number;
    readonly maxPathCoordinates: number;
    readonly maxClipPaths: number;
  };
}

export interface DensePdfSoftMaskProgramData {
  /** Native ExtGState registry index captured in DensePdfCompositeState. */
  readonly extGStateIndex: number;
  /** Page-local reusable Form program containing the soft-mask `/G` stream. */
  readonly programIndex: number;
  readonly subtype: "Alpha" | "Luminosity";
  readonly isolated: boolean;
  readonly knockout: boolean;
  readonly blendingColorSpaceIndex: number;
  readonly backdropColor: readonly [number, number, number, number] | null;
  readonly transferFunctionIndex: number;
}

export interface DensePdfCompositingPageData {
  readonly softMasks: readonly DensePdfSoftMaskProgramData[];
}

export interface DensePdfFormProgramData {
  readonly compiled: DensePdfCompiledPage;
  /** Global page glyph-store offset for this program's local text compiler. */
  readonly glyphOffset: number;
  /** Program index for each Form paint in `compiled.formPaints` order. */
  readonly invocationProgramIndices: Uint32Array;
  readonly matrix: DensePdfMatrix;
  readonly bounds: readonly [number, number, number, number];
  readonly resourceName: string;
  readonly group?: {
    readonly isolated: boolean;
    readonly knockout: boolean;
    readonly alpha: number;
    readonly alphaIsShape: boolean;
    readonly blendMode: DensePdfCompositeState["blendMode"];
    readonly softMaskIndex: number;
    readonly blendingColorSpaceIndex: number;
  };
}

export interface DensePdfAnnotationProgramInvocation {
  readonly programIndex: number;
  readonly transform: DensePdfMatrix;
  readonly clipBounds: DensePdfBounds;
  readonly optionalContentIndex: number;
  /** HEPR view-transform bits retained for backend viewport compensation. */
  readonly viewTransformFlags: number;
}

export interface DensePdfFormPageData {
  /** Program index for each root-page Form paint in `compiled.formPaints` order. */
  readonly rootInvocationProgramIndices: Uint32Array;
  /** Array position is the page-local reusable-program index. */
  readonly programs: readonly DensePdfFormProgramData[];
  /** Visible appearances appended after page content in /Annots order. */
  readonly annotations: readonly DensePdfAnnotationProgramInvocation[];
}

export interface DensePdfPatternProgramData {
  readonly compiled: DensePdfCompiledPage;
  /** Global page glyph-store offset for text painted inside this cell. */
  readonly glyphOffset: number;
  /** Global Form program index for each Form paint in source order. */
  readonly invocationProgramIndices: Uint32Array;
  readonly patternIndex: number;
  readonly bounds: readonly [number, number, number, number];
  readonly resourceName: string;
  readonly colored: boolean;
}

export interface DensePdfPatternPageData {
  readonly store: HeprPatternStore;
  /** Six floats per pattern; store matrix indexes initially address this local array. */
  readonly matrices: Float32Array;
  /** Reusable tiling-cell programs in deterministic compilation order. */
  readonly programs: readonly DensePdfPatternProgramData[];
}

export interface DensePdfType3ProgramData {
  readonly compiled: DensePdfCompiledPage;
  /** Global page glyph-store offset for CharProc-internal paint text. */
  readonly glyphOffset: number;
  /** Global Form program index for each Form paint in source order. */
  readonly invocationProgramIndices: Uint32Array;
  /** FontMatrix normalized to the text engine's units-per-em convention. */
  readonly matrix: DensePdfMatrix;
  readonly bounds: readonly [number, number, number, number];
  readonly resourceName: string;
  readonly colored: boolean;
  /** Which CharProc path roles consume the invocation's current paint. */
  readonly inheritedPaintRole: "none" | "fill" | "stroke" | "both";
}

export interface DensePdfType3PageData {
  /** One local program index per glyph instance, or -1 for non-Type3/invisible glyphs. */
  readonly glyphProgramIndices: Int32Array;
  /** Array position is the local Type3 program index. */
  readonly programs: readonly DensePdfType3ProgramData[];
}

/**
 * Move the dense compiler's GPU-ready arrays into the page-native v7 ABI.
 *
 * No geometry is copied. The compiler must have run with
 * `preservePaintOrder: true`; otherwise a non-empty page is rejected rather
 * than grouped into a visually incorrect order.
 */
export function createHeprPageDataFromDense(
  pageInfo: Readonly<PdfPageInfo>,
  compiled: DensePdfCompiledPage,
  options: DensePdfPageDataOptions = {}
): HeprPageData {
  const resourceLimits = resolvePageDataResourceLimits(options.limits);
  if (compiled.textShowOpCount > 0 && !options.text) {
    throw new DensePdfUnsupportedError(
      "The page contains text but no native font/text compilation result was supplied."
    );
  }
  if (compiled.paintRuns.length % 3 !== 0) {
    throw new TypeError("Dense PDF paint runs must contain kind/start/count triples.");
  }
  const rootPaintRunCount = compiled.paintRuns.length / 3;
  if (
    compiled.paintRunOptionalContentIndices.length !== rootPaintRunCount ||
    compiled.paintRunMarkedContentIndices.length !== rootPaintRunCount ||
    compiled.paintRunClipIndices.length !== rootPaintRunCount ||
    compiled.paintRunCompositeStates.length !== rootPaintRunCount
  ) {
    throw new TypeError("Dense PDF paint-run scope metadata is inconsistent.");
  }
  if (
    compiled.paintRuns.length === 0 &&
    (compiled.segmentCount > 0 || compiled.fillPathCount > 0)
  ) {
    throw new DensePdfUnsupportedError(
      "Dense PDF geometry has no source-order trace; compile with preservePaintOrder enabled."
    );
  }

  const stores = createEmptyHeprPageStores();
  if (options.optionalContent) {
    if (options.optionalContent.names.length !== options.optionalContent.defaultVisible.length) {
      throw new TypeError("Optional-content names and visibility arrays have different lengths.");
    }
    stores.optionalContent = {
      names: Object.freeze([...options.optionalContent.names]),
      defaultVisible: options.optionalContent.defaultVisible
    };
  }
  stores.strokes.endpoints = compiled.endpoints;
  stores.strokes.primitiveMeta = compiled.primitiveMeta;
  stores.strokes.primitiveBounds = compiled.primitiveBounds;
  stores.strokes.styles = compiled.styles;
  stores.paths.fillPathMetaA = compiled.fillPathMetaA;
  stores.paths.fillPathMetaB = compiled.fillPathMetaB;
  stores.paths.fillPathMetaC = compiled.fillPathMetaC;
  stores.paths.fillSegmentsA = compiled.fillSegmentsA;
  stores.paths.fillSegmentsB = compiled.fillSegmentsB;
  const markedTags: string[] = [];
  const markedPropertyNames: Array<string | null> = [];
  const markedMcids: number[] = [];
  const markedParentIndices: number[] = [];
  const appendMarkedContent = (source: DensePdfCompiledPage): number => {
    const base = markedTags.length;
    for (let index = 0; index < source.markedContent.length; index += 1) {
      const node = source.markedContent[index];
      if (
        node.parentIndex < -1 || node.parentIndex >= index ||
        !Number.isSafeInteger(node.mcid) || node.mcid < -1
      ) {
        throw new TypeError("Dense PDF marked-content metadata is invalid.");
      }
      markedTags.push(node.tag);
      markedPropertyNames.push(node.propertyName);
      markedMcids.push(node.mcid);
      markedParentIndices.push(node.parentIndex < 0 ? -1 : base + node.parentIndex);
    }
    return base;
  };
  const rootMarkedContentOffset = appendMarkedContent(compiled);
  const formStrokeOffsets: number[] = [];
  const formFillOffsets: number[] = [];
  const formMarkedContentOffsets: number[] = [];
  for (const program of options.forms?.programs ?? []) {
    const formCompiled = program.compiled;
    const formPaintRunCount = formCompiled.paintRuns.length / 3;
    if (
      formCompiled.paintRuns.length % 3 !== 0 ||
      formCompiled.paintRunOptionalContentIndices.length !== formPaintRunCount ||
      formCompiled.paintRunMarkedContentIndices.length !== formPaintRunCount ||
      formCompiled.paintRunClipIndices.length !== formPaintRunCount ||
      formCompiled.paintRunCompositeStates.length !== formPaintRunCount
    ) {
      throw new TypeError(`Form XObject /${program.resourceName} has inconsistent scope metadata.`);
    }
    if (
      !Number.isSafeInteger(program.glyphOffset) || program.glyphOffset < 0 ||
      program.glyphOffset > (options.text?.glyphs.glyphIds.length ?? 0) ||
      (formCompiled.textShowOpCount > 0 && !options.text)
    ) {
      throw new TypeError(`Form XObject /${program.resourceName} has invalid text resources.`);
    }
    formStrokeOffsets.push(stores.strokes.endpoints.length / 4);
    formFillOffsets.push(stores.paths.fillPathMetaA.length / 4);
    formMarkedContentOffsets.push(appendMarkedContent(formCompiled));
    const fillSegmentOffset = stores.paths.fillSegmentsA.length / 4;
    stores.strokes.endpoints = concatFloat32(stores.strokes.endpoints, formCompiled.endpoints);
    stores.strokes.primitiveMeta = concatFloat32(
      stores.strokes.primitiveMeta,
      formCompiled.primitiveMeta
    );
    stores.strokes.primitiveBounds = concatFloat32(
      stores.strokes.primitiveBounds,
      formCompiled.primitiveBounds
    );
    stores.strokes.styles = concatFloat32(stores.strokes.styles, formCompiled.styles);
    stores.paths.fillPathMetaA = concatFloat32(
      stores.paths.fillPathMetaA,
      offsetFillSegmentStarts(formCompiled.fillPathMetaA, fillSegmentOffset)
    );
    stores.paths.fillPathMetaB = concatFloat32(
      stores.paths.fillPathMetaB,
      formCompiled.fillPathMetaB
    );
    stores.paths.fillPathMetaC = concatFloat32(
      stores.paths.fillPathMetaC,
      formCompiled.fillPathMetaC
    );
    stores.paths.fillSegmentsA = concatFloat32(
      stores.paths.fillSegmentsA,
      formCompiled.fillSegmentsA
    );
    stores.paths.fillSegmentsB = concatFloat32(
      stores.paths.fillSegmentsB,
      formCompiled.fillSegmentsB
    );
  }
  const type3StrokeOffsets: number[] = [];
  const type3FillOffsets: number[] = [];
  const type3MarkedContentOffsets: number[] = [];
  for (const program of options.type3?.programs ?? []) {
    const charProc = program.compiled;
    const paintRunCount = charProc.paintRuns.length / 3;
    if (
      charProc.paintRuns.length % 3 !== 0 ||
      charProc.paintRunOptionalContentIndices.length !== paintRunCount ||
      charProc.paintRunMarkedContentIndices.length !== paintRunCount ||
      charProc.paintRunClipIndices.length !== paintRunCount ||
      charProc.paintRunCompositeStates.length !== paintRunCount
    ) {
      throw new TypeError(`Type3 CharProc ${program.resourceName} has inconsistent scope metadata.`);
    }
    if (
      !Number.isSafeInteger(program.glyphOffset) || program.glyphOffset < 0 ||
      program.glyphOffset > (options.text?.glyphs.glyphIds.length ?? 0) ||
      (charProc.textShowOpCount > 0 && !options.text) ||
      program.invocationProgramIndices.length !== charProc.formPaints.length
    ) {
      throw new TypeError(`Type3 CharProc ${program.resourceName} has invalid nested resources.`);
    }
    type3StrokeOffsets.push(stores.strokes.endpoints.length / 4);
    type3FillOffsets.push(stores.paths.fillPathMetaA.length / 4);
    type3MarkedContentOffsets.push(appendMarkedContent(charProc));
    const fillSegmentOffset = stores.paths.fillSegmentsA.length / 4;
    stores.strokes.endpoints = concatFloat32(stores.strokes.endpoints, charProc.endpoints);
    stores.strokes.primitiveMeta = concatFloat32(stores.strokes.primitiveMeta, charProc.primitiveMeta);
    stores.strokes.primitiveBounds = concatFloat32(
      stores.strokes.primitiveBounds,
      charProc.primitiveBounds
    );
    stores.strokes.styles = concatFloat32(stores.strokes.styles, charProc.styles);
    stores.paths.fillPathMetaA = concatFloat32(
      stores.paths.fillPathMetaA,
      offsetFillSegmentStarts(charProc.fillPathMetaA, fillSegmentOffset)
    );
    stores.paths.fillPathMetaB = concatFloat32(stores.paths.fillPathMetaB, charProc.fillPathMetaB);
    stores.paths.fillPathMetaC = concatFloat32(stores.paths.fillPathMetaC, charProc.fillPathMetaC);
    stores.paths.fillSegmentsA = concatFloat32(stores.paths.fillSegmentsA, charProc.fillSegmentsA);
    stores.paths.fillSegmentsB = concatFloat32(stores.paths.fillSegmentsB, charProc.fillSegmentsB);
  }
  const patternStrokeOffsets: number[] = [];
  const patternFillOffsets: number[] = [];
  const patternMarkedContentOffsets: number[] = [];
  for (const program of options.patterns?.programs ?? []) {
    const patternCompiled = program.compiled;
    const paintRunCount = patternCompiled.paintRuns.length / 3;
    if (
      patternCompiled.paintRuns.length % 3 !== 0 ||
      patternCompiled.paintRunOptionalContentIndices.length !== paintRunCount ||
      patternCompiled.paintRunMarkedContentIndices.length !== paintRunCount ||
      patternCompiled.paintRunClipIndices.length !== paintRunCount ||
      patternCompiled.paintRunCompositeStates.length !== paintRunCount
    ) {
      throw new TypeError(`Pattern /${program.resourceName} has inconsistent scope metadata.`);
    }
    if (
      !Number.isSafeInteger(program.glyphOffset) || program.glyphOffset < 0 ||
      program.glyphOffset > (options.text?.glyphs.glyphIds.length ?? 0) ||
      (patternCompiled.textShowOpCount > 0 && !options.text) ||
      program.invocationProgramIndices.length !== patternCompiled.formPaints.length
    ) {
      throw new TypeError(`Pattern /${program.resourceName} has invalid nested resources.`);
    }
    patternStrokeOffsets.push(stores.strokes.endpoints.length / 4);
    patternFillOffsets.push(stores.paths.fillPathMetaA.length / 4);
    patternMarkedContentOffsets.push(appendMarkedContent(patternCompiled));
    const fillSegmentOffset = stores.paths.fillSegmentsA.length / 4;
    stores.strokes.endpoints = concatFloat32(stores.strokes.endpoints, patternCompiled.endpoints);
    stores.strokes.primitiveMeta = concatFloat32(
      stores.strokes.primitiveMeta,
      patternCompiled.primitiveMeta
    );
    stores.strokes.primitiveBounds = concatFloat32(
      stores.strokes.primitiveBounds,
      patternCompiled.primitiveBounds
    );
    stores.strokes.styles = concatFloat32(stores.strokes.styles, patternCompiled.styles);
    stores.paths.fillPathMetaA = concatFloat32(
      stores.paths.fillPathMetaA,
      offsetFillSegmentStarts(patternCompiled.fillPathMetaA, fillSegmentOffset)
    );
    stores.paths.fillPathMetaB = concatFloat32(
      stores.paths.fillPathMetaB,
      patternCompiled.fillPathMetaB
    );
    stores.paths.fillPathMetaC = concatFloat32(
      stores.paths.fillPathMetaC,
      patternCompiled.fillPathMetaC
    );
    stores.paths.fillSegmentsA = concatFloat32(
      stores.paths.fillSegmentsA,
      patternCompiled.fillSegmentsA
    );
    stores.paths.fillSegmentsB = concatFloat32(
      stores.paths.fillSegmentsB,
      patternCompiled.fillSegmentsB
    );
  }
  stores.markedContent = {
    tags: Object.freeze(markedTags),
    propertyNames: Object.freeze(markedPropertyNames),
    mcids: Int32Array.from(markedMcids),
    parentIndices: Int32Array.from(markedParentIndices)
  };
  if (options.text) {
    stores.transforms = options.text.transforms;
    stores.glyphs = options.text.glyphs;
    const type3ProgramBase = options.forms?.programs.length ?? 0;
    stores.fonts = {
      ...options.text.fonts,
      type3ProgramIndices: Int32Array.from(
        options.text.fonts.type3ProgramIndices,
        (index) => index < 0 ? -1 : type3ProgramBase + index
      )
    };
    stores.paths.pathVerbOffsets = options.text.outlinePaths.pathVerbOffsets;
    stores.paths.verbs = options.text.outlinePaths.verbs;
    stores.paths.verbCoordinateOffsets = options.text.outlinePaths.verbCoordinateOffsets;
    stores.paths.coordinates = options.text.outlinePaths.coordinates;
    stores.paths.bounds = options.text.outlinePaths.bounds;
    stores.paths.flags = options.text.outlinePaths.flags;
  }
  if (options.type3) {
    if (options.type3.glyphProgramIndices.length !== stores.glyphs.glyphIds.length) {
      throw new TypeError("Type3 glyph-program bindings do not match the glyph store.");
    }
    for (const index of options.type3.glyphProgramIndices) {
      if (index < -1 || index >= options.type3.programs.length) {
        throw new TypeError("A glyph references an invalid local Type3 program.");
      }
    }
  }
  if (options.images) {
    stores.images = options.images.store;
    stores.colors = options.images.colors;
    stores.functions = options.images.functions;
    if (options.images.gradients) stores.gradients = options.images.gradients;
    if (options.images.meshes) stores.meshes = options.images.meshes;
  }
  if (options.patterns) {
    const source = options.patterns.store;
    stores.patterns = {
      kinds: source.kinds,
      paintTypes: source.paintTypes,
      tilingTypes: source.tilingTypes,
      bounds: source.bounds,
      xSteps: source.xSteps,
      ySteps: source.ySteps,
      matrixIndices: source.matrixIndices.slice(),
      programIndices: source.programIndices.slice(),
      gradientIndices: source.gradientIndices,
      underlyingColorSpaceIndices: source.underlyingColorSpaceIndices
    };
  }
  const initialTransformValues = stores.transforms.values;
  if (compiled.imageTransforms.length > 0) {
    const values = new Float32Array(
      initialTransformValues.length + compiled.imageTransforms.length * 6
    );
    values.set(initialTransformValues);
    for (let index = 0; index < compiled.imageTransforms.length; index += 1) {
      values.set(compiled.imageTransforms[index], initialTransformValues.length + index * 6);
    }
    stores.transforms = { values };
  }
  if (options.patterns) {
    if (
      options.patterns.matrices.length !== stores.patterns.kinds.length * 6 ||
      options.patterns.matrices.some((value) => !Number.isFinite(value))
    ) {
      throw new TypeError("Pattern matrices are inconsistent with the pattern store.");
    }
    const matrixBase = stores.transforms.values.length / 6;
    stores.transforms = {
      values: concatFloat32(stores.transforms.values, options.patterns.matrices)
    };
    for (let index = 0; index < stores.patterns.matrixIndices.length; index += 1) {
      const local = stores.patterns.matrixIndices[index];
      if (local >= stores.patterns.kinds.length) {
        throw new TypeError(`Pattern ${index} references an invalid local matrix.`);
      }
      stores.patterns.matrixIndices[index] = matrixBase + local;
    }
  }
  const extraTransforms: number[] = [];
  const appendTransform = (matrix: DensePdfMatrix): number => {
    const index = stores.transforms.values.length / 6 + extraTransforms.length / 6;
    extraTransforms.push(...matrix);
    return index;
  };
  let identityTransformIndex = -1;
  for (let offset = 0; offset < stores.transforms.values.length; offset += 6) {
    const values = stores.transforms.values;
    if (
      values[offset] === 1 && values[offset + 1] === 0 && values[offset + 2] === 0 &&
      values[offset + 3] === 1 && values[offset + 4] === 0 && values[offset + 5] === 0
    ) {
      identityTransformIndex = offset / 6;
      break;
    }
  }
  if (identityTransformIndex < 0) {
    identityTransformIndex = appendTransform([1, 0, 0, 1, 0, 0]);
  }
  const pathVerbOffsets = [...stores.paths.pathVerbOffsets];
  const pathVerbs = [...stores.paths.verbs];
  const pathCoordinateOffsets = [...stores.paths.verbCoordinateOffsets];
  const pathCoordinates = [...stores.paths.coordinates];
  const pathBoundsValues = [...stores.paths.bounds];
  const pathFlags = [...stores.paths.flags];
  const sourceOutlinePathCount = pathVerbOffsets.length - 1;
  const clipParentIndices = [...stores.clips.parentIndices];
  const clipFirstPaths = [...stores.clips.firstPaths];
  const clipPathCounts = [...stores.clips.pathCounts];
  const clipFirstGlyphs = [...stores.clips.firstGlyphs];
  const clipGlyphCounts = [...stores.clips.glyphCounts];
  const clipFillRules = [...stores.clips.fillRules];
  const clipTransformIndices = [...stores.clips.transformIndices];
  if (sourceOutlinePathCount > resourceLimits.maxPathResources) {
    throw pageDataResourceLimit("paths", resourceLimits.maxPathResources);
  }
  if (pathVerbs.length > resourceLimits.maxPathVerbs) {
    throw pageDataResourceLimit("path verbs", resourceLimits.maxPathVerbs);
  }
  if (pathCoordinates.length > resourceLimits.maxPathCoordinates) {
    throw pageDataResourceLimit("path coordinates", resourceLimits.maxPathCoordinates);
  }
  if (clipParentIndices.length > resourceLimits.maxClipPaths) {
    throw pageDataResourceLimit("clips", resourceLimits.maxClipPaths);
  }
  interface CompiledPathResources {
    readonly pathIndices: readonly number[];
    readonly transformIndices: readonly number[];
    readonly clipIndices: readonly number[];
  }
  const compiledPathResources = new Map<DensePdfCompiledPage, CompiledPathResources>();
  const coveredClipGlyphs = new Uint8Array(stores.glyphs.glyphIds.length);
  const appendRawPath = (
    data: Float32Array,
    bounds: Readonly<DensePdfBounds>
  ): number => {
    const pathIndex = pathVerbOffsets.length - 1;
    if (pathIndex >= resourceLimits.maxPathResources) {
      throw pageDataResourceLimit("paths", resourceLimits.maxPathResources);
    }
    let closed = false;
    for (let offset = 0; offset < data.length;) {
      const sourceVerb = data[offset++];
      let targetVerb: number;
      let coordinateCount: number;
      if (sourceVerb === 0 || sourceVerb === 1) {
        targetVerb = sourceVerb;
        coordinateCount = 2;
      } else if (sourceVerb === 2) {
        targetVerb = HEPR_PATH_VERB.CubicTo;
        coordinateCount = 6;
      } else if (sourceVerb === 3) {
        targetVerb = HEPR_PATH_VERB.QuadraticTo;
        coordinateCount = 4;
      } else if (sourceVerb === 4) {
        targetVerb = HEPR_PATH_VERB.Close;
        coordinateCount = 0;
        closed = true;
      } else {
        throw new TypeError(`Dense PDF generic path contains invalid verb ${sourceVerb}.`);
      }
      if (offset + coordinateCount > data.length) {
        throw new TypeError("Dense PDF generic path ends inside a verb's coordinates.");
      }
      if (pathVerbs.length >= resourceLimits.maxPathVerbs) {
        throw pageDataResourceLimit("path verbs", resourceLimits.maxPathVerbs);
      }
      if (coordinateCount > resourceLimits.maxPathCoordinates - pathCoordinates.length) {
        throw pageDataResourceLimit(
          "path coordinates",
          resourceLimits.maxPathCoordinates
        );
      }
      pathVerbs.push(targetVerb);
      for (let index = 0; index < coordinateCount; index += 1) {
        const coordinate = data[offset++];
        if (!Number.isFinite(coordinate)) {
          throw new TypeError("Dense PDF generic path contains a non-finite coordinate.");
        }
        pathCoordinates.push(coordinate);
      }
      pathCoordinateOffsets.push(pathCoordinates.length);
    }
    if (
      !Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY) ||
      !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.maxY) ||
      bounds.maxX < bounds.minX || bounds.maxY < bounds.minY
    ) {
      throw new TypeError("Dense PDF generic path has invalid conservative bounds.");
    }
    pathVerbOffsets.push(pathVerbs.length);
    pathBoundsValues.push(bounds.minX, bounds.minY, bounds.maxX, bounds.maxY);
    pathFlags.push(closed ? HEPR_PATH_FLAG.Closed : 0);
    return pathIndex;
  };
  const validateGlyphClipSpan = (
    firstGlyph: number,
    glyphCount: number,
    glyphOffset: number
  ): number => {
    const globalFirst = glyphOffset + firstGlyph;
    if (
      !Number.isSafeInteger(firstGlyph) || firstGlyph < 0 ||
      !Number.isSafeInteger(glyphCount) || glyphCount <= 0 ||
      !Number.isSafeInteger(globalFirst) || globalFirst < 0 ||
      globalFirst > stores.glyphs.glyphIds.length - glyphCount
    ) {
      throw new TypeError("A text clip references an invalid glyph span.");
    }
    for (let glyphIndex = globalFirst; glyphIndex < globalFirst + glyphCount; glyphIndex += 1) {
      const flags = stores.glyphs.flags[glyphIndex];
      if ((flags & HEPR_GLYPH_FLAG.ClipOnly) === 0) {
        throw new TypeError("A text clip references a non-clipping glyph instance.");
      }
      if ((flags & HEPR_GLYPH_FLAG.Type3) !== 0) {
        throw new DensePdfUnsupportedError(
          "Type3 clipping text cannot be reduced to an exact outline."
        );
      }
      if (coveredClipGlyphs[glyphIndex] !== 0) {
        throw new TypeError("A clipping glyph instance belongs to more than one clip node.");
      }
      const fontIndex = stores.glyphs.fontIndices[glyphIndex];
      const glyphId = stores.glyphs.glyphIds[glyphIndex];
      const start = stores.fonts.glyphOffsets[fontIndex];
      const end = stores.fonts.glyphOffsets[fontIndex + 1];
      if (start === undefined || end === undefined || start > end) {
        throw new TypeError("A text clip glyph references an invalid font span.");
      }
      let low = start;
      let high = end;
      while (low < high) {
        const middle = low + ((high - low) >> 1);
        if (stores.fonts.glyphIds[middle] < glyphId) low = middle + 1;
        else high = middle;
      }
      if (low >= end || stores.fonts.glyphIds[low] !== glyphId) {
        throw new TypeError("A text clip glyph has no derived outline record.");
      }
      coveredClipGlyphs[glyphIndex] = 1;
    }
    return globalFirst;
  };
  const appendCompiledPaths = (
    source: DensePdfCompiledPage,
    glyphOffset: number
  ): CompiledPathResources => {
    const existing = compiledPathResources.get(source);
    if (existing) return existing;
    const pathIndices: number[] = [];
    const transformIndices: number[] = [];
    for (const path of source.pagePaths) {
      const transformIndex = appendTransform(path.transform);
      transformIndices.push(transformIndex);
      pathIndices.push(appendRawPath(path.data, path.bounds));
    }
    const clipIndices: number[] = [];
    for (let localIndex = 0; localIndex < source.clipPaths.length; localIndex += 1) {
      const clip = source.clipPaths[localIndex];
      const glyphClip = clip.firstGlyph !== undefined || clip.glyphCount !== undefined;
      if (
        clip.parentIndex < -1 || clip.parentIndex >= localIndex ||
        (clip.fillRule !== 0 && clip.fillRule !== 1) ||
        (glyphClip
          ? clip.pathIndex !== -1 || clip.fillRule !== 0 ||
            clip.firstGlyph === undefined || clip.glyphCount === undefined
          : clip.pathIndex < 0 || clip.pathIndex >= pathIndices.length ||
            clip.firstGlyph !== undefined || clip.glyphCount !== undefined)
      ) {
        throw new TypeError("Dense PDF persistent clip metadata is invalid.");
      }
      if (clipParentIndices.length >= resourceLimits.maxClipPaths) {
        throw pageDataResourceLimit("clips", resourceLimits.maxClipPaths);
      }
      const clipIndex = clipParentIndices.length;
      clipIndices.push(clipIndex);
      clipParentIndices.push(clip.parentIndex < 0 ? -1 : clipIndices[clip.parentIndex]);
      if (glyphClip) {
        clipFirstPaths.push(0);
        clipPathCounts.push(0);
        clipFirstGlyphs.push(validateGlyphClipSpan(
          clip.firstGlyph!,
          clip.glyphCount!,
          glyphOffset
        ));
        clipGlyphCounts.push(clip.glyphCount!);
      } else {
        clipFirstPaths.push(pathIndices[clip.pathIndex]);
        clipPathCounts.push(1);
        clipFirstGlyphs.push(0);
        clipGlyphCounts.push(0);
      }
      clipFillRules.push(clip.fillRule);
      clipTransformIndices.push(
        glyphClip ? identityTransformIndex : transformIndices[clip.pathIndex]
      );
    }
    const resources = Object.freeze({
      pathIndices: Object.freeze(pathIndices),
      transformIndices: Object.freeze(transformIndices),
      clipIndices: Object.freeze(clipIndices)
    });
    compiledPathResources.set(source, resources);
    return resources;
  };
  const appendRectClip = (bounds: DensePdfBounds, parentIndex = -1): number => {
    if (
      !Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY) ||
      !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.maxY) ||
      bounds.maxX < bounds.minX || bounds.maxY < bounds.minY ||
      parentIndex < -1 || parentIndex >= clipParentIndices.length
    ) {
      throw new TypeError("A PDF rectangular clip has invalid bounds.");
    }
    const data = Float32Array.of(
      0, bounds.minX, bounds.minY,
      1, bounds.maxX, bounds.minY,
      1, bounds.maxX, bounds.maxY,
      1, bounds.minX, bounds.maxY,
      4
    );
    if (clipParentIndices.length >= resourceLimits.maxClipPaths) {
      throw pageDataResourceLimit("clips", resourceLimits.maxClipPaths);
    }
    const pathIndex = appendRawPath(data, bounds);
    const clipIndex = clipParentIndices.length;
    clipParentIndices.push(parentIndex);
    clipFirstPaths.push(pathIndex);
    clipPathCounts.push(1);
    clipFirstGlyphs.push(0);
    clipGlyphCounts.push(0);
    clipFillRules.push(0);
    clipTransformIndices.push(0);
    pathFlags[pathIndex] |= HEPR_PATH_FLAG.Rectangle;
    return clipIndex;
  };

  appendCompiledPaths(compiled, 0);
  for (const program of options.forms?.programs ?? []) {
    appendCompiledPaths(program.compiled, program.glyphOffset);
  }
  for (const program of options.type3?.programs ?? []) {
    appendCompiledPaths(program.compiled, program.glyphOffset);
  }
  for (const program of options.patterns?.programs ?? []) {
    appendCompiledPaths(program.compiled, program.glyphOffset);
  }
  for (let glyphIndex = 0; glyphIndex < coveredClipGlyphs.length; glyphIndex += 1) {
    const clipping = (stores.glyphs.flags[glyphIndex] & HEPR_GLYPH_FLAG.ClipOnly) !== 0;
    if (clipping !== (coveredClipGlyphs[glyphIndex] !== 0)) {
      throw new TypeError("Clipping glyph instances and persistent text clips disagree.");
    }
  }

  const textRuns = new Map(
    (options.text?.runs ?? []).map((run) => [`${run.first}:${run.count}`, run] as const)
  );
  const colorParameters: number[] = [];
  const colorParameterOffsets: number[] = [0];
  const baseColorCount = stores.colors.spaceKinds.length;
  const colorKeys = new Map<string, number>();
  const paintKeys = new Map<string, number>();
  const paintKinds: number[] = [];
  const paintResourceIndices: number[] = [];
  const paintAlphas: number[] = [];
  const paintOverprint: number[] = [];
  const paintOverprintModes: number[] = [];
  const paintPatternTransformIndices: number[] = [];
  const paintPatternBasePaintIndices: number[] = [];
  const strokeLineWidths = [...stores.strokes.lineWidths];
  const strokeMiterLimits = [...stores.strokes.miterLimits];
  const strokeLineCaps = [...stores.strokes.lineCaps];
  const strokeLineJoins = [...stores.strokes.lineJoins];
  const strokeFlags = [...stores.strokes.flags];
  const strokeDashOffsets = [...stores.strokes.dashOffsets];
  const strokeDashValues = [...stores.strokes.dashValues];
  const strokeDashPhases = [...stores.strokes.dashPhases];
  const compositeGroups: HeprCompositeGroup[] = [];
  let glyphPaintIndex = 0;
  let pathPaintIndex = 0;
  let imageTransformIndex = 0;
  let shadingPaintIndex = 0;
  let patternPaintIndex = 0;
  let genericPathPaintCount = 0;
  let rootFormPaintCount = 0;

  const solidPaint = (
    rgba: readonly [number, number, number, number],
    composite?: Readonly<DensePdfCompositeState>
  ): number => {
    const colorKey = `${rgba[0]},${rgba[1]},${rgba[2]}`;
    let colorIndex = colorKeys.get(colorKey);
    if (colorIndex === undefined) {
      colorIndex = baseColorCount + colorKeys.size;
      colorKeys.set(colorKey, colorIndex);
      colorParameters.push(rgba[0], rgba[1], rgba[2]);
      colorParameterOffsets.push(colorParameters.length);
    }
    const overprint = composite?.overprint === true ? 1 : 0;
    const overprintMode = composite?.overprintMode ?? 0;
    const paintKey = `solid:${colorIndex}:${rgba[3]}:${overprint}:${overprintMode}`;
    const existing = paintKeys.get(paintKey);
    if (existing !== undefined) return existing;
    const paintIndex = paintKeys.size;
    paintKeys.set(paintKey, paintIndex);
    paintKinds.push(HEPR_PAINT_KIND.SolidColor);
    paintResourceIndices.push(colorIndex);
    paintAlphas.push(rgba[3]);
    paintOverprint.push(overprint);
    paintOverprintModes.push(overprintMode);
    paintPatternTransformIndices.push(-1);
    paintPatternBasePaintIndices.push(-1);
    return paintIndex;
  };
  const patternPaint = (
    paint: DensePdfCompiledPage["patternPaints"][number],
    composite: Readonly<DensePdfCompositeState>
  ): number => {
    if (
      paint.patternIndex < 0 || paint.patternIndex >= stores.patterns.kinds.length ||
      paint.transform.some((value) => !Number.isFinite(value))
    ) {
      throw new TypeError("Dense PDF pattern paint metadata is invalid.");
    }
    const patternKind = stores.patterns.kinds[paint.patternIndex];
    const uncolored = patternKind === HEPR_PATTERN_KIND.UncoloredTiling;
    if (uncolored !== (paint.baseColor !== null)) {
      throw new TypeError("Pattern base-color binding does not match its PaintType.");
    }
    const basePaintIndex = paint.baseColor === null
      ? -1
      : solidPaint(paint.baseColor.color);
    const overprint = composite.overprint ? 1 : 0;
    const overprintMode = composite.overprintMode;
    const paintKey = `pattern:${paint.patternIndex}:${paint.transform.join(",")}:` +
      `${basePaintIndex}:${overprint}:${overprintMode}`;
    const existing = paintKeys.get(paintKey);
    if (existing !== undefined) return existing;
    const paintIndex = paintKeys.size;
    paintKeys.set(paintKey, paintIndex);
    paintKinds.push(HEPR_PAINT_KIND.Pattern);
    paintResourceIndices.push(paint.patternIndex);
    paintAlphas.push(1);
    paintOverprint.push(overprint);
    paintOverprintModes.push(overprintMode);
    paintPatternTransformIndices.push(appendTransform(paint.transform));
    paintPatternBasePaintIndices.push(basePaintIndex);
    return paintIndex;
  };
  const appendGenericStrokeStyle = (
    style: NonNullable<DensePdfCompiledPage["genericPathPaints"][number]["strokeStyle"]>
  ): number => {
    if (
      !Number.isFinite(style.lineWidth) || style.lineWidth < 0 ||
      !Number.isFinite(style.miterLimit) || style.miterLimit < 1 ||
      !Number.isFinite(style.dashPhase) ||
      (style.lineCap !== 0 && style.lineCap !== 1 && style.lineCap !== 2) ||
      (style.lineJoin !== 0 && style.lineJoin !== 1 && style.lineJoin !== 2) ||
      style.dash.some((value) => !Number.isFinite(value) || value < 0) ||
      (style.dash.length > 0 && style.dash.every((value) => value === 0))
    ) {
      throw new TypeError("Dense PDF generic stroke style is invalid.");
    }
    const index = strokeLineWidths.length;
    strokeLineWidths.push(style.lineWidth);
    strokeMiterLimits.push(style.miterLimit);
    strokeLineCaps.push(style.lineCap);
    strokeLineJoins.push(style.lineJoin);
    strokeFlags.push(
      (style.hairline ? HEPR_STROKE_FLAG.Hairline : 0) |
      (style.strokeAdjust ? HEPR_STROKE_FLAG.StrokeAdjust : 0)
    );
    strokeDashValues.push(...style.dash);
    strokeDashOffsets.push(strokeDashValues.length);
    strokeDashPhases.push(style.dashPhase);
    return index;
  };
  const appendTextStrokeStyle = (
    state: DensePdfFormProgramData["compiled"]["glyphPaints"][number]["initialGraphicsState"]
  ): number => appendGenericStrokeStyle({
    lineWidth: state.lineWidth,
    lineCap: state.lineCap as 0 | 1 | 2,
    lineJoin: state.lineJoin ?? 0,
    miterLimit: state.miterLimit ?? 10,
    dash: state.lineDash,
    dashPhase: state.dashPhase,
    hairline: state.lineWidth === 0,
    strokeAdjust: state.strokeAdjustment ?? false
  });
  const glyphPaintResources = (
    paint: DensePdfFormProgramData["compiled"]["glyphPaints"][number],
    renderingMode: number,
    composite: Readonly<DensePdfCompositeState>
  ) => {
    if (renderingMode < 0 || renderingMode > 7) {
      throw new DensePdfUnsupportedError(
        `PDF text rendering mode ${renderingMode} is not representable without glyph clipping.`
      );
    }
    const state = paint.initialGraphicsState;
    const fillComposite: DensePdfCompositeState = Object.freeze({
      alpha: state.fillAlpha,
      alphaIsShape: composite.alphaIsShape,
      blendMode: composite.blendMode,
      softMaskIndex: composite.softMaskIndex,
      overprint: state.fillOverprint ?? false,
      overprintMode: state.overprintMode ?? 0
    });
    const strokeComposite: DensePdfCompositeState = Object.freeze({
      alpha: state.strokeAlpha,
      alphaIsShape: composite.alphaIsShape,
      blendMode: composite.blendMode,
      softMaskIndex: composite.softMaskIndex,
      overprint: state.strokeOverprint ?? false,
      overprintMode: state.overprintMode ?? 0
    });
    const fills = renderingMode === 0 || renderingMode === 2 ||
      renderingMode === 4 || renderingMode === 6;
    const strokes = renderingMode === 1 || renderingMode === 2 ||
      renderingMode === 5 || renderingMode === 6;
    return Object.freeze({
      fillPaintIndex: fills
        ? (paint.fillPaintInherited === true
            ? -1
            : solidPaint([
                paint.fill[0], paint.fill[1], paint.fill[2], fillComposite.alpha
              ], fillComposite))
        : -1,
      strokePaintIndex: strokes
        ? (paint.strokePaintInherited === true
            ? -1
            : solidPaint([
                paint.stroke[0], paint.stroke[1], paint.stroke[2], strokeComposite.alpha
              ], strokeComposite))
        : -1,
      strokeStyleIndex: strokes ? appendTextStrokeStyle(state) : -1,
      wrapperComposite: Object.freeze({
        alpha: 1,
        alphaIsShape: composite.alphaIsShape,
        blendMode: composite.blendMode,
        softMaskIndex: composite.softMaskIndex,
        overprint: false,
        overprintMode: 0
      }) satisfies DensePdfCompositeState
    });
  };
  const genericPathCommand = (
    source: DensePdfCompiledPage,
    paintIndex: number,
    commandState: {
      readonly transformIndex: number;
      readonly clipIndex: number;
      readonly optionalContentIndex: number;
      readonly markedContentIndex: number;
      readonly sourceOffset: number;
      readonly sourceLength: number;
    },
    composite: Readonly<DensePdfCompositeState>
  ): HeprDisplayCommand => {
    const paint = source.genericPathPaints[paintIndex];
    const resources = compiledPathResources.get(source);
    if (
      !paint || !resources || paint.pathIndex < 0 ||
      paint.pathIndex >= resources.pathIndices.length ||
      (paint.fillRule !== 0 && paint.fillRule !== 1) ||
      (paint.fill === null && paint.stroke === null) ||
      ((paint.stroke === null) !== (paint.strokeStyle === null))
    ) {
      throw new TypeError("Dense PDF generic path paint metadata is invalid.");
    }
    const fillPaintIndex = paint.fill === null
      ? -1
      : paint.fill.inheritType3Paint === true
        ? -1
        : solidPaint(paint.fill.color, composite);
    const strokePaintIndex = paint.stroke === null
      ? -1
      : paint.stroke.inheritType3Paint === true
        ? -1
        : solidPaint(paint.stroke.color, composite);
    return {
      kind: "draw",
      source: "paths",
      first: resources.pathIndices[paint.pathIndex],
      count: 1,
      ...commandState,
      transformIndex: resources.transformIndices[paint.pathIndex],
      fillPaintIndex,
      strokePaintIndex,
      ...(paint.fill?.inheritType3Paint === true ? { fillPaintInherited: true } : {}),
      ...(paint.stroke?.inheritType3Paint === true ? { strokePaintInherited: true } : {}),
      strokeStyleIndex: paint.strokeStyle === null
        ? -1
        : appendGenericStrokeStyle(paint.strokeStyle),
      fillRule: paint.fillRule
    };
  };
  const patternPathCommand = (
    source: DensePdfCompiledPage,
    paintIndex: number,
    commandState: {
      readonly transformIndex: number;
      readonly clipIndex: number;
      readonly optionalContentIndex: number;
      readonly markedContentIndex: number;
      readonly sourceOffset: number;
      readonly sourceLength: number;
    },
    composite: Readonly<DensePdfCompositeState>
  ): HeprDisplayCommand => {
    const paint = source.patternPaints[paintIndex];
    const resources = compiledPathResources.get(source);
    if (
      !paint || !resources || paint.pathIndex < 0 ||
      paint.pathIndex >= resources.pathIndices.length ||
      (paint.fillRule !== 0 && paint.fillRule !== 1) ||
      (paint.role !== "fill" && paint.role !== "stroke") ||
      ((paint.role === "stroke") !== (paint.strokeStyle !== null))
    ) {
      throw new TypeError("Dense PDF exact pattern-path metadata is invalid.");
    }
    const resourcePaintIndex = patternPaint(paint, composite);
    return {
      kind: "draw",
      source: "paths",
      first: resources.pathIndices[paint.pathIndex],
      count: 1,
      ...commandState,
      transformIndex: resources.transformIndices[paint.pathIndex],
      fillPaintIndex: paint.role === "fill" ? resourcePaintIndex : -1,
      strokePaintIndex: paint.role === "stroke" ? resourcePaintIndex : -1,
      strokeStyleIndex: paint.strokeStyle === null
        ? -1
        : appendGenericStrokeStyle(paint.strokeStyle),
      fillRule: paint.fillRule
    };
  };

  const softMaskDescriptions = new Map<number, Readonly<DensePdfSoftMaskProgramData>>();
  const softMaskGroupIndices = new Map<number, number>();
  for (const mask of options.compositing?.softMasks ?? []) {
    if (
      !Number.isSafeInteger(mask.extGStateIndex) || mask.extGStateIndex < 0 ||
      softMaskDescriptions.has(mask.extGStateIndex)
    ) {
      throw new TypeError("Soft-mask ExtGState indexes must be unique nonnegative integers.");
    }
    if (
      !Number.isSafeInteger(mask.programIndex) || mask.programIndex < 0 ||
      mask.programIndex >= (options.forms?.programs.length ?? 0)
    ) {
      throw new TypeError("A soft mask references an invalid reusable Form program.");
    }
    if (
      !Number.isSafeInteger(mask.transferFunctionIndex) || mask.transferFunctionIndex < -1 ||
      mask.transferFunctionIndex >= stores.functions.kinds.length
    ) {
      throw new TypeError("A soft mask references an invalid transfer function.");
    }
    if (
      !Number.isSafeInteger(mask.blendingColorSpaceIndex) ||
      mask.blendingColorSpaceIndex < -1 ||
      mask.blendingColorSpaceIndex >= stores.colors.spaceKinds.length
    ) {
      throw new TypeError("A soft mask references an invalid blending color space.");
    }
    const groupIndex = 1 + compositeGroups.length;
    softMaskDescriptions.set(mask.extGStateIndex, mask);
    softMaskGroupIndices.set(mask.extGStateIndex, groupIndex);
    compositeGroups.push({
      commands: [{
        kind: "invoke-program",
        transformIndex: 0,
        clipIndex: -1,
        optionalContentIndex: -1,
        markedContentIndex: -1,
        sourceOffset: -1,
        sourceLength: -1,
        programIndex: mask.programIndex,
        type3PaintIndex: -1,
        viewTransformFlags: 0
      }],
      isolated: mask.isolated,
      knockout: mask.knockout,
      blendMode: "Normal",
      alpha: 1,
      alphaIsShape: false,
      softMaskGroupIndex: -1,
      softMaskSubtype: null,
      softMaskTransferFunctionIndex: -1,
      backdropPaintIndex: mask.backdropColor === null
        ? -1
        : solidPaint(mask.backdropColor),
      blendingColorSpaceIndex: mask.blendingColorSpaceIndex,
      clipIndex: -1
    });
  }

  const commandScope = (
    source: DensePdfCompiledPage,
    paintRunIndex: number,
    markedContentOffset: number
  ) => {
    const optionalContentIndex = source.paintRunOptionalContentIndices[paintRunIndex];
    const localMarkedContentIndex = source.paintRunMarkedContentIndices[paintRunIndex];
    const localClipIndex = source.paintRunClipIndices[paintRunIndex];
    const pathResources = compiledPathResources.get(source);
    if (
      optionalContentIndex < -1 ||
      optionalContentIndex >= stores.optionalContent.names.length
    ) {
      throw new TypeError("Dense PDF paint run references invalid optional content.");
    }
    if (
      optionalContentIndex >= 0 &&
      stores.optionalContent.defaultVisible[optionalContentIndex] === 0
    ) {
      throw new TypeError("Hidden default-view optional content retained a draw command.");
    }
    if (
      localMarkedContentIndex < -1 ||
      localMarkedContentIndex >= source.markedContent.length
    ) {
      throw new TypeError("Dense PDF paint run references invalid marked content.");
    }
    if (
      !pathResources || localClipIndex < -1 ||
      localClipIndex >= pathResources.clipIndices.length
    ) {
      throw new TypeError("Dense PDF paint run references invalid persistent clip metadata.");
    }
    return {
      transformIndex: 0,
      clipIndex: localClipIndex < 0 ? -1 : pathResources.clipIndices[localClipIndex],
      optionalContentIndex,
      markedContentIndex: localMarkedContentIndex < 0
        ? -1
        : markedContentOffset + localMarkedContentIndex,
      sourceOffset: -1,
      sourceLength: -1
    };
  };

  const appendPaintCommand = (
    target: HeprDisplayCommand[],
    command: HeprDisplayCommand,
    composite: Readonly<DensePdfCompositeState>,
    overprintRepresented: boolean
  ): void => {
    if (composite.overprint && !overprintRepresented) {
      throw new DensePdfUnsupportedError(
        "Overprint for this PDF paint source is not represented by the page ABI."
      );
    }
    const softMaskGroupIndex = composite.softMaskIndex < 0
      ? -1
      : softMaskGroupIndices.get(composite.softMaskIndex) ?? -1;
    if (composite.softMaskIndex >= 0 && softMaskGroupIndex < 0) {
      throw new DensePdfUnsupportedError(
        `PDF soft mask ${composite.softMaskIndex} has no compiled soft-mask group.`
      );
    }
    if (
      composite.alpha === 1 && composite.blendMode === "Normal" &&
      softMaskGroupIndex < 0
    ) {
      target.push(command);
      return;
    }
    const scopedCommand: HeprDisplayCommand = {
      ...command,
      clipIndex: -1,
      optionalContentIndex: -1,
      markedContentIndex: -1
    };
    const groupIndex = 1 + compositeGroups.length;
    compositeGroups.push({
      commands: [scopedCommand],
      isolated: false,
      knockout: false,
      blendMode: composite.blendMode,
      alpha: composite.alpha,
      alphaIsShape: composite.alphaIsShape,
      softMaskGroupIndex,
      softMaskSubtype: composite.softMaskIndex < 0
        ? null
        : softMaskDescriptions.get(composite.softMaskIndex)!.subtype,
      softMaskTransferFunctionIndex: composite.softMaskIndex < 0
        ? -1
        : softMaskDescriptions.get(composite.softMaskIndex)!.transferFunctionIndex,
      backdropPaintIndex: -1,
      blendingColorSpaceIndex: -1,
      clipIndex: -1
    });
    target.push({
      kind: "invoke-group",
      transformIndex: 0,
      clipIndex: command.clipIndex,
      optionalContentIndex: command.optionalContentIndex,
      markedContentIndex: command.markedContentIndex,
      sourceOffset: command.sourceOffset,
      sourceLength: command.sourceLength,
      groupIndex
    });
  };

  const commands: HeprDisplayCommand[] = [];
  for (let offset = 0; offset < compiled.paintRuns.length; offset += 3) {
    const paintRunIndex = offset / 3;
    const commandStart = commands.length;
    const sourceIdentity = getDensePdfPaintSourceIdentity(compiled, paintRunIndex);
    const kind = compiled.paintRuns[offset];
    const first = compiled.paintRuns[offset + 1];
    const count = compiled.paintRuns[offset + 2];
    if (count === 0) continue;
    const limit = kind === DENSE_PDF_PAINT_RUN_STROKE
      ? compiled.segmentCount
      : kind === DENSE_PDF_PAINT_RUN_FILL
        ? compiled.fillPathCount
        : kind === DENSE_PDF_PAINT_RUN_GLYPH
          ? options.text?.glyphs.glyphIds.length ?? -1
          : kind === DENSE_PDF_PAINT_RUN_IMAGE
            ? options.images?.store.widths.length ?? -1
            : kind === DENSE_PDF_PAINT_RUN_FORM
              ? compiled.formPaints.length
              : kind === DENSE_PDF_PAINT_RUN_GRADIENT
                ? stores.gradients.kinds.length
                : kind === DENSE_PDF_PAINT_RUN_PATTERN
                  ? stores.patterns.kinds.length
                  : kind === DENSE_PDF_PAINT_RUN_PATH
                    ? compiled.genericPathPaints.length
                    : -1;
    if (limit < 0 || first + count > limit) {
      throw new TypeError(
        `Dense PDF paint run ${offset / 3} references an invalid store range.`
      );
    }
    const commandState = commandScope(compiled, paintRunIndex, rootMarkedContentOffset);
    const composite = compiled.paintRunCompositeStates[paintRunIndex];
    if (!composite) throw new TypeError("Dense PDF paint run has no composite state.");
    const base = { kind: "draw" as const, first, count, ...commandState };
    if (kind === DENSE_PDF_PAINT_RUN_GLYPH) {
      const textRun = textRuns.get(`${first}:${count}`);
      const paint = compiled.glyphPaints[glyphPaintIndex++];
      if (!textRun || !paint || paint.renderingMode !== textRun.renderingMode) {
        throw new TypeError("Dense PDF glyph paint order does not match the native text result.");
      }
      const paintResources = glyphPaintResources(paint, textRun.renderingMode, composite);
      const type3FillPaintIndex = textRun.renderingMode === 0
        ? solidPaint(paint.fill, composite)
        : -1;
      let ordinaryStart = -1;
      const flushOrdinary = (end: number): void => {
        if (ordinaryStart < 0) return;
        const command: HeprDisplayCommand = {
          ...base,
          first: ordinaryStart,
          count: end - ordinaryStart,
          source: "glyphs",
          fillPaintIndex: paintResources.fillPaintIndex,
          strokePaintIndex: paintResources.strokePaintIndex,
          strokeStyleIndex: paintResources.strokeStyleIndex,
          renderingMode: textRun.renderingMode
        };
        if (textRun.renderingMode !== 3 && textRun.renderingMode !== 7) {
          appendPaintCommand(commands, command, paintResources.wrapperComposite, true);
        }
        else commands.push(command);
        ordinaryStart = -1;
      };
      for (let glyphIndex = first; glyphIndex < first + count; glyphIndex += 1) {
        const isType3 = (stores.glyphs.flags[glyphIndex] & HEPR_GLYPH_FLAG.Type3) !== 0;
        if (!isType3) {
          if (ordinaryStart < 0) ordinaryStart = glyphIndex;
          continue;
        }
        flushOrdinary(glyphIndex);
        // Invisible OCR text remains searchable but must not decode or execute
        // a CharProc merely to represent its geometry.
        if (textRun.renderingMode === 3) continue;
        if (textRun.renderingMode >= 4) {
          throw new DensePdfUnsupportedError(
            `Type3 text rendering mode ${textRun.renderingMode} cannot be reduced to an exact clipping outline.`
          );
        }
        if (textRun.renderingMode !== 0) {
          throw new DensePdfUnsupportedError(
            `Type3 text rendering mode ${textRun.renderingMode} requires CharProc stroke-mode integration.`
          );
        }
        const localProgramIndex = options.type3?.glyphProgramIndices[glyphIndex];
        if (localProgramIndex === undefined || localProgramIndex < 0) {
          throw new DensePdfUnsupportedError(
            `Visible Type3 glyph ${glyphIndex} has no compiled CharProc program.`
          );
        }
        const program = options.type3?.programs[localProgramIndex];
        if (!program) {
          throw new DensePdfUnsupportedError(
            `Visible Type3 glyph ${glyphIndex} references an invalid CharProc program.`
          );
        }
        const inheritedState = paint.initialGraphicsState;
        const inheritedComposite = (
          role: "fill" | "stroke"
        ): Readonly<DensePdfCompositeState> => Object.freeze({
          alpha: role === "fill"
            ? inheritedState.fillAlpha
            : inheritedState.strokeAlpha,
          alphaIsShape: inheritedState.alphaIsShape ?? false,
          blendMode: inheritedState.blendMode ?? "Normal",
          softMaskIndex: inheritedState.softMaskIndex ?? -1,
          overprint: role === "fill"
            ? inheritedState.fillOverprint ?? false
            : inheritedState.strokeOverprint ?? false,
          overprintMode: inheritedState.overprintMode ?? 0
        });
        let type3PaintIndex = -1;
        if (program.inheritedPaintRole === "fill") {
          type3PaintIndex = type3FillPaintIndex;
        } else if (program.inheritedPaintRole === "stroke") {
          type3PaintIndex = solidPaint(paint.stroke, inheritedComposite("stroke"));
        } else if (program.inheritedPaintRole === "both") {
          const sameColor = paint.fill.every((value, index) => value === paint.stroke[index]);
          const sameOverprint = (inheritedState.fillOverprint ?? false) ===
            (inheritedState.strokeOverprint ?? false);
          if (!sameColor || !sameOverprint) {
            throw new DensePdfUnsupportedError(
              "A Type3 CharProc inherits distinct stroking and nonstroking paints, which the single-paint invocation ABI cannot represent."
            );
          }
          type3PaintIndex = type3FillPaintIndex;
        }
        const command: HeprDisplayCommand = {
          kind: "invoke-program",
          ...commandState,
          transformIndex: stores.glyphs.transformIndices[glyphIndex],
          programIndex: (options.forms?.programs.length ?? 0) + localProgramIndex,
          type3PaintIndex,
          viewTransformFlags: 0
        };
        // The specialized CharProc program already contains the inherited
        // alpha/blend/soft-mask/overprint state on each source paint. Wrapping
        // the invocation here would apply it twice.
        commands.push(command);
      }
      flushOrdinary(first + count);
    } else if (kind === DENSE_PDF_PAINT_RUN_PATH) {
      if (count !== 1 || first !== genericPathPaintCount) {
        throw new TypeError("Dense PDF generic path runs must reference one source paint.");
      }
      appendPaintCommand(
        commands,
        genericPathCommand(compiled, first, commandState, composite),
        composite,
        true
      );
      genericPathPaintCount += 1;
    } else if (kind === DENSE_PDF_PAINT_RUN_IMAGE) {
      const imagePaint = compiled.imagePaints[imageTransformIndex];
      if (
        count !== 1 || imageTransformIndex >= compiled.imageTransforms.length ||
        !imagePaint
      ) {
        throw new TypeError("Dense PDF image paint metadata is inconsistent.");
      }
      const imageMask = stores.images.imageMask[first] !== 0;
      const command: HeprDisplayCommand = {
        ...base,
        source: "images",
        paintIndex: imageMask ? solidPaint(imagePaint.color, composite) : -1,
        transformIndex: initialTransformValues.length / 6 + imageTransformIndex,
        sourceOffset: imagePaint.sourceOffset,
        sourceLength: imagePaint.sourceLength
      };
      appendPaintCommand(commands, command, composite, imageMask);
      imageTransformIndex += 1;
    } else if (kind === DENSE_PDF_PAINT_RUN_FORM) {
      const formPaint = compiled.formPaints[first];
      const programIndex = options.forms?.rootInvocationProgramIndices[first];
      if (
        count !== 1 || !formPaint || programIndex === undefined ||
        !Number.isSafeInteger(programIndex) || programIndex < 0 ||
        programIndex >= (options.forms?.programs.length ?? 0)
      ) {
        throw new TypeError("Dense PDF root Form paint metadata is inconsistent.");
      }
      const command: HeprDisplayCommand = {
        kind: "invoke-program",
        ...commandState,
        transformIndex: appendTransform(formPaint.transform),
        programIndex,
        type3PaintIndex: -1,
        viewTransformFlags: 0
      };
      commands.push(command);
      rootFormPaintCount += 1;
    } else if (kind === DENSE_PDF_PAINT_RUN_GRADIENT) {
      const shadingPaint = compiled.shadingPaints[shadingPaintIndex];
      if (
        count !== 1 || !shadingPaint || shadingPaint.gradientIndex !== first ||
        first >= stores.gradients.kinds.length
      ) {
        throw new TypeError("Dense PDF shading paint metadata is inconsistent.");
      }
      const command: HeprDisplayCommand = {
        ...base,
        source: "gradients",
        transformIndex: appendTransform(shadingPaint.transform)
      };
      appendPaintCommand(commands, command, composite, false);
      shadingPaintIndex += 1;
    } else if (kind === DENSE_PDF_PAINT_RUN_PATTERN) {
      const sourcePaint = compiled.patternPaints[patternPaintIndex];
      if (
        count !== 1 || !sourcePaint || sourcePaint.patternIndex !== first ||
        first >= stores.patterns.kinds.length
      ) {
        throw new TypeError("Dense PDF pattern paint metadata is inconsistent.");
      }
      appendPaintCommand(
        commands,
        patternPathCommand(compiled, patternPaintIndex, commandState, composite),
        composite,
        true
      );
      patternPaintIndex += 1;
    } else {
      const paint = compiled.pathPaints[pathPaintIndex++];
      if (!paint) {
        throw new TypeError("Dense PDF path paint metadata is inconsistent.");
      }
      const command: HeprDisplayCommand = {
        ...base,
        source: kind === DENSE_PDF_PAINT_RUN_STROKE
          ? "stroke-segments"
          : "fill-paths",
        paintIndex: solidPaint(paint.color, composite)
      };
      appendPaintCommand(commands, command, composite, true);
    }
    if (sourceIdentity) {
      for (let commandIndex = commandStart; commandIndex < commands.length; commandIndex += 1) {
        commandPaintSourceIdentities.set(commands[commandIndex], sourceIdentity);
      }
    }
  }
  if (glyphPaintIndex !== compiled.glyphPaints.length) {
    throw new TypeError("Dense PDF glyph paint metadata contains unreferenced entries.");
  }
  if (
    imageTransformIndex !== compiled.imageTransforms.length ||
    imageTransformIndex !== compiled.imagePaints.length
  ) {
    throw new TypeError("Dense PDF image paint metadata contains unreferenced entries.");
  }
  if (pathPaintIndex !== compiled.pathPaints.length) {
    throw new TypeError("Dense PDF path paint metadata contains unreferenced entries.");
  }
  if (rootFormPaintCount !== compiled.formPaints.length) {
    throw new TypeError("Dense PDF root Form paint metadata contains unreferenced entries.");
  }
  if (shadingPaintIndex !== compiled.shadingPaints.length) {
    throw new TypeError("Dense PDF shading paint metadata contains unreferenced entries.");
  }
  if (patternPaintIndex !== compiled.patternPaints.length) {
    throw new TypeError("Dense PDF pattern paint metadata contains unreferenced entries.");
  }
  if (genericPathPaintCount !== compiled.genericPathPaints.length) {
    throw new TypeError("Dense PDF generic path paint metadata contains unreferenced entries.");
  }

  const reusablePrograms: HeprReusableProgram[] = [];
  const appendReusableGlyphCommands = (
    target: HeprDisplayCommand[],
    glyphOffset: number,
    first: number,
    count: number,
    paint: DensePdfCompiledPage["glyphPaints"][number],
    composite: Readonly<DensePdfCompositeState>,
    commandState: ReturnType<typeof commandScope>,
    ownerLabel: string
  ): void => {
    const globalFirst = glyphOffset + first;
    const textRun = textRuns.get(`${globalFirst}:${count}`);
    if (
      !textRun || paint.renderingMode !== textRun.renderingMode ||
      globalFirst + count > stores.glyphs.glyphIds.length
    ) {
      throw new TypeError(`${ownerLabel} has inconsistent glyph metadata.`);
    }
    const paintResources = glyphPaintResources(paint, textRun.renderingMode, composite);
    let ordinaryStart = -1;
    const flushOrdinary = (end: number): void => {
      if (ordinaryStart < 0) return;
      const command: HeprDisplayCommand = {
        kind: "draw",
        ...commandState,
        source: "glyphs",
        first: ordinaryStart,
        count: end - ordinaryStart,
        fillPaintIndex: paintResources.fillPaintIndex,
        strokePaintIndex: paintResources.strokePaintIndex,
        strokeStyleIndex: paintResources.strokeStyleIndex,
        renderingMode: textRun.renderingMode
      };
      if (textRun.renderingMode === 3 || textRun.renderingMode === 7) target.push(command);
      else appendPaintCommand(target, command, paintResources.wrapperComposite, true);
      ordinaryStart = -1;
    };
    for (let glyphIndex = globalFirst; glyphIndex < globalFirst + count; glyphIndex += 1) {
      if ((stores.glyphs.flags[glyphIndex] & HEPR_GLYPH_FLAG.Type3) === 0) {
        if (ordinaryStart < 0) ordinaryStart = glyphIndex;
        continue;
      }
      flushOrdinary(glyphIndex);
      if (textRun.renderingMode === 3) continue;
      if (textRun.renderingMode >= 4) {
        throw new DensePdfUnsupportedError(
          `${ownerLabel} uses Type3 clipping text mode ${textRun.renderingMode}.`
        );
      }
      if (textRun.renderingMode !== 0) {
        throw new DensePdfUnsupportedError(
          `${ownerLabel} uses Type3 stroke text mode ${textRun.renderingMode}.`
        );
      }
      const localProgramIndex = options.type3?.glyphProgramIndices[glyphIndex];
      const program = localProgramIndex === undefined || localProgramIndex < 0
        ? undefined
        : options.type3?.programs[localProgramIndex];
      if (!program) {
        throw new DensePdfUnsupportedError(
          `${ownerLabel} has a visible Type3 glyph without a compiled CharProc.`
        );
      }
      const resolvedLocalProgramIndex = localProgramIndex as number;
      const inheritedState = paint.initialGraphicsState;
      const inheritedComposite = (
        role: "fill" | "stroke"
      ): Readonly<DensePdfCompositeState> => Object.freeze({
        alpha: role === "fill" ? inheritedState.fillAlpha : inheritedState.strokeAlpha,
        alphaIsShape: inheritedState.alphaIsShape ?? false,
        blendMode: inheritedState.blendMode ?? "Normal",
        softMaskIndex: inheritedState.softMaskIndex ?? -1,
        overprint: role === "fill"
          ? inheritedState.fillOverprint ?? false
          : inheritedState.strokeOverprint ?? false,
        overprintMode: inheritedState.overprintMode ?? 0
      });
      const inheritedPaint = (role: "fill" | "stroke"): number => {
        const lateBound = role === "fill"
          ? paint.fillPaintInherited === true
          : paint.strokePaintInherited === true;
        if (lateBound) return -1;
        const color = role === "fill" ? paint.fill : paint.stroke;
        return solidPaint(color, inheritedComposite(role));
      };
      let type3PaintIndex = -1;
      if (program.inheritedPaintRole === "fill") {
        type3PaintIndex = inheritedPaint("fill");
      } else if (program.inheritedPaintRole === "stroke") {
        type3PaintIndex = inheritedPaint("stroke");
      } else if (program.inheritedPaintRole === "both") {
        const bothLateBound = paint.fillPaintInherited === true &&
          paint.strokePaintInherited === true;
        if (!bothLateBound) {
          const sameColor = paint.fill.every((value, index) => value === paint.stroke[index]);
          const sameOverprint = (inheritedState.fillOverprint ?? false) ===
            (inheritedState.strokeOverprint ?? false);
          if (
            paint.fillPaintInherited !== paint.strokePaintInherited ||
            !sameColor || !sameOverprint
          ) {
            throw new DensePdfUnsupportedError(
              `${ownerLabel} supplies distinct fill and stroke paints to one Type3 CharProc.`
            );
          }
        }
        type3PaintIndex = bothLateBound ? -1 : inheritedPaint("fill");
      }
      target.push({
        kind: "invoke-program",
        ...commandState,
        transformIndex: stores.glyphs.transformIndices[glyphIndex],
        programIndex: (options.forms?.programs.length ?? 0) + resolvedLocalProgramIndex,
        type3PaintIndex,
        viewTransformFlags: 0
      });
    }
    flushOrdinary(globalFirst + count);
  };
  for (let programIndex = 0; programIndex < (options.forms?.programs.length ?? 0); programIndex += 1) {
    const program = options.forms!.programs[programIndex];
    const formCompiled = program.compiled;
    if (formCompiled.paintRuns.length % 3 !== 0) {
      throw new TypeError(`Form program ${programIndex} has an invalid paint-order trace.`);
    }
    const formCommands: HeprDisplayCommand[] = [];
    let formGlyphPaintIndex = 0;
    let formPathPaintIndex = 0;
    let formImagePaintIndex = 0;
    let formShadingPaintIndex = 0;
    let formPatternPaintIndex = 0;
    let formGenericPathPaintCount = 0;
    let formInvocationCount = 0;
    for (let offset = 0; offset < formCompiled.paintRuns.length; offset += 3) {
      const paintRunIndex = offset / 3;
      const kind = formCompiled.paintRuns[offset];
      const first = formCompiled.paintRuns[offset + 1];
      const count = formCompiled.paintRuns[offset + 2];
      if (count === 0) continue;
      const commandState = commandScope(
        formCompiled,
        paintRunIndex,
        formMarkedContentOffsets[programIndex]
      );
      const composite = formCompiled.paintRunCompositeStates[paintRunIndex];
      if (!composite) throw new TypeError(`Form program ${programIndex} has no composite state.`);
      if (kind === DENSE_PDF_PAINT_RUN_STROKE || kind === DENSE_PDF_PAINT_RUN_FILL) {
        const limit = kind === DENSE_PDF_PAINT_RUN_STROKE
          ? formCompiled.segmentCount
          : formCompiled.fillPathCount;
        if (first + count > limit) {
          throw new TypeError(`Form program ${programIndex} references invalid vector geometry.`);
        }
        const paint = formCompiled.pathPaints[formPathPaintIndex++];
        if (!paint) throw new TypeError(`Form program ${programIndex} has inconsistent paint metadata.`);
        const command: HeprDisplayCommand = {
          kind: "draw",
          ...commandState,
          source: kind === DENSE_PDF_PAINT_RUN_STROKE
            ? "stroke-segments"
            : "fill-paths",
          first: first + (kind === DENSE_PDF_PAINT_RUN_STROKE
            ? formStrokeOffsets[programIndex]
            : formFillOffsets[programIndex]),
          count,
          paintIndex: paint.inheritType3Paint === true
            ? -1
            : solidPaint(paint.color, composite)
        };
        appendPaintCommand(formCommands, command, composite, true);
      } else if (kind === DENSE_PDF_PAINT_RUN_PATH) {
        if (count !== 1 || first !== formGenericPathPaintCount) {
          throw new TypeError(`Form program ${programIndex} has inconsistent generic path metadata.`);
        }
        appendPaintCommand(
          formCommands,
          genericPathCommand(formCompiled, first, commandState, composite),
          composite,
          true
        );
        formGenericPathPaintCount += 1;
      } else if (kind === DENSE_PDF_PAINT_RUN_GLYPH) {
        const paint = formCompiled.glyphPaints[formGlyphPaintIndex++];
        if (!paint) {
          throw new TypeError(`Form program ${programIndex} has inconsistent glyph metadata.`);
        }
        appendReusableGlyphCommands(
          formCommands,
          program.glyphOffset,
          first,
          count,
          paint,
          composite,
          commandState,
          `Form program ${programIndex}`
        );
      } else if (kind === DENSE_PDF_PAINT_RUN_IMAGE) {
        const imagePaint = formCompiled.imagePaints[formImagePaintIndex];
        const transform = formCompiled.imageTransforms[formImagePaintIndex];
        if (
          count !== 1 || !imagePaint || !transform ||
          first >= stores.images.widths.length
        ) {
          throw new TypeError(`Form program ${programIndex} has inconsistent image metadata.`);
        }
        const imageMask = stores.images.imageMask[first] !== 0;
        const command: HeprDisplayCommand = {
          kind: "draw",
          ...commandState,
          source: "images",
          first,
          count,
          paintIndex: imageMask
            ? (imagePaint.inheritType3Paint === true
                ? -1
                : solidPaint(imagePaint.color, composite))
            : -1,
          transformIndex: appendTransform(transform),
          sourceOffset: imagePaint.sourceOffset,
          sourceLength: imagePaint.sourceLength
        };
        appendPaintCommand(formCommands, command, composite, imageMask);
        formImagePaintIndex += 1;
      } else if (kind === DENSE_PDF_PAINT_RUN_GRADIENT) {
        const shadingPaint = formCompiled.shadingPaints[formShadingPaintIndex];
        if (
          count !== 1 || !shadingPaint || shadingPaint.gradientIndex !== first ||
          first >= stores.gradients.kinds.length
        ) {
          throw new TypeError(`Form program ${programIndex} has inconsistent shading metadata.`);
        }
        const command: HeprDisplayCommand = {
          kind: "draw",
          ...commandState,
          source: "gradients",
          first,
          count,
          transformIndex: appendTransform(shadingPaint.transform)
        };
        appendPaintCommand(formCommands, command, composite, false);
        formShadingPaintIndex += 1;
      } else if (kind === DENSE_PDF_PAINT_RUN_FORM) {
        const formPaint = formCompiled.formPaints[first];
        const nestedProgramIndex = program.invocationProgramIndices[first];
        if (
          count !== 1 || !formPaint || nestedProgramIndex === undefined ||
          nestedProgramIndex < 0 || nestedProgramIndex >= options.forms!.programs.length
        ) {
          throw new TypeError(`Form program ${programIndex} has inconsistent nested Form metadata.`);
        }
        const command: HeprDisplayCommand = {
          kind: "invoke-program",
          ...commandState,
          transformIndex: appendTransform(formPaint.transform),
          programIndex: nestedProgramIndex,
          type3PaintIndex: -1,
          viewTransformFlags: 0
        };
        formCommands.push(command);
        formInvocationCount += 1;
      } else if (kind === DENSE_PDF_PAINT_RUN_PATTERN) {
        const sourcePaint = formCompiled.patternPaints[formPatternPaintIndex];
        if (
          count !== 1 || !sourcePaint || sourcePaint.patternIndex !== first ||
          first >= stores.patterns.kinds.length
        ) {
          throw new TypeError(`Form program ${programIndex} has inconsistent pattern metadata.`);
        }
        appendPaintCommand(
          formCommands,
          patternPathCommand(
            formCompiled,
            formPatternPaintIndex,
            commandState,
            composite
          ),
          composite,
          true
        );
        formPatternPaintIndex += 1;
      } else {
        throw new DensePdfUnsupportedError(
          `Form XObject /${program.resourceName} contains a paint kind that is not integrated.`
        );
      }
    }
    if (
      formPathPaintIndex !== formCompiled.pathPaints.length ||
      formGlyphPaintIndex !== formCompiled.glyphPaints.length ||
      formImagePaintIndex !== formCompiled.imagePaints.length ||
      formImagePaintIndex !== formCompiled.imageTransforms.length ||
      formShadingPaintIndex !== formCompiled.shadingPaints.length ||
      formPatternPaintIndex !== formCompiled.patternPaints.length ||
      formGenericPathPaintCount !== formCompiled.genericPathPaints.length ||
      formInvocationCount !== formCompiled.formPaints.length ||
      program.invocationProgramIndices.length !== formCompiled.formPaints.length
    ) {
      throw new TypeError(`Form program ${programIndex} contains unreferenced paint metadata.`);
    }
    let programCommands: readonly HeprDisplayCommand[] = formCommands;
    if (program.group) {
      const softMaskGroupIndex = program.group.softMaskIndex < 0
        ? -1
        : softMaskGroupIndices.get(program.group.softMaskIndex) ?? -1;
      if (program.group.softMaskIndex >= 0 && softMaskGroupIndex < 0) {
        throw new DensePdfUnsupportedError(
          `Form /${program.resourceName} references uncompiled soft mask ${program.group.softMaskIndex}.`
        );
      }
      const softMask = program.group.softMaskIndex < 0
        ? undefined
        : softMaskDescriptions.get(program.group.softMaskIndex);
      const groupIndex = 1 + compositeGroups.length;
      compositeGroups.push({
        commands: formCommands,
        isolated: program.group.isolated,
        knockout: program.group.knockout,
        blendMode: program.group.blendMode,
        alpha: program.group.alpha,
        alphaIsShape: program.group.alphaIsShape,
        softMaskGroupIndex,
        softMaskSubtype: softMask?.subtype ?? null,
        softMaskTransferFunctionIndex: softMask?.transferFunctionIndex ?? -1,
        backdropPaintIndex: -1,
        blendingColorSpaceIndex: program.group.blendingColorSpaceIndex,
        clipIndex: -1
      });
      programCommands = [{
        kind: "invoke-group",
        transformIndex: 0,
        clipIndex: -1,
        optionalContentIndex: -1,
        markedContentIndex: -1,
        sourceOffset: -1,
        sourceLength: -1,
        groupIndex
      }];
    }
    reusablePrograms.push({
      kind: "form",
      commands: programCommands,
      matrixIndex: appendTransform(program.matrix),
      bounds: [...program.bounds] as [number, number, number, number],
      clipToBounds: true,
      resourceName: program.resourceName
    });
  }
  for (
    let localProgramIndex = 0;
    localProgramIndex < (options.type3?.programs.length ?? 0);
    localProgramIndex += 1
  ) {
    const program = options.type3!.programs[localProgramIndex];
    const charProc = program.compiled;
    const type3Commands: HeprDisplayCommand[] = [];
    let glyphPaintIndex = 0;
    let pathPaintIndex = 0;
    let imagePaintIndex = 0;
    let shadingPaintIndex = 0;
    let patternPaintIndex = 0;
    let genericPathPaintCount = 0;
    let formInvocationCount = 0;
    for (let offset = 0; offset < charProc.paintRuns.length; offset += 3) {
      const paintRunIndex = offset / 3;
      const kind = charProc.paintRuns[offset];
      const first = charProc.paintRuns[offset + 1];
      const count = charProc.paintRuns[offset + 2];
      if (count === 0) continue;
      const commandState = commandScope(
        charProc,
        paintRunIndex,
        type3MarkedContentOffsets[localProgramIndex]
      );
      const composite = charProc.paintRunCompositeStates[paintRunIndex];
      if (!composite) {
        throw new TypeError(`Type3 CharProc ${program.resourceName} has no composite state.`);
      }
      if (kind === DENSE_PDF_PAINT_RUN_STROKE || kind === DENSE_PDF_PAINT_RUN_FILL) {
        const limit = kind === DENSE_PDF_PAINT_RUN_STROKE
          ? charProc.segmentCount
          : charProc.fillPathCount;
        if (first + count > limit) {
          throw new TypeError(`Type3 CharProc ${program.resourceName} references invalid geometry.`);
        }
        const paint = charProc.pathPaints[pathPaintIndex++];
        if (!paint) {
          throw new TypeError(`Type3 CharProc ${program.resourceName} has inconsistent paint metadata.`);
        }
        const command: HeprDisplayCommand = {
          kind: "draw",
          ...commandState,
          source: kind === DENSE_PDF_PAINT_RUN_STROKE
            ? "stroke-segments"
            : "fill-paths",
          first: first + (kind === DENSE_PDF_PAINT_RUN_STROKE
            ? type3StrokeOffsets[localProgramIndex]
            : type3FillOffsets[localProgramIndex]),
          count,
          // -1 deliberately means the inherited Type3 paint in this program.
          paintIndex: paint.inheritType3Paint === true
            ? -1
            : solidPaint(paint.color, composite)
        };
        appendPaintCommand(
          type3Commands,
          command,
          composite,
          true
        );
      } else if (kind === DENSE_PDF_PAINT_RUN_PATH) {
        if (count !== 1 || first !== genericPathPaintCount) {
          throw new TypeError(
            `Type3 CharProc ${program.resourceName} has inconsistent generic path metadata.`
          );
        }
        appendPaintCommand(
          type3Commands,
          genericPathCommand(charProc, first, commandState, composite),
          composite,
          true
        );
        genericPathPaintCount += 1;
      } else if (kind === DENSE_PDF_PAINT_RUN_GLYPH) {
        const paint = charProc.glyphPaints[glyphPaintIndex++];
        if (!paint) {
          throw new TypeError(`Type3 CharProc ${program.resourceName} has inconsistent glyph metadata.`);
        }
        appendReusableGlyphCommands(
          type3Commands,
          program.glyphOffset,
          first,
          count,
          paint,
          composite,
          commandState,
          `Type3 CharProc ${program.resourceName}`
        );
      } else if (kind === DENSE_PDF_PAINT_RUN_IMAGE) {
        const imagePaint = charProc.imagePaints[imagePaintIndex];
        const transform = charProc.imageTransforms[imagePaintIndex];
        if (
          count !== 1 || !imagePaint || !transform ||
          first >= stores.images.widths.length
        ) {
          throw new TypeError(`Type3 CharProc ${program.resourceName} has inconsistent image metadata.`);
        }
        const imageMask = stores.images.imageMask[first] !== 0;
        if (!program.colored && !imageMask) {
          throw new DensePdfUnsupportedError(
            `Uncolored Type3 CharProc ${program.resourceName} contains a non-stencil image.`
          );
        }
        const command: HeprDisplayCommand = {
          kind: "draw",
          ...commandState,
          source: "images",
          first,
          count,
          paintIndex: imageMask
            ? (imagePaint.inheritType3Paint === true
                ? -1
                : solidPaint(imagePaint.color, composite))
            : -1,
          transformIndex: appendTransform(transform),
          sourceOffset: imagePaint.sourceOffset,
          sourceLength: imagePaint.sourceLength
        };
        appendPaintCommand(type3Commands, command, composite, imageMask);
        imagePaintIndex += 1;
      } else if (kind === DENSE_PDF_PAINT_RUN_FORM) {
        const formPaint = charProc.formPaints[first];
        const nestedProgramIndex = program.invocationProgramIndices[first];
        if (
          count !== 1 || !formPaint || nestedProgramIndex === undefined ||
          nestedProgramIndex < 0 || nestedProgramIndex >= (options.forms?.programs.length ?? 0)
        ) {
          throw new TypeError(`Type3 CharProc ${program.resourceName} has inconsistent Form metadata.`);
        }
        type3Commands.push({
          kind: "invoke-program",
          ...commandState,
          transformIndex: appendTransform(formPaint.transform),
          programIndex: nestedProgramIndex,
          type3PaintIndex: -1,
          viewTransformFlags: 0
        });
        formInvocationCount += 1;
      } else if (kind === DENSE_PDF_PAINT_RUN_GRADIENT) {
        if (!program.colored) {
          throw new DensePdfUnsupportedError(
            `Uncolored Type3 CharProc ${program.resourceName} contains a shading paint.`
          );
        }
        const paint = charProc.shadingPaints[shadingPaintIndex++];
        if (
          count !== 1 || !paint || paint.gradientIndex !== first ||
          first >= stores.gradients.kinds.length
        ) {
          throw new TypeError(`Type3 CharProc ${program.resourceName} has inconsistent shading metadata.`);
        }
        const command: HeprDisplayCommand = {
          kind: "draw",
          ...commandState,
          source: "gradients",
          first,
          count,
          transformIndex: appendTransform(paint.transform)
        };
        appendPaintCommand(type3Commands, command, composite, false);
      } else if (kind === DENSE_PDF_PAINT_RUN_PATTERN) {
        if (!program.colored) {
          throw new DensePdfUnsupportedError(
            `Uncolored Type3 CharProc ${program.resourceName} contains a pattern paint.`
          );
        }
        const paint = charProc.patternPaints[patternPaintIndex];
        if (
          count !== 1 || !paint || paint.patternIndex !== first ||
          first >= stores.patterns.kinds.length
        ) {
          throw new TypeError(`Type3 CharProc ${program.resourceName} has inconsistent pattern metadata.`);
        }
        appendPaintCommand(
          type3Commands,
          patternPathCommand(charProc, patternPaintIndex, commandState, composite),
          composite,
          true
        );
        patternPaintIndex += 1;
      } else {
        throw new DensePdfUnsupportedError(
          `Type3 CharProc ${program.resourceName} contains unsupported paint kind ${kind}.`
        );
      }
    }
    if (
      pathPaintIndex !== charProc.pathPaints.length ||
      imagePaintIndex !== charProc.imagePaints.length ||
      imagePaintIndex !== charProc.imageTransforms.length ||
      shadingPaintIndex !== charProc.shadingPaints.length ||
      patternPaintIndex !== charProc.patternPaints.length
      || genericPathPaintCount !== charProc.genericPathPaints.length ||
      glyphPaintIndex !== charProc.glyphPaints.length ||
      formInvocationCount !== charProc.formPaints.length ||
      program.invocationProgramIndices.length !== charProc.formPaints.length
    ) {
      throw new TypeError(`Type3 CharProc ${program.resourceName} has unreferenced paint metadata.`);
    }
    reusablePrograms.push({
      kind: "type3",
      commands: type3Commands,
      matrixIndex: appendTransform(program.matrix),
      bounds: [...program.bounds] as [number, number, number, number],
      // d1/FontBBox values describe cache geometry; unlike a Form BBox they
      // are not an implicit clipping path.
      clipToBounds: false,
      resourceName: program.resourceName
    });
  }
  for (
    let localProgramIndex = 0;
    localProgramIndex < (options.patterns?.programs.length ?? 0);
    localProgramIndex += 1
  ) {
    const program = options.patterns!.programs[localProgramIndex];
    const patternCompiled = program.compiled;
    if (
      !Number.isSafeInteger(program.patternIndex) || program.patternIndex < 0 ||
      program.patternIndex >= stores.patterns.kinds.length ||
      stores.patterns.programIndices[program.patternIndex] !== -1
    ) {
      throw new TypeError(`Pattern program ${localProgramIndex} has an invalid pattern index.`);
    }
    const globalProgramIndex = reusablePrograms.length;
    stores.patterns.programIndices[program.patternIndex] = globalProgramIndex;
    const patternCommands: HeprDisplayCommand[] = [];
    let glyphPaintIndex = 0;
    let pathPaintIndex = 0;
    let imagePaintIndex = 0;
    let shadingPaintIndex = 0;
    let nestedPatternPaintIndex = 0;
    let genericPathPaintCount = 0;
    let formInvocationCount = 0;
    for (let offset = 0; offset < patternCompiled.paintRuns.length; offset += 3) {
      const paintRunIndex = offset / 3;
      const kind = patternCompiled.paintRuns[offset];
      const first = patternCompiled.paintRuns[offset + 1];
      const count = patternCompiled.paintRuns[offset + 2];
      if (count === 0) continue;
      const commandState = commandScope(
        patternCompiled,
        paintRunIndex,
        patternMarkedContentOffsets[localProgramIndex]
      );
      const composite = patternCompiled.paintRunCompositeStates[paintRunIndex];
      if (!composite) {
        throw new TypeError(`Pattern program ${localProgramIndex} has no composite state.`);
      }
      if (kind === DENSE_PDF_PAINT_RUN_STROKE || kind === DENSE_PDF_PAINT_RUN_FILL) {
        const limit = kind === DENSE_PDF_PAINT_RUN_STROKE
          ? patternCompiled.segmentCount
          : patternCompiled.fillPathCount;
        if (first + count > limit) {
          throw new TypeError(`Pattern program ${localProgramIndex} references invalid geometry.`);
        }
        const paint = patternCompiled.pathPaints[pathPaintIndex++];
        if (!paint) {
          throw new TypeError(`Pattern program ${localProgramIndex} has inconsistent paint metadata.`);
        }
        const command: HeprDisplayCommand = {
          kind: "draw",
          ...commandState,
          source: kind === DENSE_PDF_PAINT_RUN_STROKE
            ? "stroke-segments"
            : "fill-paths",
          first: first + (kind === DENSE_PDF_PAINT_RUN_STROKE
            ? patternStrokeOffsets[localProgramIndex]
            : patternFillOffsets[localProgramIndex]),
          count,
          paintIndex: paint.inheritType3Paint === true
            ? -1
            : solidPaint(paint.color, composite)
        };
        appendPaintCommand(patternCommands, command, composite, true);
      } else if (kind === DENSE_PDF_PAINT_RUN_PATH) {
        if (count !== 1 || first !== genericPathPaintCount) {
          throw new TypeError(
            `Pattern program ${localProgramIndex} has inconsistent generic path metadata.`
          );
        }
        appendPaintCommand(
          patternCommands,
          genericPathCommand(patternCompiled, first, commandState, composite),
          composite,
          true
        );
        genericPathPaintCount += 1;
      } else if (kind === DENSE_PDF_PAINT_RUN_GLYPH) {
        const paint = patternCompiled.glyphPaints[glyphPaintIndex++];
        if (!paint) {
          throw new TypeError(`Pattern program ${localProgramIndex} has inconsistent glyph metadata.`);
        }
        appendReusableGlyphCommands(
          patternCommands,
          program.glyphOffset,
          first,
          count,
          paint,
          composite,
          commandState,
          `Pattern /${program.resourceName}`
        );
      } else if (kind === DENSE_PDF_PAINT_RUN_IMAGE) {
        const imagePaint = patternCompiled.imagePaints[imagePaintIndex];
        const transform = patternCompiled.imageTransforms[imagePaintIndex];
        if (
          count !== 1 || !imagePaint || !transform ||
          first >= stores.images.widths.length
        ) {
          throw new TypeError(`Pattern program ${localProgramIndex} has inconsistent image metadata.`);
        }
        const imageMask = stores.images.imageMask[first] !== 0;
        if (!program.colored && !imageMask) {
          throw new DensePdfUnsupportedError(
            `Uncolored tiling pattern /${program.resourceName} contains a non-stencil image.`
          );
        }
        const command: HeprDisplayCommand = {
          kind: "draw",
          ...commandState,
          source: "images",
          first,
          count,
          paintIndex: imageMask
            ? (imagePaint.inheritType3Paint === true
                ? -1
                : solidPaint(imagePaint.color, composite))
            : -1,
          transformIndex: appendTransform(transform),
          sourceOffset: imagePaint.sourceOffset,
          sourceLength: imagePaint.sourceLength
        };
        appendPaintCommand(patternCommands, command, composite, imageMask);
        imagePaintIndex += 1;
      } else if (kind === DENSE_PDF_PAINT_RUN_FORM) {
        const formPaint = patternCompiled.formPaints[first];
        const nestedProgramIndex = program.invocationProgramIndices[first];
        if (
          count !== 1 || !formPaint || nestedProgramIndex === undefined ||
          nestedProgramIndex < 0 || nestedProgramIndex >= (options.forms?.programs.length ?? 0)
        ) {
          throw new TypeError(`Pattern program ${localProgramIndex} has inconsistent Form metadata.`);
        }
        patternCommands.push({
          kind: "invoke-program",
          ...commandState,
          transformIndex: appendTransform(formPaint.transform),
          programIndex: nestedProgramIndex,
          type3PaintIndex: -1,
          viewTransformFlags: 0
        });
        formInvocationCount += 1;
      } else if (kind === DENSE_PDF_PAINT_RUN_GRADIENT) {
        if (!program.colored) {
          throw new DensePdfUnsupportedError(
            `Uncolored tiling pattern /${program.resourceName} contains a shading paint.`
          );
        }
        const paint = patternCompiled.shadingPaints[shadingPaintIndex];
        if (
          count !== 1 || !paint || paint.gradientIndex !== first ||
          first >= stores.gradients.kinds.length
        ) {
          throw new TypeError(`Pattern program ${localProgramIndex} has inconsistent shading metadata.`);
        }
        const command: HeprDisplayCommand = {
          kind: "draw",
          ...commandState,
          source: "gradients",
          first,
          count,
          transformIndex: appendTransform(paint.transform)
        };
        appendPaintCommand(patternCommands, command, composite, false);
        shadingPaintIndex += 1;
      } else if (kind === DENSE_PDF_PAINT_RUN_PATTERN) {
        const paint = patternCompiled.patternPaints[nestedPatternPaintIndex];
        if (
          count !== 1 || !paint || paint.patternIndex !== first ||
          first >= stores.patterns.kinds.length
        ) {
          throw new TypeError(`Pattern program ${localProgramIndex} has inconsistent nested-pattern metadata.`);
        }
        if (!program.colored) {
          throw new DensePdfUnsupportedError(
            `Uncolored tiling pattern /${program.resourceName} contains a nested pattern paint.`
          );
        }
        appendPaintCommand(
          patternCommands,
          patternPathCommand(
            patternCompiled,
            nestedPatternPaintIndex,
            commandState,
            composite
          ),
          composite,
          true
        );
        nestedPatternPaintIndex += 1;
      } else {
        throw new DensePdfUnsupportedError(
          `Pattern /${program.resourceName} contains unsupported paint kind ${kind}.`
        );
      }
    }
    if (
      pathPaintIndex !== patternCompiled.pathPaints.length ||
      imagePaintIndex !== patternCompiled.imagePaints.length ||
      imagePaintIndex !== patternCompiled.imageTransforms.length ||
      shadingPaintIndex !== patternCompiled.shadingPaints.length ||
      nestedPatternPaintIndex !== patternCompiled.patternPaints.length
      || genericPathPaintCount !== patternCompiled.genericPathPaints.length ||
      glyphPaintIndex !== patternCompiled.glyphPaints.length ||
      formInvocationCount !== patternCompiled.formPaints.length ||
      program.invocationProgramIndices.length !== patternCompiled.formPaints.length
    ) {
      throw new TypeError(`Pattern program ${localProgramIndex} has unreferenced paint metadata.`);
    }
    reusablePrograms.push({
      kind: "pattern",
      commands: patternCommands,
      matrixIndex: appendTransform([1, 0, 0, 1, 0, 0]),
      bounds: [...program.bounds] as [number, number, number, number],
      clipToBounds: true,
      resourceName: program.resourceName
    });
  }
  for (const annotation of options.forms?.annotations ?? []) {
    if (
      !Number.isSafeInteger(annotation.programIndex) || annotation.programIndex < 0 ||
      annotation.programIndex >= reusablePrograms.length
    ) {
      throw new TypeError("An annotation appearance references an invalid Form program.");
    }
    if (
      annotation.optionalContentIndex < -1 ||
      annotation.optionalContentIndex >= stores.optionalContent.names.length ||
      (
        annotation.optionalContentIndex >= 0 &&
        stores.optionalContent.defaultVisible[annotation.optionalContentIndex] === 0
      )
    ) {
      throw new TypeError("An annotation appearance has invalid or hidden optional content.");
    }
    if (
      !Number.isSafeInteger(annotation.viewTransformFlags) ||
      annotation.viewTransformFlags < 0 ||
      (annotation.viewTransformFlags & ~(
        HEPR_VIEW_TRANSFORM_FLAG.NoZoom | HEPR_VIEW_TRANSFORM_FLAG.NoRotate
      )) !== 0
    ) {
      throw new TypeError("An annotation appearance has invalid view-transform flags.");
    }
    commands.push({
      kind: "invoke-program",
      transformIndex: appendTransform(annotation.transform),
      clipIndex: appendRectClip(annotation.clipBounds),
      optionalContentIndex: annotation.optionalContentIndex,
      markedContentIndex: -1,
      sourceOffset: -1,
      sourceLength: -1,
      programIndex: annotation.programIndex,
      type3PaintIndex: -1,
      viewTransformFlags: annotation.viewTransformFlags
    });
  }

  if (extraTransforms.length > 0) {
    stores.transforms = {
      values: concatFloat32(stores.transforms.values, Float32Array.from(extraTransforms))
    };
  }
  stores.paths.pathVerbOffsets = Uint32Array.from(pathVerbOffsets);
  stores.paths.verbs = Uint8Array.from(pathVerbs);
  stores.paths.verbCoordinateOffsets = Uint32Array.from(pathCoordinateOffsets);
  stores.paths.coordinates = Float32Array.from(pathCoordinates);
  stores.paths.bounds = Float32Array.from(pathBoundsValues);
  stores.paths.flags = Uint8Array.from(pathFlags);
  stores.clips = {
    parentIndices: Int32Array.from(clipParentIndices),
    firstPaths: Uint32Array.from(clipFirstPaths),
    pathCounts: Uint32Array.from(clipPathCounts),
    firstGlyphs: Uint32Array.from(clipFirstGlyphs),
    glyphCounts: Uint32Array.from(clipGlyphCounts),
    fillRules: Uint8Array.from(clipFillRules),
    transformIndices: Uint32Array.from(clipTransformIndices)
  };
  stores.strokes.lineWidths = Float32Array.from(strokeLineWidths);
  stores.strokes.miterLimits = Float32Array.from(strokeMiterLimits);
  stores.strokes.lineCaps = Uint8Array.from(strokeLineCaps);
  stores.strokes.lineJoins = Uint8Array.from(strokeLineJoins);
  stores.strokes.flags = Uint8Array.from(strokeFlags);
  stores.strokes.dashOffsets = Uint32Array.from(strokeDashOffsets);
  stores.strokes.dashValues = Float32Array.from(strokeDashValues);
  stores.strokes.dashPhases = Float32Array.from(strokeDashPhases);

  const addedColorCount = colorKeys.size;
  const baseColors = stores.colors;
  stores.colors = {
    spaceKinds: appendFilledUint8(
      baseColors.spaceKinds,
      addedColorCount,
      HEPR_COLOR_SPACE_KIND.DeviceRgb
    ),
    componentCounts: appendFilledUint8(baseColors.componentCounts, addedColorCount, 3),
    alternateSpaceIndices: appendFilledInt32(
      baseColors.alternateSpaceIndices,
      addedColorCount,
      -1
    ),
    functionIndices: appendFilledInt32(baseColors.functionIndices, addedColorCount, -1),
    parameterOffsets: appendOffsets(baseColors.parameterOffsets, colorParameterOffsets),
    parameters: appendFloat32(baseColors.parameters, colorParameters),
    nameOffsets: appendEmptyOffsets(baseColors.nameOffsets, addedColorCount),
    names: baseColors.names,
    profileOffsets: appendEmptyOffsets(baseColors.profileOffsets, addedColorCount),
    profiles: baseColors.profiles,
    lookupOffsets: appendEmptyOffsets(baseColors.lookupOffsets, addedColorCount),
    lookupBytes: baseColors.lookupBytes
  };
  stores.paints = {
    kinds: Uint8Array.from(paintKinds),
    resourceIndices: Uint32Array.from(paintResourceIndices),
    alphas: Float32Array.from(paintAlphas),
    overprint: Uint8Array.from(paintOverprint),
    overprintModes: Uint8Array.from(paintOverprintModes),
    patternTransformIndices: Int32Array.from(paintPatternTransformIndices),
    patternBasePaintIndices: Int32Array.from(paintPatternBasePaintIndices)
  };

  const displayProgram = createEmptyHeprDisplayProgram();
  const root = displayProgram.groups[displayProgram.rootGroupIndex];
  const textIndex = options.text?.textIndex ?? options.textIndex ?? {
    version: 1 as const,
    text: "",
    charGlyphIndices: new Int32Array(0),
    fallbackQuads: new Float32Array(0)
  };

  return {
    kind: "hepr-page",
    version: HEPR_DOCUMENT_DATA_VERSION,
    pageInfo,
    stores,
    displayProgram: {
      ...displayProgram,
      groups: [
        ...displayProgram.groups.map((group, index) =>
          index === displayProgram.rootGroupIndex ? { ...root, commands } : group
        ),
        ...compositeGroups
      ],
      programs: reusablePrograms
    },
    textIndex,
    diagnostics: [
      ...(options.diagnostics ?? []),
      ...(options.text?.diagnostics ?? [])
    ]
  };
}

function offsetFillSegmentStarts(source: Float32Array, segmentOffset: number): Float32Array {
  if (segmentOffset === 0 || source.length === 0) return source;
  const result = source.slice();
  for (let offset = 0; offset < result.length; offset += 4) {
    result[offset] += segmentOffset;
  }
  return result;
}

function concatFloat32(first: Float32Array, second: Float32Array): Float32Array {
  if (second.length === 0) return first;
  if (first.length === 0) return second;
  const result = new Float32Array(first.length + second.length);
  result.set(first);
  result.set(second, first.length);
  return result;
}

function appendFilledUint8(source: Uint8Array, count: number, value: number): Uint8Array {
  if (count === 0) return source;
  const result = new Uint8Array(source.length + count);
  result.set(source);
  result.fill(value, source.length);
  return result;
}

function appendFilledInt32(source: Int32Array, count: number, value: number): Int32Array {
  if (count === 0) return source;
  const result = new Int32Array(source.length + count);
  result.set(source);
  result.fill(value, source.length);
  return result;
}

function appendFloat32(source: Float32Array, added: readonly number[]): Float32Array {
  if (added.length === 0) return source;
  const result = new Float32Array(source.length + added.length);
  result.set(source);
  result.set(added, source.length);
  return result;
}

function appendOffsets(base: Uint32Array, added: readonly number[]): Uint32Array {
  if (added.length <= 1) return base;
  const basePayloadLength = base[base.length - 1];
  const result = new Uint32Array(base.length + added.length - 1);
  result.set(base);
  for (let index = 1; index < added.length; index += 1) {
    result[base.length + index - 1] = basePayloadLength + added[index];
  }
  return result;
}

function appendEmptyOffsets(base: Uint32Array, count: number): Uint32Array {
  if (count === 0) return base;
  const result = new Uint32Array(base.length + count);
  result.set(base);
  result.fill(base[base.length - 1], base.length);
  return result;
}

interface ResolvedPageDataResourceLimits {
  readonly maxPathResources: number;
  readonly maxPathVerbs: number;
  readonly maxPathCoordinates: number;
  readonly maxClipPaths: number;
}

function resolvePageDataResourceLimits(
  limits: DensePdfPageDataOptions["limits"]
): ResolvedPageDataResourceLimits {
  const fallback = 0xffff_ffff;
  const resolved = {
    maxPathResources: limits?.maxPathResources ?? fallback,
    maxPathVerbs: limits?.maxPathVerbs ?? fallback,
    maxPathCoordinates: limits?.maxPathCoordinates ?? fallback,
    maxClipPaths: limits?.maxClipPaths ?? fallback
  };
  for (const [name, value] of Object.entries(resolved)) {
    if (!Number.isSafeInteger(value) || value <= 0 || value > fallback) {
      throw new RangeError(`${name} must be a positive Uint32 resource limit.`);
    }
  }
  return Object.freeze(resolved);
}

function pageDataResourceLimit(resource: string, limit: number): DensePdfResourceLimitError {
  return new DensePdfResourceLimitError(
    `Page-native ${resource} exceed limit ${limit}.`,
    undefined,
    resource.replaceAll(" ", "-")
  );
}
