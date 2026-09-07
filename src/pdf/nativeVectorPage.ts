import type {
  Bounds,
  PageTextIndex,
  RasterLayer,
  VectorScene
} from "../pdfVectorExtractor";
import { HEPR_IMAGE_FORMAT } from "../heprDocumentData";
import {
  DENSE_PDF_LEGACY_VECTOR_EVENT_FORM,
  DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH,
  DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE,
  DENSE_PDF_LEGACY_VECTOR_EVENT_ORDINARY_PAINT,
  DENSE_PDF_LEGACY_VECTOR_GLYPH_FLAG_CLIPPED,
  DENSE_PDF_LEGACY_VECTOR_GLYPH_FLAG_COMPOSITED,
  DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_CLIPPED,
  DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_LATE_AFTER_PATH,
  DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_LATE_AFTER_TEXT,
  type DensePdfLegacyVectorOutput,
  type DensePdfBounds,
  type DensePdfCompiledPage
} from "./nativeContentCompiler";
import type { NativeGlyphPathCommand, NativePdfFont } from "./nativeFont";
import type {
  NativePdfImageDescription,
  NativePdfImageRegistry
} from "./nativeImage";
import type {
  NativeTextCompilation,
  NativeTextFontResource
} from "./nativeText";
import { PdfError, throwIfAborted } from "./nativeTypes";
import { NativeTextClipTester } from "./nativeTextClip";

/**
 * Inputs for the bounded one-page native-parser to legacy-renderer boundary.
 *
 * `compiled` must have been produced with `legacyVectorOutput: true`. That
 * compiler mode proves that grouped legacy rendering preserves source paint
 * order and attaches the small `legacyVector` sidecar consumed here. Large
 * packed fill and stroke buffers are retained by reference.
 */
export interface BuildNativeVectorPageInput {
  readonly pageInfo: {
    readonly sourcePageIndex: number;
    readonly width: number;
    readonly height: number;
  };
  readonly pageBounds: Readonly<DensePdfBounds>;
  readonly compiled: DensePdfCompiledPage;
  readonly textCompilation: NativeTextCompilation;
  readonly fontResources: readonly NativeTextFontResource[];
  readonly imageRegistry: LegacyVectorImageRegistry;
  /** Maximum distinct, nonempty glyph outlines derived for this page. */
  readonly maxPaths: number;
  readonly signal?: AbortSignal;
}

type LegacyVectorImageRegistry = Pick<NativePdfImageRegistry, "size" | "describe"> & {
  /** Required only when an image matte must be converted to canonical sRGB. */
  readonly colors?: Pick<NativePdfImageRegistry["colors"], "describe" | "convertToSrgb">;
};

interface GlyphGeometry {
  readonly segmentsA: readonly number[];
  readonly segmentsB: readonly number[];
  readonly bounds: Bounds;
}

/** CFF/Type1 kernels may retain cubics even when the current TS font surface narrows them. */
type NativeVectorGlyphPathCommand = NativeGlyphPathCommand | {
  readonly kind: "cubic";
  readonly control1X: number;
  readonly control1Y: number;
  readonly control2X: number;
  readonly control2Y: number;
  readonly x: number;
  readonly y: number;
};

interface TextBuildResult {
  readonly sourceTextCount: number;
  readonly inPageCount: number;
  readonly outOfPageCount: number;
  readonly instanceA: Float32Array;
  readonly instanceB: Float32Array;
  readonly instanceC: Float32Array;
  /** Conservative page-space ink bounds, allocated only for late-image proofs. */
  readonly sourceGlyphPaintBounds: Float64Array | null;
  readonly clipRects: Float32Array;
  readonly glyphMetaA: Float32Array;
  readonly glyphMetaB: Float32Array;
  readonly glyphSegmentsA: Float32Array;
  readonly glyphSegmentsB: Float32Array;
  readonly textIndex: PageTextIndex;
}

interface MutableBounds extends Bounds {
  empty: boolean;
}

const GLYPH_FLAG_VERTICAL = 1 << 0;
const GLYPH_FLAG_INVISIBLE = 1 << 1;
const GLYPH_FLAG_TYPE3 = 1 << 2;
const GLYPH_FLAG_CLIP_ONLY = 1 << 3;
const KNOWN_GLYPH_FLAGS = GLYPH_FLAG_VERTICAL | GLYPH_FLAG_INVISIBLE |
  GLYPH_FLAG_TYPE3 | GLYPH_FLAG_CLIP_ONLY;
const MAX_LEGACY_GLYPH_PRIMITIVES = 256;
const TEXT_VISIBLE_ALPHA_EPSILON = 1e-3;
const TEXT_CUBIC_TO_QUAD_ERROR = 0.015;
const MAX_TEXT_CUBIC_TO_QUAD_DEPTH = 12;
/** Bound the exceptional disjointness proof independently of page complexity. */
const MAX_LATE_IMAGE_GLYPH_BOUNDS_TESTS = 10_000_000;
/** Match the established PageTextIndexBuilder's page-space gap heuristic. */
const TEXT_INDEX_GAP_EM_FACTOR = 0.25;
/** Match the established per-image raster capture grid and safety ceiling. */
const LEGACY_RASTER_CROP_PADDING_PX = 2;
const LEGACY_RASTER_MAX_SCALE = 24;
const LEGACY_RASTER_MAX_DIMENSION = 16_384;
const LEGACY_RASTER_MAX_PIXELS = 134_217_728;

/**
 * Build the existing one-page `VectorScene` directly from native parser data.
 *
 * This is deliberately narrower than the page-native display model. The
 * compiler sidecar rejects unsafe ordering/compositing up front; this builder
 * additionally validates every retained index and stride and never omits a
 * visible unsupported resource.
 */
export function buildNativeVectorPage(
  input: Readonly<BuildNativeVectorPageInput>
): VectorScene {
  const {
    pageInfo,
    pageBounds,
    compiled,
    textCompilation,
    fontResources,
    imageRegistry,
    signal
  } = input;
  validatePageInfo(pageInfo, pageBounds);
  const maxPaths = readPositiveLimit(input.maxPaths, "maxPaths");
  throwIfAborted(signal);
  validatePackedGeometry(compiled, pageInfo.sourcePageIndex);
  const sidecar = readLegacyVectorSidecar(compiled, pageInfo.sourcePageIndex);
  if (compiled.formPaints.length !== 0) {
    throw new PdfError(
      "unsupported-content",
      "The legacy VectorScene cannot represent Form XObject invocations until they are flattened.",
      {
        pageIndex: pageInfo.sourcePageIndex,
        details: { reason: "legacy-vector-form", operator: "Do" }
      }
    );
  }
  const sourceOrder = analyzeLegacySourceOrder(sidecar, pageInfo.sourcePageIndex);
  const fonts = validateTextInputs(
    textCompilation,
    fontResources,
    sidecar,
    pageInfo.sourcePageIndex,
    signal
  );
  const text = buildLegacyText(
    textCompilation,
    fonts,
    sidecar,
    pageBounds,
    sourceOrder.requiresLateImageProof,
    maxPaths,
    pageInfo.sourcePageIndex,
    signal
  );
  const rasterLayers = buildRasterLayers(
    imageRegistry,
    sidecar,
    pageBounds,
    pageInfo.sourcePageIndex,
    signal
  );
  if (sourceOrder.requiresLateImageProof) {
    validateLateImageUnderlays(
      sidecar,
      text.sourceGlyphPaintBounds!,
      pageInfo.sourcePageIndex,
      signal
    );
  }

  const visualBounds = emptyBounds();
  includePackedGeometryBounds(visualBounds, compiled);
  includeTextBounds(visualBounds, text);
  for (const layer of rasterLayers) includeTransformedUnitBounds(visualBounds, layer.matrix);
  if (visualBounds.empty) includeBounds(visualBounds, pageBounds);

  const firstRaster = rasterLayers[0];
  const normalizedPageBounds: Bounds = {
    minX: pageBounds.minX,
    minY: pageBounds.minY,
    maxX: pageBounds.maxX,
    maxY: pageBounds.maxY
  };
  // Worker responses transfer every scene-owned ArrayBuffer. Never reuse a
  // module-global empty view: its buffer would stay detached after response 1.
  const emptyFloats = new Float32Array(0);
  return {
    pageCount: 1,
    pagesPerRow: 1,
    pageRects: new Float32Array([
      pageBounds.minX,
      pageBounds.minY,
      pageBounds.maxX,
      pageBounds.maxY
    ]),
    pageTextRanges: new Uint32Array([0, text.instanceA.length / 4]),
    textIndex: { version: 2, pages: [text.textIndex] },
    fillPathCount: compiled.fillPathCount,
    fillSegmentCount: compiled.fillSegmentCount,
    fillPathMetaA: compiled.fillPathMetaA,
    fillPathMetaB: compiled.fillPathMetaB,
    fillPathMetaC: compiled.fillPathMetaC,
    fillSegmentsA: compiled.fillSegmentsA,
    fillSegmentsB: compiled.fillSegmentsB,
    gradientCount: 0,
    gradientMetaA: emptyFloats,
    gradientMetaB: emptyFloats,
    gradientMetaC: emptyFloats,
    gradientMetaD: emptyFloats,
    gradientMetaE: emptyFloats,
    gradientLut: new Uint8Array(0),
    gradientFillPathCount: 0,
    gradientFillSegmentCount: 0,
    gradientFillPathMetaA: emptyFloats,
    gradientFillPathMetaB: emptyFloats,
    gradientFillPathMetaC: emptyFloats,
    gradientFillPaintMeta: emptyFloats,
    gradientFillSegmentsA: emptyFloats,
    gradientFillSegmentsB: emptyFloats,
    gradientStrokeRunCount: 0,
    gradientStrokeSegmentCount: 0,
    gradientStrokeRunMetaA: emptyFloats,
    gradientStrokeRunMetaB: emptyFloats,
    gradientStrokeEndpoints: emptyFloats,
    gradientStrokePrimitiveMeta: emptyFloats,
    gradientStrokePrimitiveBounds: emptyFloats,
    gradientStrokeStyles: emptyFloats,
    segmentCount: compiled.segmentCount,
    sourceSegmentCount: compiled.sourceSegmentCount,
    mergedSegmentCount: compiled.mergedSegmentCount,
    imageLayerSegmentCount: compiled.imageLayerSegmentCount ?? 0,
    operatorCountKind: "native-estimate",
    sourceTextCount: text.sourceTextCount,
    textInstanceCount: text.instanceA.length / 4,
    textGlyphCount: text.glyphMetaA.length / 4,
    textGlyphSegmentCount: text.glyphSegmentsA.length / 4,
    textInPageCount: text.inPageCount,
    textOutOfPageCount: text.outOfPageCount,
    textInstanceA: text.instanceA,
    textInstanceB: text.instanceB,
    textInstanceC: text.instanceC,
    ...(text.clipRects.length === 0 ? {} : { textClipRects: text.clipRects }),
    textGlyphMetaA: text.glyphMetaA,
    textGlyphMetaB: text.glyphMetaB,
    textGlyphSegmentsA: text.glyphSegmentsA,
    textGlyphSegmentsB: text.glyphSegmentsB,
    rasterLayers,
    rasterLayerWidth: firstRaster?.width ?? 0,
    rasterLayerHeight: firstRaster?.height ?? 0,
    rasterLayerData: firstRaster?.data ?? new Uint8Array(0),
    rasterLayerMatrix: firstRaster?.matrix ?? new Float32Array([1, 0, 0, 1, 0, 0]),
    endpoints: compiled.endpoints,
    primitiveMeta: compiled.primitiveMeta,
    primitiveBounds: compiled.primitiveBounds,
    styles: compiled.styles,
    bounds: finalBounds(visualBounds),
    pageBounds: normalizedPageBounds,
    maxHalfWidth: compiled.maxHalfWidth,
    operatorCount: compiled.operatorCount,
    imagePaintOpCount: rasterLayers.length,
    pathCount: compiled.pathCount,
    discardedTransparentCount: compiled.discardedTransparentCount,
    discardedDegenerateCount: compiled.discardedDegenerateCount,
    discardedDuplicateCount: compiled.discardedDuplicateCount,
    discardedContainedCount: compiled.discardedContainedCount
  };
}

function readLegacyVectorSidecar(
  compiled: DensePdfCompiledPage,
  pageIndex: number
): DensePdfLegacyVectorOutput {
  const sidecar = compiled.legacyVector;
  if (!sidecar) {
    throw unsupported(
      "The native page was not compiled for the direct VectorScene boundary.",
      pageIndex,
      "legacy-vector-sidecar-missing"
    );
  }
  if (
    !(sidecar.sourceEvents instanceof Uint32Array) ||
    sidecar.sourceEvents.length % 2 !== 0 ||
    !(sidecar.glyphRunMeta instanceof Uint32Array) ||
    !(sidecar.glyphFillColors instanceof Float32Array) ||
    !(sidecar.imageIndices instanceof Uint32Array) ||
    !(sidecar.imageTransforms instanceof Float32Array) ||
    !(sidecar.imageClipBounds instanceof Float32Array) ||
    !(sidecar.imagePaintOrders instanceof Uint32Array) ||
    !(sidecar.imageFlags instanceof Uint8Array)
  ) {
    throw invalid("The native VectorScene sidecar uses invalid typed arrays.", pageIndex,
      "legacy-vector-sidecar-arrays");
  }
  if (sidecar.glyphRunMeta.length % 3 !== 0) {
    throw invalid("Native VectorScene glyph-run metadata has an invalid stride.", pageIndex,
      "legacy-vector-glyph-run-stride");
  }
  const glyphRunCount = sidecar.glyphRunMeta.length / 3;
  if (sidecar.glyphFillColors.length !== glyphRunCount * 4) {
    throw invalid("Native VectorScene glyph colors do not match its runs.", pageIndex,
      "legacy-vector-glyph-color-count");
  }
  if ((sidecar.glyphClipBounds !== undefined &&
       (!(sidecar.glyphClipBounds instanceof Float32Array) ||
        sidecar.glyphClipBounds.length !== glyphRunCount * 4)) ||
      (sidecar.glyphRunFlags !== undefined &&
       (!(sidecar.glyphRunFlags instanceof Uint8Array) ||
        sidecar.glyphRunFlags.length !== glyphRunCount)) ||
      (sidecar.glyphRunClips !== undefined && sidecar.glyphRunClips.length !== glyphRunCount)) {
    throw invalid("Native VectorScene glyph clip metadata does not match its runs.", pageIndex,
      "legacy-vector-glyph-clip-count");
  }
  const imageCount = sidecar.imageIndices.length;
  if (
    sidecar.imageTransforms.length !== imageCount * 6 ||
    sidecar.imageClipBounds.length !== imageCount * 4 ||
    sidecar.imagePaintOrders.length !== imageCount ||
    sidecar.imageFlags.length !== imageCount
  ) {
    throw invalid("Native VectorScene image metadata has inconsistent lengths.", pageIndex,
      "legacy-vector-image-count");
  }
  return sidecar;
}

interface LegacySourceOrderAnalysis {
  readonly requiresLateImageProof: boolean;
}

/**
 * Validate the compact event tape without allocating seen-index tables. The
 * compiler appends each kind-local index monotonically, and the Form flattener
 * preserves that invariant. Requiring the exact next index proves complete,
 * duplicate-free glyph/image coverage for the later spatial check.
 */
function analyzeLegacySourceOrder(
  sidecar: DensePdfLegacyVectorOutput,
  pageIndex: number
): LegacySourceOrderAnalysis {
  let nextGlyphRun = 0;
  let nextImage = 0;
  let ordinaryBarrierSeen = false;
  let precedingVisibleText = false;
  let requiresLateImageProof = false;
  for (let offset = 0; offset < sidecar.sourceEvents.length; offset += 2) {
    const kind = sidecar.sourceEvents[offset];
    const localIndex = sidecar.sourceEvents[offset + 1];
    if (kind === DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH) {
      if (localIndex !== nextGlyphRun || localIndex >= sidecar.glyphRunMeta.length / 3) {
        throw invalid("Native VectorScene glyph events are incomplete or out of order.", pageIndex,
          "legacy-vector-source-event-glyph");
      }
      const meta = localIndex * 3;
      if (sidecar.glyphRunMeta[meta + 2] === 0 &&
          sidecar.glyphFillColors[localIndex * 4 + 3] > TEXT_VISIBLE_ALPHA_EPSILON) {
        precedingVisibleText = true;
      }
      nextGlyphRun += 1;
      continue;
    }
    if (kind === DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE) {
      if (localIndex !== nextImage || localIndex >= sidecar.imageIndices.length) {
        throw invalid("Native VectorScene image events are incomplete or out of order.", pageIndex,
          "legacy-vector-source-event-image");
      }
      const markedLate = (sidecar.imageFlags[localIndex] &
        DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_LATE_AFTER_TEXT) !== 0;
      if (markedLate !== precedingVisibleText) {
        throw invalid("Native VectorScene late-image ordering metadata is inconsistent.", pageIndex,
          "legacy-vector-image-order-metadata");
      }
      requiresLateImageProof ||= markedLate;
      const markedAfterPath = (sidecar.imageFlags[localIndex] &
        DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_LATE_AFTER_PATH) !== 0;
      if (markedAfterPath && !ordinaryBarrierSeen) {
        throw invalid("Native VectorScene late-path image metadata is inconsistent.", pageIndex,
          "legacy-vector-image-path-order-metadata");
      }
      nextImage += 1;
      continue;
    }
    if (kind === DENSE_PDF_LEGACY_VECTOR_EVENT_ORDINARY_PAINT) {
      if (localIndex !== 0 || ordinaryBarrierSeen) {
        throw invalid("Native VectorScene ordinary-paint events are invalid.", pageIndex,
          "legacy-vector-source-event-ordinary-paint");
      }
      ordinaryBarrierSeen = true;
      continue;
    }
    if (kind === DENSE_PDF_LEGACY_VECTOR_EVENT_FORM) {
      // buildNativeVectorPage rejects unflattened Forms before this analysis;
      // a flattened sidecar must not retain any Form events.
      throw invalid("A flattened native VectorScene retains a Form event.", pageIndex,
        "legacy-vector-source-event-form");
    }
    throw invalid("Native VectorScene contains an unknown source event.", pageIndex,
      "legacy-vector-source-event-kind");
  }
  if (nextGlyphRun !== sidecar.glyphRunMeta.length / 3 ||
      nextImage !== sidecar.imageIndices.length) {
    throw invalid("Native VectorScene source events do not cover all paint resources.", pageIndex,
      "legacy-vector-source-event-coverage");
  }
  return { requiresLateImageProof };
}

function validatePageInfo(
  pageInfo: BuildNativeVectorPageInput["pageInfo"],
  bounds: Readonly<DensePdfBounds>
): void {
  if (!Number.isSafeInteger(pageInfo.sourcePageIndex) || pageInfo.sourcePageIndex < 0) {
    throw new RangeError("pageInfo.sourcePageIndex must be a non-negative safe integer.");
  }
  if (!Number.isFinite(pageInfo.width) || pageInfo.width <= 0 ||
      !Number.isFinite(pageInfo.height) || pageInfo.height <= 0) {
    throw new RangeError("pageInfo width and height must be positive finite values.");
  }
  if (!validBounds(bounds)) {
    throw new RangeError("pageBounds must contain finite, ordered coordinates.");
  }
}

function validatePackedGeometry(compiled: DensePdfCompiledPage, pageIndex: number): void {
  validateCountAndFloat4(compiled.fillPathCount, compiled.fillPathMetaA, "fillPathMetaA", pageIndex);
  validateCountAndFloat4(compiled.fillPathCount, compiled.fillPathMetaB, "fillPathMetaB", pageIndex);
  validateCountAndFloat4(compiled.fillPathCount, compiled.fillPathMetaC, "fillPathMetaC", pageIndex);
  validateCountAndFloat4(compiled.fillSegmentCount, compiled.fillSegmentsA, "fillSegmentsA", pageIndex);
  validateCountAndFloat4(compiled.fillSegmentCount, compiled.fillSegmentsB, "fillSegmentsB", pageIndex);
  validateCountAndFloat4(compiled.segmentCount, compiled.endpoints, "endpoints", pageIndex);
  validateCountAndFloat4(compiled.segmentCount, compiled.primitiveMeta, "primitiveMeta", pageIndex);
  validateCountAndFloat4(compiled.segmentCount, compiled.primitiveBounds, "primitiveBounds", pageIndex);
  validateCountAndFloat4(compiled.segmentCount, compiled.styles, "styles", pageIndex);
  for (const [name, value] of [
    ["operatorCount", compiled.operatorCount],
    ["pathCount", compiled.pathCount],
    ["sourceSegmentCount", compiled.sourceSegmentCount],
    ["mergedSegmentCount", compiled.mergedSegmentCount],
    ["discardedTransparentCount", compiled.discardedTransparentCount],
    ["discardedDegenerateCount", compiled.discardedDegenerateCount],
    ["discardedDuplicateCount", compiled.discardedDuplicateCount],
    ["discardedContainedCount", compiled.discardedContainedCount]
  ] as const) {
    if (!Number.isSafeInteger(value) || value < 0) {
      throw invalid(`Native packed geometry has an invalid ${name}.`, pageIndex,
        "legacy-vector-packed-count");
    }
  }
  if (!Number.isFinite(compiled.maxHalfWidth) || compiled.maxHalfWidth < 0 ||
      !validBounds(compiled.bounds)) {
    throw invalid("Native packed geometry has invalid bounds or stroke width.", pageIndex,
      "legacy-vector-packed-bounds");
  }
  if (
    (compiled.fillPathCount === 0
      ? compiled.fillBounds !== null
      : !compiled.fillBounds || !validBounds(compiled.fillBounds)) ||
    (compiled.segmentCount === 0
      ? compiled.strokeBounds !== null
      : !compiled.strokeBounds || !validBounds(compiled.strokeBounds))
  ) {
    throw invalid("Native packed geometry has inconsistent aggregate bounds.", pageIndex,
      "legacy-vector-packed-bounds");
  }
}

function validateCountAndFloat4(
  count: number,
  values: Float32Array,
  name: string,
  pageIndex: number
): void {
  if (!Number.isSafeInteger(count) || count < 0 ||
      !(values instanceof Float32Array) || values.length !== count * 4) {
    throw invalid(`Native packed ${name} has an invalid length.`, pageIndex,
      "legacy-vector-packed-stride");
  }
}

function validateTextInputs(
  compilation: NativeTextCompilation,
  resources: readonly NativeTextFontResource[],
  sidecar: DensePdfLegacyVectorOutput,
  pageIndex: number,
  signal?: AbortSignal
): readonly NativePdfFont[] {
  const { transforms, glyphs, textIndex, runs } = compilation;
  if (!(transforms.values instanceof Float32Array) || transforms.values.length < 6 ||
      transforms.values.length % 6 !== 0) {
    throw invalid("Native text has invalid transform storage.", pageIndex,
      "legacy-vector-text-transforms");
  }
  const glyphCount = glyphs.glyphIds.length;
  if (
    !(glyphs.fontIndices instanceof Uint32Array) ||
    !(glyphs.characterCodes instanceof Uint32Array) ||
    !(glyphs.glyphIds instanceof Uint32Array) ||
    !(glyphs.transformIndices instanceof Uint32Array) ||
    !(glyphs.advances instanceof Float32Array) ||
    !(glyphs.flags instanceof Uint8Array) ||
    glyphs.fontIndices.length !== glyphCount ||
    glyphs.characterCodes.length !== glyphCount ||
    glyphs.transformIndices.length !== glyphCount ||
    glyphs.advances.length !== glyphCount * 2 ||
    glyphs.flags.length !== glyphCount
  ) {
    throw invalid("Native text glyph stores have inconsistent lengths.", pageIndex,
      "legacy-vector-text-glyphs");
  }
  if (
    textIndex.version !== 1 || typeof textIndex.text !== "string" ||
    !(textIndex.charGlyphIndices instanceof Int32Array) ||
    !(textIndex.fallbackQuads instanceof Float32Array) ||
    textIndex.charGlyphIndices.length !== textIndex.text.length ||
    textIndex.fallbackQuads.length % 4 !== 0
  ) {
    throw invalid("Native text has an invalid searchable index.", pageIndex,
      "legacy-vector-text-index");
  }
  if (compilation.glyphAdvanceEms !== undefined) {
    if (!(compilation.glyphAdvanceEms instanceof Float32Array) ||
        compilation.glyphAdvanceEms.length !== glyphCount) {
      throw invalid("Native text has invalid per-glyph fallback advances.", pageIndex,
        "legacy-vector-text-fallback");
    }
    for (let index = 0; index < compilation.glyphAdvanceEms.length; index += 1) {
      if ((index & 0xffff) === 0) throwIfAborted(signal);
      if (!Number.isFinite(compilation.glyphAdvanceEms[index])) {
        throw invalid("Native text has a non-finite per-glyph fallback advance.", pageIndex,
          "legacy-vector-text-fallback");
      }
    }
  }
  if (compilation.glyphWidthEms !== undefined) {
    if (!(compilation.glyphWidthEms instanceof Float32Array) ||
        compilation.glyphWidthEms.length !== glyphCount) {
      throw invalid("Native text has invalid per-glyph PDF widths.", pageIndex,
        "legacy-vector-text-width");
    }
    for (let index = 0; index < compilation.glyphWidthEms.length; index += 1) {
      if ((index & 0xffff) === 0) throwIfAborted(signal);
      if (!Number.isFinite(compilation.glyphWidthEms[index])) {
        throw invalid("Native text has a non-finite per-glyph PDF width.", pageIndex,
          "legacy-vector-text-width");
      }
    }
  }
  if (compilation.glyphGapBefore !== undefined) {
    if (!(compilation.glyphGapBefore instanceof Uint8Array) ||
        compilation.glyphGapBefore.length !== glyphCount ||
        compilation.glyphGapBefore.some((value) => value > 1)) {
      throw invalid("Native text has invalid per-glyph gap markers.", pageIndex,
        "legacy-vector-text-gap");
    }
  }

  const fonts = new Array<NativePdfFont | undefined>(resources.length);
  for (const resource of resources) {
    throwIfAborted(signal);
    if (!Number.isSafeInteger(resource.fontIndex) || resource.fontIndex < 0 ||
        resource.fontIndex >= fonts.length || fonts[resource.fontIndex] !== undefined ||
        !validFont(resource.font)) {
      throw invalid("Native text font resources have invalid page-local indexes.", pageIndex,
        "legacy-vector-font-index");
    }
    fonts[resource.fontIndex] = resource.font;
  }
  if (fonts.some((font) => font === undefined)) {
    throw invalid("Native text font resource indexes are not contiguous.", pageIndex,
      "legacy-vector-font-contiguity");
  }

  const transformCount = transforms.values.length / 6;
  for (let glyph = 0; glyph < glyphCount; glyph += 1) {
    if ((glyph & 0x3fff) === 0) throwIfAborted(signal);
    if (glyphs.fontIndices[glyph] >= fonts.length ||
        glyphs.transformIndices[glyph] >= transformCount ||
        (glyphs.flags[glyph] & ~KNOWN_GLYPH_FLAGS) !== 0 ||
        !Number.isFinite(glyphs.advances[glyph * 2]) ||
        !Number.isFinite(glyphs.advances[glyph * 2 + 1])) {
      throw invalid("A native text glyph references invalid page resources.", pageIndex,
        "legacy-vector-glyph-reference");
    }
    const font = fonts[glyphs.fontIndices[glyph]]!;
    const vertical = (glyphs.flags[glyph] & GLYPH_FLAG_VERTICAL) !== 0;
    if (vertical !== (font.writingMode === 1)) {
      throw invalid("A native text glyph has inconsistent writing-mode metadata.", pageIndex,
        "legacy-vector-glyph-writing-mode");
    }
  }

  for (let offset = 0; offset < transforms.values.length; offset += 1) {
    if ((offset & 0xffff) === 0) throwIfAborted(signal);
    if (!Number.isFinite(transforms.values[offset])) {
      throw invalid("A native text transform is not finite.", pageIndex,
        "legacy-vector-text-transform-finite");
    }
  }
  const fallbackCount = textIndex.fallbackQuads.length / 4;
  for (let offset = 0; offset < textIndex.fallbackQuads.length; offset += 4) {
    if ((offset & 0xffff) === 0) throwIfAborted(signal);
    const quad = textIndex.fallbackQuads.subarray(offset, offset + 4);
    if (!validBounds({ minX: quad[0], minY: quad[1], maxX: quad[2], maxY: quad[3] })) {
      throw invalid("A native text fallback quad is invalid.", pageIndex,
        "legacy-vector-fallback-quad");
    }
  }
  for (let index = 0; index < textIndex.charGlyphIndices.length; index += 1) {
    if ((index & 0xffff) === 0) throwIfAborted(signal);
    const reference = textIndex.charGlyphIndices[index];
    if (reference >= glyphCount || (reference <= -2 && -reference - 2 >= fallbackCount)) {
      throw invalid("Native text contains an out-of-range search geometry reference.", pageIndex,
        "legacy-vector-text-reference");
    }
  }

  const sidecarRunCount = sidecar.glyphRunMeta.length / 3;
  if (runs.length !== sidecarRunCount) {
    throw invalid("Native text runs do not match the VectorScene sidecar.", pageIndex,
      "legacy-vector-glyph-run-count");
  }
  let nextGlyph = 0;
  for (let runIndex = 0; runIndex < sidecarRunCount; runIndex += 1) {
    throwIfAborted(signal);
    const meta = runIndex * 3;
    const first = sidecar.glyphRunMeta[meta];
    const count = sidecar.glyphRunMeta[meta + 1];
    const renderingMode = sidecar.glyphRunMeta[meta + 2];
    const run = runs[runIndex];
    const runFlags = sidecar.glyphRunFlags?.[runIndex] ?? 0;
    if (
      first !== nextGlyph || count === 0 || first > glyphCount - count ||
      (renderingMode !== 0 && renderingMode !== 3) ||
      !run || run.first !== first || run.count !== count ||
      run.renderingMode !== renderingMode || run.fontIndex >= fonts.length
    ) {
      throw invalid("Native VectorScene glyph runs are not a supported complete partition.", pageIndex,
        "legacy-vector-glyph-run-partition");
    }
    if ((runFlags & ~(DENSE_PDF_LEGACY_VECTOR_GLYPH_FLAG_CLIPPED |
        DENSE_PDF_LEGACY_VECTOR_GLYPH_FLAG_COMPOSITED)) !== 0) {
      throw invalid("Native VectorScene glyph-run clip flags are invalid.", pageIndex,
        "legacy-vector-glyph-clip-flags");
    }
    for (let glyph = first; glyph < first + count; glyph += 1) {
      const flags = glyphs.flags[glyph];
      if (glyphs.fontIndices[glyph] !== run.fontIndex ||
          ((flags & GLYPH_FLAG_INVISIBLE) !== 0) !== (renderingMode === 3) ||
          (flags & GLYPH_FLAG_CLIP_ONLY) !== 0) {
        throw invalid("Native VectorScene glyph-run semantics are inconsistent.", pageIndex,
          "legacy-vector-glyph-run-flags");
      }
    }
    const colorOffset = runIndex * 4;
    for (let component = 0; component < 4; component += 1) {
      const value = sidecar.glyphFillColors[colorOffset + component];
      if (!Number.isFinite(value) || value < 0 || value > 1) {
        throw invalid("Native VectorScene glyph colors must be finite unit values.", pageIndex,
          "legacy-vector-glyph-color");
      }
    }
    nextGlyph += count;
  }
  if (nextGlyph !== glyphCount) {
    throw invalid("Native VectorScene glyph runs do not cover every glyph.", pageIndex,
      "legacy-vector-glyph-run-coverage");
  }
  return fonts as NativePdfFont[];
}

function buildLegacyText(
  compilation: NativeTextCompilation,
  fonts: readonly NativePdfFont[],
  sidecar: DensePdfLegacyVectorOutput,
  pageBounds: Readonly<DensePdfBounds>,
  captureSourceGlyphPaintBounds: boolean,
  maxPaths: number,
  pageIndex: number,
  signal?: AbortSignal
): TextBuildResult {
  const glyphCount = compilation.glyphs.glyphIds.length;
  const glyphToGeometry = new Int32Array(glyphCount).fill(-1);
  const glyphToInstance = new Int32Array(glyphCount).fill(-1);
  const sourceGlyphPaintBounds = captureSourceGlyphPaintBounds
    ? new Float64Array(glyphCount * 4).fill(Number.NaN)
    : null;
  let glyphClipReferences: Uint32Array | null = null;
  // An absent render instance has several meanings: invisible OCR, a glyph
  // without an outline, or text proven to be outside the page/run clip. Keep
  // spatial eligibility separate so only the first two remain searchable.
  const glyphIndexable = new Uint8Array(glyphCount);
  const clipTester = new NativeTextClipTester();
  const compositedInkBounds = new Map<string, readonly number[] | null>();
  const indexQuads = new Map<number, readonly number[]>();
  const geometryByKey = new Map<string, number>();
  const geometries: GlyphGeometry[] = [];
  const clipRects: number[] = [];
  const clipRectIndexes = new Map<string, number>();
  let instanceCount = 0;
  let sourceTextCount = 0;
  let inPageCount = 0;
  let outOfPageCount = 0;

  for (let runIndex = 0; runIndex < sidecar.glyphRunMeta.length / 3; runIndex += 1) {
    throwIfAborted(signal);
    const meta = runIndex * 3;
    const first = sidecar.glyphRunMeta[meta];
    const count = sidecar.glyphRunMeta[meta + 1];
    const renderingMode = sidecar.glyphRunMeta[meta + 2];
    const alpha = sidecar.glyphFillColors[runIndex * 4 + 3];
    const clipped = ((sidecar.glyphRunFlags?.[runIndex] ?? 0) &
      DENSE_PDF_LEGACY_VECTOR_GLYPH_FLAG_CLIPPED) !== 0;
    const clipOffset = runIndex * 4;
    const glyphClip = clipped && sidecar.glyphClipBounds
      ? {
          minX: sidecar.glyphClipBounds[clipOffset],
          minY: sidecar.glyphClipBounds[clipOffset + 1],
          maxX: sidecar.glyphClipBounds[clipOffset + 2],
          maxY: sidecar.glyphClipBounds[clipOffset + 3]
        }
      : null;
    const visuallyPainted = renderingMode === 0 && alpha > TEXT_VISIBLE_ALPHA_EPSILON;
    const composited = ((sidecar.glyphRunFlags?.[runIndex] ?? 0) &
      DENSE_PDF_LEGACY_VECTOR_GLYPH_FLAG_COMPOSITED) !== 0;
    const exactClip = sidecar.glyphRunClips?.[runIndex];
    for (let glyph = first; glyph < first + count; glyph += 1) {
      if ((glyph & 0x3fff) === 0) throwIfAborted(signal);
      const flags = compilation.glyphs.flags[glyph];
      if (visuallyPainted && (flags & GLYPH_FLAG_TYPE3) !== 0) {
        throw unsupported(
          `Visible Type3 glyph ${compilation.glyphs.glyphIds[glyph]} cannot use the legacy renderer.`,
          pageIndex,
          "legacy-vector-type3-glyph"
        );
      }
      const fontIndex = compilation.glyphs.fontIndices[glyph];
      const glyphId = compilation.glyphs.glyphIds[glyph];
      const glyphTransform = readGlyphTransform(compilation, glyph, pageIndex);
      const vertical = (flags & GLYPH_FLAG_VERTICAL) !== 0;
      const rawWidthUnits = readLegacyGlyphWidthEm(compilation, glyph, pageIndex) *
        fonts[fontIndex].unitsPerEm;
      const rawEndX = glyphTransform[4] +
        (vertical ? glyphTransform[2] : glyphTransform[0]) * rawWidthUnits;
      const rawEndY = glyphTransform[5] +
        (vertical ? glyphTransform[3] : glyphTransform[1]) * rawWidthUnits;
      // PDF.js getTextContent() rejects horizontal text by its baseline and
      // vertical text by its x-origin before considering glyph ink. Keep this
      // search-only gate separate from render visibility so a partially
      // visible edge glyph can still be drawn without leaking into the
      // established searchable-text result.
      const indexableByViewBox = vertical
        ? glyphTransform[4] >= pageBounds.minX && glyphTransform[4] <= pageBounds.maxX &&
          Math.max(glyphTransform[5], rawEndY) >= pageBounds.minY &&
          Math.min(glyphTransform[5], rawEndY) <= pageBounds.maxY
        : glyphTransform[5] >= pageBounds.minY && glyphTransform[5] <= pageBounds.maxY &&
          Math.max(glyphTransform[4], rawEndX) >= pageBounds.minX &&
          Math.min(glyphTransform[4], rawEndX) <= pageBounds.maxX;
      let geometryIndex = -1;
      let transformed: Bounds;
      if (visuallyPainted) {
        const key = `${fontIndex}:${glyphId}`;
        const cachedGeometryIndex = geometryByKey.get(key);
        if (cachedGeometryIndex === undefined) {
          const geometry = deriveGlyphGeometry(fonts[fontIndex], glyphId, pageIndex, signal);
          if (geometry.segmentsA.length === 0) {
            geometryIndex = -1;
          } else {
            if (geometries.length >= maxPaths) {
              throw new PdfError(
                "resource-limit",
                "Native VectorScene glyph outlines exceed the configured path limit.",
                { pageIndex, details: { reason: "legacy-vector-glyph-paths", maxPaths } }
              );
            }
            geometryIndex = geometries.length;
            geometries.push(geometry);
          }
          geometryByKey.set(key, geometryIndex);
        } else {
          geometryIndex = cachedGeometryIndex;
        }
        if (geometryIndex >= 0) {
          glyphToGeometry[glyph] = geometryIndex;
          sourceTextCount += 1;
          transformed = transformedBounds(
            geometries[geometryIndex].bounds,
            glyphTransform
          );
        } else {
          transformed = boundsFromQuad(
            approximateGlyphBounds(compilation, fonts, glyph, pageIndex, signal)
          );
        }
      } else {
        // Invisible/OCR and zero-alpha text has no render instance, but remains
        // searchable when its conservative fallback geometry reaches the page.
        transformed = boundsFromQuad(
          approximateGlyphBounds(compilation, fonts, glyph, pageIndex, signal)
        );
      }
      if (glyphClip) {
        if (!boundsIntersect(transformed, glyphClip)) continue;
        if (visuallyPainted && geometryIndex >= 0 &&
            !boundsContainBounds(glyphClip, transformed)) {
          const key = `${glyphClip.minX},${glyphClip.minY},${glyphClip.maxX},${glyphClip.maxY}`;
          let clipIndex = clipRectIndexes.get(key);
          if (clipIndex === undefined) {
            clipIndex = clipRects.length / 4;
            clipRectIndexes.set(key, clipIndex);
            clipRects.push(glyphClip.minX, glyphClip.minY, glyphClip.maxX, glyphClip.maxY);
          }
          glyphClipReferences ??= new Uint32Array(glyphCount);
          glyphClipReferences[glyph] = clipIndex + 1;
        }
      }
      if (!boundsIntersect(transformed, pageBounds)) {
        if (visuallyPainted && geometryIndex >= 0) outOfPageCount += 1;
        continue;
      }
      if (composited && exactClip) {
        const key = `${fontIndex}:${glyphId}`;
        let ink = compositedInkBounds.get(key);
        if (ink === undefined) {
          const outline = fonts[fontIndex].getGlyphOutline(glyphId);
          ink = outline.commands.length === 0 ? null : outline.bounds;
          compositedInkBounds.set(key, ink);
        }
        if (ink) {
          const inkBounds = transformedBounds(boundsFromQuad(ink), glyphTransform);
          if (clipTester.isFullyOutside(inkBounds, exactClip, signal)) continue;
          const visibleBounds = intersectVisibleBounds(intersectVisibleBounds(inkBounds, glyphClip), pageBounds);
          if (visibleBounds) indexQuads.set(glyph, [visibleBounds.minX, visibleBounds.minY,
            visibleBounds.maxX, visibleBounds.maxY]);
        }
      }
      if (indexableByViewBox) glyphIndexable[glyph] = 1;
      if (!visuallyPainted || geometryIndex < 0) continue;
      glyphToInstance[glyph] = instanceCount++;
      if (sourceGlyphPaintBounds) {
        const visibleBounds = intersectVisibleBounds(
          intersectVisibleBounds(transformed, glyphClip),
          pageBounds
        );
        if (visibleBounds) {
          sourceGlyphPaintBounds.set([
            visibleBounds.minX,
            visibleBounds.minY,
            visibleBounds.maxX,
            visibleBounds.maxY
          ], glyph * 4);
        }
      }
      inPageCount += 1;
    }
  }

  const totalGlyphSegments = geometries.reduce(
    (total, geometry) => total + geometry.segmentsA.length / 4,
    0
  );
  if (!Number.isSafeInteger(totalGlyphSegments)) {
    throw new PdfError("resource-limit", "Native VectorScene glyph geometry is too large.", {
      pageIndex,
      details: { reason: "legacy-vector-glyph-segments" }
    });
  }
  const glyphMetaA = new Float32Array(geometries.length * 4);
  const glyphMetaB = new Float32Array(geometries.length * 4);
  const glyphSegmentsA = new Float32Array(totalGlyphSegments * 4);
  const glyphSegmentsB = new Float32Array(totalGlyphSegments * 4);
  let segmentOffset = 0;
  geometries.forEach((geometry, glyph) => {
    const meta = glyph * 4;
    glyphMetaA.set([
      segmentOffset,
      geometry.segmentsA.length / 4,
      geometry.bounds.minX,
      geometry.bounds.minY
    ], meta);
    glyphMetaB.set([geometry.bounds.maxX, geometry.bounds.maxY, 0, 0], meta);
    glyphSegmentsA.set(geometry.segmentsA, segmentOffset * 4);
    glyphSegmentsB.set(geometry.segmentsB, segmentOffset * 4);
    segmentOffset += geometry.segmentsA.length / 4;
  });

  const instanceA = new Float32Array(instanceCount * 4);
  const instanceB = new Float32Array(instanceCount * 4);
  const instanceC = new Float32Array(instanceCount * 4);
  for (let runIndex = 0; runIndex < sidecar.glyphRunMeta.length / 3; runIndex += 1) {
    const meta = runIndex * 3;
    const first = sidecar.glyphRunMeta[meta];
    const count = sidecar.glyphRunMeta[meta + 1];
    const color = sidecar.glyphFillColors.subarray(runIndex * 4, runIndex * 4 + 4);
    for (let glyph = first; glyph < first + count; glyph += 1) {
      if ((glyph & 0x3fff) === 0) throwIfAborted(signal);
      const instance = glyphToInstance[glyph];
      if (instance < 0) continue;
      const matrix = readGlyphTransform(compilation, glyph, pageIndex);
      const target = instance * 4;
      instanceA.set(matrix.subarray(0, 4), target);
      instanceB.set([
        matrix[4], matrix[5], glyphToGeometry[glyph], glyphClipReferences?.[glyph] ?? 0
      ], target);
      instanceC.set(color, target);
    }
  }

  return {
    sourceTextCount,
    inPageCount,
    outOfPageCount,
    instanceA,
    instanceB,
    instanceC,
    sourceGlyphPaintBounds,
    clipRects: Float32Array.from(clipRects),
    glyphMetaA,
    glyphMetaB,
    glyphSegmentsA,
    glyphSegmentsB,
    textIndex: convertTextIndex(
      compilation,
      fonts,
      glyphToInstance,
      glyphIndexable,
      indexQuads,
      pageIndex,
      signal
    )
  };
}

function deriveGlyphGeometry(
  font: NativePdfFont,
  glyphId: number,
  pageIndex: number,
  signal?: AbortSignal
): GlyphGeometry {
  throwIfAborted(signal);
  let outline;
  try {
    outline = font.getGlyphOutline(glyphId);
  } catch (error) {
    if (error instanceof PdfError) throw error;
    throw new PdfError("unsupported-font", `Unable to derive glyph outline ${glyphId}.`, {
      cause: error,
      pageIndex,
      details: { reason: "legacy-vector-glyph-outline", glyphId }
    });
  }
  if (!outline || outline.glyphId !== glyphId || !Array.isArray(outline.commands)) {
    throw new PdfError("unsupported-font", `Font returned an invalid outline for glyph ${glyphId}.`, {
      pageIndex,
      details: { reason: "legacy-vector-glyph-outline", glyphId }
    });
  }
  const commands = outline.commands as readonly NativeVectorGlyphPathCommand[];
  const segmentsA: number[] = [];
  const segmentsB: number[] = [];
  const bounds = emptyBounds();
  let cursorX = 0;
  let cursorY = 0;
  let firstX = 0;
  let firstY = 0;
  let contourOpen = false;

  const emitLine = (x: number, y: number): void => {
    finitePoint(x, y, glyphId, pageIndex);
    if ((x - cursorX) ** 2 + (y - cursorY) ** 2 >= 1e-12) {
      segmentsA.push(cursorX, cursorY, x, y);
      segmentsB.push(x, y, 0, 0);
      includePoint(bounds, cursorX, cursorY);
      includePoint(bounds, x, y);
    }
    cursorX = x;
    cursorY = y;
  };
  const emitQuadratic = (controlX: number, controlY: number, x: number, y: number): void => {
    finitePoint(controlX, controlY, glyphId, pageIndex);
    finitePoint(x, y, glyphId, pageIndex);
    if ((x - cursorX) ** 2 + (y - cursorY) ** 2 >= 1e-12 ||
        (controlX - cursorX) ** 2 + (controlY - cursorY) ** 2 >= 1e-12) {
      segmentsA.push(cursorX, cursorY, controlX, controlY);
      segmentsB.push(x, y, 1, 0);
      includePoint(bounds, cursorX, cursorY);
      includePoint(bounds, controlX, controlY);
      includePoint(bounds, x, y);
    }
    cursorX = x;
    cursorY = y;
  };

  for (let index = 0; index < commands.length; index += 1) {
    if ((index & 0xff) === 0) throwIfAborted(signal);
    const command = commands[index];
    if (command.kind === "move") {
      if (contourOpen) {
        throw unsupported(`Glyph ${glyphId} contains an unclosed contour.`, pageIndex,
          "legacy-vector-glyph-contour");
      }
      finitePoint(command.x, command.y, glyphId, pageIndex);
      cursorX = firstX = command.x;
      cursorY = firstY = command.y;
      contourOpen = true;
    } else if (command.kind === "line") {
      if (!contourOpen) throw unsupported(`Glyph ${glyphId} has a line outside a contour.`, pageIndex,
        "legacy-vector-glyph-contour");
      emitLine(command.x, command.y);
    } else if (command.kind === "quadratic") {
      if (!contourOpen) throw unsupported(`Glyph ${glyphId} has a curve outside a contour.`, pageIndex,
        "legacy-vector-glyph-contour");
      emitQuadratic(command.controlX, command.controlY, command.x, command.y);
    } else if (command.kind === "cubic") {
      if (!contourOpen) throw unsupported(`Glyph ${glyphId} has a curve outside a contour.`, pageIndex,
        "legacy-vector-glyph-contour");
      finitePoint(command.control1X, command.control1Y, glyphId, pageIndex);
      finitePoint(command.control2X, command.control2Y, glyphId, pageIndex);
      finitePoint(command.x, command.y, glyphId, pageIndex);
      emitCubicAsQuadratics(
        cursorX,
        cursorY,
        command.control1X,
        command.control1Y,
        command.control2X,
        command.control2Y,
        command.x,
        command.y,
        emitQuadratic
      );
    } else if (command.kind === "close") {
      if (!contourOpen) throw unsupported(`Glyph ${glyphId} closes a missing contour.`, pageIndex,
        "legacy-vector-glyph-contour");
      emitLine(firstX, firstY);
      contourOpen = false;
    } else {
      throw unsupported(`Glyph ${glyphId} uses an unsupported outline command.`, pageIndex,
        "legacy-vector-glyph-command");
    }
    if (segmentsA.length / 4 > MAX_LEGACY_GLYPH_PRIMITIVES) {
      throw unsupported(
        `Glyph ${glyphId} exceeds the legacy renderer's ${MAX_LEGACY_GLYPH_PRIMITIVES}-primitive limit.`,
        pageIndex,
        "legacy-vector-glyph-primitives"
      );
    }
  }
  if (contourOpen) {
    throw unsupported(`Glyph ${glyphId} ends with an unclosed contour.`, pageIndex,
      "legacy-vector-glyph-contour");
  }
  if (bounds.empty) includeRect(bounds, 0, 0, 0, 0);
  return { segmentsA, segmentsB, bounds: finalBounds(bounds) };
}

/** Bounded cubic approximation shared with the established legacy glyph ABI. */
function emitCubicAsQuadratics(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  emit: (controlX: number, controlY: number, x: number, y: number) => void
): void {
  const stack = [x0, y0, x1, y1, x2, y2, x3, y3, 0];
  const maximumErrorSquared = TEXT_CUBIC_TO_QUAD_ERROR ** 2;
  while (stack.length > 0) {
    const depth = stack.pop()!;
    const q3y = stack.pop()!;
    const q3x = stack.pop()!;
    const q2y = stack.pop()!;
    const q2x = stack.pop()!;
    const q1y = stack.pop()!;
    const q1x = stack.pop()!;
    const q0y = stack.pop()!;
    const q0x = stack.pop()!;
    const controlX = (3 * (q1x + q2x) - q0x - q3x) * 0.25;
    const controlY = (3 * (q1y + q2y) - q0y - q3y) * 0.25;
    if (
      depth >= MAX_TEXT_CUBIC_TO_QUAD_DEPTH ||
      cubicQuadraticErrorSquared(
        q0x, q0y, q1x, q1y, q2x, q2y, q3x, q3y, controlX, controlY
      ) <= maximumErrorSquared
    ) {
      emit(controlX, controlY, q3x, q3y);
      continue;
    }
    const x01 = (q0x + q1x) * 0.5;
    const y01 = (q0y + q1y) * 0.5;
    const x12 = (q1x + q2x) * 0.5;
    const y12 = (q1y + q2y) * 0.5;
    const x23 = (q2x + q3x) * 0.5;
    const y23 = (q2y + q3y) * 0.5;
    const x012 = (x01 + x12) * 0.5;
    const y012 = (y01 + y12) * 0.5;
    const x123 = (x12 + x23) * 0.5;
    const y123 = (y12 + y23) * 0.5;
    const middleX = (x012 + x123) * 0.5;
    const middleY = (y012 + y123) * 0.5;
    const nextDepth = depth + 1;
    // Push the second half first so the stack emits source order.
    stack.push(middleX, middleY, x123, y123, x23, y23, q3x, q3y, nextDepth);
    stack.push(q0x, q0y, x01, y01, x012, y012, middleX, middleY, nextDepth);
  }
}

function cubicQuadraticErrorSquared(
  x0: number,
  y0: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
  controlX: number,
  controlY: number
): number {
  let maximum = 0;
  for (const t of [0.25, 0.5, 0.75]) {
    const u = 1 - t;
    const cubicX = u ** 3 * x0 + 3 * u ** 2 * t * x1 +
      3 * u * t ** 2 * x2 + t ** 3 * x3;
    const cubicY = u ** 3 * y0 + 3 * u ** 2 * t * y1 +
      3 * u * t ** 2 * y2 + t ** 3 * y3;
    const quadraticX = u ** 2 * x0 + 2 * u * t * controlX + t ** 2 * x3;
    const quadraticY = u ** 2 * y0 + 2 * u * t * controlY + t ** 2 * y3;
    maximum = Math.max(
      maximum,
      (cubicX - quadraticX) ** 2 + (cubicY - quadraticY) ** 2
    );
  }
  return maximum;
}

function convertTextIndex(
  compilation: NativeTextCompilation,
  fonts: readonly NativePdfFont[],
  glyphToInstance: Int32Array,
  glyphIndexable: Uint8Array,
  indexQuads: ReadonlyMap<number, readonly number[]>,
  pageIndex: number,
  signal?: AbortSignal
): PageTextIndex {
  const source = compilation.textIndex;
  const builder = new LegacyPageTextIndexBuilder();
  for (let index = 0; index < source.charGlyphIndices.length;) {
    if ((index & 0xffff) === 0) throwIfAborted(signal);
    const reference = source.charGlyphIndices[index];
    if (reference === -1) {
      // NativeTextCompiler retains general Td/T* positioning hints in its raw
      // semantic index. The legacy scene infers those from page-space glyph
      // positions; only sign-aware TJ gaps are preserved separately below.
      index += 1;
      continue;
    }
    if (reference <= -2) {
      const fallbackIndex = -reference - 2;
      const offset = fallbackIndex * 4;
      const quad = source.fallbackQuads.subarray(offset, offset + 4);
      const unicode = source.text[index];
      if (unicode.trim().length === 0) {
        builder.appendSeparator();
      } else {
        builder.appendGlyph(unicode, -1, quad, quad[0], quad[1], quad[2], quad[1],
          Math.max(1e-6, quad[3] - quad[1]));
      }
      index += 1;
      continue;
    }

    let end = index + 1;
    while (end < source.charGlyphIndices.length &&
        source.charGlyphIndices[end] === reference) {
      end += 1;
    }
    if (glyphIndexable[reference] === 0) {
      // A fully clipped/out-of-page glyph is absent rather than an OCR
      // fallback. Do not let its source characters leak into search results.
      index = end;
      continue;
    }
    if (compilation.glyphGapBefore?.[reference] === 1) {
      builder.appendSeparator();
    }
    const unicode = source.text.slice(index, end);
    if (unicode.trim().length === 0) {
      // PDF.js exposes a decoded space glyph as a word-boundary hint rather
      // than a searchable glyph backed by a fallback quad.
      builder.appendSeparator();
      index = end;
      continue;
    }

    const font = fonts[compilation.glyphs.fontIndices[reference]];
    const matrix = readGlyphTransform(compilation, reference, pageIndex);
    const units = font.unitsPerEm;
    const advanceEm = readLegacyGlyphWidthEm(compilation, reference, pageIndex);
    const vertical = font.writingMode === 1;
    const penStartX = matrix[4];
    const penStartY = matrix[5];
    const advanceUnits = advanceEm * units;
    const penEndX = penStartX + (vertical ? matrix[2] : matrix[0]) * advanceUnits;
    const penEndY = penStartY + (vertical ? matrix[3] : matrix[1]) * advanceUnits;
    const emHeight = Math.hypot(matrix[2] * units, matrix[3] * units);
    const instance = glyphToInstance[reference];
    const quad = instance < 0
      ? indexQuads.get(reference) ?? approximateGlyphBounds(compilation, fonts, reference, pageIndex, signal)
      : null;
    builder.appendGlyph(
      unicode,
      instance,
      quad,
      penStartX,
      penStartY,
      penEndX,
      penEndY,
      emHeight
    );
    index = end;
  }
  return builder.build();
}

function boundsFromQuad(quad: ArrayLike<number>): Bounds {
  return {
    minX: quad[0],
    minY: quad[1],
    maxX: quad[2],
    maxY: quad[3]
  };
}

class LegacyPageTextIndexBuilder {
  private readonly chars: string[] = [];

  private readonly references: number[] = [];

  private readonly fallbackQuads: number[] = [];

  private prevEndX = 0;

  private prevEndY = 0;

  private prevEmHeight = 0;

  private hasPrev = false;

  private separatorPending = false;

  appendSeparator(): void {
    this.separatorPending = true;
  }

  appendGlyph(
    unicode: string,
    instance: number,
    fallbackQuad: ArrayLike<number> | null,
    penStartX: number,
    penStartY: number,
    penEndX: number,
    penEndY: number,
    emHeight: number
  ): void {
    const needsFallback = instance < 0;
    if (
      !Number.isFinite(penStartX) || !Number.isFinite(penStartY) ||
      (needsFallback && (!fallbackQuad || fallbackQuad.length !== 4 ||
        !validBounds({
          minX: fallbackQuad[0],
          minY: fallbackQuad[1],
          maxX: fallbackQuad[2],
          maxY: fallbackQuad[3]
        })))
    ) {
      this.separatorPending = true;
      return;
    }
    if (this.hasPrev && !this.separatorPending) {
      const gap = Math.hypot(penStartX - this.prevEndX, penStartY - this.prevEndY);
      if (gap > TEXT_INDEX_GAP_EM_FACTOR * Math.max(
        emHeight,
        this.prevEmHeight,
        1e-6
      )) {
        this.separatorPending = true;
      }
    }
    if (this.separatorPending && this.chars.length !== 0) {
      this.chars.push(" ");
      this.references.push(-1);
    }
    this.separatorPending = false;
    for (let index = 0; index < unicode.length; index += 1) {
      this.chars.push(unicode[index]);
      if (needsFallback) {
        const fallbackIndex = this.fallbackQuads.length / 4;
        this.fallbackQuads.push(
          fallbackQuad![0],
          fallbackQuad![1],
          fallbackQuad![2],
          fallbackQuad![3]
        );
        this.references.push(-fallbackIndex - 2);
      } else {
        this.references.push(instance);
      }
    }
    this.prevEndX = Number.isFinite(penEndX) ? penEndX : penStartX;
    this.prevEndY = Number.isFinite(penEndY) ? penEndY : penStartY;
    this.prevEmHeight = Number.isFinite(emHeight) && emHeight > 0
      ? emHeight
      : this.prevEmHeight;
    this.hasPrev = true;
  }

  build(): PageTextIndex {
    return {
      text: this.chars.join(""),
      charInstance: Int32Array.from(this.references),
      fallbackQuads: Float32Array.from(this.fallbackQuads)
    };
  }
}

function readLegacyGlyphAdvanceEm(
  compilation: NativeTextCompilation,
  glyph: number,
  pageIndex: number
): number {
  const advances = compilation.glyphAdvanceEms;
  if (!(advances instanceof Float32Array) ||
      advances.length !== compilation.glyphs.glyphIds.length) {
    throw unsupported(
      "Native text lacks the em-space advances required by the legacy search index.",
      pageIndex,
      "legacy-vector-text-advance"
    );
  }
  return advances[glyph];
}

function readLegacyGlyphWidthEm(
  compilation: NativeTextCompilation,
  glyph: number,
  pageIndex: number
): number {
  const widths = compilation.glyphWidthEms;
  if (widths instanceof Float32Array &&
      widths.length === compilation.glyphs.glyphIds.length) {
    return widths[glyph];
  }
  // Compatibility for callers constructing NativeTextCompilation directly.
  // NativeTextCompiler always supplies the exact raw width.
  return readLegacyGlyphAdvanceEm(compilation, glyph, pageIndex);
}

function approximateGlyphBounds(
  compilation: NativeTextCompilation,
  fonts: readonly NativePdfFont[],
  glyph: number,
  pageIndex: number,
  signal?: AbortSignal
): [number, number, number, number] {
  const font = fonts[compilation.glyphs.fontIndices[glyph]];
  const units = font.unitsPerEm;
  if (compilation.glyphAdvanceEms?.length === compilation.glyphs.glyphIds.length) {
    const advanceEm = compilation.glyphAdvanceEms[glyph];
    const matrix = readGlyphTransform(compilation, glyph, pageIndex);
    const bounds = transformedBounds(font.writingMode === 1
      ? {
          minX: -units * 0.5,
          minY: -Math.abs(advanceEm) * units,
          maxX: units * 0.5,
          maxY: 0
        }
      : {
          minX: 0,
          minY: -units * 0.25,
          maxX: advanceEm * units,
          maxY: units * 0.85
        }, matrix);
    if (!validBounds(bounds)) {
      throw invalid("Synthesized legacy text geometry is invalid.", pageIndex,
        "legacy-vector-text-fallback");
    }
    return [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY];
  }
  let localBounds: Bounds | null = null;
  try {
    const geometry = deriveGlyphGeometry(
      font,
      compilation.glyphs.glyphIds[glyph],
      pageIndex,
      signal
    );
    if (geometry.segmentsA.length !== 0) localBounds = geometry.bounds;
  } catch {
    // Invisible/OCR text must remain searchable even if no usable outline is
    // available. Fall back to deterministic descriptor geometry below.
  }
  const descriptor = font.descriptor.fontBBox ?? [
    0,
    Math.min(font.descriptor.descent, -250),
    1000,
    Math.max(font.descriptor.ascent, 850)
  ];
  let minX = localBounds?.minX ?? descriptor[0] * units / 1000;
  let minY = localBounds?.minY ?? descriptor[1] * units / 1000;
  let maxX = localBounds?.maxX ?? descriptor[2] * units / 1000;
  let maxY = localBounds?.maxY ?? descriptor[3] * units / 1000;
  if (minX === maxX) [minX, maxX] = [0, units];
  if (minY === maxY) [minY, maxY] = [-units / 4, units * 0.85];
  const matrix = readGlyphTransform(compilation, glyph, pageIndex);
  const bounds = transformedBounds({ minX, minY, maxX, maxY }, matrix);
  if (!validBounds(bounds)) {
    throw invalid("Synthesized legacy text geometry is invalid.", pageIndex,
      "legacy-vector-text-fallback");
  }
  return [bounds.minX, bounds.minY, bounds.maxX, bounds.maxY];
}

function readGlyphTransform(
  compilation: NativeTextCompilation,
  glyph: number,
  pageIndex: number
): Float32Array {
  const transform = compilation.glyphs.transformIndices[glyph];
  const offset = transform * 6;
  const matrix = compilation.transforms.values.subarray(offset, offset + 6);
  if (matrix.length !== 6) {
    throw invalid("A native glyph references a missing transform.", pageIndex,
      "legacy-vector-glyph-transform");
  }
  return matrix;
}

/**
 * The grouped renderer draws all raster layers before its text band. A source
 * image that followed text is therefore exact only when the image quad and
 * every already-painted glyph have disjoint conservative page-space bounds.
 * Paths are excluded earlier by DensePdfContentCompiler; Form flattening keeps
 * its stricter global source-order rejection.
 */
function validateLateImageUnderlays(
  sidecar: DensePdfLegacyVectorOutput,
  sourceGlyphPaintBounds: Float64Array,
  pageIndex: number,
  signal?: AbortSignal
): void {
  const expectedBounds = sidecar.glyphRunMeta.length === 0
    ? 0
    : (sidecar.glyphRunMeta[sidecar.glyphRunMeta.length - 3] +
      sidecar.glyphRunMeta[sidecar.glyphRunMeta.length - 2]) * 4;
  if (sourceGlyphPaintBounds.length !== expectedBounds) {
    throw invalid("Native text lacks the bounds required for a late-image proof.", pageIndex,
      "legacy-vector-image-order-bounds");
  }
  let precedingGlyphEnd = 0;
  let boundsTests = 0;
  for (let eventOffset = 0; eventOffset < sidecar.sourceEvents.length; eventOffset += 2) {
    if ((eventOffset & 0x3fff) === 0) throwIfAborted(signal);
    const kind = sidecar.sourceEvents[eventOffset];
    const localIndex = sidecar.sourceEvents[eventOffset + 1];
    if (kind === DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH) {
      const meta = localIndex * 3;
      precedingGlyphEnd = sidecar.glyphRunMeta[meta] + sidecar.glyphRunMeta[meta + 1];
      continue;
    }
    if (kind !== DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE ||
        (sidecar.imageFlags[localIndex] &
          DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_LATE_AFTER_TEXT) === 0) {
      continue;
    }
    const transformOffset = localIndex * 6;
    const imageBounds = transformedBounds(
      { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      sidecar.imageTransforms.subarray(transformOffset, transformOffset + 6)
    );
    for (let glyph = 0; glyph < precedingGlyphEnd; glyph += 1) {
      if ((glyph & 0x3fff) === 0) throwIfAborted(signal);
      const glyphOffset = glyph * 4;
      const minX = sourceGlyphPaintBounds[glyphOffset];
      if (Number.isNaN(minX)) continue;
      boundsTests += 1;
      if (boundsTests > MAX_LATE_IMAGE_GLYPH_BOUNDS_TESTS) {
        throw new PdfError(
          "resource-limit",
          "Late-image source-order proof exceeds its bounded glyph comparison limit.",
          {
            pageIndex,
            details: {
              reason: "legacy-vector-image-order-proof-limit",
              limit: MAX_LATE_IMAGE_GLYPH_BOUNDS_TESTS
            }
          }
        );
      }
      const glyphBounds: Bounds = {
        minX,
        minY: sourceGlyphPaintBounds[glyphOffset + 1],
        maxX: sourceGlyphPaintBounds[glyphOffset + 2],
        maxY: sourceGlyphPaintBounds[glyphOffset + 3]
      };
      if (!boundsProvablyDisjoint(glyphBounds, imageBounds)) {
        throw new PdfError(
          "unsupported-content",
          "A source-ordered image overlaps preceding visible text and cannot be moved to the raster underlay.",
          {
            pageIndex,
            details: {
              reason: "legacy-vector-image-order-overlap",
              imageInvocationIndex: localIndex,
              glyphIndex: glyph
            }
          }
        );
      }
    }
  }
}

function buildRasterLayers(
  registry: LegacyVectorImageRegistry,
  sidecar: DensePdfLegacyVectorOutput,
  pageBounds: Readonly<DensePdfBounds>,
  pageIndex: number,
  signal?: AbortSignal
): RasterLayer[] {
  if (!Number.isSafeInteger(registry.size) || registry.size < 0) {
    throw invalid("The native image registry has an invalid size.", pageIndex,
      "legacy-vector-image-registry");
  }
  const order = Array.from(sidecar.imageIndices, (_value, invocation) => invocation);
  order.sort((left, right) =>
    sidecar.imagePaintOrders[left] - sidecar.imagePaintOrders[right] || left - right
  );
  const layers: RasterLayer[] = [];
  let compositedImages: Map<number, Uint8Array> | null = null;
  for (const invocation of order) {
    throwIfAborted(signal);
    if ((sidecar.imageFlags[invocation] & ~(
          DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_CLIPPED |
          DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_LATE_AFTER_TEXT |
          DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_LATE_AFTER_PATH
        )) !== 0) {
      throw invalid("A native image underlay uses unknown compatibility flags.",
        pageIndex, "legacy-vector-image-flags");
    }
    const imageIndex = sidecar.imageIndices[invocation];
    if (imageIndex >= registry.size) {
      throw invalid("A native image invocation references a missing image.", pageIndex,
        "legacy-vector-image-index");
    }
    const image = registry.describe(imageIndex);
    let imageData: Uint8Array;
    if (image.softMaskImageIndex >= 0) {
      compositedImages ??= new Map<number, Uint8Array>();
      imageData = compositedImages.get(imageIndex) ?? compositeLegacySoftMaskedImage(
        registry,
        image,
        imageIndex,
        pageIndex,
        signal
      );
      compositedImages.set(imageIndex, imageData);
    } else {
      validateLegacyImage(image, imageIndex, pageIndex, false);
      imageData = image.data;
    }
    const transformOffset = invocation * 6;
    const transform = sidecar.imageTransforms.subarray(transformOffset, transformOffset + 6);
    for (const value of transform) {
      if (!Number.isFinite(value)) {
        throw invalid("A native image transform is not finite.", pageIndex,
          "legacy-vector-image-transform");
      }
    }
    const clipOffset = invocation * 4;
    const clipBounds = {
      minX: sidecar.imageClipBounds[clipOffset],
      minY: sidecar.imageClipBounds[clipOffset + 1],
      maxX: sidecar.imageClipBounds[clipOffset + 2],
      maxY: sidecar.imageClipBounds[clipOffset + 3]
    };
    if (!validBounds(clipBounds)) {
      throw invalid("A native image clip bound is invalid.", pageIndex,
        "legacy-vector-image-clip-bounds");
    }
    let layerWidth = image.width;
    let layerHeight = image.height;
    let layerData = imageData;
    let layerMatrix = flipImageMatrix(transform);
    if ((sidecar.imageFlags[invocation] & DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_CLIPPED) !== 0 &&
        !boundsContainBoundsExactly(
          clipBounds,
          transformedBounds({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, transform)
        )) {
      const clipped = clipLegacyNearestImage(
        imageData,
        image.width,
        image.height,
        transform,
        clipBounds,
        pageBounds,
        image.interpolate,
        pageIndex,
        imageIndex,
        signal
      );
      layerWidth = clipped.width;
      layerHeight = clipped.height;
      layerData = clipped.data;
      layerMatrix = clipped.matrix;
    }
    layers.push({
      width: layerWidth,
      height: layerHeight,
      data: layerData,
      matrix: layerMatrix,
      paintOrder: sidecar.imagePaintOrders[invocation],
      pageIndex: 0
    });
  }
  return layers;
}

function clipLegacyNearestImage(
  source: Uint8Array,
  sourceWidth: number,
  sourceHeight: number,
  sourceTransform: Float32Array,
  clip: Readonly<Bounds>,
  pageBounds: Readonly<Bounds>,
  interpolate: boolean,
  pageIndex: number,
  imageIndex: number,
  signal?: AbortSignal
): { width: number; height: number; data: Uint8Array; matrix: Float32Array } {
  if (interpolate || sourceTransform[1] !== 0 || sourceTransform[2] !== 0 ||
      sourceTransform[0] === 0 || sourceTransform[3] === 0) {
    throw unsupported(
      "A clipped image requires interpolation or a non-axis-aligned resample.",
      pageIndex,
      "legacy-vector-image-clip",
      { imageIndex, interpolate }
    );
  }
  const imageBounds = transformedBounds(
    { minX: 0, minY: 0, maxX: 1, maxY: 1 },
    sourceTransform
  );
  const visible = intersectVisibleBounds(
    intersectVisibleBounds(imageBounds, clip),
    pageBounds
  );
  if (!visible || visible.maxX <= visible.minX || visible.maxY <= visible.minY) {
    throw invalid("A clipped image has no visible rectangular extent.", pageIndex,
      "legacy-vector-image-empty-clip");
  }

  // Preserve the original image sampling phase. Cropping to `visible` and
  // stretching those pixels over the clip changes every sample whenever the
  // clip cuts through a source texel. The established adapter instead
  // rendered the original transform onto a native-resolution device grid,
  // retained two pixels around the placement, and let the clip make excluded
  // pixels transparent. Reproduce that representation here without changing
  // the renderer-facing VectorScene/HEP v6 ABI.
  const placement = intersectVisibleBounds(imageBounds, pageBounds);
  if (!placement || placement.maxX <= placement.minX || placement.maxY <= placement.minY) {
    throw invalid("A clipped image has no on-page placement.", pageIndex,
      "legacy-vector-image-empty-clip");
  }
  const nativeScale = Math.max(
    sourceWidth / Math.abs(sourceTransform[0]),
    sourceHeight / Math.abs(sourceTransform[3])
  );
  const scale = chooseLegacyRasterScale(
    Math.max(1, Math.ceil(placement.maxX - placement.minX)),
    Math.max(1, Math.ceil(placement.maxY - placement.minY)),
    nativeScale
  );
  const pageDeviceWidth = (pageBounds.maxX - pageBounds.minX) * scale;
  const pageDeviceHeight = (pageBounds.maxY - pageBounds.minY) * scale;
  const placedMinX = (imageBounds.minX - pageBounds.minX) * scale;
  const placedMaxX = (imageBounds.maxX - pageBounds.minX) * scale;
  const placedMinY = (pageBounds.maxY - imageBounds.maxY) * scale;
  const placedMaxY = (pageBounds.maxY - imageBounds.minY) * scale;
  const cropMinX = Math.max(0, Math.floor(placedMinX - LEGACY_RASTER_CROP_PADDING_PX));
  const cropMinY = Math.max(0, Math.floor(placedMinY - LEGACY_RASTER_CROP_PADDING_PX));
  const cropMaxX = Math.min(
    Math.ceil(pageDeviceWidth),
    Math.ceil(placedMaxX + LEGACY_RASTER_CROP_PADDING_PX)
  );
  const cropMaxY = Math.min(
    Math.ceil(pageDeviceHeight),
    Math.ceil(placedMaxY + LEGACY_RASTER_CROP_PADDING_PX)
  );
  const width = cropMaxX - cropMinX;
  const height = cropMaxY - cropMinY;
  const pixelCount = width * height;
  if (!Number.isSafeInteger(width) || width <= 0 ||
      !Number.isSafeInteger(height) || height <= 0 ||
      !Number.isSafeInteger(pixelCount) ||
      width > LEGACY_RASTER_MAX_DIMENSION || height > LEGACY_RASTER_MAX_DIMENSION ||
      pixelCount > LEGACY_RASTER_MAX_PIXELS) {
    throw new PdfError(
      "resource-limit",
      "A clipped image exceeds the bounded legacy raster dimensions.",
      {
        pageIndex,
        details: {
          reason: "legacy-vector-image-clip-size",
          imageIndex,
          width,
          height,
          maxDimension: LEGACY_RASTER_MAX_DIMENSION,
          maxPixels: LEGACY_RASTER_MAX_PIXELS
        }
      }
    );
  }
  const data = new Uint8Array(pixelCount * 4);
  const display = flipImageMatrix(sourceTransform);
  const contentDeviceBounds = intersectVisibleBounds(
    {
      minX: placedMinX,
      minY: placedMinY,
      maxX: placedMaxX,
      maxY: placedMaxY
    },
    {
      minX: (clip.minX - pageBounds.minX) * scale,
      minY: (pageBounds.maxY - clip.maxY) * scale,
      maxX: (clip.maxX - pageBounds.minX) * scale,
      maxY: (pageBounds.maxY - clip.minY) * scale
    }
  );
  if (!contentDeviceBounds) {
    throw invalid("A clipped image has no visible device extent.", pageIndex,
      "legacy-vector-image-empty-clip");
  }
  const sourceColumns = new Int32Array(width);
  const columnCoverage = new Float32Array(width);
  for (let x = 0; x < width; x += 1) {
    const deviceX = cropMinX + x;
    const coverage = intervalCoverage(
      deviceX,
      deviceX + 1,
      contentDeviceBounds.minX,
      contentDeviceBounds.maxX
    );
    columnCoverage[x] = coverage;
    if (coverage === 0) continue;
    const pageX = pageBounds.minX + (deviceX + 0.5) / scale;
    const textureX = (pageX - display[4]) / display[0];
    sourceColumns[x] = clampInteger(
      Math.floor(textureX * sourceWidth),
      0,
      sourceWidth - 1
    );
  }
  for (let y = 0; y < height; y += 1) {
    if ((y & 0xff) === 0) throwIfAborted(signal);
    const deviceY = cropMinY + y;
    const rowCoverage = intervalCoverage(
      deviceY,
      deviceY + 1,
      contentDeviceBounds.minY,
      contentDeviceBounds.maxY
    );
    if (rowCoverage === 0) continue;
    const pageY = pageBounds.maxY - (deviceY + 0.5) / scale;
    const textureY = (pageY - display[5]) / display[3];
    const sourceY = clampInteger(Math.floor(textureY * sourceHeight), 0, sourceHeight - 1);
    for (let x = 0; x < width; x += 1) {
      const coverage = rowCoverage * columnCoverage[x];
      if (coverage === 0) continue;
      const sourceOffset = (sourceY * sourceWidth + sourceColumns[x]) * 4;
      const targetOffset = (y * width + x) * 4;
      data[targetOffset] = source[sourceOffset];
      data[targetOffset + 1] = source[sourceOffset + 1];
      data[targetOffset + 2] = source[sourceOffset + 2];
      data[targetOffset + 3] = coverage >= 1
        ? source[sourceOffset + 3]
        : Math.round(source[sourceOffset + 3] * coverage);
    }
  }
  return {
    width,
    height,
    data,
    matrix: new Float32Array([
      width / scale,
      0,
      0,
      -height / scale,
      pageBounds.minX + cropMinX / scale,
      pageBounds.maxY - cropMinY / scale
    ])
  };
}

function chooseLegacyRasterScale(
  baseWidth: number,
  baseHeight: number,
  targetScale: number
): number {
  let scale = Math.max(
    1,
    Math.min(LEGACY_RASTER_MAX_SCALE, Number.isFinite(targetScale) ? targetScale : 1)
  );
  while (scale > 1) {
    const width = Math.max(1, Math.ceil(baseWidth * scale));
    const height = Math.max(1, Math.ceil(baseHeight * scale));
    if (width <= LEGACY_RASTER_MAX_DIMENSION &&
        height <= LEGACY_RASTER_MAX_DIMENSION &&
        width * height <= LEGACY_RASTER_MAX_PIXELS) {
      return scale;
    }
    scale *= 0.85;
    if (scale < 1.05) return 1;
  }
  return 1;
}

function intervalCoverage(
  pixelMin: number,
  pixelMax: number,
  contentMin: number,
  contentMax: number
): number {
  return Math.max(0, Math.min(pixelMax, contentMax) - Math.max(pixelMin, contentMin));
}

function validateLegacyImage(
  image: Readonly<NativePdfImageDescription>,
  imageIndex: number,
  pageIndex: number,
  allowSoftMask: boolean
): void {
  const expectedBytes = image.width * image.height * 4;
  if (
    !Number.isSafeInteger(image.width) || image.width <= 0 ||
    !Number.isSafeInteger(image.height) || image.height <= 0 ||
    !Number.isSafeInteger(expectedBytes) ||
    !(image.data instanceof Uint8Array) || image.data.length !== expectedBytes ||
    image.format !== HEPR_IMAGE_FORMAT.Rgba8 || image.sourceBitsPerComponent !== 8 ||
    image.imageMask || image.codecRequest !== null ||
    (allowSoftMask
      ? image.softMaskImageIndex < 0 || image.maskKind !== "soft"
      : image.softMaskImageIndex !== -1 ||
        (image.maskKind !== "none" && image.maskKind !== "color-key") ||
        image.matte.length !== 0)
  ) {
    throw new PdfError(
      "unsupported-image",
      `Image ${imageIndex} is not a directly renderable RGBA8 underlay.`,
      {
        pageIndex,
        details: {
          reason: "legacy-vector-image-format",
          imageIndex,
          width: image.width,
          height: image.height,
          sourceBitsPerComponent: image.sourceBitsPerComponent,
          format: image.format,
          interpolate: image.interpolate,
          imageMask: image.imageMask,
          softMaskImageIndex: image.softMaskImageIndex,
          maskKind: image.maskKind,
          matteComponents: image.matte.length,
          pendingCodec: image.codecRequest?.codec ?? null
        }
      }
    );
  }
}

/**
 * Collapse an Image XObject SMask into the legacy layer's straight RGBA data.
 * This is the same bounded per-pixel operation used by the page-native
 * renderers; it allocates only for images that actually carry a soft mask.
 */
function compositeLegacySoftMaskedImage(
  registry: LegacyVectorImageRegistry,
  image: Readonly<NativePdfImageDescription>,
  imageIndex: number,
  pageIndex: number,
  signal?: AbortSignal
): Uint8Array {
  validateLegacyImage(image, imageIndex, pageIndex, true);
  if (image.softMaskImageIndex >= registry.size) {
    throw invalid("A native image references a missing soft mask.", pageIndex,
      "legacy-vector-image-soft-mask-index");
  }
  const mask = registry.describe(image.softMaskImageIndex);
  validateLegacyImage(mask, image.softMaskImageIndex, pageIndex, false);
  const colors = registry.colors;
  let matteRgb: readonly [number, number, number] | null = null;
  if (image.matte.length !== 0) {
    if (!colors || image.colorSpaceIndex < 0) {
      throw unsupported("A native image matte has no canonical color converter.", pageIndex,
        "legacy-vector-image-matte-color");
    }
    const color = colors.describe(image.colorSpaceIndex);
    if (color.componentCount !== image.matte.length) {
      throw invalid("A native image matte has incompatible color components.", pageIndex,
        "legacy-vector-image-matte-components");
    }
    const converted = colors.convertToSrgb(image.colorSpaceIndex, image.matte, signal);
    if (converted.length !== 3 || converted.some((value) => !Number.isFinite(value))) {
      throw invalid("A native image matte conversion returned invalid sRGB.", pageIndex,
        "legacy-vector-image-matte-color");
    }
    matteRgb = [clampUnit(converted[0]), clampUnit(converted[1]), clampUnit(converted[2])];
  }

  const output = new Uint8Array(image.data.length);
  output.set(image.data);
  const pixelCount = image.width * image.height;
  for (let pixel = 0; pixel < pixelCount; pixel += 1) {
    if ((pixel & 0x3fff) === 0) throwIfAborted(signal);
    const x = pixel % image.width;
    const y = Math.floor(pixel / image.width);
    const factor = sampleLegacyImageMask(
      mask,
      x,
      y,
      image.width,
      image.height,
      mask.interpolate
    );
    const offset = pixel * 4;
    if (matteRgb && factor > 0) {
      for (let component = 0; component < 3; component += 1) {
        const color = output[offset + component] / 255;
        output[offset + component] = Math.round(clampUnit(
          (color - matteRgb[component] * (1 - factor)) / factor
        ) * 255);
      }
    } else if (matteRgb) {
      output[offset] = 0;
      output[offset + 1] = 0;
      output[offset + 2] = 0;
    }
    output[offset + 3] = Math.round(output[offset + 3] * factor);
  }
  return output;
}

function sampleLegacyImageMask(
  image: Readonly<NativePdfImageDescription>,
  x: number,
  y: number,
  targetWidth: number,
  targetHeight: number,
  interpolate: boolean
): number {
  if (!interpolate) {
    const sourceX = Math.min(image.width - 1, Math.floor((x + 0.5) * image.width / targetWidth));
    const sourceY = Math.min(image.height - 1, Math.floor((y + 0.5) * image.height / targetHeight));
    return legacyImageMaskPixel(image, sourceX, sourceY);
  }
  const sourceX = (x + 0.5) * image.width / targetWidth - 0.5;
  const sourceY = (y + 0.5) * image.height / targetHeight - 0.5;
  const floorX = Math.floor(sourceX);
  const floorY = Math.floor(sourceY);
  const x0 = clampInteger(floorX, 0, image.width - 1);
  const y0 = clampInteger(floorY, 0, image.height - 1);
  const x1 = Math.min(image.width - 1, x0 + 1);
  const y1 = Math.min(image.height - 1, y0 + 1);
  const tx = clampUnit(sourceX - floorX);
  const ty = clampUnit(sourceY - floorY);
  const top = legacyImageMaskPixel(image, x0, y0) * (1 - tx) +
    legacyImageMaskPixel(image, x1, y0) * tx;
  const bottom = legacyImageMaskPixel(image, x0, y1) * (1 - tx) +
    legacyImageMaskPixel(image, x1, y1) * tx;
  return top * (1 - ty) + bottom * ty;
}

function legacyImageMaskPixel(
  image: Readonly<NativePdfImageDescription>,
  x: number,
  y: number
): number {
  const offset = (y * image.width + x) * 4;
  return image.data[offset] / 255 * (image.data[offset + 3] / 255);
}

function clampInteger(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value));
}

function clampUnit(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function flipImageMatrix(matrix: Float32Array): Float32Array {
  // PDF images address rows bottom-up relative to the legacy RGBA layer.
  return new Float32Array([
    matrix[0],
    matrix[1],
    matrix[2] === 0 ? 0 : -matrix[2],
    matrix[3] === 0 ? 0 : -matrix[3],
    matrix[2] + matrix[4],
    matrix[3] + matrix[5]
  ]);
}

function validFont(font: NativePdfFont): boolean {
  return typeof font === "object" && font !== null &&
    typeof font.getGlyphOutline === "function" &&
    Number.isSafeInteger(font.unitsPerEm) && font.unitsPerEm > 0 &&
    (font.writingMode === 0 || font.writingMode === 1) &&
    typeof font.descriptor === "object" && font.descriptor !== null &&
    Number.isFinite(font.descriptor.ascent) && Number.isFinite(font.descriptor.descent);
}

function transformedBounds(bounds: Readonly<Bounds>, matrix: Float32Array): Bounds {
  const result = emptyBounds();
  for (const [x, y] of [
    [bounds.minX, bounds.minY],
    [bounds.minX, bounds.maxY],
    [bounds.maxX, bounds.minY],
    [bounds.maxX, bounds.maxY]
  ] as const) {
    includePoint(
      result,
      matrix[0] * x + matrix[2] * y + matrix[4],
      matrix[1] * x + matrix[3] * y + matrix[5]
    );
  }
  return finalBounds(result);
}

function includePackedGeometryBounds(
  bounds: MutableBounds,
  compiled: DensePdfCompiledPage
): void {
  if (compiled.fillBounds) {
    // Fill metadata is stored as Float32, while the compiler accumulates the
    // same emitted rectangles before storing them. Float32 rounding is
    // monotonic, so rounding the four extrema once is exactly equivalent to
    // rescanning and rounding every fill-path rectangle.
    const minX = Math.fround(compiled.fillBounds.minX);
    const minY = Math.fround(compiled.fillBounds.minY);
    const maxX = Math.fround(compiled.fillBounds.maxX);
    const maxY = Math.fround(compiled.fillBounds.maxY);
    if (
      Number.isFinite(minX) && Number.isFinite(minY) &&
      Number.isFinite(maxX) && Number.isFinite(maxY)
    ) {
      includeRect(bounds, minX, minY, maxX, maxY);
    } else {
      // A finite PDF coordinate can overflow when packed to Float32. Retain
      // the established per-path non-finite filtering on that exceptional
      // input instead of coupling unrelated x/y extrema in the aggregate.
      includeFillBoundsFromStore(bounds, compiled);
    }
  }
  if (compiled.strokeBounds) {
    // Stroke finalization already derives this aggregate from the retained
    // Float32 primitiveBounds store, including clipping and containment cull.
    includeBounds(bounds, compiled.strokeBounds);
  }
}

function includeFillBoundsFromStore(
  bounds: MutableBounds,
  compiled: DensePdfCompiledPage
): void {
  for (let path = 0; path < compiled.fillPathCount; path += 1) {
    const offset = path * 4;
    includeRect(
      bounds,
      compiled.fillPathMetaA[offset + 2],
      compiled.fillPathMetaA[offset + 3],
      compiled.fillPathMetaB[offset],
      compiled.fillPathMetaB[offset + 1]
    );
  }
}

function includeTextBounds(bounds: MutableBounds, text: TextBuildResult): void {
  for (let instance = 0; instance < text.instanceA.length / 4; instance += 1) {
    const offset = instance * 4;
    const glyph = Math.trunc(text.instanceB[offset + 2]);
    const glyphOffset = glyph * 4;
    const matrix = new Float32Array([
      text.instanceA[offset], text.instanceA[offset + 1],
      text.instanceA[offset + 2], text.instanceA[offset + 3],
      text.instanceB[offset], text.instanceB[offset + 1]
    ]);
    includeBounds(bounds, transformedBounds({
      minX: text.glyphMetaA[glyphOffset + 2],
      minY: text.glyphMetaA[glyphOffset + 3],
      maxX: text.glyphMetaB[glyphOffset],
      maxY: text.glyphMetaB[glyphOffset + 1]
    }, matrix));
  }
}

function includeTransformedUnitBounds(bounds: MutableBounds, matrix: Float32Array): void {
  includeBounds(bounds, transformedBounds({ minX: 0, minY: 0, maxX: 1, maxY: 1 }, matrix));
}

function boundsIntersect(left: Readonly<Bounds>, right: Readonly<Bounds>): boolean {
  return left.maxX >= right.minX && left.minX <= right.maxX &&
    left.maxY >= right.minY && left.minY <= right.maxY;
}

function intersectVisibleBounds(
  left: Readonly<Bounds> | null,
  right: Readonly<Bounds> | null
): Bounds | null {
  if (!left) return null;
  if (!right) return { ...left };
  const minX = Math.max(left.minX, right.minX);
  const minY = Math.max(left.minY, right.minY);
  const maxX = Math.min(left.maxX, right.maxX);
  const maxY = Math.min(left.maxY, right.maxY);
  return minX <= maxX && minY <= maxY ? { minX, minY, maxX, maxY } : null;
}

/**
 * Expand the comparison by a page-coordinate tolerance before declaring two
 * Float32 GPU primitives disjoint. This can conservatively reject a near miss,
 * but can never accept an overlap caused by shader arithmetic rounding.
 */
function boundsProvablyDisjoint(left: Readonly<Bounds>, right: Readonly<Bounds>): boolean {
  const scale = Math.max(
    1,
    Math.abs(left.minX),
    Math.abs(left.minY),
    Math.abs(left.maxX),
    Math.abs(left.maxY),
    Math.abs(right.minX),
    Math.abs(right.minY),
    Math.abs(right.maxX),
    Math.abs(right.maxY)
  );
  const margin = Math.max(1e-5, scale * 1e-6);
  return left.maxX + margin < right.minX - margin ||
    right.maxX + margin < left.minX - margin ||
    left.maxY + margin < right.minY - margin ||
    right.maxY + margin < left.minY - margin;
}

function boundsContainBounds(outer: Readonly<Bounds>, inner: Readonly<Bounds>): boolean {
  const epsilon = Math.max(1e-5, Math.max(
    outer.maxX - outer.minX,
    outer.maxY - outer.minY
  ) * 1e-6);
  return inner.minX >= outer.minX - epsilon && inner.minY >= outer.minY - epsilon &&
    inner.maxX <= outer.maxX + epsilon && inner.maxY <= outer.maxY + epsilon;
}

/** A proof-only containment check: never forgive geometry outside the clip. */
function boundsContainBoundsExactly(outer: Readonly<Bounds>, inner: Readonly<Bounds>): boolean {
  return inner.minX >= outer.minX && inner.minY >= outer.minY &&
    inner.maxX <= outer.maxX && inner.maxY <= outer.maxY;
}

function validBounds(bounds: Readonly<Bounds>): boolean {
  return Number.isFinite(bounds.minX) && Number.isFinite(bounds.minY) &&
    Number.isFinite(bounds.maxX) && Number.isFinite(bounds.maxY) &&
    bounds.minX <= bounds.maxX && bounds.minY <= bounds.maxY;
}

function emptyBounds(): MutableBounds {
  return {
    minX: Infinity,
    minY: Infinity,
    maxX: -Infinity,
    maxY: -Infinity,
    empty: true
  };
}

function includePoint(bounds: MutableBounds, x: number, y: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) return;
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
  bounds.empty = false;
}

function includeRect(
  bounds: MutableBounds,
  minX: number,
  minY: number,
  maxX: number,
  maxY: number
): void {
  includePoint(bounds, minX, minY);
  includePoint(bounds, maxX, maxY);
}

function includeBounds(target: MutableBounds, source: Readonly<Bounds>): void {
  includeRect(target, source.minX, source.minY, source.maxX, source.maxY);
}

function finalBounds(bounds: MutableBounds): Bounds {
  return {
    minX: bounds.minX,
    minY: bounds.minY,
    maxX: bounds.maxX,
    maxY: bounds.maxY
  };
}

function finitePoint(x: number, y: number, glyphId: number, pageIndex: number): void {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    throw new PdfError("unsupported-font", `Glyph ${glyphId} contains non-finite geometry.`, {
      pageIndex,
      details: { reason: "legacy-vector-glyph-coordinate", glyphId }
    });
  }
}

function readPositiveLimit(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return value;
}

function invalid(message: string, pageIndex: number, reason: string): PdfError {
  return new PdfError("invalid-object", message, { pageIndex, details: { reason } });
}

function unsupported(
  message: string,
  pageIndex: number,
  reason: string,
  details: Readonly<Record<string, string | number | boolean | null>> = {}
): PdfError {
  return new PdfError("unsupported-content", message, { pageIndex, details: { reason, ...details } });
}
