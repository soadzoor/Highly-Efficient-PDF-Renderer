/**
 * Allocation-conscious native compiler for PDF page content streams.
 *
 * The caller is responsible for resolving and decoding page content streams.
 * The compiler grows by resource-aware handlers while retaining this streaming,
 * allocation-conscious core. Unsupported visible content throws a typed error;
 * callers can then apply bounded fallback without silently omitting content.
 */

export type DensePdfMatrix = [number, number, number, number, number, number];

export interface DensePdfBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
}

export interface DensePdfContentBytesSegment {
  readonly kind: "content";
  readonly bytes: Uint8Array;
  /** Absolute offset in the logical decoded content source. */
  readonly sourceOffset: number;
  readonly sourceLength: number;
}

/** A prepared inline image already registered in the page image store. */
export interface DensePdfInlineImageSegment {
  readonly kind: "image";
  readonly imageIndex: number;
  /** Exact BI…EI span in the logical decoded content source. */
  readonly sourceOffset: number;
  readonly sourceLength: number;
}

export type DensePdfContentSegment =
  | DensePdfContentBytesSegment
  | DensePdfInlineImageSegment;

export type DensePdfContentSource =
  | Uint8Array
  | Iterable<Uint8Array>
  | AsyncIterable<Uint8Array>;

export type DensePdfPreparedContentSource =
  | Iterable<DensePdfContentSegment>
  | AsyncIterable<DensePdfContentSegment>;

export interface DensePdfCompileProgress {
  phase: "scanning" | "finalizing";
  processedBytes: number;
  totalBytes?: number;
  operatorCount: number;
  sourceSegmentCount: number;
}

export type DensePdfBlendMode =
  | "Normal" | "Multiply" | "Screen" | "Overlay" | "Darken" | "Lighten"
  | "ColorDodge" | "ColorBurn" | "HardLight" | "SoftLight" | "Difference"
  | "Exclusion" | "Hue" | "Saturation" | "Color" | "Luminosity";

export interface DensePdfFontSelection {
  readonly fontIndex: number;
  readonly size: number;
}

/** Rendering behavior for one native-registry `/ExtGState` resource. */
export interface DensePdfExtGStateDefinition {
  resourceName: string;
  font?: Readonly<DensePdfFontSelection>;
  strokeAlpha?: number;
  fillAlpha?: number;
  blendMode?: DensePdfBlendMode;
  /** Undefined leaves the current mask unchanged; null implements `/SMask /None`. */
  softMaskIndex?: number | null;
  strokeOverprint?: boolean;
  fillOverprint?: boolean;
  overprintMode?: 0 | 1;
  alphaIsShape?: boolean;
  textKnockout?: boolean;
  lineWidth?: number;
  lineCap?: 0 | 1 | 2;
  lineJoin?: 0 | 1 | 2;
  miterLimit?: number;
  lineDash?: readonly number[];
  dashPhase?: number;
  renderingIntent?: string;
  flatnessTolerance?: number;
  smoothnessTolerance?: number;
  strokeAdjustment?: boolean;
}

/** Composite/overprint state captured at exactly one source paint operator. */
export interface DensePdfCompositeState {
  readonly alpha: number;
  /** Whether alpha/mask values modify source shape instead of source opacity. */
  readonly alphaIsShape: boolean;
  readonly blendMode: DensePdfBlendMode;
  readonly softMaskIndex: number;
  readonly overprint: boolean;
  readonly overprintMode: 0 | 1;
}

/** Optional native text interpreter fed by the compiler's sole content lexer. */
export interface DensePdfTextOperatorSink {
  /** Selected page-local font, captured for reusable-program inheritance. */
  getFontSelection?(): Readonly<DensePdfFontSelection> | undefined;
  applyOperator(
    operator: string,
    operands: readonly unknown[],
    context: Readonly<DensePdfTextOperatorContext>
  ): void | readonly DensePdfTextPaintRun[];
}

/** Static marked/optional-content state at one source operator. */
export interface DensePdfTextOperatorContext {
  /** Present only when gs selects a font dictionary and text-space size. */
  readonly font?: Readonly<DensePdfFontSelection>;
  readonly outputEnabled: boolean;
  readonly optionalContentIndex: number;
  readonly markedContentIndex: number;
}

/** A glyph span emitted synchronously by one source text-show operator. */
export interface DensePdfTextPaintRun {
  readonly first: number;
  readonly count: number;
  readonly renderingMode: number;
}

/** Synchronously pre-resolved PDF color space used by the streaming compiler. */
export interface DensePdfColorSpaceDefinition {
  readonly resourceName: string;
  /** Page-local index in `HeprColorStore`, or -1 for a resource-free standalone compile. */
  readonly colorSpaceIndex: number;
  readonly componentCount: number;
  readonly initialComponents: readonly number[];
  convertToSrgb(components: readonly number[]): readonly [number, number, number];
}

/** `/Pattern` color-space selection resolved before streaming compilation. */
export interface DensePdfPatternColorSpaceDefinition {
  readonly resourceName: string;
  /** Null for colored tiling/shading patterns; present for uncolored tiling patterns. */
  readonly baseColorSpace: Readonly<DensePdfColorSpaceDefinition> | null;
}

/** One named `/Pattern` resource resolved in the active resource scope. */
export interface DensePdfPatternDefinition {
  readonly resourceName: string;
  readonly patternIndex: number;
  readonly kind: "colored-tiling" | "uncolored-tiling" | "shading";
  /** Proven opaque, uniform coverage of a gapless colored tiling cell. */
  readonly solidColor?: readonly [number, number, number];
  /** PatternType 2 `/ExtGState`; merged at the exact source paint position. */
  readonly hasExtGState: boolean;
  readonly extGState?: Readonly<DensePdfExtGStateDefinition>;
}

export type DensePdfColorSpaceResolver = (
  resourceName: string
) => Readonly<DensePdfColorSpaceDefinition> | undefined;

/** Supported graphics state inherited by a specialized Form invocation. */
export interface DensePdfInitialGraphicsState {
  readonly font?: Readonly<DensePdfFontSelection>;
  readonly lineWidth: number;
  readonly lineCap: number;
  readonly lineDash: readonly number[];
  readonly dashPhase: number;
  readonly strokeColor: readonly [number, number, number];
  readonly fillColor: readonly [number, number, number];
  readonly strokeColorSpace: Readonly<DensePdfColorSpaceDefinition>;
  readonly fillColorSpace: Readonly<DensePdfColorSpaceDefinition>;
  /** Late-bound caller paint propagated through reusable content. */
  readonly strokePaintInherited?: boolean;
  /** Late-bound caller paint propagated through reusable content. */
  readonly fillPaintInherited?: boolean;
  readonly strokeAlpha: number;
  readonly fillAlpha: number;
  readonly alphaIsShape?: boolean;
  readonly blendMode?: DensePdfBlendMode;
  readonly softMaskIndex?: number;
  readonly strokeOverprint?: boolean;
  readonly fillOverprint?: boolean;
  readonly overprintMode?: 0 | 1;
  readonly textKnockout?: boolean;
  readonly lineJoin?: 0 | 1 | 2;
  readonly miterLimit?: number;
  readonly renderingIntent?: string | null;
  readonly flatnessTolerance?: number | null;
  readonly smoothnessTolerance?: number | null;
  readonly strokeAdjustment?: boolean;
}

/** One source-positioned Form invocation recorded by the streaming compiler. */
export interface DensePdfFormPaint {
  readonly vectorClip?: DensePdfTextClip | null;
  readonly definitionIndex: number;
  readonly transform: DensePdfMatrix;
  /** Conservative culling bounds only; exact semantics use paintRunClipIndices. */
  readonly clipBounds: DensePdfBounds;
  /** True only when no source W/W* clip has modified the invocation scope. */
  readonly clipIsDefault: boolean;
  /** True when the active caller clip is exactly one axis-aligned rectangle. */
  readonly clipIsExactRectangle: boolean;
  readonly initialGraphicsState: DensePdfInitialGraphicsState;
}

/** One direct `/Shading` paint with the graphics state live at the `sh` operator. */
export interface DensePdfShadingPaint {
  readonly gradientIndex: number;
  readonly transform: DensePdfMatrix;
  /** Conservative culling bounds only; exact semantics use paintRunClipIndices. */
  readonly clipBounds: DensePdfBounds;
}

/** One exact path role painted by a pattern with the graphics state live at paint time. */
export interface DensePdfPatternPaint {
  readonly patternIndex: number;
  readonly pathIndex: number;
  readonly fillRule: 0 | 1;
  readonly role: "fill" | "stroke";
  readonly transform: DensePdfMatrix;
  /** Present only for an uncolored tiling-pattern use. */
  readonly baseColor: DensePdfSolidPaint | null;
  /** Present only for a stroked path role. */
  readonly strokeStyle: DensePdfGenericStrokeStyle | null;
  /** Conservative culling metadata; never substitutes for the exact path. */
  readonly bounds: DensePdfBounds;
}

/** Pre-resolved page/Form `/Properties` semantics used by BDC and DP. */
/**
 * Loads page resources on first use while content streams in. Fonts and color
 * spaces go to the caller's own text engine and `colorSpaceResolver`.
 */
export interface DensePdfResourceLoader {
  font(resourceName: string): Promise<void>;
  extGState(resourceName: string): Promise<DensePdfExtGStateDefinition>;
  /** `optionalContent` when the property is named by an `/OC` tag. */
  markedContentProperty(
    resourceName: string,
    optionalContent: boolean
  ): Promise<Readonly<DensePdfMarkedContentPropertyDefinition> | undefined>;
  colorSpace(resourceName: string): Promise<void>;
  /** A page Image or Form XObject, before the first `Do` that names it. */
  xObject(resourceName: string): Promise<void>;
  shading?(resourceName: string): Promise<void>;
  pattern?(resourceName: string): Promise<void>;
}

export interface DensePdfLoadedResourceNames {
  readonly fonts: Iterable<string>;
  readonly extGStates: Iterable<string>;
  readonly properties: Iterable<string>;
  readonly optionalContentProperties: Iterable<string>;
  readonly colorSpaces: Iterable<string>;
  readonly xObjects: Iterable<string>;
  readonly shadings?: Iterable<string>;
  readonly patterns?: Iterable<string>;
}

export interface DensePdfMarkedContentPropertyDefinition {
  readonly resourceName: string;
  readonly optionalContentIndex: number;
  readonly defaultVisible: boolean;
  readonly mcid: number;
  /** PDF text-string bytes replacing this sequence's extracted glyph text. */
  readonly actualText?: Uint8Array;
  /** The resource resolver diagnosed a missing /OC property and retained its paint. */
  readonly unresolvedOptionalContent?: boolean;
}

/** Static optional-content association on an XObject resource. */
export interface DensePdfOptionalContentDefinition {
  readonly optionalContentIndex: number;
  readonly defaultVisible: boolean;
}

/** One BMC/BDC scope in source order. Parent indexes are compiler-local. */
export interface DensePdfMarkedContentNode {
  readonly tag: string;
  readonly propertyName: string | null;
  readonly mcid: number;
  readonly parentIndex: number;
}

export interface DensePdfContentCompileOptions {
  /**
   * Geometry stores alone, a source-ordered HEPR display program, or data for
   * the VectorScene adapter. VectorScene pages preserve drawing order and
   * retain unsupported paint for the session's selective raster fallback.
   */
  output: "geometry" | "display-program" | "vector-scene";
  /** Maximum retained generic paths in this compilation. */
  maxPathResources?: number;
  /** Maximum source path verbs retained across generic paths and clips. */
  maxPathVerbs?: number;
  /** Maximum source coordinates retained across generic paths and clips. */
  maxPathCoordinates?: number;
  /** Maximum persistent clipping nodes retained in this compilation. */
  maxClipPaths?: number;
  /** Maximum generic stroke-style records retained in this compilation. */
  maxStrokeStyles?: number;
  /** Maximum dash-array values retained across generic stroke styles. */
  maxDashValues?: number;
  pageMatrix: DensePdfMatrix;
  pageBounds: DensePdfBounds;
  /** Names of page `/ExtGState` resources preflight proved behaviorally inert. */
  availableExtGStates?: readonly string[];
  /** Supported page `/ExtGState` behavior discovered during preflight. */
  extGStates?: readonly DensePdfExtGStateDefinition[];
  /** Property names whose direct OCG is visible in the default configuration. */
  alwaysVisibleOptionalContentProperties?: readonly string[];
  /** All BDC/DP property names used in this resource scope, resolved before compilation. */
  markedContentProperties?: ReadonlyMap<string, Readonly<DensePdfMarkedContentPropertyDefinition>>;
  /** Optional-content associations on Form XObjects in this resource scope. */
  formOptionalContent?: ReadonlyMap<string, Readonly<DensePdfOptionalContentDefinition>>;
  /** Optional-content associations on image XObjects in this resource scope. */
  imageOptionalContent?: ReadonlyMap<string, Readonly<DensePdfOptionalContentDefinition>>;
  /** Maximum nested BMC/BDC scopes. @default 64 */
  maxMarkedContentDepth?: number;
  /** Maximum BMC/BDC nodes retained by this compilation. @default 1000000 */
  maxMarkedContent?: number;
  /**
   * Page-local HEPR image indexes keyed by `/XObject` resource name. A value
   * of -1 is permitted only when `imageOptionalContent` marks the name hidden
   * in the default view, keeping the hidden payload lazy.
   */
  imageXObjects?: ReadonlyMap<string, number>;
  /** Page-local native Form definition indexes keyed by `/XObject` resource name. */
  formXObjects?: ReadonlyMap<string, number>;
  /** Page-local HEPR gradient indexes keyed by `/Shading` resource name. */
  shadings?: ReadonlyMap<string, number>;
  /** Gradients representable by the analytic, ordered VectorScene renderer. */
  vectorShadings?: ReadonlySet<number>;
  /** Pre-resolved `/Pattern` and `[/Pattern base]` color spaces. */
  patternColorSpaces?: ReadonlyMap<string, Readonly<DensePdfPatternColorSpaceDefinition>>;
  /** Page-local HEPR pattern indexes keyed by `/Pattern` resource name. */
  patterns?: ReadonlyMap<string, Readonly<DensePdfPatternDefinition>>;
  /** Pre-resolved page `/ColorSpace` resources plus DefaultGray/RGB/CMYK handling. */
  colorSpaceResolver?: DensePdfColorSpaceResolver;
  /**
   * Streamed content: load each font, ExtGState, marked-content property,
   * color space, XObject, pattern and shading on first use.
   */
  resourceLoader?: DensePdfResourceLoader;
  /** Prepare the current stream from BI onward, preserving this compiler's state. */
  inlineImageLoader?: (
    sourceOffset: number, buffered: Uint8Array
  ) => Promise<readonly DensePdfContentSegment[]>;
  /**
   * Streamed content: resources an earlier compilation of the same content
   * already loaded. Their fonts, ExtGStates and properties must be among the
   * prepared inputs; the loader is not asked for them again.
   */
  loadedResources?: Readonly<DensePdfLoadedResourceNames>;
  /** Keep paint in initially hidden layers for interactive VectorScene output. */
  retainOptionalContent?: boolean;
  combineOptionalContent?: (parent: number, own: number) => number;
  enableSegmentMerge?: boolean;
  enableInvisibleCull?: boolean;
  /** Exact inherited page-space clip for vector Form specialization. */
  initialVectorClip?: DensePdfTextClip | null;
  /** Retain transient root paint identities for an internal selective-render retry. @internal */
  capturePaintSourceIdentities?: boolean;
  /** Resource-aware text interpreter sharing this compiler's token stream. */
  textOperatorSink?: DensePdfTextOperatorSink;
  /** Inherited state used when specializing a reusable Form program. */
  initialGraphicsState?: DensePdfInitialGraphicsState;
  /**
   * Type3 CharProc paint contract. `uncolored` rejects every source color
   * operator so the reusable program can inherit its caller's text paint.
   * d0/d1 themselves are consumed by the Type3 registry before compilation.
   */
  type3PaintMode?: "colored" | "uncolored";
  /** PaintType 2 cell: source color operators are forbidden and paint is inherited per use. */
  uncoloredPatternPaint?: boolean;
  totalBytes?: number;
  signal?: AbortSignal;
  yieldIntervalMs?: number;
  onProgress?: (progress: DensePdfCompileProgress) => void;
}

/** Shared inputs for compilation contexts whose output is fixed. @internal */
export type DensePdfContentInputOptions = Omit<DensePdfContentCompileOptions, "output">;

/** Policies belong to the output adapter, never to individual callers. */
interface ContentOutputPolicy {
  /** Display commands use their own paint/state stores instead of VectorScene metadata. */
  readonly displayProgram: boolean;
  readonly vectorScene: boolean;
  /** Preserve VectorScene draw ranges; grouped output is only for compatibility or retained text. */
  readonly orderedPaint: boolean;
  /** Only the page adapter can consume selective paint and composite Form captures. */
  readonly selectiveRaster: boolean;
  /** Vector pages/Forms match the static renderer's treatment of OP/op/OPM. */
  readonly ignoreOverprint: boolean;
}

const GEOMETRY_OUTPUT_POLICY: ContentOutputPolicy = Object.freeze({
  displayProgram: false,
  vectorScene: false,
  orderedPaint: false,
  selectiveRaster: false,
  ignoreOverprint: false
});

function vectorSceneOutputPolicy(
  scope: "page" | "form" | "retained-text",
  orderedPaint: boolean
): ContentOutputPolicy {
  return {
    displayProgram: false,
    vectorScene: true,
    orderedPaint,
    selectiveRaster: scope === "page",
    ignoreOverprint: scope !== "retained-text"
  };
}

export interface DensePdfCompiledPage {
  operatorCount: number;
  pathCount: number;
  sourceSegmentCount: number;
  mergedSegmentCount: number;
  /** Post-cull stroke segments transferred to selective image layers. */
  imageLayerSegmentCount?: number;
  segmentCount: number;
  endpoints: Float32Array;
  primitiveMeta: Float32Array;
  primitiveBounds: Float32Array;
  styles: Float32Array;
  fillPathCount: number;
  fillSegmentCount: number;
  fillPathMetaA: Float32Array;
  fillPathMetaB: Float32Array;
  fillPathMetaC: Float32Array;
  fillSegmentsA: Float32Array;
  fillSegmentsB: Float32Array;
  /** Compact paint metadata consumed by the VectorScene adapter. @internal */
  vectorSceneData?: DensePdfVectorSceneData;
  /** Source-ordered triples of kind, store start, and store count. */
  paintRuns: Uint32Array;
  /** One optional-content membership index per paint-run triple, or -1. */
  paintRunOptionalContentIndices: Int32Array;
  /** One compiler-local marked-content node per paint-run triple, or -1. */
  paintRunMarkedContentIndices: Int32Array;
  /** One exact compositing state per source paint-run triple. */
  paintRunCompositeStates: readonly DensePdfCompositeState[];
  /** Active compiler-local persistent clip node per paint run, or -1. */
  paintRunClipIndices: Int32Array;
  /** BMC/BDC scope nodes in source order. */
  markedContent: readonly DensePdfMarkedContentNode[];
  /** Paint state for glyph runs, in the order glyph triples appear in `paintRuns`. */
  glyphPaints: readonly DensePdfGlyphPaint[];
  /** Paint state for fill/stroke runs, in their relative source order. */
  pathPaints: readonly DensePdfSolidPaint[];
  /** Exact generic path resources used by path commands and clip nodes. */
  pagePaths: readonly DensePdfPagePath[];
  /** Paint metadata for generic path triples, in source order. */
  genericPathPaints: readonly DensePdfGenericPathPaint[];
  /** Persistent local clipping chain nodes. */
  clipPaths: readonly DensePdfClipPath[];
  /** CTM for image runs, in the order image triples appear in `paintRuns`. */
  imageTransforms: readonly DensePdfMatrix[];
  /** Current nonstroking paint for image runs, used when the XObject is a stencil mask. */
  imagePaints: readonly DensePdfImagePaint[];
  /** Invocation metadata for Form triples, in their relative source order. */
  formPaints: readonly DensePdfFormPaint[];
  /** Graphics state for shading triples, in their relative source order. */
  shadingPaints: readonly DensePdfShadingPaint[];
  /** Graphics state for pattern triples, in their relative source order. */
  patternPaints: readonly DensePdfPatternPaint[];
  bounds: DensePdfBounds;
  strokeBounds: DensePdfBounds | null;
  fillBounds: DensePdfBounds | null;
  maxHalfWidth: number;
  discardedTransparentCount: number;
  discardedDegenerateCount: number;
  discardedDuplicateCount: number;
  discardedContainedCount: number;
  referencedFonts: string[];
  referencedProperties: string[];
  referencedExtGStates: string[];
  referencedXObjects: string[];
  referencedColorSpaces: string[];
  referencedShadings: string[];
  referencedPatterns: string[];
  textShowOpCount: number;
}

interface DensePdfPaintSourceIdentityStore {
  readonly offsets: Float64Array;
  readonly lengths: Float64Array;
}

const paintSourceIdentities = new WeakMap<DensePdfCompiledPage, DensePdfPaintSourceIdentityStore>();

/** Returns a transient compiler-local paint identity. It is never serialized or transferred. @internal */
export function getDensePdfPaintSourceIdentity(
  compiled: DensePdfCompiledPage,
  paintRunIndex: number
): readonly [sourceOffset: number, sourceLength: number] | null {
  const identities = paintSourceIdentities.get(compiled);
  if (!identities || paintRunIndex < 0 || paintRunIndex >= identities.offsets.length) return null;
  return [identities.offsets[paintRunIndex], identities.lengths[paintRunIndex]];
}

/** A VectorScene image invocation used a non-default PDF clip. @internal */
export const DENSE_PDF_VECTOR_SCENE_IMAGE_FLAG_CLIPPED = 1 << 0;

/**
 * An image followed visible text in source order, but no visible path paint.
 * The grouped adapter must prove that every preceding glyph is spatially
 * disjoint before it may move this image into the raster-underlay pass.
 * @internal
 */
export const DENSE_PDF_VECTOR_SCENE_IMAGE_FLAG_LATE_AFTER_TEXT = 1 << 1;

/** Preceding visible paths were conservatively proven disjoint at compile time. @internal */
export const DENSE_PDF_VECTOR_SCENE_IMAGE_FLAG_LATE_AFTER_PATH = 1 << 2;
/** A preceding contiguous path-only span must be captured with this image. @internal */
export const DENSE_PDF_VECTOR_SCENE_IMAGE_FLAG_SELECTIVE_PATH_SPAN = 1 << 3;

/** A glyph run was emitted under a non-default clip. @internal */
export const DENSE_PDF_VECTOR_SCENE_GLYPH_FLAG_CLIPPED = 1 << 0;
/** Painted text routed to an image layer, not invisible/OCR text. @internal */
export const DENSE_PDF_VECTOR_SCENE_GLYPH_FLAG_COMPOSITED = 1 << 1;

/** Source-event kind used by `DensePdfVectorSceneData.sourceEvents`. @internal */
export const DENSE_PDF_VECTOR_SCENE_EVENT_GLYPH = 0;

/** Source-event kind used by `DensePdfVectorSceneData.sourceEvents`. @internal */
export const DENSE_PDF_VECTOR_SCENE_EVENT_IMAGE = 1;

/** Source-event kind used by `DensePdfVectorSceneData.sourceEvents`. @internal */
export const DENSE_PDF_VECTOR_SCENE_EVENT_FORM = 2;

/** Source-event kind used by `DensePdfVectorSceneData.sourceEvents`. @internal */
export const DENSE_PDF_VECTOR_SCENE_EVENT_ORDINARY_PAINT = 3;
export const DENSE_PDF_VECTOR_SCENE_EVENT_FILL = 4;
export const DENSE_PDF_VECTOR_SCENE_EVENT_STROKE = 5;
/** A flattened root Form rendered as a bounded composite; index is its paint ordinal. */
export const DENSE_PDF_VECTOR_SCENE_EVENT_COMPOSITE = 6;
export const DENSE_PDF_VECTOR_SCENE_EVENT_GRADIENT = 7;

export interface DensePdfVectorShadingPaint extends DensePdfShadingPaint {
  readonly alpha: number;
  readonly paintOrder: number;
}

/** Stroke width/dashes live in graphics-state user space, independently of Tm/Tz. */
export interface DensePdfVectorGlyphStroke {
  readonly transform: DensePdfMatrix;
  readonly color: readonly [number, number, number, number];
  readonly width: number;
  readonly lineCap: 0 | 1 | 2;
  readonly lineJoin: 0 | 1 | 2;
  readonly miterLimit: number;
  readonly dashArray: readonly number[];
  readonly dashPhase: number;
}

/** A marked-content sequence with an MCID (a structure content item). */
export interface DensePdfVectorContentItem {
  readonly mcid: number;
  readonly tag: string;
}

/**
 * Compact paint metadata for the VectorScene adapter, including ordered draw ranges.
 * Packed fill and stroke geometry remains in `DensePdfCompiledPage` itself.
 * @internal
 */
export interface DensePdfVectorSceneData {
  readonly shadingPaints?: readonly DensePdfVectorShadingPaint[];
  /** Optional first/count pairs addressed by FILL/STROKE source events. */
  readonly pathPaintRanges?: Uint32Array;
  /**
   * Fill and stroke paint operations behind the FILL/STROKE events. Adjacent
   * compatible paints share one event, so events undercount them.
   */
  readonly pathPaintCount?: number;
  readonly sourceClips?: readonly (DensePdfTextClip | null)[];
  /** One blend per source event: 0 Normal, 1 Multiply. */
  readonly sourceBlendModes?: Uint8Array;
  /**
   * Source-ordered kind/index pairs for glyph runs, image invocations, Form
   * invocations, and the first ordinary-paint barrier. Kind-local indexes
   * address the corresponding sidecar array (or `formPaints`); the barrier's
   * index is always zero. Ordered output also carries FILL/STROKE range indexes
   * and COMPOSITE paint ordinals.
   */
  readonly sourceEvents: Uint32Array;
  readonly sourceOptionalContentIndices?: Int32Array;
  /**
   * One `annotationIds` index per source event whose paint belongs to an
   * annotation appearance, otherwise -1. Absent when no event has one.
   */
  readonly sourceAnnotationIndices?: Int32Array;
  /** The `PdfAnnotation.id` addressed by each `sourceAnnotationIndices` value. */
  readonly annotationIds?: readonly string[];
  /**
   * One `contentItems` index per source event: the innermost enclosing
   * marked-content sequence with an MCID, or -1. Absent for untagged content.
   */
  readonly sourceContentItems?: Int32Array;
  /** The page-level structure content items addressed by `sourceContentItems`. */
  readonly contentItems?: readonly DensePdfVectorContentItem[];
  /** Glyph triples: page glyph start, glyph count, and PDF rendering mode. */
  readonly glyphRunMeta: Uint32Array;
  /** One sRGB nonstroking RGBA tuple per glyph triple. */
  readonly glyphFillColors: Float32Array;
  readonly glyphStrokePaints?: readonly (DensePdfVectorGlyphStroke | null)[];
  /** Four exact page-space clip bounds per glyph run. */
  readonly glyphClipBounds?: Float32Array;
  /** Per-run DENSE_PDF_VECTOR_SCENE_GLYPH_FLAG_* bits. */
  readonly glyphRunFlags?: Uint8Array;
  /** Exact, shared clipping chains for search-only visibility proofs. */
  readonly glyphRunClips?: readonly (DensePdfTextClip | null)[];
  /** One page-local image resource index per source invocation. */
  readonly imageIndices: Uint32Array;
  /** Six page-space CTM values per image invocation. */
  readonly imageTransforms: Float32Array;
  /** Four page-space clip-bound values per image invocation. */
  readonly imageClipBounds: Float32Array;
  /** One monotonically increasing source paint ordinal per image invocation. */
  readonly imagePaintOrders: Uint32Array;
  /** One source paint ordinal per Form invocation. */
  readonly formPaintOrders?: Uint32Array;
  /** Bit field per image invocation; see DENSE_PDF_VECTOR_SCENE_IMAGE_FLAG_*. */
  readonly imageFlags: Uint8Array;
  /** Constant nonstroking alpha for each image paint, separate from image pixels. */
  readonly imageOpacities?: Float32Array;
  /** Six values per image: fill start/end, stroke start/end, span/image paint ordinals. */
  readonly imagePathSpanCheckpoints?: Uint32Array;
  /** Four values per image: first-path offset/length and image offset/length. */
  readonly imagePathSourceSpans?: Float64Array;
  /** Start/end paint ordinals for non-packed selective commands such as root shadings. */
  readonly selectivePaintOrdinalSpans?: Uint32Array;
  /** Source offset/length pairs for individually captured root paint operators. */
  readonly selectivePaintSourceSpans?: Float64Array;
  /**
   * Distinct reasons paints were captured into bounded raster layers rather
   * than kept as vectors, so a caller can report which feature cost fidelity
   * instead of only that something did.
   */
  readonly selectivePaintReasons?: readonly string[];
}

/** Names the feature that cost a path paint its vector representation. */
export function selectivePathPaintReason(largeDisconnectedFill: boolean, patternFill: boolean, patternStroke: boolean,
  fillPatternKind: string | undefined, strokePatternKind: string | undefined): DensePdfSelectivePaintReason {
  if (patternFill) return fillPatternKind === "shading" ? "shading-pattern-fill" : "tiling-pattern-fill";
  if (patternStroke) return strokePatternKind === "shading" ? "shading-pattern-stroke" : "tiling-pattern-stroke";
  if (largeDisconnectedFill) return "large-disconnected-fill";
  return "clipped-path";
}

/** Why a paint could not stay vector; reported with the selective-raster diagnostic. */
export type DensePdfSelectivePaintReason =
  | "shading-pattern-fill"
  | "shading-pattern-stroke"
  | "tiling-pattern-fill"
  | "tiling-pattern-stroke"
  | "large-path"
  | "large-disconnected-fill"
  | "clipped-path"
  | "clipped-image"
  | "image-over-text"
  | "root-shading"
  | "composited-glyphs"
  /** A whole Form XObject captured as one layer, recorded by the flattener. */
  | "composited-form";

export interface DensePdfSolidPaint {
  readonly color: readonly [red: number, green: number, blue: number, alpha: number];
  readonly sourceColorSpaceIndex: number;
  /** True inside an uncolored Type3 or tiling-pattern program before invocation binding. */
  readonly inheritType3Paint?: boolean;
}

export interface DensePdfImagePaint extends DensePdfSolidPaint {
  /** Conservative culling bounds only; exact semantics use paintRunClipIndices. */
  readonly clipBounds: DensePdfBounds;
  /** Exact BI…EI source span for inline images, otherwise -1/-1. */
  readonly sourceOffset: number;
  readonly sourceLength: number;
}

/** One exact source path with its construction-time CTM frozen. */
export interface DensePdfPagePath {
  readonly data: Float32Array;
  readonly transform: DensePdfMatrix;
  /** Conservative page/program-local transformed bounds used only for culling. */
  readonly bounds: DensePdfBounds;
}

export interface DensePdfGenericStrokeStyle {
  readonly lineWidth: number;
  readonly lineCap: 0 | 1 | 2;
  readonly lineJoin: 0 | 1 | 2;
  readonly miterLimit: number;
  readonly dash: readonly number[];
  readonly dashPhase: number;
  readonly hairline: boolean;
  readonly strokeAdjust: boolean;
}

/** Exact path paint; fill and stroke may share one source operator. */
export interface DensePdfGenericPathPaint {
  readonly pathIndex: number;
  readonly fillRule: 0 | 1;
  readonly fill: DensePdfSolidPaint | null;
  readonly stroke: DensePdfSolidPaint | null;
  readonly strokeStyle: DensePdfGenericStrokeStyle | null;
}

/** One persistent clip node referencing an exact page path. */
export interface DensePdfClipPath {
  readonly parentIndex: number;
  /** Generic source path, or -1 when this node is a text-object glyph union. */
  readonly pathIndex: number;
  readonly fillRule: 0 | 1;
  /** First local native-text glyph accumulated until ET; absent for path clips. */
  readonly firstGlyph?: number;
  /** Contiguous clipping-glyph count; absent for path clips. */
  readonly glyphCount?: number;
}

/** Immutable page-space clip resource retained only by the native text bridge. */
export interface DensePdfTextClip {
  readonly parent: DensePdfTextClip | null;
  readonly path: DensePdfPagePath;
  readonly fillRule: 0 | 1;
}

export interface DensePdfGlyphPaint {
  /** Resource-space pen CTM, kept separately from each glyph placement. */
  readonly strokeTransform?: DensePdfMatrix;
  readonly renderingMode: number;
  readonly patternColorApproximation?: boolean;
  readonly fill: readonly [red: number, green: number, blue: number, alpha: number];
  readonly stroke: readonly [red: number, green: number, blue: number, alpha: number];
  readonly fillPaintInherited?: boolean;
  readonly strokePaintInherited?: boolean;
  /** Full state inherited by a Type3 CharProc at this source text-show position. */
  readonly initialGraphicsState: DensePdfInitialGraphicsState;
}

/** Paint-run kind used by `DensePdfCompiledPage.paintRuns`. */
export const DENSE_PDF_PAINT_RUN_STROKE = 0;

/** Paint-run kind used by `DensePdfCompiledPage.paintRuns`. */
export const DENSE_PDF_PAINT_RUN_FILL = 1;

/** Paint-run kind used by `DensePdfCompiledPage.paintRuns`. */
export const DENSE_PDF_PAINT_RUN_GLYPH = 2;

/** Paint-run kind used by `DensePdfCompiledPage.paintRuns`. */
export const DENSE_PDF_PAINT_RUN_IMAGE = 3;

/** Paint-run kind used by `DensePdfCompiledPage.paintRuns`. */
export const DENSE_PDF_PAINT_RUN_FORM = 4;

/** Paint-run kind used by `DensePdfCompiledPage.paintRuns`. */
export const DENSE_PDF_PAINT_RUN_GRADIENT = 5;

/** Paint-run kind used by `DensePdfCompiledPage.paintRuns`. */
export const DENSE_PDF_PAINT_RUN_PATTERN = 6;

/** Paint-run kind for exact page-native path resources. */
export const DENSE_PDF_PAINT_RUN_PATH = 7;

export class DensePdfUnsupportedError extends Error {
  readonly operator?: string;

  constructor(message: string, operator?: string) {
    super(message);
    this.name = "DensePdfUnsupportedError";
    this.operator = operator;
  }
}

/**
 * A resource needs page-wide lookahead, or its streaming loader is absent.
 * Compile from prepared input instead; nothing about the page itself is wrong.
 */
export class DensePdfStreamingUnsupportedError extends Error {
  readonly operator: string;

  constructor(message: string, operator: string) {
    super(message);
    this.name = "DensePdfStreamingUnsupportedError";
    this.operator = operator;
  }
}

export class DensePdfSyntaxError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DensePdfSyntaxError";
  }
}

export class DensePdfResourceLimitError extends Error {
  readonly operator?: string;
  readonly reason?: string;

  constructor(message: string, operator?: string, reason?: string) {
    super(message);
    this.name = "DensePdfResourceLimitError";
    this.operator = operator;
    this.reason = reason;
  }
}

const DRAW_MOVE_TO = 0;
const DRAW_LINE_TO = 1;
const DRAW_CURVE_TO = 2;
const DRAW_QUAD_TO = 3;
const DRAW_CLOSE = 4;

const STROKE_PRIMITIVE_LINE = 0;
const STROKE_PRIMITIVE_QUADRATIC = 1;
const FILL_PRIMITIVE_LINE = 0;
const FILL_PRIMITIVE_QUADRATIC = 1;
const FILL_RULE_NONZERO = 0;
const FILL_RULE_EVEN_ODD = 1;

const SEGMENT_JOIN_EPSILON = 1e-3;
const COLLINEAR_DOT_THRESHOLD = 0.999995;
const COLLINEAR_PERP_EPSILON = 0.05;
const CURVE_FLATNESS = 0.35;
const MAX_CURVE_SPLIT_DEPTH = 9;
const FILL_CUBIC_TO_QUAD_ERROR = 0.08;
const MAX_FILL_CUBIC_TO_QUAD_DEPTH = 9;
const ALPHA_INVISIBLE_EPSILON = 1e-3;
const OPAQUE_ALPHA_EPSILON = 0.999;
const DUPLICATE_POSITION_SCALE = 1_000;
/** Duplicate key components describing a primitive's geometry and style, before its clip bounds. */
const DUPLICATE_TUPLE_GEOMETRY = 13;
/** Ordered stroke culling inputs: each primitive's run and each run's paint context. */
interface StrokePaintOrder {
  readonly runs: Uint32Array;
  readonly runContexts: Uint32Array;
}

/** Coverage culling steps between cooperative yields. */
const COVERAGE_WORK_PER_CHECKPOINT = 1 << 18;
/** Coverage-group key components describing line, style and flags. */
const COVERAGE_TUPLE_GEOMETRY = 7;
/** Stroke paint context of primitives that must never be merged (Multiply). */
const NO_STROKE_PAINT_CONTEXT = 0xffff_ffff;
const DUPLICATE_STYLE_SCALE = 10_000;
const COVER_DIRECTION_SCALE = 2_000;
const COVER_OFFSET_SCALE = 200;
const COVER_INTERVAL_EPSILON = 0.05;
const COVER_HALF_WIDTH_EPSILON = 1e-4;
const DEFAULT_MAX_PATH_RESOURCES = 5_000_000;
const DEFAULT_MAX_PATH_VERBS = 20_000_000;
const DEFAULT_MAX_PATH_COORDINATES = 60_000_000;
const DEFAULT_MAX_CLIP_PATHS = 1_000_000;
const DEFAULT_MAX_STROKE_STYLES = 5_000_000;
const DEFAULT_MAX_DASH_VALUES = 20_000_000;

export const DENSE_PDF_STROKE_STYLE_FLAG_HAIRLINE = 1 << 0;
const STROKE_STYLE_FLAG_ROUND_CAP = 1 << 1;
/** `primitiveBounds` is the exact effective page-space clip for this stroke. @internal */
export const DENSE_PDF_STROKE_STYLE_FLAG_CLIPPED = 1 << 2;
const STROKE_STYLE_FLAG_OFFSET = 2;

const MAX_INPUT_SLICE_BYTES = 256 * 1024;
const DEFAULT_YIELD_INTERVAL_MS = 50;
const MAX_OPERAND_COUNT = 1_000_000;
const MAX_PAINT_PATH_FLOATS = 65_536;
const MAX_COVERAGE_GROUP_SIZE = 8_192;
const DEFAULT_MAX_MARKED_CONTENT_DEPTH = 64;
const DEFAULT_MAX_MARKED_CONTENT = 1_000_000;
const TEXT_SINK_OPERATORS = new Set([
  "q", "Q", "cm", "BT", "ET", "Tf", "Tc", "Tw", "Tz", "TL", "Tr", "Ts",
  "Td", "TD", "Tm", "T*", "Tj", "TJ", "'", "\""
]);
const TYPE3_UNCOLORED_FORBIDDEN_OPERATORS = new Set([
  "G", "g", "RG", "rg", "K", "k", "CS", "cs", "SC", "sc", "SCN", "scn", "sh"
]);
const TYPE3_STROKE_COLOR_OPERATORS = new Set(["G", "RG", "K", "CS", "SC", "SCN"]);
const TYPE3_FILL_COLOR_OPERATORS = new Set(["g", "rg", "k", "cs", "sc", "scn"]);

interface PdfNameValue {
  kind: "name";
  value: string;
}

interface PdfStringValue {
  kind: "string";
  value: Uint8Array;
}

interface PdfArrayValue {
  kind: "array";
  value: PdfValue[];
}

interface PdfDictionaryValue {
  kind: "dictionary";
  value: Array<[string, PdfValue]>;
}

type PdfValue =
  | number
  | PdfNameValue
  | PdfStringValue
  | PdfArrayValue
  | PdfDictionaryValue
  | boolean
  | null;

type StreamedResourceKind =
  "font" | "extGState" | "property" | "optionalContentProperty" | "colorSpace" | "xObject" | "shading" | "pattern";

/**
 * Thrown through the lexer when streamed content first uses a resource that
 * is not loaded. Deliberately not an Error: suspending captures no stack.
 */
class ContentResourceSuspension {
  readonly kind: StreamedResourceKind;

  readonly resourceName: string;

  constructor(kind: StreamedResourceKind, resourceName: string) {
    this.kind = kind;
    this.resourceName = resourceName;
  }
}

/** A lexical BI boundary, before consuming its dictionary or binary payload. */
class ContentInlineImageSuspension {}

type LexerToken =
  | { kind: "number"; value: number }
  | { kind: "name"; value: string }
  | { kind: "string"; value: Uint8Array }
  | { kind: "word"; value: string; sourceOffset: number; sourceLength: number }
  | { kind: "array-start" | "array-end" | "dict-start" | "dict-end" };

interface ActiveMarkedContentScope {
  readonly nodeIndex: number;
  readonly optionalContentIndex: number;
  readonly defaultVisible: boolean;
}

function isTextSinkOperator(operator: string): boolean {
  // Reject path and color operators, which dominate CAD content, by first byte.
  const first = operator.charCodeAt(0);
  return (first === 0x54 || first === 0x71 || first === 0x51 || first === 0x63 ||
    first === 0x42 || first === 0x45 || first === 0x27 || first === 0x22) &&
    TEXT_SINK_OPERATORS.has(operator);
}

function toTextSinkOperand(value: PdfValue): unknown {
  if (isPdfName(value)) return value.value;
  if (isPdfString(value)) return value.value;
  if (isPdfArray(value)) return value.value.map(toTextSinkOperand);
  if (isPdfDictionary(value)) {
    return new Map(value.value.map(([key, entry]) => [key, toTextSinkOperand(entry)]));
  }
  return value;
}

function isPdfString(value: PdfValue): value is PdfStringValue {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "string";
}

function isPdfArray(value: PdfValue): value is PdfArrayValue {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "array";
}

interface ParserContainer {
  kind: "array" | "dictionary";
  values: PdfValue[];
  entries: Array<[string, PdfValue]>;
  pendingKey: string | null;
}

interface GraphicsState {
  matrix: DensePdfMatrix;
  matrixScale: number;
  clipBounds: DensePdfBounds | null;
  clipMask: DensePdfClipMask | null;
  /** False after any source clipping path has modified this saved state. */
  clipIsDefault: boolean;
  /** The effective clip is exactly the axis-aligned `clipBounds` rectangle. */
  clipIsExactRectangle: boolean;
  /** Innermost exact compiler-local clip node, or -1 for the program boundary. */
  clipIndex: number;
  lineWidth: number;
  lineCap: number;
  lineDash: number[];
  dashPhase: number;
  strokeR: number;
  strokeG: number;
  strokeB: number;
  fillR: number;
  fillG: number;
  fillB: number;
  strokePaintInherited: boolean;
  fillPaintInherited: boolean;
  strokeColorSpace: Readonly<DensePdfColorSpaceDefinition>;
  fillColorSpace: Readonly<DensePdfColorSpaceDefinition>;
  strokePatternColorSpace: Readonly<DensePdfPatternColorSpaceDefinition> | null;
  fillPatternColorSpace: Readonly<DensePdfPatternColorSpaceDefinition> | null;
  strokePattern: Readonly<DensePdfPatternDefinition> | null;
  fillPattern: Readonly<DensePdfPatternDefinition> | null;
  strokeAlpha: number;
  fillAlpha: number;
  alphaIsShape: boolean;
  blendMode: DensePdfBlendMode;
  softMaskIndex: number;
  strokeOverprint: boolean;
  fillOverprint: boolean;
  overprintMode: 0 | 1;
  textKnockout: boolean;
  lineJoin: 0 | 1 | 2;
  miterLimit: number;
  renderingIntent: string | null;
  flatnessTolerance: number | null;
  smoothnessTolerance: number | null;
  strokeAdjustment: boolean;
}

interface DensePdfClipMask {
  bounds: DensePdfBounds;
  exclusionBounds: DensePdfBounds[];
}

type DeviceColorSpace = "DeviceGray" | "DeviceRGB" | "DeviceCMYK";

interface CoverageCandidate {
  index: number;
  start: number;
  end: number;
  halfWidth: number;
  alpha: number;
  styleFlags: number;
}

interface StrokeFinalizeResult {
  endpoints: Float32Array;
  primitiveMeta: Float32Array;
  primitiveBounds: Float32Array;
  styles: Float32Array;
  bounds: DensePdfBounds | null;
  maxHalfWidth: number;
  discardedContainedCount: number;
}

/** Compile already-decoded content for the requested output adapter. */
export async function compileDensePdfContent(
  source: DensePdfContentSource | DensePdfPreparedContentSource,
  options: DensePdfContentCompileOptions
): Promise<DensePdfCompiledPage> {
  switch (options.output) {
    case "geometry":
      return compileContent(source, options, GEOMETRY_OUTPUT_POLICY);
    case "display-program":
      return compileContent(source, options, { ...GEOMETRY_OUTPUT_POLICY, displayProgram: true });
    case "vector-scene":
      return compileContent(source, options, vectorSceneOutputPolicy("page", true));
    default:
      throw new TypeError("Unknown PDF compiler output. Expected geometry, display-program, or vector-scene.");
  }
}

/** Compatibility retry used internally after ordered page adaptation fails. @internal */
export function compileGroupedVectorPageContent(
  source: DensePdfContentSource | DensePdfPreparedContentSource,
  options: DensePdfContentInputOptions
): Promise<DensePdfCompiledPage> {
  return compileContent(source, options, vectorSceneOutputPolicy("page", false));
}

/**
 * Compile a Form for vector flattening. Unsupported paint is handled by the
 * enclosing page, which can capture the whole Form with its compositing state.
 * @internal
 */
export function compileVectorFormContent(
  source: DensePdfContentSource | DensePdfPreparedContentSource,
  options: DensePdfContentInputOptions,
  drawingOrder: "source" | "grouped" = "source"
): Promise<DensePdfCompiledPage> {
  return compileContent(source, options, vectorSceneOutputPolicy("form", drawingOrder === "source"));
}

/** Compile prevalidated text retained by the dense geometry path. @internal */
export function compileRetainedTextContent(
  source: DensePdfContentSource | DensePdfPreparedContentSource,
  options: DensePdfContentInputOptions
): Promise<DensePdfCompiledPage> {
  return compileContent(source, options, vectorSceneOutputPolicy("retained-text", false));
}

async function compileContent(
  source: DensePdfContentSource | DensePdfPreparedContentSource,
  options: DensePdfContentInputOptions,
  policy: ContentOutputPolicy
): Promise<DensePdfCompiledPage> {
  assertFiniteMatrix(options.pageMatrix);
  assertValidBounds(options.pageBounds, "pageBounds");
  options.signal?.throwIfAborted();

  const compiler = new DenseContentCompiler(options, policy);
  const lexer = new IncrementalPdfLexer(
    (token) => compiler.consumeToken(token),
    (value) => compiler.consumeNumber(value)
  );
  const yieldIntervalMs = Math.max(4, options.yieldIntervalMs ?? DEFAULT_YIELD_INTERVAL_MS);
  let processedBytes = 0;
  let lastYieldAt = nowMs();

  // Streamed content suspends at an operator whose resource is not loaded
  // yet; load it, then resume lexing at that operator.
  const feed = async (slice: Uint8Array, final: boolean, sourceOffset?: number): Promise<void> => {
    for (let input = slice; ; input = EMPTY_CONTENT_BYTES, sourceOffset = undefined) {
      try {
        if (final) lexer.finish();
        else lexer.feed(input, false, sourceOffset);
        return;
      } catch (error) {
        if (!(error instanceof ContentResourceSuspension)) throw error;
        await compiler.loadStreamedResource(error);
        options.signal?.throwIfAborted();
      }
    }
  };

  const consumeSegment = async (segment: DensePdfContentSegment): Promise<void> => {
    if (segment.kind === "image") {
      // BI…EI is structurally prepared before resource resolution. Flush the
      // lexical boundary without finalizing the long-lived graphics parser,
      // then interleave one paint event at the exact source position.
      await feed(EMPTY_CONTENT_BYTES, true);
      compiler.consumeInlineImage(segment);
      processedBytes += segment.sourceLength;
      return;
    }
    const inputChunk = segment.bytes;
    for (let offset = 0; offset < inputChunk.length; offset += MAX_INPUT_SLICE_BYTES) {
      options.signal?.throwIfAborted();
      const slice = inputChunk.subarray(
        offset,
        Math.min(inputChunk.length, offset + MAX_INPUT_SLICE_BYTES)
      );
      try {
        await feed(slice, false, segment.sourceOffset + offset);
      } catch (error) {
        if (!(error instanceof ContentInlineImageSuspension) || !options.inlineImageLoader) throw error;
        const pending = lexer.takePending();
        const rest = inputChunk.subarray(offset + slice.length);
        const buffered = new Uint8Array(pending.bytes.length + rest.length);
        buffered.set(pending.bytes);
        buffered.set(rest, pending.bytes.length);
        const prepared = await options.inlineImageLoader(pending.sourceOffset, buffered);
        options.signal?.throwIfAborted();
        // Previous slices may contain the B of a split BI token. Count its
        // complete span only once, using the exact absolute source position.
        processedBytes = pending.sourceOffset;
        for (const replacement of prepared) await consumeSegment(replacement);
        return;
      }
      processedBytes += slice.length;
      compiler.compactStrokesIfWorthwhile();

      const now = nowMs();
      if (now - lastYieldAt >= yieldIntervalMs) {
        options.onProgress?.({
          phase: "scanning",
          processedBytes,
          totalBytes: options.totalBytes,
          operatorCount: compiler.operatorCount,
          sourceSegmentCount: compiler.sourceSegmentCount
        });
        await yieldToHost();
        options.signal?.throwIfAborted();
        lastYieldAt = nowMs();
      }
    }
  };
  for await (const segment of normalizeContentSegments(source)) await consumeSegment(segment);

  try {
    await feed(EMPTY_CONTENT_BYTES, true);
  } catch (error) {
    if (!(error instanceof ContentInlineImageSuspension) || !options.inlineImageLoader) throw error;
    const pending = lexer.takePending();
    processedBytes = pending.sourceOffset;
    for (const replacement of await options.inlineImageLoader(pending.sourceOffset, pending.bytes)) {
      await consumeSegment(replacement);
    }
    await feed(EMPTY_CONTENT_BYTES, true);
  }
  options.signal?.throwIfAborted();
  let lastFinalizeYieldAt = nowMs();
  const finalizeCheckpoint = async (force = false): Promise<void> => {
    options.signal?.throwIfAborted();
    const now = nowMs();
    if (!force && now - lastFinalizeYieldAt < yieldIntervalMs) return;
    options.onProgress?.({
      phase: "finalizing",
      processedBytes,
      totalBytes: options.totalBytes ?? processedBytes,
      operatorCount: compiler.operatorCount,
      sourceSegmentCount: compiler.sourceSegmentCount
    });
    await yieldToHost();
    options.signal?.throwIfAborted();
    lastFinalizeYieldAt = nowMs();
  };
  await finalizeCheckpoint(true);
  const result = await compiler.finish(finalizeCheckpoint);
  options.onProgress?.({
    phase: "finalizing",
    processedBytes,
    totalBytes: options.totalBytes ?? processedBytes,
    operatorCount: result.operatorCount,
    sourceSegmentCount: result.sourceSegmentCount
  });
  return result;
}

export interface DensePdfResourceReferences {
  readonly xObjects: readonly string[];
  readonly properties: readonly string[];
  /** Named BDC/DP properties whose tag is /OC and therefore affects paint visibility. */
  readonly optionalContentProperties: readonly string[];
  readonly fonts: readonly string[];
  readonly extGStates: readonly string[];
  readonly colorSpaces: readonly string[];
  readonly shadings: readonly string[];
  readonly patterns: readonly string[];
}

export interface DensePdfResourceScanOptions {
  readonly signal?: AbortSignal;
  /** Internal overview inspection; image payloads remain unregistered and undecoded. */
  readonly onInlineImage?: () => void;
  /** Internal text-only interpreter; operands use the native text sink representation. */
  readonly onOperator?: (operator: string, operands: readonly unknown[], markedContentProperty?: import("./nativeCos").PdfValue) => void;
}

/**
 * Discover every named resource operand consumed by the dense interpreter.
 *
 * This intentionally uses the compiler's exact lexer and operand model so a
 * preflight cannot disagree about escaped names, strings, arrays, dictionaries,
 * or operator boundaries. Each list is duplicate-free and retains first-use
 * source order.
 */
export function scanDensePdfResourceReferences(
  content: Uint8Array,
  options: DensePdfResourceScanOptions = {}
): DensePdfResourceReferences {
  return scanDensePdfPreparedResourceReferences([{
    kind: "content",
    bytes: content,
    sourceOffset: 0,
    sourceLength: content.length
  }], options);
}

/** Scan only prepared non-image spans through one exact, long-lived lexer. */
export function scanDensePdfPreparedResourceReferences(
  segments: Iterable<DensePdfContentSegment>,
  options: DensePdfResourceScanOptions = {}
): DensePdfResourceReferences {
  options.signal?.throwIfAborted();
  const scanner = new DensePdfResourceReferenceScanner(options.onOperator);
  let tokenCount = 0;
  const lexer = new IncrementalPdfLexer((token) => {
    if ((tokenCount++ & 0xfff) === 0) options.signal?.throwIfAborted();
    scanner.consumeToken(token);
  });
  for (const segment of segments) {
    options.signal?.throwIfAborted();
    validateContentSegment(segment);
    if (segment.kind === "image") {
      lexer.finish();
      scanner.consumeInlineImage();
      options.onInlineImage?.();
    } else {
      lexer.feed(segment.bytes, false, segment.sourceOffset);
    }
  }
  lexer.finish();
  scanner.finish();
  options.signal?.throwIfAborted();
  return Object.freeze({
    xObjects: Object.freeze([...scanner.xObjects]),
    properties: Object.freeze([...scanner.properties]),
    optionalContentProperties: Object.freeze([...scanner.optionalContentProperties]),
    fonts: Object.freeze([...scanner.fonts]),
    extGStates: Object.freeze([...scanner.extGStates]),
    colorSpaces: Object.freeze([...scanner.colorSpaces]),
    shadings: Object.freeze([...scanner.shadings]),
    patterns: Object.freeze([...scanner.patterns])
  });
}

/** @deprecated Use `scanDensePdfResourceReferences().xObjects`. */
export function scanDensePdfXObjectReferences(content: Uint8Array): readonly string[] {
  return scanDensePdfResourceReferences(content).xObjects;
}

/** @deprecated Use `scanDensePdfResourceReferences().properties`. */
export function scanDensePdfMarkedContentPropertyReferences(
  content: Uint8Array
): readonly string[] {
  return scanDensePdfResourceReferences(content).properties;
}

function normalizeExtGStateDefinitions(
  options: DensePdfContentInputOptions
): Map<string, DensePdfExtGStateDefinition> {
  const definitions = new Map<string, DensePdfExtGStateDefinition>();
  for (const resourceName of options.availableExtGStates ?? []) {
    if (typeof resourceName !== "string" || resourceName.length === 0) {
      throw new TypeError("availableExtGStates contains an invalid resource name.");
    }
    definitions.set(resourceName, {
      resourceName
    });
  }
  for (const definition of options.extGStates ?? []) {
    definitions.set(definition.resourceName, validateExtGStateDefinition(definition));
  }
  return definitions;
}

function validateExtGStateDefinition(
  definition: DensePdfExtGStateDefinition
): DensePdfExtGStateDefinition {
  if (
    !definition ||
    typeof definition.resourceName !== "string" ||
    definition.resourceName.length === 0 ||
    !isOptionalFontSelection(definition.font) ||
    !isOptionalUnitInterval(definition.strokeAlpha) ||
    !isOptionalUnitInterval(definition.fillAlpha) ||
    (definition.alphaIsShape !== undefined && typeof definition.alphaIsShape !== "boolean") ||
    (definition.blendMode !== undefined && !isDensePdfBlendMode(definition.blendMode)) ||
    (definition.softMaskIndex !== undefined && definition.softMaskIndex !== null &&
      (!Number.isSafeInteger(definition.softMaskIndex) || definition.softMaskIndex < 0)) ||
    (definition.overprintMode !== undefined &&
      definition.overprintMode !== 0 && definition.overprintMode !== 1)
  ) {
    throw new TypeError("extGStates contains an invalid supported graphics-state definition.");
  }
  return { ...definition };
}

function normalizePositiveLimit(
  value: number | undefined,
  fallback: number,
  name: string
): number {
  const normalized = value ?? fallback;
  if (!Number.isSafeInteger(normalized) || normalized <= 0) {
    throw new RangeError(`${name} must be a positive safe integer.`);
  }
  return normalized;
}

function validateMarkedContentDefinitions(
  definitions: ReadonlyMap<string, Readonly<DensePdfMarkedContentPropertyDefinition>> | undefined
): void {
  if (!definitions) return;
  for (const [resourceName, definition] of definitions) {
    if (
      resourceName.length === 0 || definition.resourceName !== resourceName ||
      !Number.isSafeInteger(definition.optionalContentIndex) ||
      definition.optionalContentIndex < -1 ||
      typeof definition.defaultVisible !== "boolean" ||
      (definition.unresolvedOptionalContent !== undefined &&
        (typeof definition.unresolvedOptionalContent !== "boolean" ||
          (definition.unresolvedOptionalContent &&
            (definition.optionalContentIndex !== -1 || !definition.defaultVisible)))) ||
      !Number.isSafeInteger(definition.mcid) || definition.mcid < -1 ||
      (definition.actualText !== undefined && !(definition.actualText instanceof Uint8Array))
    ) {
      throw new TypeError(`markedContentProperties contains an invalid /${resourceName} definition.`);
    }
  }
}

function validateOptionalContentDefinitions(
  definitions: ReadonlyMap<string, Readonly<DensePdfOptionalContentDefinition>>,
  label: string
): void {
  for (const [resourceName, definition] of definitions) {
    if (
      resourceName.length === 0 ||
      !Number.isSafeInteger(definition.optionalContentIndex) ||
      definition.optionalContentIndex < 0 ||
      typeof definition.defaultVisible !== "boolean"
    ) {
      throw new TypeError(`${label} contains an invalid /${resourceName} definition.`);
    }
  }
}

function isOptionalUnitInterval(value: number | undefined): boolean {
  return value === undefined || (Number.isFinite(value) && value >= 0 && value <= 1);
}

function isOptionalFontSelection(font: Readonly<DensePdfFontSelection> | undefined): boolean {
  return font === undefined || (!!font && Number.isSafeInteger(font.fontIndex) &&
    font.fontIndex >= 0 && Number.isFinite(font.size));
}

function isDensePdfBlendMode(value: string): value is DensePdfBlendMode {
  return value === "Normal" || value === "Multiply" || value === "Screen" ||
    value === "Overlay" || value === "Darken" || value === "Lighten" ||
    value === "ColorDodge" || value === "ColorBurn" || value === "HardLight" ||
    value === "SoftLight" || value === "Difference" || value === "Exclusion" ||
    value === "Hue" || value === "Saturation" || value === "Color" ||
    value === "Luminosity";
}

class DenseContentCompiler {
  readonly options: DensePdfContentInputOptions;

  private readonly policy: ContentOutputPolicy;

  readonly path = new ReusablePathBuilder();

  readonly strokes: DenseStrokeBuilder;

  readonly fillPathMetaA: Float4Builder;

  readonly fillPathMetaB: Float4Builder;

  readonly fillPathMetaC: Float4Builder;

  readonly fillSegmentsA: Float4Builder;

  readonly fillSegmentsB: Float4Builder;

  readonly referencedFonts = new Set<string>();

  readonly referencedProperties = new Set<string>();

  readonly referencedExtGStates = new Set<string>();

  readonly referencedXObjects = new Set<string>();

  readonly referencedColorSpaces = new Set<string>();

  readonly referencedShadings = new Set<string>();

  readonly referencedPatterns = new Set<string>();

  /**
   * Operand stack, reused across operators: only the first `operandCount`
   * entries are live. Truncating an array to zero would drop and reallocate
   * its backing store for every operator.
   */
  private readonly operands: PdfValue[] = [];

  private operandCount = 0;

  readonly containers: ParserContainer[] = [];

  readonly stateStack: GraphicsState[] = [];

  readonly extGStates: Map<string, DensePdfExtGStateDefinition>;

  readonly alwaysVisibleOptionalContentProperties: ReadonlySet<string>;

  readonly markedContentProperties: ReadonlyMap<string, Readonly<DensePdfMarkedContentPropertyDefinition>> | undefined;

  /** Per-operator option checks, resolved once. */
  private readonly streamed: boolean;

  private readonly textSink: DensePdfTextOperatorSink | undefined;

  private readonly type3PaintTracked: boolean;

  private readonly uncoloredPaintOnly: boolean;

  /** Streamed compilation: resources already loaded, by kind. */
  private readonly loadedResources = {
    font: new Set<string>(),
    extGState: new Set<string>(),
    property: new Set<string>(),
    optionalContentProperty: new Set<string>(),
    colorSpace: new Set<string>(),
    xObject: new Set<string>(),
    shading: new Set<string>(),
    pattern: new Set<string>()
  };

  readonly formOptionalContent: ReadonlyMap<string, Readonly<DensePdfOptionalContentDefinition>>;

  readonly imageOptionalContent: ReadonlyMap<string, Readonly<DensePdfOptionalContentDefinition>>;

  readonly paintRuns: number[] = [];

  readonly paintRunOptionalContentIndices: number[] = [];

  readonly paintRunMarkedContentIndices: number[] = [];

  readonly paintRunCompositeStates: DensePdfCompositeState[] = [];

  readonly paintRunClipIndices: number[] = [];

  readonly paintRunSourceOffsets: number[] = [];

  readonly paintRunSourceLengths: number[] = [];

  readonly markedContent: DensePdfMarkedContentNode[] = [];

  readonly markedContentStack: ActiveMarkedContentScope[] = [];

  readonly glyphPaints: DensePdfGlyphPaint[] = [];

  readonly pathPaints: DensePdfSolidPaint[] = [];

  readonly pagePaths: DensePdfPagePath[] = [];

  readonly genericPathPaints: DensePdfGenericPathPaint[] = [];

  readonly clipPaths: DensePdfClipPath[] = [];

  readonly imageTransforms: DensePdfMatrix[] = [];

  readonly imagePaints: DensePdfImagePaint[] = [];

  readonly formPaints: DensePdfFormPaint[] = [];

  readonly shadingPaints: DensePdfShadingPaint[] = [];

  readonly patternPaints: DensePdfPatternPaint[] = [];

  readonly vectorGlyphRunMeta: number[] = [];

  readonly vectorGlyphFillColors: number[] = [];

  readonly vectorGlyphStrokePaints: (DensePdfVectorGlyphStroke | null)[] = [];

  readonly vectorGlyphClipBounds: number[] = [];

  readonly vectorGlyphRunFlags: number[] = [];
  readonly vectorGlyphClipIndices: number[] = [];

  readonly vectorImageIndices: number[] = [];

  readonly vectorImageTransforms: number[] = [];

  readonly vectorImageClipBounds: number[] = [];

  readonly vectorImagePaintOrders: number[] = [];

  readonly vectorFormPaintOrders: number[] = [];

  readonly vectorImageFlags: number[] = [];
  readonly vectorImageOpacities: number[] = [];

  readonly vectorImagePathSpanCheckpoints: number[] = [];

  readonly vectorImagePathSourceSpans: number[] = [];

  readonly vectorSelectivePaintOrdinalSpans: number[] = [];
  private readonly vectorSelectivePaintReasons = new Set<string>();

  readonly vectorSelectivePaintSourceSpans: number[] = [];

  readonly vectorSourceEvents: number[] = [];
  readonly vectorSourceOptionalContentIndices: number[] = [];
  /** Per source event: the enclosing structure content item's marked-content node, or -1. */
  readonly vectorSourceContentItems: number[] = [];
  readonly vectorShadingPaints: DensePdfVectorShadingPaint[] = [];
  readonly vectorSourceClipIndices: number[] = [];
  readonly vectorSourceBlendModes: number[] = [];
  readonly vectorFormClipIndices: number[] = [];
  readonly vectorPathPaintRanges: number[] = [];

  private readonly strokePaintContexts = new Map<number, number>();

  private lastContextClipIndex = -2;

  private lastContextOptionalContent = -2;

  private lastStrokePaintContext = -1;

  private vectorPathPaintCount = 0;

  private vectorPathSpanStartFillCount = 0;

  private vectorPathSpanStartStrokeCount = 0;

  private vectorPathSpanStartOrdinal = 0;

  private vectorPathSpanHasPaint = false;

  private vectorPathSpanSourceOffset = -1;

  private vectorPathSpanSourceLength = -1;

  private state: GraphicsState;

  private pendingClipRule: 0 | 1 | null = null;

  /** Null outside BT/ET; clipping glyphs are unioned into one node at ET. */
  private pendingTextClipRange: { first: number; count: number } | null = null;

  private fillBounds: DensePdfBounds | null = null;

  private shadingBounds: DensePdfBounds | null = null;

  private patternBounds: DensePdfBounds | null = null;

  private genericPathBounds: DensePdfBounds | null = null;

  private genericStrokeBounds: DensePdfBounds | null = null;

  private genericMaxHalfWidth = 0;

  private operatorSourceOffset = -1;

  /** Innermost marked-content node and optional content, or -1. */
  private activeMarkedContentIndex = -1;

  /** Innermost enclosing marked-content node with an MCID, or -1. */
  private activeContentItem = -1;

  /** Per marked-content node: the innermost node with an MCID at or above it, or -1. */
  private readonly markedContentItems: number[] = [];

  private activeOptionalContentIndex = -1;

  /** Whether paint here shows: retained layers, or visible by default. */
  private contentVisible = true;

  private operatorSourceLength = -1;

  private readonly maxMarkedContentDepth: number;

  private readonly maxMarkedContent: number;

  private readonly maxPathResources: number;

  private readonly maxPathVerbs: number;

  private readonly maxPathCoordinates: number;

  private readonly maxClipPaths: number;

  private readonly maxStrokeStyles: number;

  private readonly maxDashValues: number;

  private retainedPathVerbs = 0;

  private retainedPathCoordinates = 0;

  private retainedStrokeStyles = 0;

  private retainedDashValues = 0;

  private vectorPaintOrdinal = 0;

  private vectorSawVisibleText = false;

  /** Visible path paint cannot be reordered behind a later image by the grouped ABI. */
  private vectorSawPathPaint = false;

  private vectorRecordedOrdinaryPaintBarrier = false;

  private finished = false;

  pathCount = 0;

  fillPathCount = 0;

  textShowOpCount = 0;

  operatorCount = 0;

  constructor(options: DensePdfContentInputOptions, policy: ContentOutputPolicy) {
    this.options = options;
    this.policy = policy;
    this.extGStates = normalizeExtGStateDefinitions(options);
    this.alwaysVisibleOptionalContentProperties = new Set(
      options.alwaysVisibleOptionalContentProperties ?? []
    );
    this.streamed = options.resourceLoader !== undefined;
    const loaded = options.loadedResources;
    if (loaded) {
      for (const name of loaded.fonts) this.loadedResources.font.add(name);
      for (const name of loaded.extGStates) this.loadedResources.extGState.add(name);
      for (const name of loaded.properties) this.loadedResources.property.add(name);
      for (const name of loaded.optionalContentProperties) this.loadedResources.optionalContentProperty.add(name);
      for (const name of loaded.colorSpaces) this.loadedResources.colorSpace.add(name);
      for (const name of loaded.xObjects) this.loadedResources.xObject.add(name);
      for (const name of loaded.shadings ?? []) this.loadedResources.shading.add(name);
      for (const name of loaded.patterns ?? []) this.loadedResources.pattern.add(name);
    }
    this.textSink = options.textOperatorSink;
    this.type3PaintTracked = options.type3PaintMode !== undefined;
    this.uncoloredPaintOnly = options.type3PaintMode === "uncolored" ||
      options.uncoloredPatternPaint === true;
    // Streamed compilation adds each property to its own copy as it loads.
    this.markedContentProperties = options.resourceLoader
      ? new Map(options.markedContentProperties ?? [])
      : options.markedContentProperties;
    this.formOptionalContent = options.formOptionalContent ?? new Map();
    this.imageOptionalContent = options.imageOptionalContent ?? new Map();
    this.maxMarkedContentDepth = normalizePositiveLimit(
      options.maxMarkedContentDepth,
      DEFAULT_MAX_MARKED_CONTENT_DEPTH,
      "maxMarkedContentDepth"
    );
    this.maxMarkedContent = normalizePositiveLimit(
      options.maxMarkedContent,
      DEFAULT_MAX_MARKED_CONTENT,
      "maxMarkedContent"
    );
    this.maxPathResources = normalizePositiveLimit(
      options.maxPathResources,
      DEFAULT_MAX_PATH_RESOURCES,
      "maxPathResources"
    );
    this.maxPathVerbs = normalizePositiveLimit(
      options.maxPathVerbs,
      DEFAULT_MAX_PATH_VERBS,
      "maxPathVerbs"
    );
    this.maxPathCoordinates = normalizePositiveLimit(
      options.maxPathCoordinates,
      DEFAULT_MAX_PATH_COORDINATES,
      "maxPathCoordinates"
    );
    this.maxClipPaths = normalizePositiveLimit(
      options.maxClipPaths,
      DEFAULT_MAX_CLIP_PATHS,
      "maxClipPaths"
    );
    this.maxStrokeStyles = normalizePositiveLimit(
      options.maxStrokeStyles,
      DEFAULT_MAX_STROKE_STYLES,
      "maxStrokeStyles"
    );
    this.maxDashValues = normalizePositiveLimit(
      options.maxDashValues,
      DEFAULT_MAX_DASH_VALUES,
      "maxDashValues"
    );
    validateMarkedContentDefinitions(this.markedContentProperties);
    validateOptionalContentDefinitions(this.formOptionalContent, "formOptionalContent");
    validateOptionalContentDefinitions(this.imageOptionalContent, "imageOptionalContent");
    const inherited = options.initialGraphicsState;
    if (inherited) validateInitialGraphicsState(inherited);
    const initialColorSpace = inherited?.strokeColorSpace ??
      this.resolveColorSpace("DeviceGray", "initial graphics state");
    const initialFillColorSpace = inherited?.fillColorSpace ?? initialColorSpace;
    const initialColor = inherited?.strokeColor ??
      this.convertColor(initialColorSpace, initialColorSpace.initialComponents, "initial graphics state");
    const initialFillColor = inherited?.fillColor ??
      this.convertColor(
        initialFillColorSpace,
        initialFillColorSpace.initialComponents,
        "initial graphics state"
      );
    this.state = {
      matrix: [...options.pageMatrix],
      matrixScale: matrixScale(options.pageMatrix),
      clipBounds: { ...options.pageBounds },
      clipMask: null,
      clipIsDefault: true,
      clipIsExactRectangle: true,
      clipIndex: -1,
      lineWidth: inherited?.lineWidth ?? 1,
      lineCap: inherited?.lineCap ?? 0,
      lineDash: [...(inherited?.lineDash ?? [])],
      dashPhase: inherited?.dashPhase ?? 0,
      strokeR: initialColor[0],
      strokeG: initialColor[1],
      strokeB: initialColor[2],
      fillR: initialFillColor[0],
      fillG: initialFillColor[1],
      fillB: initialFillColor[2],
      strokePaintInherited: inherited?.strokePaintInherited === true ||
        options.type3PaintMode !== undefined || options.uncoloredPatternPaint === true,
      fillPaintInherited: inherited?.fillPaintInherited === true ||
        options.type3PaintMode !== undefined || options.uncoloredPatternPaint === true,
      strokeColorSpace: initialColorSpace,
      fillColorSpace: initialFillColorSpace,
      strokePatternColorSpace: null,
      fillPatternColorSpace: null,
      strokePattern: null,
      fillPattern: null,
      strokeAlpha: inherited?.strokeAlpha ?? 1,
      fillAlpha: inherited?.fillAlpha ?? 1,
      alphaIsShape: inherited?.alphaIsShape ?? false,
      blendMode: inherited?.blendMode ?? "Normal",
      softMaskIndex: inherited?.softMaskIndex ?? -1,
      strokeOverprint: inherited?.strokeOverprint ?? false,
      fillOverprint: inherited?.fillOverprint ?? false,
      overprintMode: inherited?.overprintMode ?? 0,
      textKnockout: inherited?.textKnockout ?? true,
      lineJoin: inherited?.lineJoin ?? 0,
      miterLimit: inherited?.miterLimit ?? 10,
      renderingIntent: inherited?.renderingIntent ?? null,
      flatnessTolerance: inherited?.flatnessTolerance ?? null,
      smoothnessTolerance: inherited?.smoothnessTolerance ?? null,
      strokeAdjustment: inherited?.strokeAdjustment ?? false
    };
    this.strokes = new DenseStrokeBuilder(
      options.enableInvisibleCull !== false,
      policy.displayProgram === true || policy.orderedPaint === true,
      policy.vectorScene === true && policy.orderedPaint === true && policy.displayProgram !== true
    );
    this.fillPathMetaA = new Float4Builder(2_048);
    this.fillPathMetaB = new Float4Builder(2_048);
    this.fillPathMetaC = new Float4Builder(2_048);
    this.fillSegmentsA = new Float4Builder(16_384);
    this.fillSegmentsB = new Float4Builder(16_384);
  }

  get sourceSegmentCount(): number {
    return this.strokes.sourceSegmentCount;
  }

  /** A top-level number is an operand; anything else takes the general path. */
  consumeNumber(value: number): void {
    if (this.finished || this.containers.length !== 0 || this.operandCount >= MAX_OPERAND_COUNT) {
      this.consumeToken({ kind: "number", value });
      return;
    }
    this.operands[this.operandCount++] = value;
  }

  consumeToken(token: LexerToken): void {
    if (this.finished) {
      throw new DensePdfSyntaxError("Content appeared after the compiler was finalized.");
    }

    // Numeric operands dominate content streams.
    if (token.kind === "number") {
      this.appendValue(token.value);
      return;
    }
    if (token.kind === "array-start") {
      this.containers.push({ kind: "array", values: [], entries: [], pendingKey: null });
      return;
    }
    if (token.kind === "dict-start") {
      this.containers.push({ kind: "dictionary", values: [], entries: [], pendingKey: null });
      return;
    }
    if (token.kind === "array-end" || token.kind === "dict-end") {
      this.closeContainer(token.kind);
      return;
    }
    if (token.kind === "name") {
      this.appendValue({ kind: "name", value: token.value });
      return;
    }
    if (token.kind === "string") {
      this.appendValue({ kind: "string", value: token.value });
      return;
    }
    if (token.kind !== "word") {
      throw new DensePdfSyntaxError(`Unexpected ${token.kind} token in PDF content.`);
    }

    if (token.value === "true" || token.value === "false" || token.value === "null") {
      this.appendValue(token.value === "null" ? null : token.value === "true");
      return;
    }
    if (this.containers.length > 0) {
      throw new DensePdfSyntaxError(
        `Unexpected keyword ${token.value} inside a content-stream object.`
      );
    }

    // Path construction dominates CAD content. `m` and `l` need no graphics
    // state, resources or text, so they skip the general dispatcher.
    const operator = token.value;
    if ((operator === "l" || operator === "m") && this.operandCount === 2) {
      const x = this.operands[0];
      const y = this.operands[1];
      if (typeof x === "number" && typeof y === "number" && Number.isFinite(x) && Number.isFinite(y)) {
        if (operator === "l") this.path.lineTo(x, y);
        else this.path.moveTo(x, y);
        this.assertCurrentPathLimits(operator);
        this.operatorCount += 1;
        this.operandCount = 0;
        return;
      }
    }
    if (this.streamed) this.requireStreamedResource(token.value);
    // A thrown error ends the compilation, so the span needs no finally.
    this.operatorSourceOffset = token.sourceOffset;
    this.operatorSourceLength = token.sourceLength;
    this.executeOperator(token.value, this.operands);
    this.operatorCount += 1;
    this.operandCount = 0;
    this.operatorSourceOffset = -1;
    this.operatorSourceLength = -1;
  }

  /**
   * Streamed compilation: suspend before the first operator that uses a
   * resource not loaded yet. The lexer resumes at this operator, with its
   * operands still on the stack, once `loadStreamedResource` has run.
   */
  private requireStreamedResource(operator: string): void {
    const operands = this.operands;
    const count = this.operandCount;
    let kind: StreamedResourceKind;
    let operand: PdfValue;
    switch (operator) {
      case "Tf":
        if (count !== 2) return;
        kind = "font";
        operand = operands[0];
        break;
      case "gs":
        if (count !== 1) return;
        kind = "extGState";
        operand = operands[0];
        break;
      case "cs":
      case "CS":
        if (count !== 1) return;
        kind = "colorSpace";
        operand = operands[0];
        break;
      case "BDC":
      case "DP":
        if (count !== 2 || !isPdfName(operands[0])) return;
        kind = operands[0].value === "OC" ? "optionalContentProperty" : "property";
        operand = operands[1];
        break;
      case "Do":
        if (count !== 1) return;
        kind = "xObject";
        operand = operands[0];
        break;
      case "sh":
        if (count !== 1) return;
        if (!this.options.resourceLoader?.shading) {
          throw new DensePdfStreamingUnsupportedError("Streamed shading needs a resource loader.", operator);
        }
        kind = "shading";
        operand = operands[0];
        break;
      case "BI":
        if (this.options.inlineImageLoader) throw new ContentInlineImageSuspension();
        throw new DensePdfStreamingUnsupportedError(
          `Streamed content cannot resolve operator ${operator}; it needs prepared resources.`,
          operator
        );
      case "SCN":
      case "scn":
        if (count > 0 && isPdfName(operands[count - 1])) {
          if (!this.options.resourceLoader?.pattern) {
            throw new DensePdfStreamingUnsupportedError("Streamed pattern needs a resource loader.", operator);
          }
          kind = "pattern";
          operand = operands[count - 1];
          break;
        }
        return;
      default:
        return;
    }
    if (!isPdfName(operand) || this.loadedResources[kind].has(operand.value)) return;
    throw new ContentResourceSuspension(kind, operand.value);
  }

  /** Load the resource a suspended operator needs, before resuming it. */
  async loadStreamedResource(request: ContentResourceSuspension): Promise<void> {
    const loader = this.options.resourceLoader;
    if (!loader) throw new DensePdfSyntaxError("Content suspended without a resource loader.");
    const { kind, resourceName } = request;
    switch (kind) {
      case "font":
        await loader.font(resourceName);
        break;
      case "extGState": {
        const definition = await loader.extGState(resourceName);
        if (definition.resourceName !== resourceName) {
          throw new TypeError(`The resource loader returned ExtGState /${definition.resourceName} for /${resourceName}.`);
        }
        this.extGStates.set(resourceName, validateExtGStateDefinition(definition));
        break;
      }
      case "property":
      case "optionalContentProperty": {
        const definition = await loader.markedContentProperty(
          resourceName,
          kind === "optionalContentProperty"
        );
        if (definition) {
          const definitions = new Map([[resourceName, definition]]);
          validateMarkedContentDefinitions(definitions);
          (this.markedContentProperties as Map<string, Readonly<DensePdfMarkedContentPropertyDefinition>>)
            .set(resourceName, definition);
        }
        break;
      }
      case "colorSpace":
        await loader.colorSpace(resourceName);
        break;
      case "xObject":
        await loader.xObject(resourceName);
        break;
      case "shading":
        await loader.shading!(resourceName);
        break;
      case "pattern":
        await loader.pattern!(resourceName);
        break;
    }
    this.loadedResources[kind].add(resourceName);
  }

  consumeInlineImage(segment: Readonly<DensePdfInlineImageSegment>): void {
    if (this.finished) {
      throw new DensePdfSyntaxError("Inline image appeared after the compiler was finalized.");
    }
    validateContentSegment(segment);
    if (this.containers.length > 0 || this.operandCount > 0) {
      throw new DensePdfSyntaxError("Inline image interrupts a pending content object or operand list.");
    }
    this.rejectTransformChangeInsidePath("BI");
    this.operatorCount += 1;
    this.operatorSourceOffset = segment.sourceOffset;
    this.operatorSourceLength = segment.sourceLength;
    try {
      if (this.contentVisible && this.state.clipBounds) {
        this.recordImagePaintRun(
          segment.imageIndex,
          this.activeOptionalContentIndex,
          segment.sourceOffset,
          segment.sourceLength,
          "BI"
        );
      }
    } finally {
      this.operatorSourceOffset = -1;
      this.operatorSourceLength = -1;
    }
  }

  async finish(
    checkpoint: (force?: boolean) => Promise<void>
  ): Promise<DensePdfCompiledPage> {
    if (this.finished) {
      throw new DensePdfSyntaxError("Dense PDF content compiler was finalized twice.");
    }
    this.finished = true;
    if (this.containers.length > 0) {
      throw new DensePdfSyntaxError("Unterminated array or dictionary in PDF content.");
    }
    if (this.operandCount > 0) {
      throw new DensePdfSyntaxError("Dangling operands at the end of PDF content.");
    }
    if (this.path.length > 0 || this.pendingClipRule !== null) {
      throw new DensePdfSyntaxError("Unpainted path at the end of PDF content.");
    }
    if (this.pendingTextClipRange !== null) {
      throw new DensePdfSyntaxError("PDF content ends inside an unterminated text object.");
    }
    if (this.stateStack.length > 0) {
      // Saved graphics states are local to this compiled content program. Any
      // unterminated saves expire at EOF after their already-emitted paint.
      while (this.stateStack.length > 0) {
        this.stateStack.pop();
        if ((this.stateStack.length & 0x1fff) === 0) await checkpoint();
      }
    }
    if (this.markedContentStack.length > 0) {
      throw new DensePdfSyntaxError("PDF content ends inside an unterminated BMC/BDC scope.");
    }

    // Uniform opaque, stroke-only pages can retain the established containment
    // optimization. Mixed paints keep every source range stable.
    // Tagged content keeps its per-item ranges, which compaction would merge.
    const compactOrderedStrokes = this.policy.orderedPaint === true &&
      !this.vectorSourceOptionalContentIndices.some(index => index >= 0) &&
      !this.vectorSourceContentItems.some(item => item >= 0) &&
      this.vectorSourceEvents.every((value, i) => i % 2 !== 0 ||
        value === DENSE_PDF_VECTOR_SCENE_EVENT_ORDINARY_PAINT || value === DENSE_PDF_VECTOR_SCENE_EVENT_STROKE) &&
      this.vectorSourceClipIndices.every(index => index === this.vectorSourceClipIndices[0]) &&
      this.vectorSourceBlendModes.every(mode => mode === 0) &&
      this.strokes.hasUniformOpaqueColor();
    this.remapStrokeIndices(compactOrderedStrokes
      ? this.strokes.compactRemoved()
      : await this.strokes.cullContainedInOrder(checkpoint));
    const strokeResult = await this.strokes.finalize(checkpoint, compactOrderedStrokes,
      this.vectorImagePathSpanCheckpoints.length > 0 && !this.policy.orderedPaint
        ? remap => this.remapStrokeIndices(remap)
        : undefined);
    if (compactOrderedStrokes) {
      const clipIndex = this.vectorSourceClipIndices[0] ?? -1;
      this.vectorSourceClipIndices.length = 0;
      this.vectorSourceBlendModes.length = 0;
      this.vectorSourceEvents.length = 0;
      this.vectorSourceOptionalContentIndices.length = 0;
      this.vectorSourceContentItems.length = 0;
      this.vectorPathPaintRanges.length = 0;
      const count = strokeResult.endpoints.length / 4;
      if (count > 0) {
        this.vectorSourceEvents.push(DENSE_PDF_VECTOR_SCENE_EVENT_ORDINARY_PAINT, 0,
          DENSE_PDF_VECTOR_SCENE_EVENT_STROKE, 0);
        this.vectorPathPaintRanges.push(0, count);
        this.vectorSourceClipIndices.push(clipIndex, clipIndex);
        this.vectorSourceBlendModes.push(0, 0);
        this.vectorSourceOptionalContentIndices.push(-1, -1);
        this.vectorSourceContentItems.push(-1, -1);
      }
    }
    const fillPathMetaA = this.fillPathMetaA.take();
    const fillPathMetaB = this.fillPathMetaB.take();
    const fillPathMetaC = this.fillPathMetaC.take();
    const fillSegmentsA = this.fillSegmentsA.take();
    const fillSegmentsB = this.fillSegmentsB.take();
    const combinedBounds = combineBounds(
      combineBounds(
        combineBounds(combineBounds(strokeResult.bounds, this.fillBounds), this.shadingBounds),
        this.patternBounds
      ),
      this.genericPathBounds
    ) ?? {
      ...this.options.pageBounds
    };
    const textClips: DensePdfTextClip[] = [];
    if (this.policy.vectorScene && (this.policy.selectiveRaster || this.policy.orderedPaint)) {
      for (const clip of this.clipPaths) {
        textClips.push(Object.freeze({
          parent: textClips[clip.parentIndex] ?? this.options.initialVectorClip ?? null,
          path: this.pagePaths[clip.pathIndex],
          fillRule: clip.fillRule
        }));
      }
    }
    const result: DensePdfCompiledPage = {
      operatorCount: this.operatorCount,
      pathCount: this.pathCount,
      sourceSegmentCount: this.strokes.sourceSegmentCount,
      mergedSegmentCount: this.strokes.mergedSegmentCount,
      segmentCount: strokeResult.endpoints.length >> 2,
      endpoints: strokeResult.endpoints,
      primitiveMeta: strokeResult.primitiveMeta,
      primitiveBounds: strokeResult.primitiveBounds,
      styles: strokeResult.styles,
      fillPathCount: this.fillPathCount,
      fillSegmentCount: fillSegmentsA.length >> 2,
      fillPathMetaA,
      fillPathMetaB,
      fillPathMetaC,
      fillSegmentsA,
      fillSegmentsB,
      ...(this.policy.vectorScene === true ? {
        vectorSceneData: {
          ...(this.vectorShadingPaints.length ? { shadingPaints: Object.freeze(this.vectorShadingPaints) } : {}),
          sourceEvents: Uint32Array.from(this.vectorSourceEvents),
          ...(this.options.retainOptionalContent ? { sourceOptionalContentIndices: Int32Array.from(this.vectorSourceOptionalContentIndices) } : {}),
          ...this.vectorContentItemTable(),
          sourceBlendModes: Uint8Array.from(this.vectorSourceBlendModes),
          ...(this.policy.orderedPaint ? {
            pathPaintRanges: Uint32Array.from(this.vectorPathPaintRanges),
            pathPaintCount: this.vectorPathPaintCount,
            sourceClips: this.vectorSourceClipIndices.map(index => textClips[index] ?? this.options.initialVectorClip ?? null)
          } : {}),
          glyphRunMeta: Uint32Array.from(this.vectorGlyphRunMeta),
          glyphFillColors: Float32Array.from(this.vectorGlyphFillColors),
          ...(this.vectorGlyphStrokePaints.some(paint => paint !== null)
            ? { glyphStrokePaints: Object.freeze(this.vectorGlyphStrokePaints) } : {}),
          glyphClipBounds: Float32Array.from(this.vectorGlyphClipBounds),
          glyphRunFlags: Uint8Array.from(this.vectorGlyphRunFlags),
          ...(textClips.length === 0 && !this.options.initialVectorClip ? {} : {
            glyphRunClips: Object.freeze(this.vectorGlyphClipIndices.map(index => textClips[index] ?? this.options.initialVectorClip ?? null))
          }),
          imageIndices: Uint32Array.from(this.vectorImageIndices),
          imageTransforms: Float32Array.from(this.vectorImageTransforms),
          imageClipBounds: Float32Array.from(this.vectorImageClipBounds),
          imagePaintOrders: Uint32Array.from(this.vectorImagePaintOrders),
          formPaintOrders: Uint32Array.from(this.vectorFormPaintOrders),
          imageFlags: Uint8Array.from(this.vectorImageFlags),
          imageOpacities: Float32Array.from(this.vectorImageOpacities),
          imagePathSpanCheckpoints: Uint32Array.from(this.vectorImagePathSpanCheckpoints),
          imagePathSourceSpans: Float64Array.from(this.vectorImagePathSourceSpans),
          selectivePaintOrdinalSpans: Uint32Array.from(this.vectorSelectivePaintOrdinalSpans),
          selectivePaintSourceSpans: Float64Array.from(this.vectorSelectivePaintSourceSpans),
          ...(this.vectorSelectivePaintReasons.size
            ? { selectivePaintReasons: Object.freeze([...this.vectorSelectivePaintReasons].sort()) } : {})
        }
      } : {}),
      paintRuns: Uint32Array.from(this.paintRuns),
      paintRunOptionalContentIndices: Int32Array.from(this.paintRunOptionalContentIndices),
      paintRunMarkedContentIndices: Int32Array.from(this.paintRunMarkedContentIndices),
      paintRunClipIndices: Int32Array.from(this.paintRunClipIndices),
      paintRunCompositeStates: Object.freeze(
        this.paintRunCompositeStates.map((state) => Object.freeze({ ...state }))
      ),
      markedContent: Object.freeze(
        this.markedContent.map((node) => Object.freeze({ ...node }))
      ),
      glyphPaints: Object.freeze(
        this.glyphPaints.map((paint) => Object.freeze({
          ...(paint.strokeTransform ? { strokeTransform: Object.freeze([...paint.strokeTransform]) as unknown as DensePdfMatrix } : {}),
          renderingMode: paint.renderingMode,
          ...(paint.patternColorApproximation ? { patternColorApproximation: true } : {}),
          fill: Object.freeze([...paint.fill]) as DensePdfGlyphPaint["fill"],
          stroke: Object.freeze([...paint.stroke]) as DensePdfGlyphPaint["stroke"],
          ...(paint.fillPaintInherited === true ? { fillPaintInherited: true } : {}),
          ...(paint.strokePaintInherited === true ? { strokePaintInherited: true } : {}),
          initialGraphicsState: freezeInitialGraphicsState(paint.initialGraphicsState)
        }))
      ),
      pathPaints: Object.freeze(
        this.pathPaints.map((paint) => Object.freeze({
          color: Object.freeze([...paint.color]) as DensePdfSolidPaint["color"],
          sourceColorSpaceIndex: paint.sourceColorSpaceIndex,
          ...(paint.inheritType3Paint === true ? { inheritType3Paint: true } : {})
        }))
      ),
      pagePaths: Object.freeze(
        this.pagePaths.map((path) => Object.freeze({
          data: path.data.slice(),
          transform: Object.freeze([...path.transform]) as DensePdfMatrix,
          bounds: Object.freeze({ ...path.bounds })
        }))
      ),
      genericPathPaints: Object.freeze(
        this.genericPathPaints.map((paint) => Object.freeze({
          pathIndex: paint.pathIndex,
          fillRule: paint.fillRule,
          fill: paint.fill === null ? null : freezeSolidPaint(paint.fill),
          stroke: paint.stroke === null ? null : freezeSolidPaint(paint.stroke),
          strokeStyle: paint.strokeStyle === null ? null : Object.freeze({
            ...paint.strokeStyle,
            dash: Object.freeze([...paint.strokeStyle.dash])
          })
        }))
      ),
      clipPaths: Object.freeze(
        this.clipPaths.map((clip) => Object.freeze({ ...clip }))
      ),
      imageTransforms: Object.freeze(
        this.imageTransforms.map((matrix) => Object.freeze([...matrix]) as DensePdfMatrix)
      ),
      imagePaints: Object.freeze(
        this.imagePaints.map((paint) => Object.freeze({
          color: Object.freeze([...paint.color]) as DensePdfSolidPaint["color"],
          sourceColorSpaceIndex: paint.sourceColorSpaceIndex,
          ...(paint.inheritType3Paint === true ? { inheritType3Paint: true } : {}),
          clipBounds: Object.freeze({ ...paint.clipBounds }),
          sourceOffset: paint.sourceOffset,
          sourceLength: paint.sourceLength
        }))
      ),
      formPaints: Object.freeze(
        this.formPaints.map((paint, index) => Object.freeze({
          ...(this.policy.orderedPaint ? { vectorClip: textClips[this.vectorFormClipIndices[index]] ?? this.options.initialVectorClip ?? null } : {}),
          definitionIndex: paint.definitionIndex,
          transform: Object.freeze([...paint.transform]) as DensePdfMatrix,
          clipBounds: Object.freeze({ ...paint.clipBounds }),
          clipIsDefault: paint.clipIsDefault,
          clipIsExactRectangle: paint.clipIsExactRectangle,
          initialGraphicsState: freezeInitialGraphicsState(paint.initialGraphicsState)
        }))
      ),
      shadingPaints: Object.freeze(
        this.shadingPaints.map((paint) => Object.freeze({
          gradientIndex: paint.gradientIndex,
          transform: Object.freeze([...paint.transform]) as DensePdfMatrix,
          clipBounds: Object.freeze({ ...paint.clipBounds })
        }))
      ),
      patternPaints: Object.freeze(
        this.patternPaints.map((paint) => Object.freeze({
          patternIndex: paint.patternIndex,
          pathIndex: paint.pathIndex,
          fillRule: paint.fillRule,
          role: paint.role,
          transform: Object.freeze([...paint.transform]) as DensePdfMatrix,
          baseColor: paint.baseColor === null ? null : freezeSolidPaint(paint.baseColor),
          strokeStyle: paint.strokeStyle === null ? null : Object.freeze({
            ...paint.strokeStyle,
            dash: Object.freeze([...paint.strokeStyle.dash])
          }),
          bounds: Object.freeze({ ...paint.bounds })
        }))
      ),
      bounds: combinedBounds,
      strokeBounds: combineBounds(strokeResult.bounds, this.genericStrokeBounds),
      fillBounds: this.fillBounds,
      maxHalfWidth: Math.max(strokeResult.maxHalfWidth, this.genericMaxHalfWidth),
      discardedTransparentCount: this.strokes.discardedTransparentCount,
      discardedDegenerateCount: this.strokes.discardedDegenerateCount,
      discardedDuplicateCount: this.strokes.discardedDuplicateCount,
      discardedContainedCount: strokeResult.discardedContainedCount,
      referencedFonts: [...this.referencedFonts],
      referencedProperties: [...this.referencedProperties],
      referencedExtGStates: [...this.referencedExtGStates],
      referencedXObjects: [...this.referencedXObjects],
      referencedColorSpaces: [...this.referencedColorSpaces],
      referencedShadings: [...this.referencedShadings],
      referencedPatterns: [...this.referencedPatterns],
      textShowOpCount: this.textShowOpCount
    };
    if (this.options.capturePaintSourceIdentities === true) {
      paintSourceIdentities.set(result, {
        offsets: Float64Array.from(this.paintRunSourceOffsets),
        lengths: Float64Array.from(this.paintRunSourceLengths)
      });
    }
    return result;
  }

  private appendValue(value: PdfValue): void {
    const container = this.containers.at(-1);
    if (!container) {
      if (this.operandCount >= MAX_OPERAND_COUNT) {
        throw new DensePdfSyntaxError("PDF content operand stack exceeded its safety limit.");
      }
      this.operands[this.operandCount++] = value;
      return;
    }

    if (container.kind === "array") {
      container.values.push(value);
      return;
    }

    if (container.pendingKey === null) {
      if (!isPdfName(value)) {
        throw new DensePdfSyntaxError("PDF dictionary keys must be names.");
      }
      container.pendingKey = value.value;
      return;
    }
    container.entries.push([container.pendingKey, value]);
    container.pendingKey = null;
  }

  private closeContainer(kind: "array-end" | "dict-end"): void {
    const container = this.containers.pop();
    const expected = kind === "array-end" ? "array" : "dictionary";
    if (!container || container.kind !== expected) {
      throw new DensePdfSyntaxError(`Unexpected ${kind} token in PDF content.`);
    }
    if (container.kind === "dictionary" && container.pendingKey !== null) {
      throw new DensePdfSyntaxError("PDF dictionary ended without a value for its final key.");
    }
    this.appendValue(
      container.kind === "array"
        ? { kind: "array", value: container.values }
        : { kind: "dictionary", value: container.entries }
    );
  }

  private executeOperator(operator: string, args: PdfValue[]): void {
    if (this.uncoloredPaintOnly && TYPE3_UNCOLORED_FORBIDDEN_OPERATORS.has(operator)) {
      throw new DensePdfUnsupportedError(
        `Uncolored ${this.options.uncoloredPatternPaint === true
          ? "tiling-pattern cell"
          : "Type3 CharProc"} content cannot use color operator ${operator}.`,
        operator
      );
    }
    if (this.type3PaintTracked) {
      if (TYPE3_STROKE_COLOR_OPERATORS.has(operator)) this.state.strokePaintInherited = false;
      if (TYPE3_FILL_COLOR_OPERATORS.has(operator)) this.state.fillPaintInherited = false;
    }
    if (this.textSink && isTextSinkOperator(operator)) {
      const glyphRuns = this.textSink.applyOperator(
        operator,
        this.textSinkOperands(),
        {
          outputEnabled: this.contentVisible,
          optionalContentIndex: this.activeOptionalContentIndex,
          markedContentIndex: this.activeMarkedContentIndex
        }
      );
      if (glyphRuns) {
        for (const run of glyphRuns) {
          if (
            !Number.isSafeInteger(run.first) || run.first < 0 ||
            !Number.isSafeInteger(run.count) || run.count < 0 ||
            !Number.isInteger(run.renderingMode) ||
            run.renderingMode < 0 || run.renderingMode > 7
          ) {
            throw new DensePdfSyntaxError("The native text engine emitted an invalid glyph paint run.");
          }
          this.recordGlyphPaintRun(run.first, run.count, run.renderingMode);
        }
      }
    }
    switch (operator) {
      case "m":
        this.requireArgs(operator, args, 2);
        this.path.moveTo(numberArg(args, 0), numberArg(args, 1));
        this.assertCurrentPathLimits(operator);
        return;
      case "l":
        this.requireArgs(operator, args, 2);
        this.path.lineTo(numberArg(args, 0), numberArg(args, 1));
        this.assertCurrentPathLimits(operator);
        return;
      case "c":
        this.requireArgs(operator, args, 6);
        this.path.curveTo(
          numberArg(args, 0), numberArg(args, 1), numberArg(args, 2),
          numberArg(args, 3), numberArg(args, 4), numberArg(args, 5)
        );
        this.assertCurrentPathLimits(operator);
        return;
      case "v":
        this.requireArgs(operator, args, 4);
        this.path.curveTo2(
          numberArg(args, 0), numberArg(args, 1), numberArg(args, 2), numberArg(args, 3)
        );
        this.assertCurrentPathLimits(operator);
        return;
      case "y":
        this.requireArgs(operator, args, 4);
        this.path.curveTo3(
          numberArg(args, 0), numberArg(args, 1), numberArg(args, 2), numberArg(args, 3)
        );
        this.assertCurrentPathLimits(operator);
        return;
      case "re":
        this.requireArgs(operator, args, 4);
        this.path.rectangle(
          numberArg(args, 0), numberArg(args, 1), numberArg(args, 2), numberArg(args, 3)
        );
        this.assertCurrentPathLimits(operator);
        return;
      case "h":
        this.requireArgs(operator, args, 0);
        this.path.closePath(this.policy.displayProgram === true);
        this.assertCurrentPathLimits(operator);
        return;
      case "W":
      case "W*":
        this.requireArgs(operator, args, 0);
        if (this.pendingClipRule !== null) {
          throw new DensePdfSyntaxError("A PDF path contains more than one clipping operator.");
        }
        this.pendingClipRule = operator === "W*" ? FILL_RULE_EVEN_ODD : FILL_RULE_NONZERO;
        return;
      case "S":
      case "s":
      case "f":
      case "F":
      case "f*":
      case "B":
      case "B*":
      case "b":
      case "b*":
      case "n":
        this.requireArgs(operator, args, 0);
        this.paintPath(operator);
        return;
      case "q":
        this.requireArgs(operator, args, 0);
        this.rejectTransformChangeInsidePath(operator);
        this.stateStack.push(cloneState(this.state));
        return;
      case "Q": {
        this.requireArgs(operator, args, 0);
        this.rejectTransformChangeInsidePath(operator);
        const restored = this.stateStack.pop();
        if (!restored) {
          throw new DensePdfSyntaxError("Unbalanced Q operator in PDF content.");
        }
        this.state = restored;
        return;
      }
      case "cm":
        this.requireArgs(operator, args, 6);
        this.rejectTransformChangeInsidePath(operator);
        this.state.matrix = multiplyMatrices(this.state.matrix, matrixFromArgs(args));
        this.state.matrixScale = matrixScale(this.state.matrix);
        return;
      case "w":
        this.requireArgs(operator, args, 1);
        {
          const lineWidth = numberArg(args, 0);
          if (this.policy.displayProgram && lineWidth < 0) {
            throw new DensePdfSyntaxError("w requires a non-negative line width.");
          }
          this.state.lineWidth = Math.abs(lineWidth);
        }
        return;
      case "J":
        this.requireArgs(operator, args, 1);
        {
          const lineCap = numberArg(args, 0);
          if (!Number.isInteger(lineCap) || lineCap < 0 || lineCap > 2) {
            throw new DensePdfSyntaxError("J requires an integer line cap from 0 through 2.");
          }
          this.state.lineCap = lineCap;
        }
        return;
      case "j": {
        this.requireArgs(operator, args, 1);
        const lineJoin = numberArg(args, 0);
        if (!Number.isInteger(lineJoin) || lineJoin < 0 || lineJoin > 2) {
          throw new DensePdfSyntaxError("j requires an integer line join from 0 through 2.");
        }
        this.state.lineJoin = lineJoin as 0 | 1 | 2;
        return;
      }
      case "M": {
        this.requireArgs(operator, args, 1);
        const miterLimit = numberArg(args, 0);
        if (miterLimit < 1) {
          throw new DensePdfSyntaxError("M requires a miter limit of at least 1.");
        }
        this.state.miterLimit = miterLimit;
        return;
      }
      case "ri":
        this.requireArgs(operator, args, 1);
        this.state.renderingIntent = nameArg(args, 0);
        return;
      case "i":
        this.requireArgs(operator, args, 1);
        this.state.flatnessTolerance = numberArg(args, 0);
        if (this.state.flatnessTolerance < 0 || this.state.flatnessTolerance > 100) {
          throw new DensePdfSyntaxError("i requires a flatness tolerance from 0 through 100.");
        }
        return;
      case "d": {
        this.requireArgs(operator, args, 2);
        const dash = arrayArg(args, 0).map((value) => numberValue(value, "d"));
        if (dash.some((value) => value < 0)) {
          throw new DensePdfSyntaxError("Negative dash-array entry in PDF content.");
        }
        if (
          this.policy.displayProgram && dash.length > 0 &&
          dash.every((value) => value === 0)
        ) {
          throw new DensePdfSyntaxError("A PDF dash array cannot contain only zero lengths.");
        }
        this.state.lineDash = normalizeDashPattern(dash);
        this.state.dashPhase = numberArg(args, 1);
        return;
      }
      case "gs": {
        this.requireArgs(operator, args, 1);
        const resourceName = nameArg(args, 0);
        const definition = this.extGStates.get(resourceName);
        if (!definition) {
          throw new DensePdfUnsupportedError(
            `Graphics state /${resourceName} was not resolved for this content.`,
            operator
          );
        }
        if (definition.font && this.textSink) {
          this.textSink.applyOperator(operator, [resourceName], {
            outputEnabled: this.contentVisible,
            optionalContentIndex: this.activeOptionalContentIndex,
            markedContentIndex: this.activeMarkedContentIndex,
            font: definition.font
          });
        }
        if (definition.strokeAlpha !== undefined) {
          this.state.strokeAlpha = definition.strokeAlpha;
        }
        if (definition.fillAlpha !== undefined) {
          this.state.fillAlpha = definition.fillAlpha;
        }
        if (definition.blendMode !== undefined) this.state.blendMode = definition.blendMode;
        if (definition.softMaskIndex !== undefined) {
          this.state.softMaskIndex = definition.softMaskIndex ?? -1;
        }
        if (definition.strokeOverprint !== undefined) {
          this.state.strokeOverprint = definition.strokeOverprint;
        }
        if (definition.fillOverprint !== undefined) {
          this.state.fillOverprint = definition.fillOverprint;
        }
        if (definition.overprintMode !== undefined) {
          this.state.overprintMode = definition.overprintMode;
        }
        if (definition.alphaIsShape !== undefined) {
          this.state.alphaIsShape = definition.alphaIsShape;
        }
        if (definition.textKnockout !== undefined) {
          this.state.textKnockout = definition.textKnockout;
        }
        if (definition.lineWidth !== undefined) this.state.lineWidth = definition.lineWidth;
        if (definition.lineCap !== undefined) this.state.lineCap = definition.lineCap;
        if (definition.lineJoin !== undefined) this.state.lineJoin = definition.lineJoin;
        if (definition.miterLimit !== undefined) this.state.miterLimit = definition.miterLimit;
        if (definition.lineDash !== undefined) {
          this.state.lineDash = normalizeDashPattern([...definition.lineDash]);
          this.state.dashPhase = definition.dashPhase ?? 0;
        }
        if (definition.renderingIntent !== undefined) {
          this.state.renderingIntent = definition.renderingIntent;
        }
        if (definition.flatnessTolerance !== undefined) {
          this.state.flatnessTolerance = definition.flatnessTolerance;
        }
        if (definition.smoothnessTolerance !== undefined) {
          this.state.smoothnessTolerance = definition.smoothnessTolerance;
        }
        if (definition.strokeAdjustment !== undefined) {
          this.state.strokeAdjustment = definition.strokeAdjustment;
        }
        this.referencedExtGStates.add(resourceName);
        return;
      }
      case "G":
        this.requireArgs(operator, args, 1);
        this.state.strokePatternColorSpace = null;
        this.state.strokePattern = null;
        this.state.strokeColorSpace = this.resolveColorSpace("DeviceGray", operator);
        [this.state.strokeR, this.state.strokeG, this.state.strokeB] = this.convertColor(
          this.state.strokeColorSpace,
          [numberArg(args, 0)],
          operator
        );
        return;
      case "g":
        this.requireArgs(operator, args, 1);
        this.state.fillPatternColorSpace = null;
        this.state.fillPattern = null;
        this.state.fillColorSpace = this.resolveColorSpace("DeviceGray", operator);
        [this.state.fillR, this.state.fillG, this.state.fillB] = this.convertColor(
          this.state.fillColorSpace,
          [numberArg(args, 0)],
          operator
        );
        return;
      case "RG":
        this.requireArgs(operator, args, 3);
        this.state.strokePatternColorSpace = null;
        this.state.strokePattern = null;
        this.state.strokeColorSpace = this.resolveColorSpace("DeviceRGB", operator);
        [this.state.strokeR, this.state.strokeG, this.state.strokeB] = this.convertColor(
          this.state.strokeColorSpace,
          [numberArg(args, 0), numberArg(args, 1), numberArg(args, 2)],
          operator
        );
        return;
      case "rg":
        this.requireArgs(operator, args, 3);
        this.state.fillPatternColorSpace = null;
        this.state.fillPattern = null;
        this.state.fillColorSpace = this.resolveColorSpace("DeviceRGB", operator);
        [this.state.fillR, this.state.fillG, this.state.fillB] = this.convertColor(
          this.state.fillColorSpace,
          [numberArg(args, 0), numberArg(args, 1), numberArg(args, 2)],
          operator
        );
        return;
      case "K":
        this.requireArgs(operator, args, 4);
        this.state.strokePatternColorSpace = null;
        this.state.strokePattern = null;
        this.state.strokeColorSpace = this.resolveColorSpace("DeviceCMYK", operator);
        [this.state.strokeR, this.state.strokeG, this.state.strokeB] = this.convertColor(
          this.state.strokeColorSpace,
          [numberArg(args, 0), numberArg(args, 1), numberArg(args, 2), numberArg(args, 3)],
          operator
        );
        return;
      case "k":
        this.requireArgs(operator, args, 4);
        this.state.fillPatternColorSpace = null;
        this.state.fillPattern = null;
        this.state.fillColorSpace = this.resolveColorSpace("DeviceCMYK", operator);
        [this.state.fillR, this.state.fillG, this.state.fillB] = this.convertColor(
          this.state.fillColorSpace,
          [numberArg(args, 0), numberArg(args, 1), numberArg(args, 2), numberArg(args, 3)],
          operator
        );
        return;
      case "CS":
      case "cs": {
        this.requireArgs(operator, args, 1);
        const resourceName = nameArg(args, 0);
        const patternColorSpace = this.resolvePatternColorSpace(resourceName);
        if (patternColorSpace) {
          this.referencedColorSpaces.add(resourceName);
          if (operator === "CS") {
            this.state.strokePatternColorSpace = patternColorSpace;
            this.state.strokePattern = null;
          } else {
            this.state.fillPatternColorSpace = patternColorSpace;
            this.state.fillPattern = null;
          }
          return;
        }
        const colorSpace = this.resolveColorSpace(resourceName, operator);
        const initial = this.convertColor(colorSpace, colorSpace.initialComponents, operator);
        if (operator === "CS") {
          this.state.strokePatternColorSpace = null;
          this.state.strokePattern = null;
          this.state.strokeColorSpace = colorSpace;
          [this.state.strokeR, this.state.strokeG, this.state.strokeB] = initial;
        } else {
          this.state.fillPatternColorSpace = null;
          this.state.fillPattern = null;
          this.state.fillColorSpace = colorSpace;
          [this.state.fillR, this.state.fillG, this.state.fillB] = initial;
        }
        return;
      }
      case "SC":
      case "sc":
      case "SCN":
      case "scn": {
        args = this.operandList();
        const stroke = operator === "SC" || operator === "SCN";
        const patternColorSpace = stroke
          ? this.state.strokePatternColorSpace
          : this.state.fillPatternColorSpace;
        if (patternColorSpace) {
          if (operator === "SC" || operator === "sc") {
            throw new DensePdfSyntaxError(
              `${operator} cannot select a pattern; use ${stroke ? "SCN" : "scn"}.`
            );
          }
          const patternOperand = args.at(-1);
          if (patternOperand === undefined || !isPdfName(patternOperand)) {
            throw new DensePdfSyntaxError(`${operator} requires a final pattern-name operand.`);
          }
          const resourceName = nameArg(args, args.length - 1);
          const definition = this.options.patterns?.get(resourceName);
          if (!definition) {
            throw new DensePdfUnsupportedError(
              `Pattern /${resourceName} was not resolved in the active resource scope.`,
              operator
            );
          }
          this.validatePatternDefinition(definition, resourceName);
          const components = args.slice(0, -1).map((_, index) => numberArg(args, index));
          const base = patternColorSpace.baseColorSpace;
          if (definition.kind === "uncolored-tiling") {
            if (!base) {
              throw new DensePdfSyntaxError(
                `Uncolored pattern /${resourceName} requires a [/Pattern base] color space.`
              );
            }
            const color = this.convertColor(base, components, operator);
            if (stroke) {
              this.state.strokeColorSpace = base;
              [this.state.strokeR, this.state.strokeG, this.state.strokeB] = color;
            } else {
              this.state.fillColorSpace = base;
              [this.state.fillR, this.state.fillG, this.state.fillB] = color;
            }
          } else if (base || components.length !== 0) {
            throw new DensePdfSyntaxError(
              `Colored pattern /${resourceName} requires the colored /Pattern color space.`
            );
          }
          this.referencedPatterns.add(resourceName);
          if (stroke) {
            this.state.strokePattern = definition;
            if (definition.solidColor) {
              [this.state.strokeR, this.state.strokeG, this.state.strokeB] = definition.solidColor;
            }
          } else {
            this.state.fillPattern = definition;
            if (definition.solidColor) {
              [this.state.fillR, this.state.fillG, this.state.fillB] = definition.solidColor;
            }
          }
          return;
        }
        const colorSpace = stroke ? this.state.strokeColorSpace : this.state.fillColorSpace;
        const color = this.convertColor(
          colorSpace,
          args.map((_, index) => numberArg(args, index)),
          operator
        );
        if (stroke) {
          [this.state.strokeR, this.state.strokeG, this.state.strokeB] = color;
        } else {
          [this.state.fillR, this.state.fillG, this.state.fillB] = color;
        }
        return;
      }
      case "Do": {
        this.requireArgs(operator, args, 1);
        this.rejectTransformChangeInsidePath(operator);
        const resourceName = nameArg(args, 0);
        const imageIndex = this.options.imageXObjects?.get(resourceName);
        if (imageIndex !== undefined) {
          const association = this.imageOptionalContent.get(resourceName);
          if (!this.options.retainOptionalContent && association?.defaultVisible === false) {
            if (imageIndex !== -1 && (!Number.isSafeInteger(imageIndex) || imageIndex < 0)) {
              throw new DensePdfSyntaxError(
                `Hidden Image XObject /${resourceName} has an invalid page-local index.`
              );
            }
            return;
          }
          if (!Number.isSafeInteger(imageIndex) || imageIndex < 0) {
            throw new DensePdfSyntaxError(`Image XObject /${resourceName} has an invalid page-local index.`);
          }
          if (this.contentVisible) {
            this.referencedXObjects.add(resourceName);
            this.recordImagePaintRun(
              imageIndex,
              this.combineOptionalContent(this.activeOptionalContentIndex, association?.optionalContentIndex ?? -1),
              this.operatorSourceOffset,
              this.operatorSourceLength,
              "Do"
            );
          }
          return;
        }
        const formDefinitionIndex = this.options.formXObjects?.get(resourceName);
        if (formDefinitionIndex !== undefined) {
          if (!Number.isSafeInteger(formDefinitionIndex) || formDefinitionIndex < 0) {
            throw new DensePdfSyntaxError(
              `Form XObject /${resourceName} has an invalid page-local definition index.`
            );
          }
          this.referencedXObjects.add(resourceName);
          const association = this.formOptionalContent.get(resourceName);
          if (this.contentVisible && (this.options.retainOptionalContent || association?.defaultVisible !== false)) {
            this.recordFormPaint(
              formDefinitionIndex,
              this.combineOptionalContent(this.activeOptionalContentIndex, association?.optionalContentIndex ?? -1)
            );
          }
          return;
        }
        throw new DensePdfUnsupportedError(
          `XObject /${resourceName} was not resolved as a native image or Form program.`,
          operator
        );
      }
      case "sh": {
        this.requireArgs(operator, args, 1);
        this.rejectTransformChangeInsidePath(operator);
        const resourceName = nameArg(args, 0);
        const gradientIndex = this.options.shadings?.get(resourceName);
        if (gradientIndex === undefined) {
          throw new DensePdfUnsupportedError(
            `Shading /${resourceName} was not resolved in the active resource scope.`,
            operator
          );
        }
        if (!Number.isSafeInteger(gradientIndex) || gradientIndex < 0) {
          throw new DensePdfSyntaxError(
            `Shading /${resourceName} has an invalid page-local gradient index.`
          );
        }
        if (gradientIndex > 0xffff_ffff) {
          throw new DensePdfResourceLimitError(
            `Shading /${resourceName} exceeds the HEPR gradient-index range.`,
            operator
          );
        }
        if (this.policy.displayProgram !== true &&
            !(this.policy.vectorScene === true &&
              (this.policy.selectiveRaster === true ||
                (this.policy.orderedPaint && this.options.vectorShadings?.has(gradientIndex))))) {
          throw new DensePdfUnsupportedError(
            "The sh operator requires source-ordered display-program compilation.",
            operator
          );
        }
        this.referencedShadings.add(resourceName);
        if (this.contentVisible && this.state.clipBounds) {
          if (this.policy.vectorScene === true) {
            this.assertVectorSceneComposite("nonstroke", operator);
            const ordinal = this.nextVectorPaintOrdinal(operator);
            const [a, b, c, d] = this.state.matrix;
            if (this.policy.orderedPaint && this.options.vectorShadings?.has(gradientIndex) &&
                this.state.blendMode === "Normal" && Math.abs(a * d - b * c) > 1e-12) {
              this.recordVectorSourceEvent(DENSE_PDF_VECTOR_SCENE_EVENT_GRADIENT, this.vectorShadingPaints.length, operator);
              this.vectorShadingPaints.push({ gradientIndex, transform: [...this.state.matrix],
                clipBounds: { ...this.state.clipBounds }, alpha: this.state.fillAlpha, paintOrder: ordinal });
              this.shadingBounds = combineBounds(this.shadingBounds, this.state.clipBounds);
            } else {
              this.vectorSelectivePaintSourceSpans.push(
                this.operatorSourceOffset,
                this.operatorSourceLength
              );
              this.recordVectorSelectivePaint(ordinal, "root-shading");
            }
            this.vectorPathSpanStartFillCount = this.fillPathCount;
            this.vectorPathSpanStartStrokeCount = this.strokes.primitiveCount;
            this.vectorPathSpanStartOrdinal = ordinal + 1;
          } else {
            this.recordShadingPaint(gradientIndex);
          }
        }
        return;
      }
      case "BT":
        this.requireArgs(operator, args, 0);
        if (this.options.textOperatorSink) {
          if (this.pendingTextClipRange !== null) {
            throw new DensePdfSyntaxError("Nested BT operators are not permitted.");
          }
          this.pendingTextClipRange = { first: -1, count: 0 };
        }
        return;
      case "ET":
        this.requireArgs(operator, args, 0);
        if (this.options.textOperatorSink) this.commitTextClip();
        return;
      case "T*":
        this.requireArgs(operator, args, 0);
        return;
      case "Tc":
      case "Tw":
      case "Tz":
      case "TL":
      case "Ts":
        this.requireArgs(operator, args, 1);
        numberArg(args, 0);
        return;
      case "Tr": {
        this.requireArgs(operator, args, 1);
        const modeValue = numberArg(args, 0);
        const mode = Math.trunc(modeValue);
        if (mode !== modeValue || mode < 0 || mode > 7) {
          throw new DensePdfSyntaxError("Tr requires an integer text rendering mode from 0 through 7.");
        }
        if (mode >= 4 && !this.options.textOperatorSink && this.contentVisible) {
          throw new DensePdfUnsupportedError(
            "Glyph clipping text modes require the native text sink.",
            operator
          );
        }
        return;
      }
      case "Td":
      case "TD":
        this.requireArgs(operator, args, 2);
        numberArg(args, 0);
        numberArg(args, 1);
        return;
      case "Tm":
        this.requireArgs(operator, args, 6);
        matrixFromArgs(args);
        return;
      case "Tf": {
        this.requireArgs(operator, args, 2);
        const font = nameArg(args, 0);
        numberArg(args, 1);
        this.referencedFonts.add(font);
        return;
      }
      case "Tj":
        this.requireArgs(operator, args, 1);
        stringArg(args, 0);
        this.requireNativeTextSinkForVisiblePaint(operator);
        this.textShowOpCount += 1;
        return;
      case "TJ":
        this.requireArgs(operator, args, 1);
        validateTextArray(arrayArg(args, 0));
        this.requireNativeTextSinkForVisiblePaint(operator);
        this.textShowOpCount += 1;
        return;
      case "'":
        this.requireArgs(operator, args, 1);
        stringArg(args, 0);
        this.requireNativeTextSinkForVisiblePaint(operator);
        this.textShowOpCount += 1;
        return;
      case "\"":
        this.requireArgs(operator, args, 3);
        numberArg(args, 0);
        numberArg(args, 1);
        stringArg(args, 2);
        this.requireNativeTextSinkForVisiblePaint(operator);
        this.textShowOpCount += 1;
        return;
      case "BMC": {
        this.requireArgs(operator, args, 1);
        const tag = nameArg(args, 0);
        if (tag === "OC") {
          throw new DensePdfUnsupportedError(
            "An /OC BMC scope has no membership property and cannot be evaluated.",
            operator
          );
        }
        this.beginMarkedContent(tag, null, -1, -1, true, operator);
        this.textSink?.applyOperator(operator, [tag], {
          outputEnabled: this.contentVisible,
          optionalContentIndex: this.activeOptionalContentIndex,
          markedContentIndex: this.activeMarkedContentIndex
        });
        return;
      }
      case "BDC": {
        this.requireArgs(operator, args, 2);
        const tag = nameArg(args, 0);
        const property = args[1];
        let propertyName: string | null = null;
        let implicitVisibleOptionalScope = false;
        let optionalContentIndex = -1;
        let defaultVisible = true;
        let mcid = -1;
        let actualText: Uint8Array | null = null;
        if (isPdfName(property)) {
          propertyName = property.value;
          implicitVisibleOptionalScope = tag === "OC" &&
            this.markedContentProperties === undefined &&
            this.alwaysVisibleOptionalContentProperties.has(propertyName);
          if (!implicitVisibleOptionalScope) this.referencedProperties.add(propertyName);
          const definition = this.resolveMarkedContentProperty(propertyName, operator);
          if (definition) {
            if (tag === "OC") {
              optionalContentIndex = definition.optionalContentIndex;
              defaultVisible = definition.defaultVisible;
              implicitVisibleOptionalScope = definition.unresolvedOptionalContent === true;
            }
            mcid = definition.mcid;
            actualText = definition.actualText ?? null;
          }
        } else if (!isPdfDictionary(property)) {
          throw new DensePdfSyntaxError("BDC property operand must be a name or dictionary.");
        } else {
          if (dictionaryContainsOptionalContent(property)) {
            throw new DensePdfUnsupportedError(
              "Inline optional-content property dictionaries cannot be resolved synchronously.",
              operator
            );
          }
          mcid = readInlineMcid(property, operator);
          const value = property.value.find(([key]) => key === "ActualText")?.[1];
          if (value !== undefined && value !== null) {
            if (!isPdfString(value)) throw new DensePdfSyntaxError("BDC /ActualText must be a byte string.");
            actualText = value.value;
          }
        }
        if (
          tag === "OC" && optionalContentIndex < 0 && !implicitVisibleOptionalScope &&
          !(propertyName && this.alwaysVisibleOptionalContentProperties.has(propertyName))
        ) {
          throw new DensePdfUnsupportedError(
            "An /OC BDC scope does not resolve to an OCG or OCMD membership.",
            operator
          );
        }
        this.beginMarkedContent(
          tag,
          propertyName,
          mcid,
          optionalContentIndex,
          defaultVisible,
          operator
        );
        this.textSink?.applyOperator(operator, [tag, actualText], {
          outputEnabled: this.contentVisible,
          optionalContentIndex: this.activeOptionalContentIndex,
          markedContentIndex: this.activeMarkedContentIndex
        });
        return;
      }
      case "EMC":
        this.requireArgs(operator, args, 0);
        if (!this.markedContentStack.pop()) {
          throw new DensePdfSyntaxError("EMC has no matching BMC or BDC scope.");
        }
        this.syncActiveMarkedContent();
        this.textSink?.applyOperator(operator, [], {
          outputEnabled: this.contentVisible,
          optionalContentIndex: this.activeOptionalContentIndex,
          markedContentIndex: this.activeMarkedContentIndex
        });
        return;
      case "MP":
        this.requireArgs(operator, args, 1);
        nameArg(args, 0);
        return;
      case "DP": {
        this.requireArgs(operator, args, 2);
        const tag = nameArg(args, 0);
        const property = args[1];
        let optionalContentIndex = -1;
        let unresolvedOptionalContent = false;
        if (isPdfName(property)) {
          this.referencedProperties.add(property.value);
          const definition = this.resolveMarkedContentProperty(
            property.value,
            operator
          );
          optionalContentIndex = tag === "OC"
            ? definition?.optionalContentIndex ?? -1
            : -1;
          unresolvedOptionalContent = definition?.unresolvedOptionalContent === true;
        } else if (!isPdfDictionary(property)) {
          throw new DensePdfSyntaxError("DP property operand must be a name or dictionary.");
        } else if (dictionaryContainsOptionalContent(property)) {
          throw new DensePdfUnsupportedError(
            "Inline optional-content property dictionaries cannot be resolved synchronously.",
            operator
          );
        }
        if (
          tag === "OC" && optionalContentIndex < 0 && !unresolvedOptionalContent &&
          !(isPdfName(property) &&
            this.alwaysVisibleOptionalContentProperties.has(property.value))
        ) {
          throw new DensePdfUnsupportedError(
            "An /OC DP point does not resolve to an OCG or OCMD membership.",
            operator
          );
        }
        return;
      }
      case "BX":
      case "EX":
        this.requireArgs(operator, args, 0);
        return;
      default:
        throw new DensePdfUnsupportedError(
          `PDF content operator ${operator} is not supported.`,
          operator
        );
    }
  }

  private assertCurrentPathLimits(operator: string): void {
    if (this.path.verbCount > this.maxPathVerbs) {
      throw new DensePdfResourceLimitError(
        `A PDF path exceeds the ${this.maxPathVerbs}-verb limit.`,
        operator
      );
    }
    if (this.path.coordinateCount > this.maxPathCoordinates) {
      throw new DensePdfResourceLimitError(
        `A PDF path exceeds the ${this.maxPathCoordinates}-coordinate limit.`,
        operator
      );
    }
  }

  private retainExactPath(
    pathData: Float32Array,
    pathBounds: DensePdfBounds | null,
    painted: boolean,
    operator: string
  ): number {
    if (this.pagePaths.length >= this.maxPathResources) {
      throw new DensePdfResourceLimitError(
        `Generic path resources exceed limit ${this.maxPathResources}.`,
        operator
      );
    }
    const nextVerbCount = this.retainedPathVerbs + this.path.verbCount;
    if (nextVerbCount > this.maxPathVerbs) {
      throw new DensePdfResourceLimitError(
        `Retained generic path verbs exceed limit ${this.maxPathVerbs}.`,
        operator
      );
    }
    const nextCoordinateCount = this.retainedPathCoordinates + this.path.coordinateCount;
    if (nextCoordinateCount > this.maxPathCoordinates) {
      throw new DensePdfResourceLimitError(
        `Retained generic path coordinates exceed limit ${this.maxPathCoordinates}.`,
        operator
      );
    }
    const index = this.pagePaths.length;
    const bounds = pathBounds ?? { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    this.pagePaths.push({
      data: pathData.slice(),
      transform: [...this.state.matrix],
      bounds: { ...bounds }
    });
    this.retainedPathVerbs = nextVerbCount;
    this.retainedPathCoordinates = nextCoordinateCount;
    if (painted && pathBounds) {
      this.genericPathBounds = combineBounds(this.genericPathBounds, pathBounds);
    }
    return index;
  }

  private retainClipPath(
    pathIndex: number,
    pathData: Float32Array,
    pathBounds: DensePdfBounds | null,
    operator: string
  ): void {
    const fillRule = this.pendingClipRule;
    if (fillRule === null) return;
    if (this.clipPaths.length >= this.maxClipPaths) {
      throw new DensePdfResourceLimitError(
        `Persistent clipping nodes exceed limit ${this.maxClipPaths}.`,
        operator
      );
    }
    const parentIndex = this.state.clipIndex;
    this.clipPaths.push({ parentIndex, pathIndex, fillRule });
    this.state.clipIndex = this.clipPaths.length - 1;
    const clipMask = fillRule === FILL_RULE_EVEN_ODD
      ? extractSimpleEvenOddRectangleClipMask(pathData, this.state.matrix)
      : null;
    applyClipToState(
      this.state,
      pathBounds,
      clipMask,
      fillRule,
      isSingleAxisAlignedRectangle(pathData, pathBounds, this.state.matrix)
    );
  }

  private currentSolidPaint(role: "fill" | "stroke"): DensePdfSolidPaint {
    const fill = role === "fill";
    return {
      color: fill
        ? [this.state.fillR, this.state.fillG, this.state.fillB, 1]
        : [this.state.strokeR, this.state.strokeG, this.state.strokeB, 1],
      sourceColorSpaceIndex: fill
        ? this.state.fillColorSpace.colorSpaceIndex
        : this.state.strokeColorSpace.colorSpaceIndex,
      ...((fill ? this.state.fillPaintInherited : this.state.strokePaintInherited)
        ? { inheritType3Paint: true as const }
        : {})
    };
  }

  private currentGenericStrokeStyle(operator: string): DensePdfGenericStrokeStyle {
    if (this.retainedStrokeStyles >= this.maxStrokeStyles) {
      throw new DensePdfResourceLimitError(
        `Generic stroke styles exceed limit ${this.maxStrokeStyles}.`,
        operator
      );
    }
    if (this.retainedDashValues + this.state.lineDash.length > this.maxDashValues) {
      throw new DensePdfResourceLimitError(
        `Retained dash-array values exceed limit ${this.maxDashValues}.`,
        operator
      );
    }
    this.retainedStrokeStyles += 1;
    this.retainedDashValues += this.state.lineDash.length;
    return {
      lineWidth: this.state.lineWidth,
      lineCap: this.state.lineCap as 0 | 1 | 2,
      lineJoin: this.state.lineJoin,
      miterLimit: this.state.miterLimit,
      dash: [...this.state.lineDash],
      dashPhase: this.state.dashPhase,
      hairline: this.state.lineWidth === 0,
      strokeAdjust: this.state.strokeAdjustment
    };
  }

  private retainGenericPathPaint(
    pathIndex: number,
    fillRule: 0 | 1,
    fill: boolean,
    stroke: boolean,
    operator: string
  ): void {
    const pathBounds = this.pagePaths[pathIndex]?.bounds;
    if (pathBounds) {
      let paintBounds = pathBounds;
      if (stroke && this.state.lineWidth > 0) {
        const matrix = this.state.matrix;
        const linearScale = Math.max(
          Math.hypot(matrix[0], matrix[1]),
          Math.hypot(matrix[2], matrix[3])
        );
        const halfWidth = this.state.lineWidth * linearScale * 0.5;
        const joinExpansion = this.state.lineJoin === 0
          ? Math.max(1, this.state.miterLimit)
          : Math.SQRT2;
        const expansion = halfWidth * joinExpansion;
        paintBounds = expandBounds(pathBounds, expansion);
        this.genericStrokeBounds = combineBounds(this.genericStrokeBounds, paintBounds);
        this.genericMaxHalfWidth = Math.max(this.genericMaxHalfWidth, expansion);
      } else if (stroke) {
        this.genericStrokeBounds = combineBounds(this.genericStrokeBounds, pathBounds);
      }
      this.genericPathBounds = combineBounds(this.genericPathBounds, paintBounds);
    }
    const fillComposite = fill ? this.compositeState("nonstroke") : null;
    const strokeComposite = stroke ? this.compositeState("stroke") : null;
    const combined = fill && stroke && fillComposite !== null && strokeComposite !== null &&
      compositeStatesEqual(fillComposite, strokeComposite) &&
      fillComposite.alpha === 1 && fillComposite.blendMode === "Normal" &&
      fillComposite.softMaskIndex < 0;
    if (combined) {
      const start = this.genericPathPaints.length;
      this.genericPathPaints.push({
        pathIndex,
        fillRule,
        fill: this.currentSolidPaint("fill"),
        stroke: this.currentSolidPaint("stroke"),
        strokeStyle: this.currentGenericStrokeStyle(operator)
      });
      this.recordPaintTrace(
        DENSE_PDF_PAINT_RUN_PATH,
        start,
        1,
        undefined,
        "nonstroke",
        fillComposite
      );
      return;
    }
    if (fill && fillComposite) {
      const start = this.genericPathPaints.length;
      this.genericPathPaints.push({
        pathIndex,
        fillRule,
        fill: this.currentSolidPaint("fill"),
        stroke: null,
        strokeStyle: null
      });
      this.recordPaintTrace(
        DENSE_PDF_PAINT_RUN_PATH,
        start,
        1,
        undefined,
        "nonstroke",
        fillComposite
      );
    }
    if (stroke && strokeComposite) {
      const start = this.genericPathPaints.length;
      this.genericPathPaints.push({
        pathIndex,
        fillRule,
        fill: null,
        stroke: this.currentSolidPaint("stroke"),
        strokeStyle: this.currentGenericStrokeStyle(operator)
      });
      this.recordPaintTrace(
        DENSE_PDF_PAINT_RUN_PATH,
        start,
        1,
        undefined,
        "stroke",
        strokeComposite
      );
    }
  }

  private paintPath(operator: string): void {
    const closesPath = operator === "s" || operator === "b" || operator === "b*";
    if (closesPath) {
      this.path.closePath(this.policy.displayProgram === true);
      this.assertCurrentPathLimits(operator);
    }

    if (
      this.contentVisible &&
      operator === "S" &&
      this.state.strokePatternColorSpace === null &&
      this.pendingClipRule === null &&
      // Ordered output records each paint's exact clip path; like the general
      // path, the stroke store itself only culls against the clip's bounds.
      (this.state.clipIndex < 0 || this.policy.orderedPaint) &&
      this.state.lineDash.length === 0 &&
      this.state.lineCap !== 2 &&
      this.path.isSingleLine() &&
      // A single segment has no joins, stroke adjustment is not applied, and
      // the general path packs this line exactly the same way. Only display
      // programs, which otherwise retain the exact style, need the defaults.
      (!this.policy.displayProgram || (
        this.state.lineJoin === 0 &&
        Math.abs(this.state.miterLimit - 10) <= 1e-6 &&
        !this.state.strokeAdjustment &&
        isPackedStrokeTransformCompatible(
          this.state.matrix,
          this.state.lineWidth,
          this.state.lineDash.length > 0
        )
      ))
    ) {
      this.paintSimpleStrokeLine();
      return;
    }

    const pathData = this.path.view();
    const oversizedPath = !this.policy.displayProgram &&
      pathData.length > MAX_PAINT_PATH_FLOATS;
    const pathBounds = pathData.length > 0
      ? computeTransformedPathBounds(pathData, this.state.matrix)
      : null;
    const strokePaint = operator === "S" || operator === "s" || operator === "B" ||
      operator === "B*" || operator === "b" || operator === "b*";
    const fillPaint = operator === "f" || operator === "F" || operator === "f*" ||
      operator === "B" || operator === "B*" || operator === "b" || operator === "b*";
    const isEndPath = operator === "n";

    const fillPathVisible = this.contentVisible && pathData.length > 0 &&
      boundsIntersectNullable(this.state.clipBounds, pathBounds);
    // Centerline bounds are not a semantic stroke bound: a wide stroke can
    // overlap the clip even when its source path does not. Keep it and let the
    // backend apply the exact persistent clip.
    const strokePathVisible = this.contentVisible && pathData.length > 0 &&
      this.state.clipBounds !== null;
    const pathVisible = (fillPaint && fillPathVisible) || (strokePaint && strokePathVisible);
    if (!isEndPath && pathVisible) {
      this.pathCount += 1;
    }

    const fillRule = fillPaint
      ? operator.includes("*") ? FILL_RULE_EVEN_ODD : FILL_RULE_NONZERO
      : null;
    const largeDisconnectedFill =
      !this.policy.displayProgram && !this.policy.orderedPaint && pathVisible &&
      fillRule === FILL_RULE_NONZERO &&
      countPathMoveOps(pathData) >= 100;
    if (largeDisconnectedFill && !(
      this.policy.vectorScene === true &&
      this.policy.selectiveRaster === true
    )) {
      throw new DensePdfUnsupportedError(
        "Large disconnected nonzero fills require source-ordered exact path compilation.",
        operator
      );
    }

    let exactPathIndex = -1;
    const finishClip = (): void => {
      if (this.pendingClipRule === null) return;
      if (this.policy.displayProgram || this.policy.selectiveRaster || this.policy.orderedPaint) {
        if (exactPathIndex < 0) {
          exactPathIndex = this.retainExactPath(pathData, pathBounds, false, operator);
        }
        this.retainClipPath(exactPathIndex, pathData, pathBounds, operator);
      } else {
        const clipMask = this.pendingClipRule === FILL_RULE_EVEN_ODD
          ? extractSimpleEvenOddRectangleClipMask(pathData, this.state.matrix)
          : null;
        applyClipToState(
          this.state,
          pathBounds,
          clipMask,
          this.pendingClipRule,
          isSingleAxisAlignedRectangle(pathData, pathBounds, this.state.matrix)
        );
      }
    };

    const fillUsesPattern = fillPaint && this.state.fillPatternColorSpace !== null &&
      !(this.policy.vectorScene && this.state.fillPattern?.solidColor);
    const strokeUsesPattern = strokePaint && this.state.strokePatternColorSpace !== null &&
      !(this.policy.vectorScene && this.state.strokePattern?.solidColor);
    const visiblePatternFill = fillPathVisible && fillUsesPattern &&
      this.state.fillAlpha > ALPHA_INVISIBLE_EPSILON;
    const visiblePatternStroke = strokePathVisible && strokeUsesPattern &&
      this.state.strokeAlpha > ALPHA_INVISIBLE_EPSILON;
    const fillPattern = visiblePatternFill ? this.state.fillPattern : null;
    const strokePattern = visiblePatternStroke ? this.state.strokePattern : null;
    if (visiblePatternFill && !fillPattern) {
      throw new DensePdfSyntaxError(
        "A nonstroking /Pattern color space was painted before scn selected a pattern."
      );
    }
    if (visiblePatternStroke && !strokePattern) {
      throw new DensePdfSyntaxError(
        "A stroking /Pattern color space was painted before SCN selected a pattern."
      );
    }

    const visibleFill = fillPathVisible && fillPaint && !fillUsesPattern &&
      this.state.fillAlpha > ALPHA_INVISIBLE_EPSILON;
    const visibleStroke = strokePathVisible && strokePaint && !strokeUsesPattern &&
      this.state.strokeAlpha > ALPHA_INVISIBLE_EPSILON;
    // The cooperative geometry budget applies to emitted paint, not to clip
    // resources or discarded paths. Pages can preserve the complete compound
    // path (including winding, dashes, and the active clip) through the native
    // display program's bounded selective raster capture.
    const visibleOversizedPath = oversizedPath &&
      (visibleFill || visibleStroke || visiblePatternFill || visiblePatternStroke);
    if (visibleOversizedPath && !this.policy.selectiveRaster) {
      throw new DensePdfUnsupportedError(
        "A single PDF path is too large for cooperative vector compilation.",
        operator
      );
    }
    const selectivelyCapturedPath = this.policy.vectorScene === true &&
      this.policy.selectiveRaster === true &&
      (visibleOversizedPath || largeDisconnectedFill || visiblePatternFill || visiblePatternStroke ||
        ((!this.policy.orderedPaint && !this.state.clipIsDefault && !this.state.clipIsExactRectangle) &&
          (visibleFill || visibleStroke)));
    if (selectivelyCapturedPath) {
      if (visibleFill || visiblePatternFill) this.assertVectorSceneComposite("nonstroke", operator);
      if (visibleStroke || visiblePatternStroke) this.assertVectorSceneComposite("stroke", operator);
      const ordinal = this.nextVectorPaintOrdinal(operator);
      this.vectorSelectivePaintSourceSpans.push(
        this.operatorSourceOffset,
        this.operatorSourceLength
      );
      this.recordVectorSelectivePaint(ordinal, visibleOversizedPath ? "large-path" : selectivePathPaintReason(
        largeDisconnectedFill, visiblePatternFill, visiblePatternStroke,
        this.state.fillPattern?.kind, this.state.strokePattern?.kind));
      finishClip();
      this.clearPaintPathState();
      return;
    }
    if (this.policy.vectorScene === true) {
      // Validate before emitting into the optimizing stores: a duplicate or
      // contained primitive may otherwise be removed before its unsupported
      // blend/mask semantics are observed.
      if (visibleFill) this.noteVectorOrdinaryPaint("nonstroke", operator);
      if (visibleStroke) this.noteVectorOrdinaryPaint("stroke", operator);
    }
    if (visiblePatternFill || visiblePatternStroke) {
      if (!this.policy.displayProgram) {
        throw new DensePdfUnsupportedError(
          "Pattern path painting requires source-ordered display-program compilation.",
          operator
        );
      }
      exactPathIndex = this.retainExactPath(pathData, pathBounds, true, operator);
      const exactFillRule = fillRule ?? FILL_RULE_NONZERO;
      // PDF paints a combined path fill before its stroke. Retain separate
      // commands whenever either role is a pattern so role-specific alpha,
      // overprint, blend, soft mask, and pattern base color cannot alias.
      if (visiblePatternFill) {
        this.recordPatternPaint(
          fillPattern!,
          exactPathIndex,
          exactFillRule,
          "fill",
          operator
        );
      } else if (visibleFill) {
        this.retainGenericPathPaint(exactPathIndex, exactFillRule, true, false, operator);
      }
      if (visiblePatternStroke) {
        this.recordPatternPaint(
          strokePattern!,
          exactPathIndex,
          exactFillRule,
          "stroke",
          operator
        );
      } else if (visibleStroke) {
        this.retainGenericPathPaint(exactPathIndex, exactFillRule, false, true, operator);
      }
      finishClip();
      this.clearPaintPathState();
      return;
    }

    const simpleDenseFill = visibleFill && !visibleStroke &&
      fillRule === FILL_RULE_NONZERO && pathBounds !== null &&
      countPathMoveOps(pathData) === 1 &&
      isAxisAlignedRectangleSubpath(
        pathData,
        { start: 0, end: pathData.length, bounds: pathBounds },
        this.state.matrix
      );
    const simpleDenseStroke = visibleStroke && !visibleFill &&
      this.path.isSingleLine() && this.state.lineCap !== 2 &&
      this.state.lineJoin === 0 && Math.abs(this.state.miterLimit - 10) <= 1e-6 &&
      !this.state.strokeAdjustment && isPackedStrokeTransformCompatible(
        this.state.matrix,
        this.state.lineWidth,
        this.state.lineDash.length > 0
      );
    const genericPaint = this.policy.displayProgram === true &&
      (visibleFill || visibleStroke) && !simpleDenseFill && !simpleDenseStroke;

    if (genericPaint) {
      exactPathIndex = this.retainExactPath(pathData, pathBounds, true, operator);
      this.retainGenericPathPaint(
        exactPathIndex,
        fillRule ?? FILL_RULE_NONZERO,
        visibleFill,
        visibleStroke,
        operator
      );
      finishClip();
      this.clearPaintPathState();
      return;
    }

    if (visibleStroke) this.assertSupportedStrokeState(operator);

    const strokes = this.strokes;
    const fillPathMetaA = this.fillPathMetaA;
    const fillPathMetaB = this.fillPathMetaB;
    const fillPathMetaC = this.fillPathMetaC;
    const fillSegmentsA = this.fillSegmentsA;
    const fillSegmentsB = this.fillSegmentsB;

    let strokeStart = 0;
    let strokeCount = 0;
    if (visibleStroke) {
      strokes.paintContext = this.strokePaintContext();
      // This path's fill paints before its stroke: the stroke starts a new run.
      if (visibleFill) strokes.breakRun();
      strokeStart = strokes.primitiveCount;
      const isHairline = this.state.lineWidth <= 0;
      const halfWidth = isHairline ? 0 : this.state.lineWidth * this.state.matrixScale * 0.5;
      // Record the width once for a path whose aggregate bounds intersect the
      // clip, even when primitive-level clipping later rejects every segment.
      strokes.recordPathHalfWidth(halfWidth);
      let flags = isHairline ? DENSE_PDF_STROKE_STYLE_FLAG_HAIRLINE : 0;
      if (this.state.lineCap === 1) {
        flags |= STROKE_STYLE_FLAG_ROUND_CAP;
      }
      emitSegmentsFromPath(
        pathData,
        this.state.matrix,
        halfWidth,
        this.state.strokeR,
        this.state.strokeG,
        this.state.strokeB,
        this.policy.displayProgram ? 1 : this.state.strokeAlpha,
        flags,
        this.state.lineDash,
        this.state.dashPhase,
        this.options.enableSegmentMerge !== false,
        strokes,
        this.state.clipBounds
      );
      strokeCount = strokes.primitiveCount - strokeStart;
      if (strokeCount > 0 && (!fillPaint || !visibleFill)) {
        this.recordPaintRun(DENSE_PDF_PAINT_RUN_STROKE, strokeStart, strokeCount, true);
      }
    }

    if (visibleFill) {
      const fillStart = this.fillPathCount;
      const fillSegmentStart = fillSegmentsA.quadCount;
      if (fillRule === null) {
        throw new DensePdfSyntaxError("Missing PDF fill rule for a painted fill path.");
      }
      const emittedBounds = emitFilledPathFromPath(
            pathData,
            this.state.matrix,
            fillRule,
            strokePaint && this.state.strokeAlpha > ALPHA_INVISIBLE_EPSILON,
            this.state.fillR,
            this.state.fillG,
            this.state.fillB,
            this.policy.displayProgram ? 1 : this.state.fillAlpha,
            fillPathMetaA,
            fillPathMetaB,
            fillPathMetaC,
            fillSegmentsA,
            fillSegmentsB,
            this.state.clipBounds,
            this.state.clipMask
          );
      if (emittedBounds) {
        if (!this.policy.displayProgram && fillSegmentsA.quadCount - fillSegmentStart > 65_536) {
          throw new DensePdfUnsupportedError("VectorScene fill exceeds the 65536-segment analytic coverage budget.", operator);
        }
        this.fillPathCount += 1;
        this.fillBounds = combineBounds(this.fillBounds, emittedBounds);
      }
      const fillCount = this.fillPathCount - fillStart;
      if (fillCount > 0) {
        this.recordPaintRun(DENSE_PDF_PAINT_RUN_FILL, fillStart, fillCount, true);
      }
      if (strokePaint) {
        if (strokeCount > 0) {
          this.recordPaintRun(
            DENSE_PDF_PAINT_RUN_STROKE,
            strokeStart,
            strokeCount,
            true
          );
        }
      }
    }

    finishClip();
    this.clearPaintPathState();
  }

  private paintSimpleStrokeLine(): void {
    const strokes = this.strokes;
    const data = this.path.rawData();
    const matrix = this.state.matrix;
    const x0 = matrix[0] * data[1] + matrix[2] * data[2] + matrix[4];
    const y0 = matrix[1] * data[1] + matrix[3] * data[2] + matrix[5];
    const x1 = matrix[0] * data[4] + matrix[2] * data[5] + matrix[4];
    const y1 = matrix[1] * data[4] + matrix[3] * data[5] + matrix[5];
    const clip = this.state.clipBounds;
    const geometryMinX = Math.min(x0, x1);
    const geometryMinY = Math.min(y0, y1);
    const geometryMaxX = Math.max(x0, x1);
    const geometryMaxY = Math.max(y0, y1);
    const hairline = this.state.lineWidth <= 0;
    const halfWidth = hairline
      ? 0
      : this.state.lineWidth * this.state.matrixScale * 0.5;
    if (
      !clip ||
      geometryMaxX + halfWidth < clip.minX || geometryMinX - halfWidth > clip.maxX ||
      geometryMaxY + halfWidth < clip.minY || geometryMinY - halfWidth > clip.maxY
    ) {
      this.path.clear();
      return;
    }
    this.pathCount += 1;
    strokes.recordPathHalfWidth(halfWidth);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const zeroLength = dx * dx + dy * dy < 1e-10;
    if (zeroLength && this.state.lineCap !== 1) {
      this.path.clear();
      return;
    }
    const validated = this.state.strokeAlpha > ALPHA_INVISIBLE_EPSILON && this.policy.vectorScene === true;
    if (this.state.strokeAlpha > ALPHA_INVISIBLE_EPSILON) {
      if (validated) this.noteVectorOrdinaryPaint("stroke", "S");
      this.assertSupportedStrokeState("S");
    }
    strokes.sourceSegmentCount += 1;
    strokes.paintContext = this.strokePaintContext();
    const strokeStart = strokes.primitiveCount;
    let flags = hairline ? DENSE_PDF_STROKE_STYLE_FLAG_HAIRLINE : 0;
    if (this.state.lineCap === 1) flags |= STROKE_STYLE_FLAG_ROUND_CAP;
    const paintMinX = geometryMinX - halfWidth;
    const paintMinY = geometryMinY - halfWidth;
    const paintMaxX = geometryMaxX + halfWidth;
    const paintMaxY = geometryMaxY + halfWidth;
    const visibleMinX = Math.max(clip.minX, paintMinX);
    const visibleMinY = Math.max(clip.minY, paintMinY);
    const visibleMaxX = Math.min(clip.maxX, paintMaxX);
    const visibleMaxY = Math.min(clip.maxY, paintMaxY);
    if (visibleMinX <= visibleMaxX && visibleMinY <= visibleMaxY) {
      const clipped =
        visibleMinX > paintMinX + 1e-6 || visibleMinY > paintMinY + 1e-6 ||
        visibleMaxX < paintMaxX - 1e-6 || visibleMaxY < paintMaxY - 1e-6;
      if (clipped) flags |= DENSE_PDF_STROKE_STYLE_FLAG_CLIPPED;
      strokes.emitPrimitive(
        x0, y0, x1, y1, x1, y1, STROKE_PRIMITIVE_LINE,
        halfWidth,
        this.state.strokeR, this.state.strokeG, this.state.strokeB,
        this.policy.displayProgram ? 1 : this.state.strokeAlpha, flags,
        clipped ? clip.minX : geometryMinX,
        clipped ? clip.minY : geometryMinY,
        clipped ? clip.maxX : geometryMaxX,
        clipped ? clip.maxY : geometryMaxY
      );
    }
    const strokeCount = strokes.primitiveCount - strokeStart;
    if (strokeCount > 0) {
      this.recordPaintRun(DENSE_PDF_PAINT_RUN_STROKE, strokeStart, strokeCount, validated);
    }
    this.path.clear();
  }

  private assertSupportedStrokeState(operator: string): void {
    // The compact unordered representation retains its established
    // approximation behavior. Source-ordered compilation must fail instead
    // of discarding visible stroke semantics.
    if (!this.policy.displayProgram) return;
    if (this.state.lineCap === 2) {
      throw new DensePdfUnsupportedError(
        "Projecting-square line caps require the native stroke-style expansion.",
        operator
      );
    }
    if (this.state.lineJoin !== 0 || Math.abs(this.state.miterLimit - 10) > 1e-6) {
      throw new DensePdfUnsupportedError(
        "The active line join or miter limit is not representable by the stroke store.",
        operator
      );
    }
    if (this.state.strokeAdjustment) {
      throw new DensePdfUnsupportedError(
        "Stroke adjustment requires device-pixel-aware path placement.",
        operator
      );
    }
  }

  private resolveColorSpace(
    resourceName: string,
    operator: string
  ): Readonly<DensePdfColorSpaceDefinition> {
    let definition = this.options.colorSpaceResolver?.(resourceName);
    if (!definition) definition = fallbackDeviceColorSpace(resourceName, operator);
    if (
      typeof definition.resourceName !== "string" ||
      !Number.isSafeInteger(definition.colorSpaceIndex) || definition.colorSpaceIndex < -1 ||
      !Number.isSafeInteger(definition.componentCount) || definition.componentCount <= 0 ||
      definition.componentCount > 255 ||
      !Array.isArray(definition.initialComponents) ||
      definition.initialComponents.length !== definition.componentCount ||
      definition.initialComponents.some((value) => !Number.isFinite(value)) ||
      typeof definition.convertToSrgb !== "function"
    ) {
      throw new TypeError(`Color-space resolver returned an invalid definition for /${resourceName}.`);
    }
    this.referencedColorSpaces.add(resourceName);
    return definition;
  }

  private resolvePatternColorSpace(
    resourceName: string
  ): Readonly<DensePdfPatternColorSpaceDefinition> | undefined {
    const definition = this.options.patternColorSpaces?.get(resourceName);
    if (!definition) return undefined;
    if (
      definition.resourceName !== resourceName ||
      (definition.baseColorSpace !== null &&
        (!Number.isSafeInteger(definition.baseColorSpace.componentCount) ||
          definition.baseColorSpace.componentCount <= 0))
    ) {
      throw new TypeError(
        `Pattern color-space resolver returned an invalid definition for /${resourceName}.`
      );
    }
    return definition;
  }

  private validatePatternDefinition(
    definition: Readonly<DensePdfPatternDefinition>,
    resourceName: string
  ): void {
    if (
      definition.resourceName !== resourceName ||
      !Number.isSafeInteger(definition.patternIndex) || definition.patternIndex < 0 ||
      definition.patternIndex > 0xffff_ffff ||
      (definition.kind !== "colored-tiling" &&
        definition.kind !== "uncolored-tiling" && definition.kind !== "shading") ||
      (definition.solidColor !== undefined && (definition.kind !== "colored-tiling" ||
        !Array.isArray(definition.solidColor) || definition.solidColor.length !== 3 ||
        definition.solidColor.some(value => !Number.isFinite(value) || value < 0 || value > 1))) ||
      typeof definition.hasExtGState !== "boolean" ||
      definition.hasExtGState !== (definition.extGState !== undefined)
    ) {
      throw new TypeError(`Pattern /${resourceName} has an invalid page-local definition.`);
    }
  }

  private convertColor(
    definition: Readonly<DensePdfColorSpaceDefinition>,
    components: readonly number[],
    operator: string
  ): [number, number, number] {
    if (components.length !== definition.componentCount) {
      throw new DensePdfSyntaxError(
        `${operator} expected ${definition.componentCount} components for /${definition.resourceName}.`
      );
    }
    if (components.some((value) => !Number.isFinite(value))) {
      throw new DensePdfSyntaxError(`${operator} contains a non-finite color component.`);
    }
    const converted = definition.convertToSrgb(components);
    if (
      !Array.isArray(converted) || converted.length !== 3 ||
      converted.some((value) => !Number.isFinite(value))
    ) {
      throw new DensePdfUnsupportedError(
        `Color space /${definition.resourceName} produced an invalid sRGB value.`,
        operator
      );
    }
    return [clamp01(converted[0]), clamp01(converted[1]), clamp01(converted[2])];
  }

  private assertVectorSceneComposite(
    role: "stroke" | "nonstroke",
    operator: string,
    requireOpaque = false,
    requireLocalPaint = true
  ): void {
    const stroke = role === "stroke";
    const alpha = stroke ? this.state.strokeAlpha : this.state.fillAlpha;
    // `/AIS` only changes compositing when an alpha source can reduce the
    // source contribution. With unit constant alpha and no soft mask, shape
    // and opacity are identically 1, so the VectorScene result is exact. Keep the
    // rejection for every active-alpha case below.
    if (this.state.alphaIsShape && (alpha !== 1 || this.state.softMaskIndex >= 0)) {
      throw new DensePdfUnsupportedError(
        "VectorScene output cannot represent alpha-as-shape compositing.",
        operator
      );
    }
    if (this.state.blendMode !== "Normal" &&
        !(this.policy.orderedPaint && this.state.blendMode === "Multiply")) {
      throw new DensePdfUnsupportedError(
        `VectorScene output cannot represent /${this.state.blendMode} blending.`,
        operator
      );
    }
    if (this.state.softMaskIndex >= 0) {
      throw new DensePdfUnsupportedError(
        "VectorScene output cannot represent a soft mask.",
        operator
      );
    }
    if ((stroke ? this.state.strokeOverprint : this.state.fillOverprint) &&
        this.policy.ignoreOverprint !== true) {
      throw new DensePdfUnsupportedError(
        "VectorScene output cannot represent active overprint.",
        operator
      );
    }
    if (requireOpaque && alpha !== 1) {
      throw new DensePdfUnsupportedError(
        "VectorScene image output requires opaque constant alpha.",
        operator
      );
    }
    if (
      requireLocalPaint &&
      (stroke ? this.state.strokePaintInherited : this.state.fillPaintInherited)
    ) {
      throw new DensePdfUnsupportedError(
        "VectorScene output cannot represent inherited caller paint.",
        operator
      );
    }
  }

  private nextVectorPaintOrdinal(operator: string): number {
    if (this.vectorPaintOrdinal > 0xffff_ffff) {
      throw new DensePdfResourceLimitError(
        "VectorScene output exceeds the 32-bit source paint-order range.",
        operator
      );
    }
    return this.vectorPaintOrdinal++;
  }

  private recordVectorSelectivePaint(ordinal: number, reason: DensePdfSelectivePaintReason): void {
    this.vectorSelectivePaintReasons.add(reason);
    this.vectorSelectivePaintOrdinalSpans.push(ordinal, ordinal);
    if (this.policy.orderedPaint) {
      this.recordVectorSourceEvent(DENSE_PDF_VECTOR_SCENE_EVENT_COMPOSITE, ordinal, "paint");
    }
  }

  private recordVectorSourceEvent(kind: number, index: number, operator: string, optionalContentIndex = this.activeOptionalContentIndex): void {
    if (
      !Number.isSafeInteger(kind) || kind < 0 || kind > 0xffff_ffff ||
      !Number.isSafeInteger(index) || index < 0 || index > 0xffff_ffff ||
      this.vectorSourceEvents.length > 0xffff_ffff - 2
    ) {
      throw new DensePdfResourceLimitError(
        "VectorScene source events exceed the 32-bit event-tape range.",
        operator
      );
    }
    if (kind !== DENSE_PDF_VECTOR_SCENE_EVENT_STROKE) this.strokes.breakRun();
    this.vectorSourceEvents.push(kind, index);
    this.vectorSourceOptionalContentIndices.push(optionalContentIndex);
    this.vectorSourceContentItems.push(this.activeContentItem);
    this.vectorSourceClipIndices.push(this.state.clipIndex);
    this.vectorSourceBlendModes.push(this.state.blendMode === "Multiply" ? 1 : 0);
  }

  private recordVectorOrdinaryPaintBarrier(operator: string): void {
    if (this.vectorRecordedOrdinaryPaintBarrier) return;
    this.recordVectorSourceEvent(
      DENSE_PDF_VECTOR_SCENE_EVENT_ORDINARY_PAINT,
      0,
      operator
    );
    this.vectorRecordedOrdinaryPaintBarrier = true;
  }

  private recordVectorOrdinaryPaint(
    role: "stroke" | "nonstroke",
    operator: string,
    validated = false
  ): void {
    if (!validated) this.assertVectorSceneComposite(role, operator);
    this.nextVectorPaintOrdinal(operator);
    this.recordVectorOrdinaryPaintBarrier(operator);
  }

  private recordVectorPathPaint(
    role: "stroke" | "nonstroke",
    operator: string,
    validated: boolean
  ): void {
    if (!this.vectorPathSpanHasPaint) {
      this.vectorPathSpanSourceOffset = this.operatorSourceOffset;
      this.vectorPathSpanSourceLength = this.operatorSourceLength;
      this.vectorPathSpanHasPaint = true;
    }
    this.recordVectorOrdinaryPaint(role, operator, validated);
    this.vectorSawPathPaint = true;
  }

  private noteVectorOrdinaryPaint(
    role: "stroke" | "nonstroke",
    operator: string
  ): void {
    this.assertVectorSceneComposite(role, operator);
    this.recordVectorOrdinaryPaintBarrier(operator);
    this.vectorSawPathPaint = true;
  }

  /**
   * Consecutive paths of one kind, clip, blend mode and layer draw as one run,
   * so extend the previous range instead of recording an event per path.
   */
  private extendLastPathPaint(event: number, start: number, count: number): boolean {
    const eventOffset = this.vectorSourceEvents.length - 2;
    const rangeOffset = this.vectorPathPaintRanges.length - 2;
    if (eventOffset < 0 || rangeOffset < 0 ||
        this.vectorSourceEvents[eventOffset] !== event ||
        this.vectorSourceEvents[eventOffset + 1] !== rangeOffset / 2 ||
        this.vectorPathPaintRanges[rangeOffset] + this.vectorPathPaintRanges[rangeOffset + 1] !== start) return false;
    const last = eventOffset / 2;
    // Each structure content item keeps its own range, so its paint stays attributable.
    if (this.vectorSourceOptionalContentIndices[last] !== this.activeOptionalContentIndex ||
        this.vectorSourceContentItems[last] !== this.activeContentItem ||
        this.vectorSourceClipIndices[last] !== this.state.clipIndex ||
        this.vectorSourceBlendModes[last] !== (this.state.blendMode === "Multiply" ? 1 : 0)) return false;
    this.vectorPathPaintRanges[rangeOffset + 1] += count;
    return true;
  }

  /** Number the structure content items events reference, in first-use order. */
  private vectorContentItemTable(): Pick<DensePdfVectorSceneData, "sourceContentItems" | "contentItems"> {
    const items: DensePdfVectorContentItem[] = [];
    const indexes = new Map<number, number>();
    const events = this.vectorSourceContentItems.map((node) => {
      if (node < 0) return -1;
      let index = indexes.get(node);
      if (index === undefined) {
        index = items.length;
        indexes.set(node, index);
        items.push(Object.freeze({ mcid: this.markedContent[node].mcid, tag: this.markedContent[node].tag }));
      }
      return index;
    });
    return items.length ? { sourceContentItems: Int32Array.from(events), contentItems: Object.freeze(items) } : {};
  }

  /** Tag strokes with their paint context; Multiply strokes never merge. */
  private strokePaintContext(): number {
    if (this.state.blendMode !== "Normal") return -1;
    const clipIndex = this.state.clipIndex;
    const optionalContentIndex = this.activeOptionalContentIndex;
    if (clipIndex === this.lastContextClipIndex && optionalContentIndex === this.lastContextOptionalContent) {
      return this.lastStrokePaintContext;
    }
    const key = (clipIndex + 1) * 0x1_0000_0000 + (optionalContentIndex + 1);
    let context = this.strokePaintContexts.get(key);
    if (context === undefined) {
      context = this.strokePaintContexts.size;
      this.strokePaintContexts.set(key, context);
    }
    this.lastContextClipIndex = clipIndex;
    this.lastContextOptionalContent = optionalContentIndex;
    this.lastStrokePaintContext = context;
    return context;
  }

  /** Apply a stroke compaction remap to every stored stroke index. */
  private remapStrokeIndices(remap: Uint32Array | null): void {
    if (!remap) return;
    for (let offset = 0; offset < this.vectorSourceEvents.length; offset += 2) {
      if (this.vectorSourceEvents[offset] !== DENSE_PDF_VECTOR_SCENE_EVENT_STROKE) continue;
      const range = this.vectorSourceEvents[offset + 1] * 2;
      const start = this.vectorPathPaintRanges[range];
      const end = start + this.vectorPathPaintRanges[range + 1];
      this.vectorPathPaintRanges[range] = remap[start];
      this.vectorPathPaintRanges[range + 1] = remap[end] - remap[start];
    }
    for (let offset = 0; offset < this.vectorImagePathSpanCheckpoints.length; offset += 6) {
      this.vectorImagePathSpanCheckpoints[offset + 2] = remap[this.vectorImagePathSpanCheckpoints[offset + 2]];
      this.vectorImagePathSpanCheckpoints[offset + 3] = remap[this.vectorImagePathSpanCheckpoints[offset + 3]];
    }
    this.vectorPathSpanStartStrokeCount = remap[this.vectorPathSpanStartStrokeCount];
  }

  /** Keep removed duplicates from accumulating: compact once they outnumber live strokes. */
  compactStrokesIfWorthwhile(): void {
    const removed = this.strokes.removedCount;
    if (removed >= 262_144 && removed * 2 >= this.strokes.primitiveCount) {
      this.remapStrokeIndices(this.strokes.compactRemoved());
    }
  }

  /** `validated`: this paint's composite state was just checked for VectorScene output. */
  private recordPaintRun(kind: number, start: number, count: number, validated = false): void {
    if (count <= 0) return;
    const role = kind === DENSE_PDF_PAINT_RUN_STROKE
      ? "stroke"
      : kind === DENSE_PDF_PAINT_RUN_FILL
        ? "nonstroke"
        : null;
    if (role === null) {
      throw new DensePdfSyntaxError("A non-path paint run reached the path paint recorder.");
    }
    if (this.policy.vectorScene === true) {
      if (!this.policy.orderedPaint && !this.state.clipIsDefault && !this.state.clipIsExactRectangle) {
        throw new DensePdfUnsupportedError(
          "VectorScene output cannot represent an arbitrary clipped visible path.",
          kind === DENSE_PDF_PAINT_RUN_STROKE ? "S" : "f"
        );
      }
      this.recordVectorPathPaint(
        role,
        kind === DENSE_PDF_PAINT_RUN_STROKE ? "S" : "f",
        validated
      );
      if (this.policy.orderedPaint) {
        const event = kind === DENSE_PDF_PAINT_RUN_STROKE
          ? DENSE_PDF_VECTOR_SCENE_EVENT_STROKE : DENSE_PDF_VECTOR_SCENE_EVENT_FILL;
        if (event !== DENSE_PDF_VECTOR_SCENE_EVENT_STROKE) this.strokes.breakRun();
        this.vectorPathPaintCount += 1;
        if (!this.extendLastPathPaint(event, start, count)) {
          this.recordVectorSourceEvent(event, this.vectorPathPaintRanges.length / 2, role === "stroke" ? "S" : "f");
          this.vectorPathPaintRanges.push(start, count);
        }
      }
    }
    if (!this.policy.displayProgram) return;
    // A run is scoped to exactly one source painting operator. Even adjacent
    // compatible stores may be separated by a clip, group, marked-content, or
    // backdrop-sensitive state transition that has no geometry of its own.
    this.recordPaintTrace(
      kind,
      start,
      count,
      undefined,
      role
    );
    if (kind === DENSE_PDF_PAINT_RUN_FILL) {
      this.pathPaints.push({
        color: [this.state.fillR, this.state.fillG, this.state.fillB, 1],
        sourceColorSpaceIndex: this.state.fillColorSpace.colorSpaceIndex,
        ...(this.state.fillPaintInherited ? { inheritType3Paint: true } : {})
      });
    } else if (kind === DENSE_PDF_PAINT_RUN_STROKE) {
      this.pathPaints.push({
        color: [this.state.strokeR, this.state.strokeG, this.state.strokeB, 1],
        sourceColorSpaceIndex: this.state.strokeColorSpace.colorSpaceIndex,
        ...(this.state.strokePaintInherited ? { inheritType3Paint: true } : {})
      });
    }
  }

  private recordGlyphPaintRun(start: number, count: number, renderingMode: number): void {
    if (count <= 0) return;
    if (this.policy.vectorScene === true) {
      this.recordVectorGlyphPaintRun(start, count, renderingMode);
      return;
    }
    if (renderingMode >= 4) {
      if (!this.policy.displayProgram) {
        throw new DensePdfUnsupportedError(
          "Text clipping modes require source-ordered display-program compilation.",
          "Tr"
        );
      }
      const pending = this.pendingTextClipRange;
      if (pending === null) {
        throw new DensePdfSyntaxError("A clipping glyph run was emitted outside BT/ET.");
      }
      if (start > 0xffff_ffff - count) {
        throw new DensePdfResourceLimitError(
          "A clipping glyph range exceeds the HEPR glyph-index range.",
          "Tj"
        );
      }
      if (pending.count === 0) pending.first = start;
      else if (start !== pending.first + pending.count) {
        throw new DensePdfSyntaxError(
          "Clipping glyph runs inside one text object are not contiguous."
        );
      }
      pending.count += count;
    }
    if (!this.policy.displayProgram) return;
    if (!this.state.textKnockout) {
      throw new DensePdfUnsupportedError(
        "Text knockout disabled requires a text-object transparency group.",
        "Tj"
      );
    }
    const fills = renderingMode === 0 || renderingMode === 2 ||
      renderingMode === 4 || renderingMode === 6;
    const strokes = renderingMode === 1 || renderingMode === 2 ||
      renderingMode === 5 || renderingMode === 6;
    const patternColorApproximation = Boolean(
      (fills && this.state.fillPatternColorSpace && !this.state.fillPattern?.solidColor) ||
      (strokes && this.state.strokePatternColorSpace && !this.state.strokePattern?.solidColor)
    );
    const role = renderingMode === 1 || renderingMode === 5 ? "stroke" : "nonstroke";
    this.recordPaintTrace(
      DENSE_PDF_PAINT_RUN_GLYPH,
      start,
      count,
      undefined,
      role
    );
    this.glyphPaints.push({
      ...(this.state.lineWidth === 0 && [1, 2, 5, 6].includes(renderingMode)
        ? { strokeTransform: [...this.state.matrix] as DensePdfMatrix } : {}),
      renderingMode,
      ...(patternColorApproximation ? { patternColorApproximation: true } : {}),
      fill: [
        this.state.fillR,
        this.state.fillG,
        this.state.fillB,
        1
      ],
      stroke: [
        this.state.strokeR,
        this.state.strokeG,
        this.state.strokeB,
        1
      ],
      ...(this.state.fillPaintInherited ? { fillPaintInherited: true } : {}),
      ...(this.state.strokePaintInherited ? { strokePaintInherited: true } : {}),
      initialGraphicsState: snapshotInitialGraphicsState(this.state)
    });
  }

  private recordVectorGlyphPaintRun(
    start: number,
    count: number,
    renderingMode: number
  ): void {
    if (
      start > 0xffff_ffff || count > 0xffff_ffff ||
      start > 0xffff_ffff - count
    ) {
      throw new DensePdfResourceLimitError(
        "A VectorScene glyph range exceeds the 32-bit glyph-index range.",
        "Tj"
      );
    }
    const outlined = renderingMode === 1 || renderingMode === 2;
    const vectorOutline = outlined && this.policy.orderedPaint && this.state.lineWidth >= 0 &&
      !this.state.strokeAdjustment;
    if (outlined && !vectorOutline && this.policy.selectiveRaster) {
      this.assertVectorSceneComposite("stroke", "Tj");
      if (renderingMode === 2) this.assertVectorSceneComposite("nonstroke", "Tj");
      this.recordVectorCompositeGlyphPaintRun(start, count, renderingMode);
      return;
    }
    if (renderingMode !== 0 && renderingMode !== 3 && !vectorOutline) {
      throw new DensePdfUnsupportedError(
        `VectorScene output supports only fill and invisible text, not rendering mode ${renderingMode}.`,
        "Tr"
      );
    }
    const visibleFill = (renderingMode === 0 || renderingMode === 2) && this.state.fillAlpha > ALPHA_INVISIBLE_EPSILON;
    const visibleStroke = vectorOutline && this.state.strokeAlpha > ALPHA_INVISIBLE_EPSILON;
    if (visibleFill || visibleStroke) {
      if (!this.state.textKnockout) {
        throw new DensePdfUnsupportedError(
          "VectorScene output cannot represent text knockout disabled.",
          "Tj"
        );
      }
      if ((visibleFill && this.state.fillPatternColorSpace && !this.state.fillPattern?.solidColor) ||
          (visibleStroke && this.state.strokePatternColorSpace && !this.state.strokePattern?.solidColor)) {
        throw new DensePdfUnsupportedError(
          "VectorScene output cannot represent pattern-colored text.",
          "Tj"
        );
      }
      if (!this.policy.orderedPaint && !this.state.clipIsDefault && !this.state.clipIsExactRectangle) {
        if (this.policy.selectiveRaster === true) {
          this.assertVectorSceneComposite("nonstroke", "Tj");
          this.recordVectorCompositeGlyphPaintRun(start, count, renderingMode);
          return;
        }
        throw new DensePdfUnsupportedError(
          "VectorScene output cannot prove an arbitrary clipped visible text run.",
          "Tj"
        );
      }
      if (visibleFill) this.recordVectorOrdinaryPaint("nonstroke", "Tj");
      if (visibleStroke) this.recordVectorOrdinaryPaint("stroke", "Tj");
    }
    const glyphRunIndex = this.vectorGlyphRunMeta.length / 3;
    this.vectorGlyphRunMeta.push(start, count, renderingMode);
    this.vectorGlyphClipIndices.push(this.state.clipIndex);
    this.vectorGlyphFillColors.push(
      this.state.fillR,
      this.state.fillG,
      this.state.fillB,
      this.state.fillAlpha
    );
    this.vectorGlyphStrokePaints.push(vectorOutline ? Object.freeze({
      transform: [...this.state.matrix] as DensePdfMatrix,
      color: [this.state.strokeR, this.state.strokeG, this.state.strokeB, this.state.strokeAlpha] as const,
      width: this.state.lineWidth,
      lineCap: this.state.lineCap as 0 | 1 | 2,
      lineJoin: this.state.lineJoin,
      miterLimit: this.state.miterLimit,
      dashArray: [...this.state.lineDash],
      dashPhase: this.state.dashPhase
    }) : null);
    const clip = this.state.clipBounds ?? this.options.pageBounds;
    this.vectorGlyphClipBounds.push(clip.minX, clip.minY, clip.maxX, clip.maxY);
    this.vectorGlyphRunFlags.push(
      this.state.clipIsDefault ? 0 : DENSE_PDF_VECTOR_SCENE_GLYPH_FLAG_CLIPPED
    );
    if (visibleFill || visibleStroke) {
      this.vectorSawVisibleText = true;
    }
    this.recordVectorSourceEvent(
      DENSE_PDF_VECTOR_SCENE_EVENT_GLYPH,
      glyphRunIndex,
      "Tj"
    );
  }

  private recordVectorCompositeGlyphPaintRun(start: number, count: number, renderingMode: number): void {
    const ordinal = this.nextVectorPaintOrdinal("Tj");
    this.vectorSelectivePaintSourceSpans.push(this.operatorSourceOffset, this.operatorSourceLength);
    this.recordVectorSelectivePaint(ordinal, "composited-glyphs");
    const glyphRunIndex = this.vectorGlyphRunMeta.length / 3;
    this.vectorGlyphRunMeta.push(start, count, renderingMode);
    // Keep search/selection geometry while the display program paints the
    // complete glyph appearance into a bounded layer, without duplicate ink.
    this.vectorGlyphFillColors.push(0, 0, 0, 0);
    this.vectorGlyphStrokePaints.push(null);
    const clip = this.state.clipBounds ?? this.options.pageBounds;
    this.vectorGlyphClipBounds.push(clip.minX, clip.minY, clip.maxX, clip.maxY);
    this.vectorGlyphRunFlags.push(DENSE_PDF_VECTOR_SCENE_GLYPH_FLAG_CLIPPED |
      DENSE_PDF_VECTOR_SCENE_GLYPH_FLAG_COMPOSITED);
    this.vectorGlyphClipIndices.push(this.state.clipIndex);
    this.recordVectorSourceEvent(DENSE_PDF_VECTOR_SCENE_EVENT_GLYPH, glyphRunIndex, "Tj");
  }

  private commitTextClip(): void {
    const range = this.pendingTextClipRange;
    if (range === null) {
      throw new DensePdfSyntaxError("ET appeared outside a text object.");
    }
    this.pendingTextClipRange = null;
    if (range.count === 0) return;
    if (this.clipPaths.length >= this.maxClipPaths) {
      throw new DensePdfResourceLimitError(
        `Persistent clipping nodes exceed limit ${this.maxClipPaths}.`,
        "ET"
      );
    }
    const parentIndex = this.state.clipIndex;
    this.clipPaths.push({
      parentIndex,
      pathIndex: -1,
      fillRule: FILL_RULE_NONZERO,
      firstGlyph: range.first,
      glyphCount: range.count
    });
    this.state.clipIndex = this.clipPaths.length - 1;
    this.state.clipIsDefault = false;
    this.state.clipIsExactRectangle = false;
    // Glyph geometry is materialized after font outlines are built. Preserve
    // the prior conservative bounds; it is a safe superset of the intersection.
  }

  private recordImagePaintRun(
    imageIndex: number,
    optionalContentIndex: number,
    sourceOffset = -1,
    sourceLength = -1,
    operator: "Do" | "BI" = "Do"
  ): void {
    // An image under an empty clip intersection paints nothing.
    if (!isNonEmptyBounds(this.state.clipBounds)) return;
    if (!this.policy.displayProgram && this.policy.vectorScene !== true) return;
    if (
      !Number.isSafeInteger(imageIndex) || imageIndex < 0 || imageIndex > 0xffff_ffff ||
      !Number.isSafeInteger(sourceOffset) || sourceOffset < -1 ||
      !Number.isSafeInteger(sourceLength) || sourceLength < -1 ||
      ((sourceOffset < 0) !== (sourceLength < 0))
    ) {
      throw new DensePdfSyntaxError("Image paint source metadata is invalid.");
    }
    if (this.policy.vectorScene === true) {
      if (!this.policy.orderedPaint && this.policy.selectiveRaster === true &&
          !this.state.clipIsDefault && (!this.state.clipIsExactRectangle ||
          this.state.matrix[1] !== 0 || this.state.matrix[2] !== 0)) {
        this.assertVectorSceneComposite("nonstroke", operator, false, false);
        const ordinal = this.nextVectorPaintOrdinal(operator);
        this.vectorSelectivePaintSourceSpans.push(sourceOffset, sourceLength);
        this.recordVectorSelectivePaint(ordinal, "clipped-image");
        return;
      }
      let overlappingPathSpan = false;
      if (this.vectorSawPathPaint && !this.policy.orderedPaint) {
        overlappingPathSpan = this.vectorPrecedingPathsOverlapImage(operator);
        if (overlappingPathSpan && (
          !this.policy.selectiveRaster ||
          this.genericPathPaints.length !== 0
        )) {
          throw new DensePdfUnsupportedError(
            "VectorScene output cannot move an image behind overlapping preceding visible path paint.",
            operator
          );
        }
      }
      if (this.policy.selectiveRaster && !this.policy.orderedPaint &&
          this.vectorSawVisibleText && !overlappingPathSpan) {
        this.assertVectorSceneComposite("nonstroke", operator, false, false);
        const ordinal = this.nextVectorPaintOrdinal(operator);
        this.vectorSelectivePaintSourceSpans.push(sourceOffset, sourceLength);
        this.recordVectorSelectivePaint(ordinal, "image-over-text");
        this.vectorPathSpanStartFillCount = this.fillPathCount;
        this.vectorPathSpanStartStrokeCount = this.strokes.primitiveCount;
        return;
      }
      if (!this.policy.orderedPaint && !this.state.clipIsDefault && !this.state.clipIsExactRectangle) {
        throw new DensePdfUnsupportedError(
          "VectorScene output cannot prove an arbitrarily clipped image underlay.",
          operator
        );
      }
      this.assertVectorSceneComposite("nonstroke", operator, false, false);
      const ordinal = this.nextVectorPaintOrdinal(operator);
      const imageInvocationIndex = this.vectorImageIndices.length;
      this.vectorImageIndices.push(imageIndex);
      this.vectorImageTransforms.push(...this.state.matrix);
      this.vectorImageClipBounds.push(
        this.state.clipBounds.minX,
        this.state.clipBounds.minY,
        this.state.clipBounds.maxX,
        this.state.clipBounds.maxY
      );
      this.vectorImagePaintOrders.push(ordinal);
      this.vectorImageOpacities.push(this.state.fillAlpha);
      this.vectorImageFlags.push(
        (this.state.clipIsDefault ? 0 : DENSE_PDF_VECTOR_SCENE_IMAGE_FLAG_CLIPPED) |
        (this.vectorSawVisibleText
          ? DENSE_PDF_VECTOR_SCENE_IMAGE_FLAG_LATE_AFTER_TEXT
          : 0) |
        (this.vectorSawPathPaint
          ? DENSE_PDF_VECTOR_SCENE_IMAGE_FLAG_LATE_AFTER_PATH
          : 0) |
        (overlappingPathSpan
          ? DENSE_PDF_VECTOR_SCENE_IMAGE_FLAG_SELECTIVE_PATH_SPAN
          : 0)
      );
      this.vectorImagePathSpanCheckpoints.push(
        overlappingPathSpan ? this.vectorPathSpanStartFillCount : this.fillPathCount,
        this.fillPathCount,
        overlappingPathSpan ? this.vectorPathSpanStartStrokeCount : this.strokes.primitiveCount,
        this.strokes.primitiveCount,
        overlappingPathSpan ? this.vectorPathSpanStartOrdinal : ordinal,
        ordinal
      );
      this.vectorImagePathSourceSpans.push(
        overlappingPathSpan ? this.vectorPathSpanSourceOffset : sourceOffset,
        overlappingPathSpan ? this.vectorPathSpanSourceLength : sourceLength,
        sourceOffset,
        sourceLength
      );
      this.recordVectorSourceEvent(
        DENSE_PDF_VECTOR_SCENE_EVENT_IMAGE,
        imageInvocationIndex,
        operator,
        optionalContentIndex
      );
      this.vectorPathSpanStartFillCount = this.fillPathCount;
      this.vectorPathSpanStartStrokeCount = this.strokes.primitiveCount;
      this.vectorPathSpanStartOrdinal = ordinal + 1;
      this.vectorPathSpanHasPaint = false;
      this.vectorPathSpanSourceOffset = -1;
      this.vectorPathSpanSourceLength = -1;
      return;
    }
    this.recordPaintTrace(
      DENSE_PDF_PAINT_RUN_IMAGE,
      imageIndex,
      1,
      optionalContentIndex,
      "nonstroke"
    );
    this.imageTransforms.push([...this.state.matrix]);
    this.imagePaints.push({
      color: [
        this.state.fillR,
        this.state.fillG,
        this.state.fillB,
        1
      ],
      sourceColorSpaceIndex: this.state.fillColorSpace.colorSpaceIndex,
      ...(this.state.fillPaintInherited ? { inheritType3Paint: true } : {}),
      clipBounds: { ...this.state.clipBounds },
      sourceOffset,
      sourceLength
    });
  }

  /**
   * The grouped compatibility renderer places images below vector geometry.
   * At the first late image all retained path stores contain preceding paints
   * only, so scan those existing bounds without keeping a source-order journal.
   */
  private vectorPrecedingPathsOverlapImage(operator: string): boolean {
    let imageBounds: DensePdfBounds | null = transformRectangleBounds(
      { minX: 0, minY: 0, maxX: 1, maxY: 1 },
      this.state.matrix
    );
    imageBounds = intersectBounds(imageBounds, this.state.clipBounds);
    if (imageBounds && (imageBounds.minX > imageBounds.maxX || imageBounds.minY > imageBounds.maxY)) {
      imageBounds = null;
    }
    if (!imageBounds) return false;
    const visibleImageBounds = imageBounds;
    let comparisons = 0;
    let overlaps = false;
    const check = (bounds: DensePdfBounds): void => {
      comparisons += 1;
      if (comparisons > 10_000_000) {
        throw new DensePdfResourceLimitError(
          "Late-image source-order proof exceeds 10000000 path comparisons.",
          operator,
          "legacy-vector-image-path-order-proof-limit"
        );
      }
      if (!denseBoundsAreProvablyDisjoint(bounds, visibleImageBounds)) {
        overlaps = true;
      }
    };
    const fillA = this.fillPathMetaA.usedView();
    const fillB = this.fillPathMetaB.usedView();
    for (let offset = this.vectorPathSpanStartFillCount * 4; offset < fillA.length; offset += 4) {
      check({ minX: fillA[offset + 2], minY: fillA[offset + 3],
        maxX: fillB[offset], maxY: fillB[offset + 1] });
    }
    const strokeBounds = this.strokes.primitiveBounds.usedView();
    for (let offset = this.vectorPathSpanStartStrokeCount * 4; offset < strokeBounds.length; offset += 4) {
      check({ minX: strokeBounds[offset], minY: strokeBounds[offset + 1],
        maxX: strokeBounds[offset + 2], maxY: strokeBounds[offset + 3] });
    }
    for (const paint of this.genericPathPaints) {
      const path = this.pagePaths[paint.pathIndex];
      if (!path) throw new DensePdfSyntaxError("A path paint references a missing path.");
      let bounds = path.bounds;
      if (paint.strokeStyle && paint.strokeStyle.lineWidth > 0) {
        const matrix = path.transform;
        const scale = Math.max(Math.hypot(matrix[0], matrix[1]), Math.hypot(matrix[2], matrix[3]));
        const join = paint.strokeStyle.lineJoin === 0
          ? Math.max(1, paint.strokeStyle.miterLimit) : Math.SQRT2;
        bounds = expandBounds(bounds, paint.strokeStyle.lineWidth * scale * 0.5 * join);
      }
      check(bounds);
    }
    return overlaps;
  }

  private recordFormPaint(definitionIndex: number, optionalContentIndex: number): void {
    if (!this.state.clipBounds) return;
    if (this.policy.vectorScene === true) {
      if (this.state.strokePatternColorSpace || this.state.fillPatternColorSpace) {
        throw new DensePdfUnsupportedError(
          "A Form invoked with inherited pattern color state cannot be specialized exactly.",
          "Do"
        );
      }
      // A Form can inherit either paint role. Validate both now so the event
      // tape never advertises an occurrence whose caller state the grouped
      // bridge cannot represent conservatively.
      if (this.policy.selectiveRaster !== true) {
        this.assertVectorSceneComposite("nonstroke", "Do");
        this.assertVectorSceneComposite("stroke", "Do");
      }
      const paintIndex = this.formPaints.length;
      const paintOrder = this.nextVectorPaintOrdinal("Do");
      this.formPaints.push({
        definitionIndex,
        transform: [...this.state.matrix],
        clipBounds: { ...this.state.clipBounds },
        clipIsDefault: this.state.clipIsDefault,
        clipIsExactRectangle: this.state.clipIsExactRectangle,
        initialGraphicsState: snapshotInitialGraphicsState(this.state, this.textSink?.getFontSelection?.())
      });
      this.vectorFormPaintOrders.push(paintOrder);
      this.vectorFormClipIndices.push(this.state.clipIndex);
      this.recordVectorSourceEvent(
        DENSE_PDF_VECTOR_SCENE_EVENT_FORM,
        paintIndex,
        "Do",
        optionalContentIndex
      );
      return;
    }
    if (!this.policy.displayProgram) return;
    if (this.state.strokePatternColorSpace || this.state.fillPatternColorSpace) {
      throw new DensePdfUnsupportedError(
        "A Form invoked with inherited pattern color state cannot be specialized exactly.",
        "Do"
      );
    }
    const paintIndex = this.formPaints.length;
    this.recordPaintTrace(
      DENSE_PDF_PAINT_RUN_FORM,
      paintIndex,
      1,
      optionalContentIndex,
      "nonstroke"
    );
    this.formPaints.push({
      definitionIndex,
      transform: [...this.state.matrix],
      clipBounds: { ...this.state.clipBounds },
      clipIsDefault: this.state.clipIsDefault,
      clipIsExactRectangle: this.state.clipIsExactRectangle,
      initialGraphicsState: snapshotInitialGraphicsState(this.state, this.textSink?.getFontSelection?.())
    });
  }

  private recordShadingPaint(gradientIndex: number): void {
    if (!this.policy.displayProgram || !this.state.clipBounds) return;
    this.recordPaintTrace(
      DENSE_PDF_PAINT_RUN_GRADIENT,
      gradientIndex,
      1,
      undefined,
      "nonstroke"
    );
    const clipBounds = { ...this.state.clipBounds };
    this.shadingPaints.push({
      gradientIndex,
      transform: [...this.state.matrix],
      clipBounds
    });
    this.shadingBounds = combineBounds(this.shadingBounds, clipBounds);
  }

  private recordPatternPaint(
    definition: Readonly<DensePdfPatternDefinition>,
    pathIndex: number,
    fillRule: 0 | 1,
    role: "fill" | "stroke",
    operator: string
  ): void {
    if (!this.policy.displayProgram) {
      throw new DensePdfUnsupportedError(
        "Pattern painting requires source-ordered display-program compilation."
      );
    }
    const sourcePath = this.pagePaths[pathIndex];
    if (!sourcePath) {
      throw new DensePdfSyntaxError("A pattern paint references a missing exact path.");
    }
    let bounds = sourcePath.bounds;
    let strokeStyle: DensePdfGenericStrokeStyle | null = null;
    if (role === "stroke") {
      strokeStyle = this.currentGenericStrokeStyle(operator);
      if (this.state.lineWidth > 0) {
        const matrix = this.state.matrix;
        const linearScale = Math.max(
          Math.hypot(matrix[0], matrix[1]),
          Math.hypot(matrix[2], matrix[3])
        );
        const halfWidth = this.state.lineWidth * linearScale * 0.5;
        const joinExpansion = this.state.lineJoin === 0
          ? Math.max(1, this.state.miterLimit)
          : Math.SQRT2;
        bounds = expandBounds(bounds, halfWidth * joinExpansion);
        this.genericMaxHalfWidth = Math.max(
          this.genericMaxHalfWidth,
          halfWidth * joinExpansion
        );
      }
      this.genericStrokeBounds = combineBounds(this.genericStrokeBounds, bounds);
    }
    this.recordPaintTrace(
      DENSE_PDF_PAINT_RUN_PATTERN,
      definition.patternIndex,
      1,
      undefined,
      role === "stroke" ? "stroke" : "nonstroke",
      definition.extGState
        ? this.compositeState(role === "stroke" ? "stroke" : "nonstroke", definition.extGState)
        : undefined
    );
    this.patternPaints.push({
      patternIndex: definition.patternIndex,
      pathIndex,
      fillRule,
      role,
      transform: [...this.state.matrix],
      baseColor: definition.kind === "uncolored-tiling"
        ? this.currentSolidPaint(role)
        : null,
      strokeStyle,
      bounds: { ...bounds }
    });
    this.patternBounds = combineBounds(this.patternBounds, bounds);
    this.genericPathBounds = combineBounds(this.genericPathBounds, bounds);
  }

  private recordPaintTrace(
    kind: number,
    start: number,
    count: number,
    optionalContentIndex = this.activeOptionalContentIndex,
    role: "stroke" | "nonstroke" = "nonstroke",
    compositeState?: Readonly<DensePdfCompositeState>
  ): void {
    this.paintRuns.push(kind, start, count);
    this.paintRunOptionalContentIndices.push(optionalContentIndex);
    this.paintRunMarkedContentIndices.push(this.activeMarkedContentIndex);
    this.paintRunClipIndices.push(this.state.clipIndex);
    if (this.options.capturePaintSourceIdentities === true) {
      this.paintRunSourceOffsets.push(this.operatorSourceOffset);
      this.paintRunSourceLengths.push(this.operatorSourceLength);
    }
    this.paintRunCompositeStates.push(compositeState ?? Object.freeze({
      alpha: role === "stroke" ? this.state.strokeAlpha : this.state.fillAlpha,
      alphaIsShape: this.state.alphaIsShape,
      blendMode: this.state.blendMode,
      softMaskIndex: this.state.softMaskIndex,
      overprint: role === "stroke"
        ? this.state.strokeOverprint
        : this.state.fillOverprint,
      overprintMode: this.state.overprintMode
    }));
  }

  private compositeState(
    role: "stroke" | "nonstroke",
    override?: Readonly<DensePdfExtGStateDefinition>
  ): Readonly<DensePdfCompositeState> {
    const alpha = role === "stroke"
      ? override?.strokeAlpha ?? this.state.strokeAlpha
      : override?.fillAlpha ?? this.state.fillAlpha;
    const overprint = role === "stroke"
      ? override?.strokeOverprint ?? this.state.strokeOverprint
      : override?.fillOverprint ?? this.state.fillOverprint;
    const softMaskIndex = override?.softMaskIndex === undefined
      ? this.state.softMaskIndex
      : override.softMaskIndex ?? -1;
    return Object.freeze({
      alpha,
      alphaIsShape: override?.alphaIsShape ?? this.state.alphaIsShape,
      blendMode: override?.blendMode ?? this.state.blendMode,
      softMaskIndex,
      overprint,
      overprintMode: override?.overprintMode ?? this.state.overprintMode
    });
  }

  private beginMarkedContent(
    tag: string,
    propertyName: string | null,
    mcid: number,
    optionalContentIndex: number,
    ownDefaultVisible: boolean,
    operator: string
  ): void {
    if (this.markedContentStack.length >= this.maxMarkedContentDepth) {
      throw new DensePdfResourceLimitError(
        `Marked-content nesting exceeds limit ${this.maxMarkedContentDepth}.`,
        operator
      );
    }
    if (this.markedContent.length >= this.maxMarkedContent) {
      throw new DensePdfResourceLimitError(
        `Marked-content node count exceeds limit ${this.maxMarkedContent}.`,
        operator
      );
    }
    const parent = this.markedContentStack.at(-1);
    const nodeIndex = this.markedContent.length;
    this.markedContent.push({
      tag,
      propertyName,
      mcid,
      parentIndex: parent?.nodeIndex ?? -1
    });
    this.markedContentItems.push(mcid >= 0 ? nodeIndex : parent ? this.markedContentItems[parent.nodeIndex] : -1);
    this.markedContentStack.push({
      nodeIndex,
      optionalContentIndex: this.combineOptionalContent(parent?.optionalContentIndex ?? -1, optionalContentIndex),
      defaultVisible: (parent?.defaultVisible ?? true) && ownDefaultVisible
    });
    this.syncActiveMarkedContent();
  }

  private resolveMarkedContentProperty(
    resourceName: string,
    operator: string
  ): Readonly<DensePdfMarkedContentPropertyDefinition> | undefined {
    const definition = this.markedContentProperties?.get(resourceName);
    if (definition) return definition;
    if (this.alwaysVisibleOptionalContentProperties.has(resourceName)) {
      return {
        resourceName,
        optionalContentIndex: -1,
        defaultVisible: true,
        mcid: -1
      };
    }
    if (this.markedContentProperties) {
      throw new DensePdfUnsupportedError(
        `Marked-content property /${resourceName} was not resolved in the active resource scope.`,
        operator
      );
    }
    return undefined;
  }

  /** Follow the innermost marked-content scope after a push or pop. */
  private syncActiveMarkedContent(): void {
    const active = this.markedContentStack.at(-1);
    this.activeMarkedContentIndex = active?.nodeIndex ?? -1;
    this.activeContentItem = active ? this.markedContentItems[active.nodeIndex] : -1;
    this.activeOptionalContentIndex = active?.optionalContentIndex ?? -1;
    this.contentVisible = this.options.retainOptionalContent === true || (active?.defaultVisible ?? true);
  }

  private combineOptionalContent(parent: number, own: number): number {
    return this.options.combineOptionalContent?.(parent, own) ?? (own >= 0 ? own : parent);
  }

  private clearPaintPathState(): void {
    this.path.clear();
    this.pendingClipRule = null;
  }

  private requireArgs(operator: string, _args: PdfValue[], count: number): void {
    if (this.operandCount !== count) {
      throw new DensePdfSyntaxError(
        `Operator ${operator} expected ${count} operands but received ${this.operandCount}.`
      );
    }
  }

  /** The live operands as an exact-length array, for variable-arity operators. */
  private operandList(): PdfValue[] {
    return this.operands.slice(0, this.operandCount);
  }

  private textSinkOperands(): unknown[] {
    const operands = new Array<unknown>(this.operandCount);
    for (let index = 0; index < this.operandCount; index += 1) {
      operands[index] = toTextSinkOperand(this.operands[index]);
    }
    return operands;
  }

  private requireNativeTextSinkForVisiblePaint(operator: string): void {
    if (this.contentVisible && !this.options.textOperatorSink) {
      throw new DensePdfUnsupportedError(
        "Visible text requires the native text engine.",
        operator
      );
    }
  }

  private rejectTransformChangeInsidePath(operator: string): void {
    if (this.path.length > 0) {
      throw new DensePdfUnsupportedError(
        `Operator ${operator} changes graphics transforms inside an active path.`,
        operator
      );
    }
  }
}

class DensePdfResourceReferenceScanner {
  private readonly onOperator?: DensePdfResourceScanOptions["onOperator"];

  constructor(onOperator?: DensePdfResourceScanOptions["onOperator"]) {
    this.onOperator = onOperator;
  }
  readonly xObjects = new Set<string>();

  readonly properties = new Set<string>();

  readonly optionalContentProperties = new Set<string>();

  readonly fonts = new Set<string>();

  readonly extGStates = new Set<string>();

  readonly colorSpaces = new Set<string>();

  readonly shadings = new Set<string>();

  readonly patterns = new Set<string>();

  private readonly operands: PdfValue[] = [];

  private readonly containers: ParserContainer[] = [];

  consumeInlineImage(): void {
    if (this.containers.length > 0 || this.operands.length > 0) {
      throw new DensePdfSyntaxError(
        "Inline image interrupts a pending content object or operand list."
      );
    }
  }

  consumeToken(token: LexerToken): void {
    if (token.kind === "array-start") {
      this.containers.push({ kind: "array", values: [], entries: [], pendingKey: null });
      return;
    }
    if (token.kind === "dict-start") {
      this.containers.push({ kind: "dictionary", values: [], entries: [], pendingKey: null });
      return;
    }
    if (token.kind === "array-end" || token.kind === "dict-end") {
      this.closeContainer(token.kind);
      return;
    }
    if (token.kind === "number") {
      this.appendValue(token.value);
      return;
    }
    if (token.kind === "name") {
      this.appendValue({ kind: "name", value: token.value });
      return;
    }
    if (token.kind === "string") {
      this.appendValue({ kind: "string", value: token.value });
      return;
    }
    if (token.kind !== "word") {
      throw new DensePdfSyntaxError(`Unexpected ${token.kind} token in PDF content.`);
    }
    if (token.value === "true" || token.value === "false" || token.value === "null") {
      this.appendValue(token.value === "null" ? null : token.value === "true");
      return;
    }
    if (this.containers.length > 0) {
      throw new DensePdfSyntaxError(
        `Unexpected keyword ${token.value} inside a content-stream object.`
      );
    }
    switch (token.value) {
      case "Do":
        this.xObjects.add(this.referenceName("Do", 0, 1));
        break;
      case "Tf":
        this.fonts.add(this.referenceName("Tf", 0, 2));
        if (typeof this.operands[1] !== "number") {
          throw new DensePdfSyntaxError("Tf requires a numeric font-size operand.");
        }
        break;
      case "gs":
        this.extGStates.add(this.referenceName("gs", 0, 1));
        break;
      case "G":
      case "g":
        this.colorSpaces.add("DeviceGray");
        break;
      case "RG":
      case "rg":
        this.colorSpaces.add("DeviceRGB");
        break;
      case "K":
      case "k":
        this.colorSpaces.add("DeviceCMYK");
        break;
      case "CS":
      case "cs":
        this.colorSpaces.add(this.referenceName(token.value, 0, 1));
        break;
      case "sh":
        this.shadings.add(this.referenceName("sh", 0, 1));
        break;
      case "SCN":
      case "scn": {
        const candidate = this.operands.at(-1);
        if (candidate !== undefined && isPdfName(candidate)) this.patterns.add(candidate.value);
        break;
      }
      case "BDC":
      case "DP": {
        const tag = this.referenceName(token.value, 0, 2);
        const property = this.operands[1];
        if (isPdfName(property)) {
          this.properties.add(property.value);
          if (tag === "OC") this.optionalContentProperties.add(property.value);
        } else if (!isPdfDictionary(property)) {
          throw new DensePdfSyntaxError(
            `${token.value} property operand must be a name or dictionary.`
          );
        }
        break;
      }
    }
    this.onOperator?.(token.value, this.operands.map(toTextSinkOperand),
      token.value === "BDC" ? contentOperandToCos(this.operands[1]) : undefined);
    this.operands.length = 0;
  }

  finish(): void {
    if (this.containers.length > 0) {
      throw new DensePdfSyntaxError("Unterminated array or dictionary in PDF content.");
    }
    if (this.operands.length > 0) {
      throw new DensePdfSyntaxError("Dangling operands at the end of PDF content.");
    }
  }

  private appendValue(value: PdfValue): void {
    const container = this.containers.at(-1);
    if (!container) {
      if (this.operands.length >= MAX_OPERAND_COUNT) {
        throw new DensePdfSyntaxError("PDF content operand stack exceeded its safety limit.");
      }
      this.operands.push(value);
      return;
    }
    if (container.kind === "array") {
      container.values.push(value);
      return;
    }
    if (container.pendingKey === null) {
      if (!isPdfName(value)) {
        throw new DensePdfSyntaxError("PDF dictionary keys must be names.");
      }
      container.pendingKey = value.value;
      return;
    }
    container.entries.push([container.pendingKey, value]);
    container.pendingKey = null;
  }

  private referenceName(operator: string, index: number, count: number): string {
    if (this.operands.length !== count || !isPdfName(this.operands[index])) {
      throw new DensePdfSyntaxError(
        `${operator} requires exactly ${count} operand${count === 1 ? "" : "s"}, with a name at index ${index}.`
      );
    }
    return this.operands[index].value;
  }

  private closeContainer(kind: "array-end" | "dict-end"): void {
    const container = this.containers.pop();
    const expected = kind === "array-end" ? "array" : "dictionary";
    if (!container || container.kind !== expected) {
      throw new DensePdfSyntaxError(`Unexpected ${kind} token in PDF content.`);
    }
    if (container.kind === "dictionary" && container.pendingKey !== null) {
      throw new DensePdfSyntaxError("PDF dictionary ended without a value for its final key.");
    }
    this.appendValue(
      container.kind === "array"
        ? { kind: "array", value: container.values }
        : { kind: "dictionary", value: container.entries }
    );
  }
}

function contentOperandToCos(value: PdfValue): import("./nativeCos").PdfValue {
  if (isPdfArray(value)) return value.value.map(contentOperandToCos);
  if (isPdfDictionary(value)) return new Map(value.value.map(([key, entry]) => [key, contentOperandToCos(entry)]));
  if (isPdfString(value)) return { kind: "string", bytes: value.value, hex: false };
  return value;
}

class IncrementalPdfLexer {
  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  private readonly onToken: (token: LexerToken) => void;

  /** Numbers, most tokens of a content stream, skip the token object. */
  private readonly onNumber: (value: number) => void;

  private readonly numberToken: Extract<LexerToken, { kind: "number" }> = {
    kind: "number",
    value: 0
  };

  private readonly wordToken: Extract<LexerToken, { kind: "word" }> = {
    kind: "word",
    value: "",
    sourceOffset: 0,
    sourceLength: 0
  };

  private bufferSourceOffset = 0;

  private nextSourceOffset = 0;

  /** Start of the last operator word handed to `onToken`. */
  private wordStart = 0;

  constructor(onToken: (token: LexerToken) => void, onNumber?: (value: number) => void) {
    this.onToken = onToken;
    this.onNumber = onNumber ?? ((value) => {
      this.numberToken.value = value;
      onToken(this.numberToken);
    });
  }

  feed(chunk: Uint8Array, final: boolean, sourceOffset = this.nextSourceOffset): void {
    if (
      !Number.isSafeInteger(sourceOffset) || sourceOffset < 0 ||
      !Number.isSafeInteger(sourceOffset + chunk.length)
    ) {
      throw new TypeError("PDF lexer source offsets must be nonnegative safe integers.");
    }
    if (chunk.length > 0) {
      if (this.buffer.length === 0) {
        this.buffer = chunk;
        this.bufferSourceOffset = sourceOffset;
      } else {
        if (sourceOffset !== this.bufferSourceOffset + this.buffer.length) {
          throw new TypeError("PDF lexer chunks must be source-contiguous within one token span.");
        }
        const combined = new Uint8Array(this.buffer.length + chunk.length);
        combined.set(this.buffer);
        combined.set(chunk, this.buffer.length);
        this.buffer = combined;
      }
      this.nextSourceOffset = sourceOffset + chunk.length;
    }

    let offset: number;
    try {
      offset = this.readTokens(final);
    } catch (error) {
      // Resume at the suspended operator: its operands are already consumed.
      if (error instanceof ContentResourceSuspension || error instanceof ContentInlineImageSuspension) {
        this.retainFrom(this.wordStart);
      }
      throw error;
    }
    this.retainFrom(offset);
  }

  takePending(): { bytes: Uint8Array; sourceOffset: number } {
    const pending = { bytes: this.buffer, sourceOffset: this.bufferSourceOffset };
    this.retainFrom(this.buffer.length);
    return pending;
  }

  private retainFrom(offset: number): void {
    this.buffer = offset >= this.buffer.length
      ? new Uint8Array(0)
      : this.buffer.slice(offset);
    this.bufferSourceOffset += offset;
  }

  finish(): void {
    this.feed(new Uint8Array(0), true);
    if (this.buffer.length > 0) {
      throw new DensePdfSyntaxError("Incomplete token at the end of PDF content.");
    }
  }

  /**
   * Parse the whole available buffer in one hot loop instead of one call per
   * token. Returns the offset of the first byte of an incomplete trailing token.
   */
  private readTokens(final: boolean): number {
    const bytes = this.buffer;
    let offset = 0;
    while (true) {
      const initialOffset = offset;
      while (offset < bytes.length) {
        const byte = bytes[offset];
        if (PDF_BYTE_CLASSES[byte] === PDF_BYTE_WHITESPACE) {
          offset += 1;
          continue;
        }
        if (byte === 0x25) {
          const end = findLineEnd(bytes, offset + 1);
          if (end < 0) {
            return final ? bytes.length : initialOffset;
          }
          offset = end;
          continue;
        }
        break;
      }

      if (offset >= bytes.length) {
        return offset;
      }

      const start = offset;
      const byte = bytes[offset++];
      if (byte === 0x5b) {
        this.onToken(ARRAY_START_TOKEN);
        continue;
      }
      if (byte === 0x5d) {
        this.onToken(ARRAY_END_TOKEN);
        continue;
      }
      if (byte === 0x3c) {
        if (offset >= bytes.length && !final) {
          return initialOffset;
        }
        if (bytes[offset] === 0x3c) {
          this.onToken(DICT_START_TOKEN);
          offset += 1;
          continue;
        }
        const end = findByte(bytes, 0x3e, offset);
        if (end < 0) {
          if (!final) {
            return initialOffset;
          }
          throw new DensePdfSyntaxError("Unterminated hexadecimal string in PDF content.");
        }
        this.onToken({ kind: "string", value: decodeHexString(bytes.subarray(offset, end)) });
        offset = end + 1;
        continue;
      }
      if (byte === 0x3e) {
        if (offset >= bytes.length && !final) {
          return initialOffset;
        }
        if (bytes[offset] !== 0x3e) {
          throw new DensePdfSyntaxError("Unexpected > delimiter in PDF content.");
        }
        this.onToken(DICT_END_TOKEN);
        offset += 1;
        continue;
      }
      if (byte === 0x28) {
        const parsed = parseLiteralString(bytes, offset, final);
        if (!parsed) {
          return initialOffset;
        }
        this.onToken({ kind: "string", value: parsed.value });
        offset = parsed.offset;
        continue;
      }
      if (byte === 0x2f) {
        const end = findRegularTokenEnd(bytes, offset);
        if (end === bytes.length && !final) {
          return initialOffset;
        }
        this.onToken({ kind: "name", value: decodePdfName(bytes.subarray(offset, end)) });
        offset = end;
        continue;
      }

      // Numeric operands dominate CAD content streams: parse the value while
      // finding the token boundary instead of scanning its bytes twice.
      if ((byte >= 0x30 && byte <= 0x39) || byte === 0x2b || byte === 0x2d || byte === 0x2e) {
        let numberOffset = start;
        let sign = 1;
        if (byte === 0x2b || byte === 0x2d) {
          if (byte === 0x2d) sign = -1;
          numberOffset += 1;
        }
        const integerStart = numberOffset;
        let value = 0;
        let digit: number;
        while (numberOffset < bytes.length && (digit = bytes[numberOffset] - 0x30) >= 0 && digit <= 9) {
          value = value * 10 + digit;
          numberOffset += 1;
        }
        let digits = numberOffset - integerStart;
        let divideBy = 1;
        if (bytes[numberOffset] === 0x2e) {
          const fractionalStart = ++numberOffset;
          while (numberOffset < bytes.length && (digit = bytes[numberOffset] - 0x30) >= 0 && digit <= 9) {
            value = value * 10 + digit;
            divideBy *= 10;
            numberOffset += 1;
          }
          digits += numberOffset - fractionalStart;
        }
        if (numberOffset === bytes.length && !final) return initialOffset;
        if (digits === 0 || (numberOffset < bytes.length && PDF_BYTE_CLASSES[bytes[numberOffset]] === PDF_BYTE_REGULAR)) {
          throw new DensePdfSyntaxError("Malformed numeric token in PDF content.");
        }
        // Integer accumulation is exact for the common short CAD operands.
        // Longer decimals need correctly rounded conversion, including tiny
        // fractions whose divisor would overflow before their value does.
        const parsed = digits <= 15
          ? sign * (value / divideBy)
          : Number(internPdfWord(bytes, start, numberOffset));
        if (!Number.isFinite(parsed)) {
          throw new DensePdfSyntaxError("Invalid numeric token in PDF content.");
        }
        this.onNumber(parsed);
        offset = numberOffset;
        continue;
      }

      const end = findRegularTokenEnd(bytes, start);
      if (end === bytes.length && !final) {
        return initialOffset;
      }
      if (end === start) {
        throw new DensePdfSyntaxError(`Unexpected delimiter byte 0x${byte.toString(16)}.`);
      }
      this.wordToken.value = internPdfWord(bytes, start, end);
      this.wordToken.sourceOffset = this.bufferSourceOffset + start;
      this.wordToken.sourceLength = end - start;
      this.wordStart = start;
      this.onToken(this.wordToken);
      offset = end;
    }
  }
}

class ReusablePathBuilder {
  private data = new Float32Array(256);

  private used = 0;

  private verbs = 0;

  private coordinates = 0;

  private currentX = 0;

  private currentY = 0;

  private subpathStartX = 0;

  private subpathStartY = 0;

  get length(): number {
    return this.used;
  }

  get verbCount(): number {
    return this.verbs;
  }

  get coordinateCount(): number {
    return this.coordinates;
  }

  clear(): void {
    this.used = 0;
    this.verbs = 0;
    this.coordinates = 0;
    this.currentX = 0;
    this.currentY = 0;
    this.subpathStartX = 0;
    this.subpathStartY = 0;
  }

  view(): Float32Array {
    return this.data.subarray(0, this.used);
  }

  rawData(): Float32Array {
    return this.data;
  }

  isSingleLine(): boolean {
    return this.used === 6 && this.data[0] === DRAW_MOVE_TO && this.data[3] === DRAW_LINE_TO;
  }

  moveTo(x: number, y: number): void {
    this.currentX = x;
    this.currentY = y;
    this.subpathStartX = x;
    this.subpathStartY = y;
    this.ensureCapacity(3);
    this.data[this.used++] = DRAW_MOVE_TO;
    this.data[this.used++] = x;
    this.data[this.used++] = y;
    this.verbs += 1;
    this.coordinates += 2;
  }

  lineTo(x: number, y: number): void {
    this.currentX = x;
    this.currentY = y;
    this.ensureCapacity(3);
    this.data[this.used++] = DRAW_LINE_TO;
    this.data[this.used++] = x;
    this.data[this.used++] = y;
    this.verbs += 1;
    this.coordinates += 2;
  }

  curveTo(x1: number, y1: number, x2: number, y2: number, x: number, y: number): void {
    this.currentX = x;
    this.currentY = y;
    this.ensureCapacity(7);
    this.data[this.used++] = DRAW_CURVE_TO;
    this.data[this.used++] = x1;
    this.data[this.used++] = y1;
    this.data[this.used++] = x2;
    this.data[this.used++] = y2;
    this.data[this.used++] = x;
    this.data[this.used++] = y;
    this.verbs += 1;
    this.coordinates += 6;
  }

  curveTo2(x2: number, y2: number, x: number, y: number): void {
    this.curveTo(this.currentX, this.currentY, x2, y2, x, y);
  }

  curveTo3(x1: number, y1: number, x: number, y: number): void {
    this.curveTo(x1, y1, x, y, x, y);
  }

  rectangle(x: number, y: number, width: number, height: number): void {
    const xw = x + width;
    const yh = y + height;
    this.currentX = x;
    this.currentY = y;
    this.subpathStartX = x;
    this.subpathStartY = y;
    if (width === 0 || height === 0) {
      this.ensureCapacity(7);
      this.data[this.used++] = DRAW_MOVE_TO;
      this.data[this.used++] = x;
      this.data[this.used++] = y;
      this.data[this.used++] = DRAW_LINE_TO;
      this.data[this.used++] = xw;
      this.data[this.used++] = yh;
      this.data[this.used++] = DRAW_CLOSE;
      this.verbs += 3;
      this.coordinates += 4;
    } else {
      this.ensureCapacity(13);
      this.data[this.used++] = DRAW_MOVE_TO;
      this.data[this.used++] = x;
      this.data[this.used++] = y;
      this.data[this.used++] = DRAW_LINE_TO;
      this.data[this.used++] = xw;
      this.data[this.used++] = y;
      this.data[this.used++] = DRAW_LINE_TO;
      this.data[this.used++] = xw;
      this.data[this.used++] = yh;
      this.data[this.used++] = DRAW_LINE_TO;
      this.data[this.used++] = x;
      this.data[this.used++] = yh;
      this.data[this.used++] = DRAW_CLOSE;
      this.verbs += 5;
      this.coordinates += 8;
    }
  }

  closePath(resetCurrentPoint: boolean): void {
    this.ensureCapacity(1);
    this.data[this.used++] = DRAW_CLOSE;
    this.verbs += 1;
    if (resetCurrentPoint) {
      this.currentX = this.subpathStartX;
      this.currentY = this.subpathStartY;
    }
  }

  private ensureCapacity(extra: number): void {
    if (this.used + extra <= this.data.length) {
      return;
    }
    let length = this.data.length;
    while (this.used + extra > length) {
      length *= 2;
    }
    const next = new Float32Array(length);
    next.set(this.data);
    this.data = next;
  }
}

class Float4Builder {
  private data = new Float32Array(0);

  private readonly initialLength: number;

  private length = 0;

  constructor(initialQuads = 32_768) {
    // Text-only pages never need the large geometry backing stores.
    this.initialLength = Math.max(1, initialQuads) * 4;
  }

  get quadCount(): number {
    return this.length >> 2;
  }

  truncateQuads(quadCount: number): void {
    this.length = clampInt(quadCount, 0, this.quadCount) * 4;
  }

  /** Move quads `[start, end)` to `target`, as one run of a compaction. */
  moveQuads(target: number, start: number, end: number): void {
    this.data.copyWithin(target * 4, start * 4, end * 4);
  }

  push(a: number, b: number, c: number, d: number): void {
    this.ensureCapacity(4);
    this.data[this.length] = a;
    this.data[this.length + 1] = b;
    this.data[this.length + 2] = c;
    this.data[this.length + 3] = d;
    this.length += 4;
  }

  /** The backing store, valid until the next push; for hot read loops. */
  values(): Float32Array {
    return this.data;
  }

  usedView(): Float32Array {
    return this.data.subarray(0, this.length);
  }

  /** Hand over the used values and empty the builder. */
  take(): Float32Array {
    const values = takeFloat32Prefix(this.data, this.length);
    this.data = new Float32Array(0);
    this.length = 0;
    return values;
  }

  private ensureCapacity(extra: number): void {
    if (this.length + extra <= this.data.length) {
      return;
    }
    let length = this.data.length || this.initialLength;
    while (this.length + extra > length) {
      length *= 2;
    }
    const next = new Float32Array(length);
    next.set(this.data);
    this.data = next;
  }
}

class DenseStrokeBuilder {
  readonly endpoints = new Float4Builder(65_536);

  readonly primitiveMeta = new Float4Builder(65_536);

  readonly primitiveBounds = new Float4Builder(65_536);

  readonly styles = new Float4Builder(65_536);

  readonly duplicateIndex = new DenseDuplicateIndex();

  readonly duplicateTuple = new Float64Array(17);

  readonly existingDuplicateTuple = new Float64Array(17);

  /**
   * The primitive being emitted, as it will be stored. Repeated source
   * strokes store bit-identical values, which a duplicate lookup can match
   * without requantizing the stored primitive.
   */
  private candidateX0 = 0;

  private candidateY0 = 0;

  private candidateCx = 0;

  private candidateCy = 0;

  private candidateX1 = 0;

  private candidateY1 = 0;

  private candidateType = 0;

  private candidateStyle = 0;

  private candidateWidth = 0;

  private candidateR = 0;

  private candidateG = 0;

  private candidateB = 0;

  private candidateMinX = 0;

  private candidateMinY = 0;

  private candidateMaxX = 0;

  private candidateMaxY = 0;

  private readonly duplicateEquals = (index: number, tuple: Float64Array): boolean =>
    this.matchesDuplicateTuple(index, tuple);

  readonly enableInvisibleCull: boolean;

  readonly preservePrimitiveOrder: boolean;

  /**
   * Ordered output: of two identical opaque strokes in one paint context, the
   * earlier is removed. The later one repaints exactly its pixels, so this is
   * safe whatever was painted in between; removing the later one is not.
   */
  readonly keepLastDuplicate: boolean;

  /** Paint context of the primitives now emitted; -1 disables duplicate removal. */
  paintContext = -1;

  /** Per primitive when `keepLastDuplicate`: its removal flag. */
  private removed = new Uint8Array(0);

  /**
   * Per primitive: consecutive opaque strokes of one color and context with no
   * other paint between them share a run. Order within a run cannot change
   * the result, so containment inside a run is order-free.
   */
  private runs = new Uint32Array(0);

  /** Per run: the paint context all of its primitives share. */
  private runContexts = new Uint32Array(1_024);

  private currentRun = 0;

  private runBroken = true;

  private runContext = -1;

  private runR = 0;

  private runG = 0;

  private runB = 0;

  removedCount = 0;

  private orderedContainedCount = 0;

  sourceSegmentCount = 0;

  mergedSegmentCount = 0;

  discardedTransparentCount = 0;

  discardedDegenerateCount = 0;

  discardedDuplicateCount = 0;

  emittedMaxHalfWidth = 0;

  constructor(enableInvisibleCull: boolean, preservePrimitiveOrder: boolean, keepLastDuplicate = false) {
    this.enableInvisibleCull = enableInvisibleCull;
    this.preservePrimitiveOrder = preservePrimitiveOrder;
    this.keepLastDuplicate = keepLastDuplicate && enableInvisibleCull && preservePrimitiveOrder;
  }

  /** Each live primitive's run and each run's paint context, for ordered culling. */
  paintOrder(): StrokePaintOrder | null {
    return this.keepLastDuplicate
      ? { runs: this.runs.subarray(0, this.endpoints.quadCount), runContexts: this.runContexts }
      : null;
  }

  /** Another kind of paint happened: later strokes cannot join the current run. */
  breakRun(): void {
    this.runBroken = true;
  }

  /**
   * Drop removed primitives in place. Returns `remap`, where `remap[i]` is the
   * new index of old primitive `i` and `remap[count]` the new count, so a range
   * `[start, end)` becomes `[remap[start], remap[end])`.
   */
  compactRemoved(): Uint32Array | null {
    if (this.removedCount === 0) return null;
    const count = this.endpoints.quadCount;
    const removed = this.removed;
    const remap = new Uint32Array(count + 1);
    let out = 0;
    let index = 0;
    while (index < count) {
      if (removed[index] !== 0) {
        remap[index] = out;
        index += 1;
        continue;
      }
      // Kept primitives mostly come in long runs: move each run at once.
      const start = index;
      while (index < count && removed[index] === 0) {
        remap[index] = out + index - start;
        index += 1;
      }
      if (out !== start) {
        this.endpoints.moveQuads(out, start, index);
        this.primitiveMeta.moveQuads(out, start, index);
        this.primitiveBounds.moveQuads(out, start, index);
        this.styles.moveQuads(out, start, index);
        this.runs.copyWithin(out, start, index);
      }
      out += index - start;
    }
    remap[count] = out;
    this.endpoints.truncateQuads(out);
    this.primitiveMeta.truncateQuads(out);
    this.primitiveBounds.truncateQuads(out);
    this.styles.truncateQuads(out);
    this.removed.fill(0, 0, count);
    this.removedCount = 0;
    this.duplicateIndex.remap(remap);
    return remap;
  }

  get primitiveCount(): number {
    return this.endpoints.quadCount;
  }

  recordPathHalfWidth(halfWidth: number): void {
    if (!this.enableInvisibleCull) {
      this.emittedMaxHalfWidth = Math.max(this.emittedMaxHalfWidth, halfWidth);
    }
  }

  emitPrimitive(
    p0x: number,
    p0y: number,
    p1x: number,
    p1y: number,
    p2x: number,
    p2y: number,
    primitiveType: number,
    halfWidth: number,
    colorR: number,
    colorG: number,
    colorB: number,
    alpha: number,
    styleFlags: number,
    visibleMinX: number,
    visibleMinY: number,
    visibleMaxX: number,
    visibleMaxY: number
  ): void {
    this.mergedSegmentCount += 1;
    if (!this.enableInvisibleCull) {
      // The established no-cull extractor reports the pre-Float32 stroke
      // width even though the packed style buffer is normalized to Float32.
      this.emittedMaxHalfWidth = Math.max(this.emittedMaxHalfWidth, halfWidth);
    }
    const x0 = Math.fround(p0x);
    const y0 = Math.fround(p0y);
    const cx = Math.fround(p1x);
    const cy = Math.fround(p1y);
    const x1 = Math.fround(p2x);
    const y1 = Math.fround(p2y);
    const type = Math.fround(primitiveType);
    const width = Math.fround(halfWidth);
    const r = Math.fround(colorR);
    const g = Math.fround(colorG);
    const b = Math.fround(colorB);
    const encodedStyle = Math.fround(encodeStrokeStyleMeta(alpha, styleFlags));
    const decodedFlags = Math.max(
      0,
      Math.trunc(encodedStyle / STROKE_STYLE_FLAG_OFFSET + 1e-6)
    );
    const decodedAlpha = clamp01(encodedStyle - decodedFlags * STROKE_STYLE_FLAG_OFFSET);

    if (this.enableInvisibleCull) {
      if (decodedAlpha <= ALPHA_INVISIBLE_EPSILON) {
        this.discardedTransparentCount += 1;
        return;
      }
      this.candidateX0 = x0;
      this.candidateY0 = y0;
      this.candidateCx = cx;
      this.candidateCy = cy;
      this.candidateX1 = x1;
      this.candidateY1 = y1;
      this.candidateType = type;
      this.candidateStyle = encodedStyle;
      this.candidateWidth = width;
      this.candidateR = r;
      this.candidateG = g;
      this.candidateB = b;
      // Bounds are stored as Float32 values.
      this.candidateMinX = Math.fround(visibleMinX);
      this.candidateMinY = Math.fround(visibleMinY);
      this.candidateMaxX = Math.fround(visibleMaxX);
      this.candidateMaxY = Math.fround(visibleMaxY);
      const isQuadratic = type >= STROKE_PRIMITIVE_QUADRATIC - 0.5;
      const isDegenerate = isQuadratic
        ? Math.hypot(cx - x0, cy - y0) + Math.hypot(x1 - cx, y1 - cy) < 1e-5
        : (x1 - x0) * (x1 - x0) + (y1 - y0) * (y1 - y0) < 1e-10;
      if (isDegenerate) {
        const roundPoint = !isQuadratic && (decodedFlags & STROKE_STYLE_FLAG_ROUND_CAP) !== 0;
        const hairline = (decodedFlags & DENSE_PDF_STROKE_STYLE_FLAG_HAIRLINE) !== 0;
        if (!roundPoint || (!hairline && width <= 1e-6)) {
          this.discardedDegenerateCount += 1;
          return;
        }
      }
      // Repainting the same translucent primitive increases its accumulated
      // opacity, so it is not a visual duplicate. Only effectively opaque
      // source-over strokes are safe to collapse.
      if (!this.preservePrimitiveOrder && decodedAlpha >= OPAQUE_ALPHA_EPSILON) {
        fillDuplicateTuple(
          this.duplicateTuple,
          x0, y0, cx, cy, x1, y1, type, width, r, g, b, decodedAlpha,
          decodedFlags,
          visibleMinX, visibleMinY, visibleMaxX, visibleMaxY
        );
        if (this.duplicateIndex.hasOrInsert(
          this.duplicateTuple,
          (decodedFlags & DENSE_PDF_STROKE_STYLE_FLAG_CLIPPED) !== 0
            ? this.duplicateTuple.length
            : DUPLICATE_TUPLE_GEOMETRY,
          this.endpoints.quadCount,
          this.duplicateEquals
        )) {
          this.discardedDuplicateCount += 1;
          return;
        }
      } else if (this.keepLastDuplicate && this.paintContext >= 0 && decodedAlpha >= OPAQUE_ALPHA_EPSILON) {
        fillDuplicateTuple(
          this.duplicateTuple,
          x0, y0, cx, cy, x1, y1, type, width, r, g, b, decodedAlpha,
          decodedFlags,
          visibleMinX, visibleMinY, visibleMaxX, visibleMaxY
        );
        const slot = this.duplicateIndex.findOrInsert(
          this.duplicateTuple,
          DUPLICATE_TUPLE_GEOMETRY,
          this.endpoints.quadCount,
          this.duplicateEquals
        );
        if (slot >= 0) {
          this.discardedDuplicateCount += 1;
          const previous = this.duplicateIndex.indexAt(slot);
          // Order inside one run is free: an equal stroke already in the run
          // this one would join stays, and this one is not stored.
          if (this.runs[previous] === this.runFor(this.paintContext, r, g, b, decodedAlpha)) return;
          this.duplicateIndex.replaceAt(slot, this.endpoints.quadCount);
          this.removed[previous] = 1;
          this.removedCount += 1;
        }
      }
    }

    if (this.keepLastDuplicate) this.recordContext(this.endpoints.quadCount, r, g, b, decodedAlpha);
    this.endpoints.push(x0, y0, cx, cy);
    this.primitiveMeta.push(x1, y1, type, encodedStyle);
    this.styles.push(width, r, g, b);
    this.primitiveBounds.push(
      visibleMinX,
      visibleMinY,
      visibleMaxX,
      visibleMaxY
    );
  }

  /** The run the next primitive with this paint would join. */
  private runFor(paintContext: number, r: number, g: number, b: number, alpha: number): number {
    const context = paintContext >= 0 ? paintContext : NO_STROKE_PAINT_CONTEXT;
    const joins = !this.runBroken && context !== NO_STROKE_PAINT_CONTEXT && alpha >= OPAQUE_ALPHA_EPSILON &&
      context === this.runContext && r === this.runR && g === this.runG && b === this.runB;
    return joins ? this.currentRun : this.currentRun + 1;
  }

  private recordContext(index: number, r: number, g: number, b: number, alpha: number): void {
    if (index >= this.runs.length) {
      const length = Math.max(65_536, this.runs.length * 2);
      const removed = new Uint8Array(length);
      removed.set(this.removed);
      this.removed = removed;
      const runs = new Uint32Array(length);
      runs.set(this.runs);
      this.runs = runs;
    }
    const context = this.paintContext >= 0 ? this.paintContext : NO_STROKE_PAINT_CONTEXT;
    if (this.runBroken || context === NO_STROKE_PAINT_CONTEXT || alpha < OPAQUE_ALPHA_EPSILON ||
        context !== this.runContext || r !== this.runR || g !== this.runG || b !== this.runB) {
      this.currentRun += 1;
      if (this.currentRun >= this.runContexts.length) {
        const runContexts = new Uint32Array(this.runContexts.length * 2);
        runContexts.set(this.runContexts);
        this.runContexts = runContexts;
      }
      this.runContexts[this.currentRun] = context;
      this.runContext = context;
      this.runR = r;
      this.runG = g;
      this.runB = b;
      // A translucent or blended stroke cannot share its run with any other.
      this.runBroken = context === NO_STROKE_PAINT_CONTEXT || alpha < OPAQUE_ALPHA_EPSILON;
    }
    // `removed` is clear here: stores start zeroed and compaction clears them.
    this.runs[index] = this.currentRun;
  }

  hasUniformOpaqueColor(): boolean {
    const styles = this.styles.usedView();
    const meta = this.primitiveMeta.usedView();
    for (let i = 0; i < styles.length; i += 4) {
      const flags = Math.max(0, Math.trunc(meta[i + 3] / STROKE_STYLE_FLAG_OFFSET + 1e-6));
      if (meta[i + 3] - flags * STROKE_STYLE_FLAG_OFFSET < OPAQUE_ALPHA_EPSILON ||
          styles[i + 1] !== styles[1] || styles[i + 2] !== styles[2] || styles[i + 3] !== styles[3]) return false;
    }
    return true;
  }

  /**
   * Ordered output: remove segments that a later segment in the same paint
   * context covers. Returns the index remap, or null when nothing moved.
   */
  async cullContainedInOrder(checkpoint: (force?: boolean) => Promise<void>): Promise<Uint32Array | null> {
    if (!this.keepLastDuplicate || this.endpoints.quadCount === 0) return this.compactRemoved();
    // No primitive is emitted after this; the duplicate index is not needed.
    this.duplicateIndex.release();
    const { keep, discardedContainedCount } = await markContainedSegments(
      this.endpoints.usedView(),
      this.primitiveMeta.usedView(),
      this.primitiveBounds.usedView(),
      this.styles.usedView(),
      checkpoint,
      this.paintOrder(),
      this.removedCount > 0 ? this.removed : null
    );
    if (discardedContainedCount > 0) {
      for (let index = 0; index < keep.length; index += 1) {
        if (keep[index] === 0) this.removed[index] = 1;
      }
      this.removedCount += discardedContainedCount;
      this.orderedContainedCount += discardedContainedCount;
    }
    // Removed duplicates and contained segments go in one compaction.
    return this.compactRemoved();
  }

  async finalize(
    checkpoint: (force?: boolean) => Promise<void>,
    compactOrderedStrokes = false,
    onIndexRemap?: (remap: Uint32Array) => void
  ): Promise<StrokeFinalizeResult> {
    // No further primitives can be emitted once finalization starts. Release
    // the duplicate hash table before allocating the containment-cull working
    // sets so both indexes do not contribute to the finalization peak.
    this.duplicateIndex.release();
    if (
      !this.enableInvisibleCull ||
      (this.preservePrimitiveOrder && !compactOrderedStrokes) ||
      this.endpoints.quadCount === 0
    ) {
      const endpoints = this.endpoints.take();
      const primitiveMeta = this.primitiveMeta.take();
      const primitiveBounds = this.primitiveBounds.take();
      const styles = this.styles.take();
      const result = await buildUncompactedStrokeResult(
        endpoints,
        primitiveMeta,
        primitiveBounds,
        styles,
        checkpoint,
        this.enableInvisibleCull ? null : this.emittedMaxHalfWidth
      );
      result.discardedContainedCount = this.orderedContainedCount;
      return result;
    }
    return cullContainedSegments(
      this.endpoints.usedView(),
      this.primitiveMeta.usedView(),
      this.primitiveBounds.usedView(),
      this.styles.usedView(),
      checkpoint,
      onIndexRemap
    );
  }

  private matchesDuplicateTuple(index: number, tuple: Float64Array): boolean {
    if (this.keepLastDuplicate && this.runContexts[this.runs[index]] !== this.paintContext) return false;
    const offset = index * 4;
    const endpoints = this.endpoints.values();
    const meta = this.primitiveMeta.values();
    const styles = this.styles.values();
    const bounds = this.primitiveBounds.values();
    // Bit-identical stored values quantize to an identical tuple.
    if (
      endpoints[offset] === this.candidateX0 &&
      endpoints[offset + 1] === this.candidateY0 &&
      endpoints[offset + 2] === this.candidateCx &&
      endpoints[offset + 3] === this.candidateCy &&
      meta[offset] === this.candidateX1 &&
      meta[offset + 1] === this.candidateY1 &&
      meta[offset + 2] === this.candidateType &&
      meta[offset + 3] === this.candidateStyle &&
      styles[offset] === this.candidateWidth &&
      styles[offset + 1] === this.candidateR &&
      styles[offset + 2] === this.candidateG &&
      styles[offset + 3] === this.candidateB
    ) {
      // Unordered clipped primitives also compare their clip bounds.
      if (this.keepLastDuplicate || (tuple[6] & DENSE_PDF_STROKE_STYLE_FLAG_CLIPPED) === 0) return true;
      if (
        bounds[offset] === this.candidateMinX && bounds[offset + 1] === this.candidateMinY &&
        bounds[offset + 2] === this.candidateMaxX && bounds[offset + 3] === this.candidateMaxY
      ) return true;
    }
    const encoded = meta[offset + 3];
    const decodedFlags = Math.max(0, Math.trunc(encoded / STROKE_STYLE_FLAG_OFFSET + 1e-6));
    const decodedAlpha = clamp01(encoded - decodedFlags * STROKE_STYLE_FLAG_OFFSET);
    fillDuplicateTuple(
      this.existingDuplicateTuple,
      endpoints[offset],
      endpoints[offset + 1],
      endpoints[offset + 2],
      endpoints[offset + 3],
      meta[offset],
      meta[offset + 1],
      meta[offset + 2],
      styles[offset],
      styles[offset + 1],
      styles[offset + 2],
      styles[offset + 3],
      decodedAlpha,
      decodedFlags,
      bounds[offset],
      bounds[offset + 1],
      bounds[offset + 2],
      bounds[offset + 3]
    );
    // An ordered primitive's paint context names its clip, so its clip
    // bounds need no comparison.
    const count = this.keepLastDuplicate ? DUPLICATE_TUPLE_GEOMETRY : tuple.length;
    for (let i = 0; i < count; i += 1) {
      if (this.existingDuplicateTuple[i] !== tuple[i]) {
        return false;
      }
    }
    return true;
  }
}

class DenseDuplicateIndex {
  private hashes = new Uint32Array(0);

  private indices = new Uint32Array(0);

  private size = 0;

  /** Hash the first `hashedLength` components; `equals` decides equality. */
  hasOrInsert(
    tuple: Float64Array,
    hashedLength: number,
    newIndex: number,
    equals: (index: number, tuple: Float64Array) => boolean
  ): boolean {
    if ((this.size + 1) * 10 >= this.hashes.length * 7) {
      this.grow();
    }
    const hash = hashQuantizedTuple(tuple, hashedLength);
    let slot = hash & (this.hashes.length - 1);
    while (this.hashes[slot] !== 0) {
      if (this.hashes[slot] === hash && equals(this.indices[slot] - 1, tuple)) {
        return true;
      }
      slot = (slot + 1) & (this.hashes.length - 1);
    }
    this.hashes[slot] = hash;
    this.indices[slot] = newIndex + 1;
    this.size += 1;
    return false;
  }

  /**
   * The slot of an equal entry, left unchanged, or -1 after inserting
   * `newIndex` for a new tuple.
   */
  findOrInsert(
    tuple: Float64Array,
    hashedLength: number,
    newIndex: number,
    equals: (index: number, tuple: Float64Array) => boolean
  ): number {
    if ((this.size + 1) * 10 >= this.hashes.length * 7) {
      this.grow();
    }
    const hash = hashQuantizedTuple(tuple, hashedLength);
    let slot = hash & (this.hashes.length - 1);
    while (this.hashes[slot] !== 0) {
      if (this.hashes[slot] === hash && equals(this.indices[slot] - 1, tuple)) return slot;
      slot = (slot + 1) & (this.hashes.length - 1);
    }
    this.hashes[slot] = hash;
    this.indices[slot] = newIndex + 1;
    this.size += 1;
    return -1;
  }

  indexAt(slot: number): number {
    return this.indices[slot] - 1;
  }

  /** Point an equal entry's slot at a later primitive. */
  replaceAt(slot: number, newIndex: number): void {
    this.indices[slot] = newIndex + 1;
  }

  /** Rewrite stored indices after compaction; every indexed entry is live. */
  remap(remap: Uint32Array): void {
    for (let slot = 0; slot < this.indices.length; slot += 1) {
      if (this.indices[slot] !== 0) this.indices[slot] = remap[this.indices[slot] - 1] + 1;
    }
  }

  release(): void {
    this.hashes = new Uint32Array(0);
    this.indices = new Uint32Array(0);
    this.size = 0;
  }

  private grow(): void {
    const oldHashes = this.hashes;
    const oldIndices = this.indices;
    // Most pages have few strokes. Reserve 8 KiB across both index arrays on
    // first use; dense CAD pages grow geometrically as unique strokes arrive.
    this.hashes = new Uint32Array(oldHashes.length === 0 ? 1 << 10 : oldHashes.length * 2);
    this.indices = new Uint32Array(this.hashes.length);
    const mask = this.hashes.length - 1;
    for (let i = 0; i < oldHashes.length; i += 1) {
      const hash = oldHashes[i];
      if (hash === 0) {
        continue;
      }
      let slot = hash & mask;
      while (this.hashes[slot] !== 0) {
        slot = (slot + 1) & mask;
      }
      this.hashes[slot] = hash;
      this.indices[slot] = oldIndices[i];
    }
  }
}

function emitSegmentsFromPath(
  pathData: Float32Array,
  matrix: DensePdfMatrix,
  halfWidth: number,
  colorR: number,
  colorG: number,
  colorB: number,
  alpha: number,
  styleFlags: number,
  lineDash: number[],
  dashPhase: number,
  allowSegmentMerge: boolean,
  output: DenseStrokeBuilder,
  clipBounds: DensePdfBounds | null
): void {
  let cursorX = 0;
  let cursorY = 0;
  let startX = 0;
  let startY = 0;
  let hasStart = false;
  let pendingX0 = 0;
  let pendingY0 = 0;
  let pendingX1 = 0;
  let pendingY1 = 0;
  let hasPending = false;

  const dashScale = lineDash.length > 0 ? matrixScale(matrix) : 1;
  const dashPattern = lineDash.length > 0
    ? lineDash.map((entry) => entry * dashScale)
    : lineDash;
  let dashPatternLength = 0;
  for (let index = 0; index < dashPattern.length; index += 1) {
    dashPatternLength += dashPattern[index];
  }
  const hasDashPattern = dashPattern.length > 0 && dashPatternLength > 1e-9;
  let dashIndex = 0;
  let dashRemaining = Number.POSITIVE_INFINITY;
  let dashPaint = true;

  const emitPrimitive = (
    p0x: number,
    p0y: number,
    p1x: number,
    p1y: number,
    p2x: number,
    p2y: number,
    primitiveType: number
  ): void => {
    const minX = Math.min(p0x, p1x, p2x);
    const minY = Math.min(p0y, p1y, p2y);
    const maxX = Math.max(p0x, p1x, p2x);
    const maxY = Math.max(p0y, p1y, p2y);
    const paintMinX = minX - halfWidth;
    const paintMinY = minY - halfWidth;
    const paintMaxX = maxX + halfWidth;
    const paintMaxY = maxY + halfWidth;
    const visibleMinX = clipBounds ? Math.max(clipBounds.minX, paintMinX) : paintMinX;
    const visibleMinY = clipBounds ? Math.max(clipBounds.minY, paintMinY) : paintMinY;
    const visibleMaxX = clipBounds ? Math.min(clipBounds.maxX, paintMaxX) : paintMaxX;
    const visibleMaxY = clipBounds ? Math.min(clipBounds.maxY, paintMaxY) : paintMaxY;
    if (!(visibleMinX <= visibleMaxX && visibleMinY <= visibleMaxY)) {
      return;
    }
    const clipped = clipBounds !== null && (
      visibleMinX > paintMinX + 1e-6 ||
      visibleMinY > paintMinY + 1e-6 ||
      visibleMaxX < paintMaxX - 1e-6 ||
      visibleMaxY < paintMaxY - 1e-6
    );
    output.emitPrimitive(
      p0x, p0y, p1x, p1y, p2x, p2y, primitiveType,
      halfWidth, colorR, colorG, colorB, alpha,
      clipped ? styleFlags | DENSE_PDF_STROKE_STYLE_FLAG_CLIPPED : styleFlags,
      clipped ? clipBounds!.minX : minX,
      clipped ? clipBounds!.minY : minY,
      clipped ? clipBounds!.maxX : maxX,
      clipped ? clipBounds!.maxY : maxY
    );
  };

  const flushPending = (): void => {
    if (!hasPending) {
      return;
    }
    emitPrimitive(
      pendingX0, pendingY0, pendingX1, pendingY1,
      pendingX1, pendingY1, STROKE_PRIMITIVE_LINE
    );
    hasPending = false;
  };

  const tryMergePending = (x0: number, y0: number, x1: number, y1: number): boolean => {
    if (!hasPending) {
      return false;
    }
    const joinDx = x0 - pendingX1;
    const joinDy = y0 - pendingY1;
    if (joinDx * joinDx + joinDy * joinDy > SEGMENT_JOIN_EPSILON * SEGMENT_JOIN_EPSILON) {
      return false;
    }
    const baseDx = pendingX1 - pendingX0;
    const baseDy = pendingY1 - pendingY0;
    const nextDx = x1 - x0;
    const nextDy = y1 - y0;
    const baseLenSq = baseDx * baseDx + baseDy * baseDy;
    const nextLenSq = nextDx * nextDx + nextDy * nextDy;
    if (baseLenSq < 1e-10 || nextLenSq < 1e-10) {
      return false;
    }
    const dot = (baseDx * nextDx + baseDy * nextDy) / Math.sqrt(baseLenSq * nextLenSq);
    if (dot < COLLINEAR_DOT_THRESHOLD) {
      return false;
    }
    const chainDx = x1 - pendingX0;
    const chainDy = y1 - pendingY0;
    if (crossDistanceSq(chainDx, chainDy, baseDx, baseDy, baseLenSq) > COLLINEAR_PERP_EPSILON ** 2) {
      return false;
    }
    pendingX1 = x1;
    pendingY1 = y1;
    return true;
  };

  const emitLine = (x0: number, y0: number, x1: number, y1: number, merge: boolean): void => {
    const dx = x1 - x0;
    const dy = y1 - y0;
    if (dx * dx + dy * dy < 1e-10) {
      if ((styleFlags & STROKE_STYLE_FLAG_ROUND_CAP) !== 0) {
        output.sourceSegmentCount += 1;
        flushPending();
        emitPrimitive(x0, y0, x1, y1, x1, y1, STROKE_PRIMITIVE_LINE);
      }
      return;
    }
    output.sourceSegmentCount += 1;
    if (allowSegmentMerge && merge && tryMergePending(x0, y0, x1, y1)) {
      return;
    }
    if (allowSegmentMerge) {
      flushPending();
      pendingX0 = x0;
      pendingY0 = y0;
      pendingX1 = x1;
      pendingY1 = y1;
      hasPending = true;
      return;
    }
    emitPrimitive(x0, y0, x1, y1, x1, y1, STROKE_PRIMITIVE_LINE);
  };

  const advanceDash = (): void => {
    if (!hasDashPattern) {
      dashRemaining = Number.POSITIVE_INFINITY;
      dashPaint = true;
      return;
    }
    dashIndex = (dashIndex + 1) % dashPattern.length;
    dashPaint = !dashPaint;
    dashRemaining = dashPattern[dashIndex];
  };

  const advancePastZeroDashEntries = (
    x: number,
    y: number,
    emitPaintedDots: boolean
  ): void => {
    // A zero-length painted dash is visible with a round cap. It is the
    // canonical PDF idiom for a dotted line (`[0 gap] 0 d`, `1 J`). Do not
    // discard it while advancing to the next positive-length dash entry.
    for (let guard = 0; dashRemaining <= 1e-9 && guard < dashPattern.length; guard += 1) {
      if (emitPaintedDots && dashPaint &&
          (styleFlags & STROKE_STYLE_FLAG_ROUND_CAP) !== 0) {
        emitLine(x, y, x, y, false);
      }
      advanceDash();
    }
  };

  const resetDash = (): void => {
    if (!hasDashPattern) {
      dashIndex = 0;
      dashRemaining = Number.POSITIVE_INFINITY;
      dashPaint = true;
      return;
    }
    dashIndex = 0;
    dashRemaining = dashPattern[0];
    dashPaint = true;
    let phase = ((dashPhase * dashScale) % dashPatternLength + dashPatternLength) % dashPatternLength;
    while (phase > 1e-9) {
      advancePastZeroDashEntries(0, 0, false);
      if (phase < dashRemaining - 1e-9) {
        dashRemaining -= phase;
        phase = 0;
      } else {
        phase -= dashRemaining;
        advanceDash();
      }
    }
  };

  const emitStrokedLine = (x0: number, y0: number, x1: number, y1: number, merge: boolean): void => {
    if (!hasDashPattern) {
      emitLine(x0, y0, x1, y1, merge);
      return;
    }
    advancePastZeroDashEntries(x0, y0, true);
    const dx = x1 - x0;
    const dy = y1 - y0;
    const length = Math.hypot(dx, dy);
    if (length <= 1e-9) {
      if (dashPaint) {
        emitLine(x0, y0, x1, y1, false);
      }
      return;
    }
    let consumed = 0;
    while (consumed < length - 1e-9) {
      const span = Math.min(length - consumed, dashRemaining);
      const next = consumed + span;
      if (dashPaint && span > 1e-9) {
        emitLine(
          x0 + dx * (consumed / length), y0 + dy * (consumed / length),
          x0 + dx * (next / length), y0 + dy * (next / length), merge
        );
      } else {
        flushPending();
      }
      consumed = next;
      dashRemaining -= span;
      if (dashRemaining <= 1e-9) {
        advanceDash();
        advancePastZeroDashEntries(
          x0 + dx * (next / length),
          y0 + dy * (next / length),
          true
        );
        if (!dashPaint) {
          flushPending();
        }
      }
    }
  };

  const emitQuadratic = (
    x0: number, y0: number, cx: number, cy: number, x1: number, y1: number
  ): void => {
    if (
      (x1 - x0) ** 2 + (y1 - y0) ** 2 < 1e-10 &&
      (cx - x0) ** 2 + (cy - y0) ** 2 < 1e-10
    ) {
      return;
    }
    output.sourceSegmentCount += 1;
    flushPending();
    emitPrimitive(x0, y0, cx, cy, x1, y1, STROKE_PRIMITIVE_QUADRATIC);
  };

  resetDash();
  for (let offset = 0; offset < pathData.length;) {
    const op = pathData[offset++];
    if (op === DRAW_MOVE_TO) {
      flushPending();
      cursorX = pathData[offset++];
      cursorY = pathData[offset++];
      startX = cursorX;
      startY = cursorY;
      hasStart = true;
      resetDash();
    } else if (op === DRAW_LINE_TO) {
      const x = pathData[offset++];
      const y = pathData[offset++];
      const p0 = applyMatrix(matrix, cursorX, cursorY);
      const p1 = applyMatrix(matrix, x, y);
      emitStrokedLine(p0[0], p0[1], p1[0], p1[1], true);
      cursorX = x;
      cursorY = y;
    } else if (op === DRAW_CURVE_TO) {
      const x1 = pathData[offset++];
      const y1 = pathData[offset++];
      const x2 = pathData[offset++];
      const y2 = pathData[offset++];
      const x3 = pathData[offset++];
      const y3 = pathData[offset++];
      const p0 = applyMatrix(matrix, cursorX, cursorY);
      const p1 = applyMatrix(matrix, x1, y1);
      const p2 = applyMatrix(matrix, x2, y2);
      const p3 = applyMatrix(matrix, x3, y3);
      if (hasDashPattern) {
        flattenCubic(
          ...p0, ...p1, ...p2, ...p3,
          (ax, ay, bx, by) => emitStrokedLine(ax, ay, bx, by, true),
          CURVE_FLATNESS,
          MAX_CURVE_SPLIT_DEPTH
        );
      } else {
        emitCubicAsQuadratics(
          ...p0, ...p1, ...p2, ...p3, emitQuadratic,
          FILL_CUBIC_TO_QUAD_ERROR, MAX_FILL_CUBIC_TO_QUAD_DEPTH
        );
      }
      cursorX = x3;
      cursorY = y3;
    } else if (op === DRAW_QUAD_TO) {
      const cx = pathData[offset++];
      const cy = pathData[offset++];
      const x = pathData[offset++];
      const y = pathData[offset++];
      const p0 = applyMatrix(matrix, cursorX, cursorY);
      const pc = applyMatrix(matrix, cx, cy);
      const p1 = applyMatrix(matrix, x, y);
      emitQuadratic(p0[0], p0[1], pc[0], pc[1], p1[0], p1[1]);
      cursorX = x;
      cursorY = y;
    } else if (op === DRAW_CLOSE) {
      if (hasStart && (cursorX !== startX || cursorY !== startY)) {
        const p0 = applyMatrix(matrix, cursorX, cursorY);
        const p1 = applyMatrix(matrix, startX, startY);
        emitStrokedLine(p0[0], p0[1], p1[0], p1[1], true);
      }
      cursorX = startX;
      cursorY = startY;
      flushPending();
    } else {
      throw new DensePdfSyntaxError(`Invalid path opcode ${op}.`);
    }
  }
  flushPending();
}

function emitFilledPathFromPath(
  pathData: Float32Array,
  matrix: DensePdfMatrix,
  fillRule: number,
  hasCompanionStroke: boolean,
  colorR: number,
  colorG: number,
  colorB: number,
  alpha: number,
  metaA: Float4Builder,
  metaB: Float4Builder,
  metaC: Float4Builder,
  segmentsA: Float4Builder,
  segmentsB: Float4Builder,
  clipBounds: DensePdfBounds | null,
  clipMask: DensePdfClipMask | null
): DensePdfBounds | null {
  let cursorX = 0;
  let cursorY = 0;
  let startX = 0;
  let startY = 0;
  let hasStart = false;
  const segmentStart = segmentsA.quadCount;
  let primitiveCount = 0;
  const localBounds = emptyBounds();

  const emitLine = (x0: number, y0: number, x1: number, y1: number): void => {
    if ((x1 - x0) ** 2 + (y1 - y0) ** 2 < 1e-12) {
      return;
    }
    segmentsA.push(x0, y0, x1, y1);
    segmentsB.push(x1, y1, FILL_PRIMITIVE_LINE, 0);
    primitiveCount += 1;
    includePoint(localBounds, x0, y0);
    includePoint(localBounds, x1, y1);
  };
  const emitQuadratic = (
    x0: number, y0: number, cx: number, cy: number, x1: number, y1: number
  ): void => {
    if (
      (x1 - x0) ** 2 + (y1 - y0) ** 2 < 1e-12 &&
      (cx - x0) ** 2 + (cy - y0) ** 2 < 1e-12
    ) {
      return;
    }
    segmentsA.push(x0, y0, cx, cy);
    segmentsB.push(x1, y1, FILL_PRIMITIVE_QUADRATIC, 0);
    primitiveCount += 1;
    includePoint(localBounds, x0, y0);
    includePoint(localBounds, cx, cy);
    includePoint(localBounds, x1, y1);
  };
  const closeSubpath = (): void => {
    if (hasStart && (cursorX !== startX || cursorY !== startY)) {
      const p0 = applyMatrix(matrix, cursorX, cursorY);
      const p1 = applyMatrix(matrix, startX, startY);
      emitLine(p0[0], p0[1], p1[0], p1[1]);
    }
    cursorX = startX;
    cursorY = startY;
  };

  for (let offset = 0; offset < pathData.length;) {
    const op = pathData[offset++];
    if (op === DRAW_MOVE_TO) {
      closeSubpath();
      cursorX = pathData[offset++];
      cursorY = pathData[offset++];
      startX = cursorX;
      startY = cursorY;
      hasStart = true;
    } else if (op === DRAW_LINE_TO) {
      const x = pathData[offset++];
      const y = pathData[offset++];
      const p0 = applyMatrix(matrix, cursorX, cursorY);
      const p1 = applyMatrix(matrix, x, y);
      emitLine(p0[0], p0[1], p1[0], p1[1]);
      cursorX = x;
      cursorY = y;
    } else if (op === DRAW_CURVE_TO) {
      const x1 = pathData[offset++];
      const y1 = pathData[offset++];
      const x2 = pathData[offset++];
      const y2 = pathData[offset++];
      const x3 = pathData[offset++];
      const y3 = pathData[offset++];
      const p0 = applyMatrix(matrix, cursorX, cursorY);
      const p1 = applyMatrix(matrix, x1, y1);
      const p2 = applyMatrix(matrix, x2, y2);
      const p3 = applyMatrix(matrix, x3, y3);
      emitCubicAsQuadratics(
        ...p0, ...p1, ...p2, ...p3, emitQuadratic,
        FILL_CUBIC_TO_QUAD_ERROR, MAX_FILL_CUBIC_TO_QUAD_DEPTH
      );
      cursorX = x3;
      cursorY = y3;
    } else if (op === DRAW_QUAD_TO) {
      const cx = pathData[offset++];
      const cy = pathData[offset++];
      const x = pathData[offset++];
      const y = pathData[offset++];
      const p0 = applyMatrix(matrix, cursorX, cursorY);
      const pc = applyMatrix(matrix, cx, cy);
      const p1 = applyMatrix(matrix, x, y);
      emitQuadratic(p0[0], p0[1], pc[0], pc[1], p1[0], p1[1]);
      cursorX = x;
      cursorY = y;
    } else if (op === DRAW_CLOSE) {
      closeSubpath();
    } else {
      throw new DensePdfSyntaxError(`Invalid fill-path opcode ${op}.`);
    }
  }
  closeSubpath();

  if (primitiveCount === 0 || !isNonEmptyBounds(localBounds)) {
    segmentsA.truncateQuads(segmentStart);
    segmentsB.truncateQuads(segmentStart);
    return null;
  }
  const visibleBounds = clipBounds ? intersectBounds(clipBounds, localBounds) : localBounds;
  if (!isNonEmptyBounds(visibleBounds)) {
    segmentsA.truncateQuads(segmentStart);
    segmentsB.truncateQuads(segmentStart);
    return null;
  }

  const clipConstrainedPath = createClipConstrainedFillPath(
    pathData,
    matrix,
    localBounds,
    visibleBounds,
    clipMask
  );
  if (clipConstrainedPath) {
    segmentsA.truncateQuads(segmentStart);
    segmentsB.truncateQuads(segmentStart);
    return emitFilledPathFromPath(
      clipConstrainedPath,
      [1, 0, 0, 1, 0, 0],
      FILL_RULE_EVEN_ODD,
      hasCompanionStroke,
      colorR,
      colorG,
      colorB,
      alpha,
      metaA,
      metaB,
      metaC,
      segmentsA,
      segmentsB,
      null,
      null
    );
  }

  metaA.push(segmentStart, primitiveCount, visibleBounds.minX, visibleBounds.minY);
  metaB.push(visibleBounds.maxX, visibleBounds.maxY, colorR, colorG);
  metaC.push(fillRule, hasCompanionStroke ? 1 : 0, colorB, alpha);
  return { ...visibleBounds };
}

function countPathMoveOps(pathData: Float32Array): number {
  let count = 0;
  for (let offset = 0; offset < pathData.length;) {
    const operator = pathData[offset++];
    if (operator === DRAW_MOVE_TO) {
      count += 1;
      offset += 2;
    } else if (operator === DRAW_LINE_TO) offset += 2;
    else if (operator === DRAW_CURVE_TO) offset += 6;
    else if (operator === DRAW_QUAD_TO) offset += 4;
    else if (operator !== DRAW_CLOSE) break;
  }
  return count;
}

async function cullContainedSegments(
  endpoints: Float32Array,
  primitiveMeta: Float32Array,
  primitiveBounds: Float32Array,
  styles: Float32Array,
  checkpoint: (force?: boolean) => Promise<void>,
  onIndexRemap?: (remap: Uint32Array) => void
): Promise<StrokeFinalizeResult> {
  const { keep, discardedContainedCount } = await markContainedSegments(
    endpoints, primitiveMeta, primitiveBounds, styles, checkpoint, null);
  return compactStrokeBuffers(
    endpoints,
    primitiveMeta,
    primitiveBounds,
    styles,
    keep,
    keep.length - discardedContainedCount,
    discardedContainedCount,
    checkpoint,
    onIndexRemap
  );
}

/**
 * Mark segments that an opaque collinear segment of the same style covers.
 * Unordered output may drop any covered segment. With `order`, output keeps
 * source order: a segment is dropped only when a later segment in the same
 * paint context, or an earlier one in its run, covers it, and oversized
 * groups are kept rather than refused.
 */
async function markContainedSegments(
  endpoints: Float32Array,
  primitiveMeta: Float32Array,
  primitiveBounds: Float32Array,
  styles: Float32Array,
  checkpoint: (force?: boolean) => Promise<void>,
  order: StrokePaintOrder | null,
  removed: Uint8Array | null = null
): Promise<{ keep: Uint8Array; discardedContainedCount: number }> {
  const runs = order?.runs ?? null;
  const runContexts = order?.runContexts ?? null;
  const count = endpoints.length >> 2;
  const keep = new Uint8Array(count);
  keep.fill(1);
  // A paint context names its clip, so ordered groups key on the context in
  // place of the clipped segments' clip bounds.
  const tupleLength = order ? COVERAGE_TUPLE_GEOMETRY + 1 : COVERAGE_TUPLE_GEOMETRY + 4;
  const tuple = new Float64Array(tupleLength);
  const representative = new Float64Array(tupleLength);
  const fillTuple = (target: Float64Array, index: number): boolean => {
    if (!fillCoverageGroupTuple(target, index, endpoints, primitiveMeta, styles, primitiveBounds)) {
      return false;
    }
    if (runs && runContexts) target[COVERAGE_TUPLE_GEOMETRY] = runContexts[runs[index]];
    return true;
  };

  // Group segments with equal keys: hash each key in one sequential pass,
  // sort the (hash, index) pairs, then split every run of equal hashes by
  // exact key. Most CAD segments share no line with any other, and this never
  // probes a table for them.
  let hashes: Uint32Array = new Uint32Array(count);
  let indices: Uint32Array = new Uint32Array(count);
  let grouped = 0;
  for (let index = 0; index < count; index += 1) {
    if ((index & 0x1fff) === 0) await checkpoint();
    if (runs && runContexts && runContexts[runs[index]] === NO_STROKE_PAINT_CONTEXT) continue;
    // An already removed duplicate neither paints nor covers.
    if (removed && removed[index] !== 0) continue;
    if (!fillTuple(tuple, index)) continue;
    hashes[grouped] = hashQuantizedTuple(tuple, tupleLength);
    indices[grouped] = index;
    grouped += 1;
  }
  ({ keys: hashes, values: indices } = await radixSortPairs(hashes, indices, grouped, checkpoint));

  // Only groups with several candidates need line extents.
  let starts = new Float64Array(64);
  let ends = new Float64Array(64);
  let discardedContainedCount = 0;
  const coverageSorter = new CoverageObjectSorter();
  const opaqueCovers: number[] = [];
  const cullGroup = (candidates: number[]): void => {
    if (candidates.length > MAX_COVERAGE_GROUP_SIZE) {
      if (order) return;
      throw new DensePdfUnsupportedError(
        "A collinear stroke group is too large for cooperative vector culling."
      );
    }
    if (candidates.length > starts.length) {
      starts = new Float64Array(Math.max(candidates.length, starts.length * 2));
      ends = new Float64Array(starts.length);
    }
    for (let position = 0; position < candidates.length; position += 1) {
      coverageExtent(candidates[position], endpoints, primitiveMeta, starts, ends, position);
    }
    coverageSorter.sortNow(candidates, starts, ends, styles, primitiveMeta);
    // Covers are positions in the sorted group, which index `starts`/`ends`.
    opaqueCovers.length = 0;
    for (let candidateNumber = 0; candidateNumber < candidates.length; candidateNumber += 1) {
      const candidate = candidates[candidateNumber];
      const candidateOffset = candidate * 4;
      const candidateWidth = styles[candidateOffset];
      let covered = false;
      for (let coverNumber = 0; coverNumber < opaqueCovers.length; coverNumber += 1) {
        const coverPosition = opaqueCovers[coverNumber];
        const cover = candidates[coverPosition];
        if (styles[cover * 4] + COVER_HALF_WIDTH_EPSILON < candidateWidth) {
          continue;
        }
        if (
          starts[coverPosition] - COVER_INTERVAL_EPSILON <= starts[candidateNumber] &&
          ends[coverPosition] + COVER_INTERVAL_EPSILON >= ends[candidateNumber]
        ) {
          // In source order an earlier cover repaints nothing painted after it,
          // unless both belong to one run of the same paint.
          if (runs && cover < candidate && runs[cover] !== runs[candidate]) continue;
          covered = true;
          break;
        }
      }
      if (covered) {
        keep[candidate] = 0;
        discardedContainedCount += 1;
      } else {
        const encodedStyle = primitiveMeta[candidateOffset + 3];
        const flags = Math.max(
          0,
          Math.trunc(encodedStyle / STROKE_STYLE_FLAG_OFFSET + 1e-6)
        );
        if (clamp01(encodedStyle - flags * STROKE_STYLE_FLAG_OFFSET) >= OPAQUE_ALPHA_EPSILON) {
          opaqueCovers.push(candidateNumber);
        }
      }
    }
  };

  // Within a group the sorter imposes a total order ending in the segment
  // index, and groups are independent, so discovery order cannot matter.
  // Groups are culled without yielding; yield after enough work instead of
  // paying a promise per group.
  const candidates: number[] = [];
  const pending: number[] = [];
  let workSinceCheckpoint = 0;
  for (let first = 0; first < grouped;) {
    if (workSinceCheckpoint >= COVERAGE_WORK_PER_CHECKPOINT) {
      workSinceCheckpoint = 0;
      await checkpoint();
    }
    workSinceCheckpoint += 1;
    let end = first + 1;
    while (end < grouped && hashes[end] === hashes[first]) end += 1;
    if (end - first >= 2) {
      pending.length = 0;
      for (let position = first; position < end; position += 1) pending.push(indices[position]);
      // Split the run by exact key; distinct keys rarely share a hash.
      while (pending.length >= 2) {
        fillTuple(representative, pending[0]);
        candidates.length = 0;
        let rest = 0;
        for (let position = 0; position < pending.length; position += 1) {
          const index = pending[position];
          fillTuple(tuple, index);
          let equal = true;
          for (let component = 0; component < tupleLength; component += 1) {
            if (tuple[component] !== representative[component]) {
              equal = false;
              break;
            }
          }
          if (equal) candidates.push(index);
          else pending[rest++] = index;
        }
        pending.length = rest;
        workSinceCheckpoint += candidates.length;
        if (candidates.length >= 2) {
          // The cover scan is quadratic in the worst case.
          workSinceCheckpoint += candidates.length * candidates.length;
          cullGroup(candidates);
        }
      }
    }
    first = end;
  }

  candidates.length = 0;
  pending.length = 0;
  opaqueCovers.length = 0;
  hashes = new Uint32Array(0);
  indices = new Uint32Array(0);
  coverageSorter.release();
  starts = new Float64Array(0);
  ends = new Float64Array(0);
  await checkpoint(true);
  return { keep, discardedContainedCount };
}

/** Stable least-significant-digit radix sort of `length` (key, value) pairs by key. */
async function radixSortPairs(
  keys: Uint32Array,
  values: Uint32Array,
  length: number,
  checkpoint: (force?: boolean) => Promise<void>
): Promise<{ keys: Uint32Array; values: Uint32Array }> {
  let sourceKeys: Uint32Array = keys;
  let sourceValues: Uint32Array = values;
  let targetKeys: Uint32Array = new Uint32Array(length);
  let targetValues: Uint32Array = new Uint32Array(length);
  const counts = new Uint32Array(1 << 16);
  for (let shift = 0; shift < 32; shift += 16) {
    counts.fill(0);
    for (let index = 0; index < length; index += 1) counts[(sourceKeys[index] >>> shift) & 0xffff] += 1;
    let total = 0;
    for (let digit = 0; digit < counts.length; digit += 1) {
      const digitCount = counts[digit];
      counts[digit] = total;
      total += digitCount;
    }
    for (let index = 0; index < length; index += 1) {
      const key = sourceKeys[index];
      const position = counts[(key >>> shift) & 0xffff]++;
      targetKeys[position] = key;
      targetValues[position] = sourceValues[index];
    }
    [sourceKeys, targetKeys] = [targetKeys, sourceKeys];
    [sourceValues, targetValues] = [targetValues, sourceValues];
    await checkpoint();
  }
  return { keys: sourceKeys, values: sourceValues };
}

/**
 * A grouped line's extent along its direction, computed exactly as
 * `fillCoverageGroupTuple` computes it; grouping already rejected lines too
 * short to have a direction.
 */
function coverageExtent(
  index: number,
  endpoints: Float32Array,
  primitiveMeta: Float32Array,
  starts: Float64Array,
  ends: Float64Array,
  slot: number
): void {
  const offset = index * 4;
  let ax = endpoints[offset];
  let ay = endpoints[offset + 1];
  let bx = primitiveMeta[offset];
  let by = primitiveMeta[offset + 1];
  const length = Math.hypot(bx - ax, by - ay);
  let ux = (bx - ax) / length;
  let uy = (by - ay) / length;
  if (ux < 0 || (Math.abs(ux) < 1e-10 && uy < 0)) {
    ux = -ux;
    uy = -uy;
    ax = primitiveMeta[offset];
    ay = primitiveMeta[offset + 1];
    bx = endpoints[offset];
    by = endpoints[offset + 1];
  }
  starts[slot] = Math.min(ux * ax + uy * ay, ux * bx + uy * by);
  ends[slot] = Math.max(ux * ax + uy * ay, ux * bx + uy * by);
}

function fillCoverageGroupTuple(
  tuple: Float64Array,
  index: number,
  endpoints: Float32Array,
  primitiveMeta: Float32Array,
  styles: Float32Array,
  primitiveBounds: Float32Array
): boolean {
  const offset = index * 4;
  if (primitiveMeta[offset + 2] >= STROKE_PRIMITIVE_QUADRATIC - 0.5) {
    return false;
  }
  let ax = endpoints[offset];
  let ay = endpoints[offset + 1];
  let bx = primitiveMeta[offset];
  let by = primitiveMeta[offset + 1];
  const dx = bx - ax;
  const dy = by - ay;
  const length = Math.hypot(dx, dy);
  if (length < 1e-5) {
    return false;
  }
  let ux = dx / length;
  let uy = dy / length;
  if (ux < 0 || (Math.abs(ux) < 1e-10 && uy < 0)) {
    ux = -ux;
    uy = -uy;
    ax = primitiveMeta[offset];
    ay = primitiveMeta[offset + 1];
    bx = endpoints[offset];
    by = endpoints[offset + 1];
  }
  const nx = -uy;
  const ny = ux;
  const encodedStyle = primitiveMeta[offset + 3];
  const decodedFlags = Math.max(
    0,
    Math.trunc(encodedStyle / STROKE_STYLE_FLAG_OFFSET + 1e-6)
  );
  tuple[0] = quantize(ux, COVER_DIRECTION_SCALE);
  tuple[1] = quantize(uy, COVER_DIRECTION_SCALE);
  tuple[2] = quantize(nx * ax + ny * ay, COVER_OFFSET_SCALE);
  tuple[3] = quantize(styles[offset + 1], DUPLICATE_STYLE_SCALE);
  tuple[4] = quantize(styles[offset + 2], DUPLICATE_STYLE_SCALE);
  tuple[5] = quantize(styles[offset + 3], DUPLICATE_STYLE_SCALE);
  tuple[6] = quantize(decodedFlags, 1);
  if (tuple.length === COVERAGE_TUPLE_GEOMETRY + 4) {
    const clipped = (decodedFlags & DENSE_PDF_STROKE_STYLE_FLAG_CLIPPED) !== 0;
    tuple[7] = clipped ? primitiveBounds[offset] : 0;
    tuple[8] = clipped ? primitiveBounds[offset + 1] : 0;
    tuple[9] = clipped ? primitiveBounds[offset + 2] : 0;
    tuple[10] = clipped ? primitiveBounds[offset + 3] : 0;
  }
  return true;
}

class CoverageObjectSorter {
  private readonly pool: CoverageCandidate[] = [];

  private readonly work: CoverageCandidate[] = [];

  /** Sort a group's candidates; `starts`/`ends` are by position and move with them. */
  sortNow(
    values: number[],
    starts: Float64Array,
    ends: Float64Array,
    styles: Float32Array,
    primitiveMeta: Float32Array
  ): void {
    // Reuse candidate objects to bound allocation across dense coverage groups.
    this.work.length = 0;
    for (let offset = 0; offset < values.length; offset += 1) {
      const index = values[offset];
      const encoded = primitiveMeta[index * 4 + 3];
      const styleFlags = Math.max(
        0,
        Math.trunc(encoded / STROKE_STYLE_FLAG_OFFSET + 1e-6)
      );
      const candidate = this.pool[offset] ?? (this.pool[offset] = {
        index: 0,
        start: 0,
        end: 0,
        halfWidth: 0,
        alpha: 0,
        styleFlags: 0
      });
      candidate.index = index;
      candidate.start = starts[offset];
      candidate.end = ends[offset];
      candidate.halfWidth = styles[index * 4];
      candidate.alpha = clamp01(encoded - styleFlags * STROKE_STYLE_FLAG_OFFSET);
      candidate.styleFlags = styleFlags;
      this.work.push(candidate);
    }

    // Use a total order across runtimes; epsilon ties are non-transitive.
    // Apply coverage tolerances only in the containment checks.
    this.work.sort((a, b) =>
      b.halfWidth - a.halfWidth ||
      (b.end - b.start) - (a.end - a.start) ||
      a.start - b.start ||
      a.index - b.index
    );
    for (let offset = 0; offset < values.length; offset += 1) {
      values[offset] = this.work[offset].index;
      starts[offset] = this.work[offset].start;
      ends[offset] = this.work[offset].end;
    }
  }

  release(): void {
    this.pool.length = 0;
    this.work.length = 0;
  }
}

async function compactStrokeBuffers(
  endpoints: Float32Array,
  primitiveMeta: Float32Array,
  primitiveBounds: Float32Array,
  styles: Float32Array,
  keep: Uint8Array,
  visibleCount: number,
  discardedContainedCount: number,
  checkpoint: (force?: boolean) => Promise<void>,
  onIndexRemap?: (remap: Uint32Array) => void
): Promise<StrokeFinalizeResult> {
  // Finalization owns the builder stores: compact them in place, then shrink
  // them instead of copying four output stores at peak memory.
  const bounds = emptyBounds();
  // Grouped vector output also stores stroke boundaries for selective image
  // captures. Those boundaries must follow the final containment compaction.
  const remap = onIndexRemap && discardedContainedCount > 0 ? new Uint32Array(keep.length + 1) : null;
  let maxHalfWidth = 0;
  let out = 0;
  for (let index = 0; index < keep.length; index += 1) {
    if ((index & 0x1fff) === 0) await checkpoint();
    if (remap) remap[index] = out;
    if (keep[index] === 0) {
      continue;
    }
    const inputOffset = index * 4;
    const outputOffset = out * 4;
    includePoint(bounds, primitiveBounds[inputOffset], primitiveBounds[inputOffset + 1]);
    includePoint(bounds, primitiveBounds[inputOffset + 2], primitiveBounds[inputOffset + 3]);
    maxHalfWidth = Math.max(maxHalfWidth, styles[inputOffset]);
    if (outputOffset !== inputOffset) {
      for (let component = 0; component < 4; component += 1) {
        endpoints[outputOffset + component] = endpoints[inputOffset + component];
        primitiveMeta[outputOffset + component] = primitiveMeta[inputOffset + component];
        primitiveBounds[outputOffset + component] = primitiveBounds[inputOffset + component];
        styles[outputOffset + component] = styles[inputOffset + component];
      }
    }
    out += 1;
  }
  if (remap) {
    remap[keep.length] = out;
    onIndexRemap!(remap);
  }
  return {
    endpoints: takeFloat32Prefix(endpoints, visibleCount * 4),
    primitiveMeta: takeFloat32Prefix(primitiveMeta, visibleCount * 4),
    primitiveBounds: takeFloat32Prefix(primitiveBounds, visibleCount * 4),
    styles: takeFloat32Prefix(styles, visibleCount * 4),
    bounds: visibleCount > 0 ? bounds : null,
    maxHalfWidth,
    discardedContainedCount
  };
}

/**
 * The prefix of a store the caller owns, transferred rather than sliced where
 * the runtime supports it. The input is unusable afterwards either way.
 */
function takeFloat32Prefix(values: Float32Array, floatCount: number): Float32Array<ArrayBuffer> {
  if (canShrinkInPlace(values)) {
    return new Float32Array(transferableBuffer(values).transferToFixedLength!(
      floatCount * Float32Array.BYTES_PER_ELEMENT
    ));
  }
  return values.slice(0, floatCount);
}

function canShrinkInPlace(values: ArrayBufferView): boolean {
  const buffer = transferableBuffer(values);
  return values.byteOffset === 0 && buffer instanceof ArrayBuffer &&
    typeof buffer.transferToFixedLength === "function";
}

function transferableBuffer(values: ArrayBufferView): ArrayBuffer & {
  transferToFixedLength?: (newByteLength?: number) => ArrayBuffer;
} {
  return values.buffer as ArrayBuffer;
}

async function buildUncompactedStrokeResult(
  endpoints: Float32Array,
  primitiveMeta: Float32Array,
  primitiveBounds: Float32Array,
  styles: Float32Array,
  checkpoint: (force?: boolean) => Promise<void>,
  preservedMaxHalfWidth: number | null = null
): Promise<StrokeFinalizeResult> {
  const count = endpoints.length >> 2;
  const bounds = emptyBounds();
  let maxHalfWidth = count > 0 ? preservedMaxHalfWidth ?? 0 : 0;
  for (let index = 0; index < count; index += 1) {
    if ((index & 0x1fff) === 0) await checkpoint();
    const offset = index * 4;
    includePoint(bounds, primitiveBounds[offset], primitiveBounds[offset + 1]);
    includePoint(bounds, primitiveBounds[offset + 2], primitiveBounds[offset + 3]);
    if (preservedMaxHalfWidth === null) {
      maxHalfWidth = Math.max(maxHalfWidth, styles[offset]);
    }
  }
  return {
    endpoints,
    primitiveMeta,
    primitiveBounds,
    styles,
    bounds: count > 0 ? bounds : null,
    maxHalfWidth,
    discardedContainedCount: 0
  };
}

const EMPTY_CONTENT_BYTES = new Uint8Array(0);
const ARRAY_START_TOKEN: LexerToken = { kind: "array-start" };
const ARRAY_END_TOKEN: LexerToken = { kind: "array-end" };
const DICT_START_TOKEN: LexerToken = { kind: "dict-start" };
const DICT_END_TOKEN: LexerToken = { kind: "dict-end" };

const SINGLE_BYTE_PDF_WORDS: string[] = Array.from(
  { length: 256 },
  (_, value) => String.fromCharCode(value)
);

async function* normalizeContentSegments(
  source: DensePdfContentSource | DensePdfPreparedContentSource
): AsyncGenerator<DensePdfContentSegment> {
  if (source instanceof Uint8Array) {
    if (source.length > 0) {
      yield {
        kind: "content",
        bytes: source,
        sourceOffset: 0,
        sourceLength: source.length
      };
    }
    return;
  }
  let inferredOffset = 0;
  if (Symbol.asyncIterator in Object(source)) {
    for await (const chunk of source as AsyncIterable<Uint8Array | DensePdfContentSegment>) {
      const segment = normalizeContentSegment(chunk, inferredOffset);
      if (segment.kind === "image" || segment.bytes.length > 0) yield segment;
      inferredOffset = segment.sourceOffset + segment.sourceLength;
    }
    return;
  }
  for (const chunk of source as Iterable<Uint8Array | DensePdfContentSegment>) {
    const segment = normalizeContentSegment(chunk, inferredOffset);
    if (segment.kind === "image" || segment.bytes.length > 0) yield segment;
    inferredOffset = segment.sourceOffset + segment.sourceLength;
  }
}

function normalizeContentSegment(
  value: Uint8Array | DensePdfContentSegment,
  inferredOffset = 0
): DensePdfContentSegment {
  const segment: DensePdfContentSegment = value instanceof Uint8Array
    ? {
        kind: "content",
        bytes: value,
        sourceOffset: inferredOffset,
        sourceLength: value.length
      }
    : value;
  validateContentSegment(segment);
  return segment;
}

function validateContentSegment(segment: DensePdfContentSegment): void {
  if (!segment || (segment.kind !== "content" && segment.kind !== "image")) {
    throw new TypeError("Dense PDF content sources yielded an invalid segment.");
  }
  if (
    !Number.isSafeInteger(segment.sourceOffset) || segment.sourceOffset < 0 ||
    !Number.isSafeInteger(segment.sourceLength) || segment.sourceLength < 0 ||
    !Number.isSafeInteger(segment.sourceOffset + segment.sourceLength)
  ) {
    throw new TypeError("Dense PDF content segment source metadata is invalid.");
  }
  if (segment.kind === "content") {
    if (!(segment.bytes instanceof Uint8Array) || segment.bytes.length !== segment.sourceLength) {
      throw new TypeError("Dense PDF content spans must contain their exact source bytes.");
    }
  } else if (
    !Number.isSafeInteger(segment.imageIndex) || segment.imageIndex < 0 ||
    segment.imageIndex > 0xffff_ffff || segment.sourceLength <= 0
  ) {
    throw new TypeError("Dense PDF inline-image segment has an invalid image index or span.");
  }
}

function nowMs(): number {
  return typeof performance !== "undefined" ? performance.now() : Date.now();
}

/** Yield parser work to a host task without accumulating nested-timer delays. */
function yieldToHost(): Promise<void> {
  return new Promise((resolve) => {
    if (typeof MessageChannel === "undefined") {
      setTimeout(resolve, 0);
      return;
    }
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      channel.port1.close();
      channel.port2.close();
      resolve();
    };
    channel.port2.postMessage(null);
  });
}

function assertFiniteMatrix(matrix: DensePdfMatrix): void {
  if (matrix.length !== 6 || matrix.some((value) => !Number.isFinite(value))) {
    throw new TypeError("pageMatrix must contain six finite numbers.");
  }
}

function assertValidBounds(bounds: DensePdfBounds, label: string): void {
  if (
    !Number.isFinite(bounds.minX) || !Number.isFinite(bounds.minY) ||
    !Number.isFinite(bounds.maxX) || !Number.isFinite(bounds.maxY) ||
    bounds.minX > bounds.maxX || bounds.minY > bounds.maxY
  ) {
    throw new TypeError(`${label} must be finite and non-empty.`);
  }
}

const PDF_BYTE_REGULAR = 0;
const PDF_BYTE_WHITESPACE = 1;
const PDF_BYTE_DELIMITER = 2;
const PDF_BYTE_CLASSES = new Uint8Array(256);
for (const byte of [0, 9, 10, 12, 13, 32]) PDF_BYTE_CLASSES[byte] = PDF_BYTE_WHITESPACE;
for (const byte of [0x28, 0x29, 0x3c, 0x3e, 0x5b, 0x5d, 0x7b, 0x7d, 0x2f, 0x25]) {
  PDF_BYTE_CLASSES[byte] = PDF_BYTE_DELIMITER;
}

function isPdfWhitespace(byte: number): boolean {
  return PDF_BYTE_CLASSES[byte] === PDF_BYTE_WHITESPACE;
}

function findRegularTokenEnd(bytes: Uint8Array, offset: number): number {
  while (offset < bytes.length && PDF_BYTE_CLASSES[bytes[offset]] === PDF_BYTE_REGULAR) {
    offset += 1;
  }
  return offset;
}

function findLineEnd(bytes: Uint8Array, offset: number): number {
  while (offset < bytes.length) {
    const byte = bytes[offset++];
    if (byte === 10) {
      return offset;
    }
    if (byte === 13) {
      return offset < bytes.length && bytes[offset] === 10 ? offset + 1 : offset;
    }
  }
  return -1;
}

function findByte(bytes: Uint8Array, expected: number, offset: number): number {
  while (offset < bytes.length) {
    if (bytes[offset] === expected) {
      return offset;
    }
    offset += 1;
  }
  return -1;
}

function hexNibble(byte: number): number {
  if (byte >= 0x30 && byte <= 0x39) return byte - 0x30;
  if (byte >= 0x41 && byte <= 0x46) return byte - 0x41 + 10;
  if (byte >= 0x61 && byte <= 0x66) return byte - 0x61 + 10;
  return -1;
}

function decodeHexString(bytes: Uint8Array): Uint8Array {
  let digits = 0;
  for (const byte of bytes) {
    if (isPdfWhitespace(byte)) continue;
    if (hexNibble(byte) < 0) {
      throw new DensePdfSyntaxError("Invalid hexadecimal digit in PDF string.");
    }
    digits += 1;
  }
  const output = new Uint8Array((digits + 1) >> 1);
  let high = -1;
  let index = 0;
  for (const byte of bytes) {
    if (isPdfWhitespace(byte)) continue;
    const nibble = hexNibble(byte);
    if (high < 0) {
      high = nibble;
    } else {
      output[index++] = (high << 4) | nibble;
      high = -1;
    }
  }
  if (high >= 0) {
    output[index] = high << 4;
  }
  return output;
}

function parseLiteralString(
  bytes: Uint8Array,
  offset: number,
  final: boolean
): { value: Uint8Array; offset: number } | null {
  const output: number[] = [];
  let depth = 1;
  while (offset < bytes.length) {
    const byte = bytes[offset++];
    if (byte === 0x28) {
      depth += 1;
      output.push(byte);
      continue;
    }
    if (byte === 0x29) {
      depth -= 1;
      if (depth === 0) {
        return { value: Uint8Array.from(output), offset };
      }
      output.push(byte);
      continue;
    }
    if (byte !== 0x5c) {
      output.push(byte);
      continue;
    }
    if (offset >= bytes.length) {
      if (!final) return null;
      throw new DensePdfSyntaxError("Incomplete escape at the end of a PDF string.");
    }
    const escaped = bytes[offset++];
    if (escaped === 0x6e) output.push(10);
    else if (escaped === 0x72) output.push(13);
    else if (escaped === 0x74) output.push(9);
    else if (escaped === 0x62) output.push(8);
    else if (escaped === 0x66) output.push(12);
    else if (escaped === 0x0a) { /* escaped line continuation */ }
    else if (escaped === 0x0d) {
      if (offset < bytes.length && bytes[offset] === 0x0a) offset += 1;
    } else if (escaped >= 0x30 && escaped <= 0x37) {
      let value = escaped - 0x30;
      let count = 1;
      while (count < 3 && offset < bytes.length) {
        const digit = bytes[offset];
        if (digit < 0x30 || digit > 0x37) break;
        value = value * 8 + digit - 0x30;
        offset += 1;
        count += 1;
      }
      output.push(value & 0xff);
    } else {
      output.push(escaped);
    }
  }
  if (!final) return null;
  throw new DensePdfSyntaxError("Unterminated literal string in PDF content.");
}

function decodePdfName(bytes: Uint8Array): string {
  let output = "";
  for (let offset = 0; offset < bytes.length; offset += 1) {
    let byte = bytes[offset];
    if (byte === 0x23) {
      if (offset + 2 >= bytes.length) {
        throw new DensePdfSyntaxError("Incomplete # escape in PDF name.");
      }
      const high = hexNibble(bytes[++offset]);
      const low = hexNibble(bytes[++offset]);
      if (high < 0 || low < 0) {
        throw new DensePdfSyntaxError("Invalid # escape in PDF name.");
      }
      byte = (high << 4) | low;
    }
    output += String.fromCharCode(byte);
  }
  return output;
}

function internPdfWord(bytes: Uint8Array, start: number, end: number): string {
  const length = end - start;
  if (length === 1) {
    return SINGLE_BYTE_PDF_WORDS[bytes[start]];
  }
  // Avoid allocating strings for the small set of multi-byte operators that can
  // occur millions of times in machine-generated CAD streams.
  if (length === 2) {
    const a = bytes[start];
    const b = bytes[start + 1];
    if (a === 0x42 && b === 0x54) return "BT";
    if (a === 0x45 && b === 0x54) return "ET";
    if (a === 0x54 && b === 0x66) return "Tf";
    if (a === 0x54 && b === 0x6a) return "Tj";
    if (a === 0x54 && b === 0x4a) return "TJ";
    if (a === 0x54 && b === 0x64) return "Td";
    if (a === 0x54 && b === 0x44) return "TD";
    if (a === 0x54 && b === 0x6d) return "Tm";
    if (a === 0x54 && b === 0x63) return "Tc";
    if (a === 0x54 && b === 0x77) return "Tw";
    if (a === 0x54 && b === 0x7a) return "Tz";
    if (a === 0x54 && b === 0x4c) return "TL";
    if (a === 0x54 && b === 0x72) return "Tr";
    if (a === 0x54 && b === 0x73) return "Ts";
    if (a === 0x54 && b === 0x2a) return "T*";
    if (a === 0x52 && b === 0x47) return "RG";
    if (a === 0x72 && b === 0x67) return "rg";
    if (a === 0x43 && b === 0x53) return "CS";
    if (a === 0x63 && b === 0x73) return "cs";
    if (a === 0x53 && b === 0x43) return "SC";
    if (a === 0x73 && b === 0x63) return "sc";
    if (a === 0x63 && b === 0x6d) return "cm";
    if (a === 0x72 && b === 0x65) return "re";
    if (a === 0x57 && b === 0x2a) return "W*";
    if (a === 0x66 && b === 0x2a) return "f*";
    if (a === 0x42 && b === 0x2a) return "B*";
    if (a === 0x62 && b === 0x2a) return "b*";
    if (a === 0x4d && b === 0x50) return "MP";
    if (a === 0x44 && b === 0x50) return "DP";
    if (a === 0x42 && b === 0x58) return "BX";
    if (a === 0x45 && b === 0x58) return "EX";
    if (a === 0x72 && b === 0x69) return "ri";
  } else if (length === 3) {
    const a = bytes[start];
    const b = bytes[start + 1];
    const c = bytes[start + 2];
    if (a === 0x42 && b === 0x4d && c === 0x43) return "BMC";
    if (a === 0x42 && b === 0x44 && c === 0x43) return "BDC";
    if (a === 0x45 && b === 0x4d && c === 0x43) return "EMC";
    if (a === 0x53 && b === 0x43 && c === 0x4e) return "SCN";
    if (a === 0x73 && b === 0x63 && c === 0x6e) return "scn";
  }
  let output = "";
  for (let offset = start; offset < end; offset += 1) {
    output += String.fromCharCode(bytes[offset]);
  }
  return output;
}

function isPdfName(value: PdfValue): value is PdfNameValue {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "name";
}

function isPdfDictionary(value: PdfValue): value is PdfDictionaryValue {
  return typeof value === "object" && value !== null && "kind" in value && value.kind === "dictionary";
}

function dictionaryContainsOptionalContent(dictionary: PdfDictionaryValue): boolean {
  for (const [key, value] of dictionary.value) {
    if (key === "OC" || key === "OCGs" || key === "OCProperties") return true;
    if (
      key === "Type" && isPdfName(value) &&
      (value.value === "OCG" || value.value === "OCMD")
    ) return true;
    if (pdfValueContainsOptionalContent(value)) return true;
  }
  return false;
}

function readInlineMcid(dictionary: PdfDictionaryValue, operator: string): number {
  const entry = dictionary.value.find(([key]) => key === "MCID");
  if (!entry) return -1;
  const value = entry[1];
  if (!Number.isSafeInteger(value) || (value as number) < 0) {
    throw new DensePdfSyntaxError(`${operator} /MCID must be a non-negative integer.`);
  }
  return value as number;
}

function pdfValueContainsOptionalContent(value: PdfValue): boolean {
  if (!value || typeof value !== "object" || !("kind" in value)) return false;
  if (value.kind === "array") return value.value.some(pdfValueContainsOptionalContent);
  if (value.kind === "dictionary") return dictionaryContainsOptionalContent(value);
  return false;
}

function numberValue(value: PdfValue | undefined, operator: string): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new DensePdfSyntaxError(`Operator ${operator} requires numeric operands.`);
  }
  return value;
}

function numberArg(args: PdfValue[], index: number): number {
  return numberValue(args[index], "content");
}

function nameArg(args: PdfValue[], index: number): string {
  const value = args[index];
  if (!value || typeof value !== "object" || !("kind" in value) || value.kind !== "name") {
    throw new DensePdfSyntaxError("PDF operator requires a name operand.");
  }
  return value.value;
}

function stringArg(args: PdfValue[], index: number): Uint8Array {
  const value = args[index];
  if (!value || typeof value !== "object" || !("kind" in value) || value.kind !== "string") {
    throw new DensePdfSyntaxError("PDF text operator requires a string operand.");
  }
  return value.value;
}

function arrayArg(args: PdfValue[], index: number): PdfValue[] {
  const value = args[index];
  if (!value || typeof value !== "object" || !("kind" in value) || value.kind !== "array") {
    throw new DensePdfSyntaxError("PDF operator requires an array operand.");
  }
  return value.value;
}

function validateTextArray(values: PdfValue[]): void {
  for (const value of values) {
    if (typeof value === "number") continue;
    if (value && typeof value === "object" && "kind" in value && value.kind === "string") continue;
    throw new DensePdfSyntaxError("TJ arrays may contain only strings and numbers.");
  }
}

function cloneState(state: GraphicsState): GraphicsState {
  return {
    ...state,
    matrix: [...state.matrix],
    clipBounds: state.clipBounds ? { ...state.clipBounds } : null,
    clipMask: cloneClipMaskOrNull(state.clipMask),
    lineDash: [...state.lineDash]
  };
}

function compositeStatesEqual(
  first: Readonly<DensePdfCompositeState>,
  second: Readonly<DensePdfCompositeState>
): boolean {
  return first.alpha === second.alpha &&
    first.alphaIsShape === second.alphaIsShape &&
    first.blendMode === second.blendMode &&
    first.softMaskIndex === second.softMaskIndex &&
    first.overprint === second.overprint &&
    first.overprintMode === second.overprintMode;
}

function freezeSolidPaint(paint: Readonly<DensePdfSolidPaint>): DensePdfSolidPaint {
  return Object.freeze({
    color: Object.freeze([...paint.color]) as DensePdfSolidPaint["color"],
    sourceColorSpaceIndex: paint.sourceColorSpaceIndex,
    ...(paint.inheritType3Paint === true ? { inheritType3Paint: true } : {})
  });
}

function snapshotInitialGraphicsState(
  state: GraphicsState,
  font?: Readonly<DensePdfFontSelection>
): DensePdfInitialGraphicsState {
  return {
    ...(font ? { font } : {}),
    lineWidth: state.lineWidth,
    lineCap: state.lineCap,
    lineDash: [...state.lineDash],
    dashPhase: state.dashPhase,
    strokeColor: [state.strokeR, state.strokeG, state.strokeB],
    fillColor: [state.fillR, state.fillG, state.fillB],
    strokeColorSpace: state.strokeColorSpace,
    fillColorSpace: state.fillColorSpace,
    strokePaintInherited: state.strokePaintInherited,
    fillPaintInherited: state.fillPaintInherited,
    strokeAlpha: state.strokeAlpha,
    fillAlpha: state.fillAlpha,
    alphaIsShape: state.alphaIsShape,
    blendMode: state.blendMode,
    softMaskIndex: state.softMaskIndex,
    strokeOverprint: state.strokeOverprint,
    fillOverprint: state.fillOverprint,
    overprintMode: state.overprintMode,
    textKnockout: state.textKnockout,
    lineJoin: state.lineJoin,
    miterLimit: state.miterLimit,
    renderingIntent: state.renderingIntent,
    flatnessTolerance: state.flatnessTolerance,
    smoothnessTolerance: state.smoothnessTolerance,
    strokeAdjustment: state.strokeAdjustment
  };
}

function freezeInitialGraphicsState(
  state: DensePdfInitialGraphicsState
): DensePdfInitialGraphicsState {
  return Object.freeze({
    ...state,
    ...(state.font ? { font: Object.freeze({ ...state.font }) } : {}),
    lineDash: Object.freeze([...state.lineDash]),
    strokeColor: Object.freeze([...state.strokeColor]) as DensePdfInitialGraphicsState["strokeColor"],
    fillColor: Object.freeze([...state.fillColor]) as DensePdfInitialGraphicsState["fillColor"]
  });
}

function validateInitialGraphicsState(state: DensePdfInitialGraphicsState): void {
  if (!isOptionalFontSelection(state.font)) throw new TypeError("Initial Form font state is invalid.");
  if (!Number.isFinite(state.lineWidth) || state.lineWidth < 0) {
    throw new TypeError("Initial Form line width must be finite and non-negative.");
  }
  if (!Number.isInteger(state.lineCap) || state.lineCap < 0 || state.lineCap > 2) {
    throw new TypeError("Initial Form line cap must be 0, 1, or 2.");
  }
  if (
    !Array.isArray(state.lineDash) ||
    state.lineDash.some((value) => !Number.isFinite(value) || value < 0) ||
    !Number.isFinite(state.dashPhase)
  ) {
    throw new TypeError("Initial Form dash state is invalid.");
  }
  for (const [name, color] of [
    ["stroke", state.strokeColor],
    ["fill", state.fillColor]
  ] as const) {
    if (
      !Array.isArray(color) || color.length !== 3 ||
      color.some((value) => !Number.isFinite(value) || value < 0 || value > 1)
    ) {
      throw new TypeError(`Initial Form ${name} color is invalid.`);
    }
  }
  if (
    !Number.isFinite(state.strokeAlpha) || state.strokeAlpha < 0 || state.strokeAlpha > 1 ||
    !Number.isFinite(state.fillAlpha) || state.fillAlpha < 0 || state.fillAlpha > 1
  ) {
    throw new TypeError("Initial Form alpha state is invalid.");
  }
  if (state.blendMode !== undefined && !isDensePdfBlendMode(state.blendMode)) {
    throw new TypeError("Initial Form blend mode is invalid.");
  }
  if (state.alphaIsShape !== undefined && typeof state.alphaIsShape !== "boolean") {
    throw new TypeError("Initial Form alpha-source state is invalid.");
  }
  if (
    state.softMaskIndex !== undefined &&
    (!Number.isSafeInteger(state.softMaskIndex) || state.softMaskIndex < -1)
  ) {
    throw new TypeError("Initial Form soft-mask index is invalid.");
  }
  if (
    state.overprintMode !== undefined &&
    state.overprintMode !== 0 && state.overprintMode !== 1
  ) {
    throw new TypeError("Initial Form overprint mode is invalid.");
  }
  for (const definition of [state.strokeColorSpace, state.fillColorSpace]) {
    if (
      !definition || typeof definition.resourceName !== "string" ||
      !Number.isSafeInteger(definition.colorSpaceIndex) || definition.colorSpaceIndex < -1 ||
      typeof definition.convertToSrgb !== "function"
    ) {
      throw new TypeError("Initial Form color-space state is invalid.");
    }
  }
}

function cloneClipMaskOrNull(mask: DensePdfClipMask | null): DensePdfClipMask | null {
  if (!mask) return null;
  return {
    bounds: { ...mask.bounds },
    exclusionBounds: mask.exclusionBounds.map((bounds) => ({ ...bounds }))
  };
}

function matrixFromArgs(args: PdfValue[]): DensePdfMatrix {
  return [
    numberArg(args, 0), numberArg(args, 1), numberArg(args, 2),
    numberArg(args, 3), numberArg(args, 4), numberArg(args, 5)
  ];
}

function multiplyMatrices(a: DensePdfMatrix, b: DensePdfMatrix): DensePdfMatrix {
  return [
    a[0] * b[0] + a[2] * b[1],
    a[1] * b[0] + a[3] * b[1],
    a[0] * b[2] + a[2] * b[3],
    a[1] * b[2] + a[3] * b[3],
    a[0] * b[4] + a[2] * b[5] + a[4],
    a[1] * b[4] + a[3] * b[5] + a[5]
  ];
}

function applyMatrix(matrix: DensePdfMatrix, x: number, y: number): [number, number] {
  return [
    matrix[0] * x + matrix[2] * y + matrix[4],
    matrix[1] * x + matrix[3] * y + matrix[5]
  ];
}

function transformRectangleBounds(
  bounds: DensePdfBounds,
  matrix: DensePdfMatrix
): DensePdfBounds {
  const points = [
    applyMatrix(matrix, bounds.minX, bounds.minY),
    applyMatrix(matrix, bounds.minX, bounds.maxY),
    applyMatrix(matrix, bounds.maxX, bounds.minY),
    applyMatrix(matrix, bounds.maxX, bounds.maxY)
  ];
  return {
    minX: Math.min(...points.map(([x]) => x)),
    minY: Math.min(...points.map(([, y]) => y)),
    maxX: Math.max(...points.map(([x]) => x)),
    maxY: Math.max(...points.map(([, y]) => y))
  };
}

function matrixScale(matrix: DensePdfMatrix): number {
  const sx = Math.hypot(matrix[0], matrix[1]);
  const sy = Math.hypot(matrix[2], matrix[3]);
  const scale = (sx + sy) * 0.5;
  return Number.isFinite(scale) && scale > 0 ? scale : 1;
}

function isPackedStrokeTransformCompatible(
  matrix: DensePdfMatrix,
  lineWidth: number,
  dashed: boolean
): boolean {
  // An undashed hairline is defined in device space, so the packed segment
  // representation remains exact even when its source CTM is anisotropic.
  if (lineWidth === 0 && !dashed) return true;
  const scaleX = Math.hypot(matrix[0], matrix[1]);
  const scaleY = Math.hypot(matrix[2], matrix[3]);
  if (!(scaleX > 0) || !(scaleY > 0)) return false;
  const tolerance = Math.max(scaleX, scaleY, 1) * 1e-6;
  const dot = matrix[0] * matrix[2] + matrix[1] * matrix[3];
  return Math.abs(scaleX - scaleY) <= tolerance &&
    Math.abs(dot) <= scaleX * scaleY * 1e-6;
}

function clampInt(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clamp01(value: number): number {
  return Math.min(1, Math.max(0, value));
}

function normalizeDashPattern(values: number[]): number[] {
  if (values.length === 0) return [];
  const normalized = values.length % 2 === 0 ? values : values.concat(values);
  let patternLength = 0;
  for (const value of normalized) patternLength += value;
  return patternLength <= 1e-9 ? [] : normalized;
}

function normalizeColorTriplet(r: number, g: number, b: number): [number, number, number] {
  const output = new Uint8ClampedArray(3);
  output[0] = r * 255;
  output[1] = g * 255;
  output[2] = b * 255;
  return [output[0] / 255, output[1] / 255, output[2] / 255];
}

function normalizeGray(gray: number): [number, number, number] {
  return normalizeColorTriplet(gray, gray, gray);
}

function normalizeRgb(r: number, g: number, b: number): [number, number, number] {
  return normalizeColorTriplet(r, g, b);
}

function normalizeCmyk(c: number, m: number, y: number, k: number): [number, number, number] {
  c = clamp01(c);
  m = clamp01(m);
  y = clamp01(y);
  k = clamp01(k);
  const r = 255 + c * (-4.387332384609988 * c + 54.48615194189176 * m +
    18.82290502165302 * y + 212.25662451639585 * k - 285.2331026137004) +
    m * (1.7149763477362134 * m - 5.6096736904047315 * y -
      17.873870861415444 * k - 5.497006427196366) +
    y * (-2.5217340131683033 * y - 21.248923337353073 * k + 17.5119270841813) +
    k * (-21.86122147463605 * k - 189.48180835922747);
  const g = 255 + c * (8.841041422036149 * c + 60.118027045597366 * m +
    6.871425592049007 * y + 31.159100130055922 * k - 79.2970844816548) +
    m * (-15.310361306967817 * m + 17.575251261109482 * y +
      131.35250912493976 * k - 190.9453302588951) +
    y * (4.444339102852739 * y + 9.8632861493405 * k - 24.86741582555878) +
    k * (-20.737325471181034 * k - 187.80453709719578);
  const b = 255 + c * (0.8842522430003296 * c + 8.078677503112928 * m +
    30.89978309703729 * y - 0.23883238689178934 * k - 14.183576799673286) +
    m * (10.49593273432072 * m + 63.02378494754052 * y +
      50.606957656360734 * k - 112.23884253719248) +
    y * (0.03296041114873217 * y + 115.60384449646641 * k - 193.58209356861505) +
    k * (-22.33816807309886 * k - 180.12613974708367);
  return normalizeColorTriplet(r / 255, g / 255, b / 255);
}

function parseDeviceColorSpace(name: string, operator: string): DeviceColorSpace {
  if (name === "DeviceGray" || name === "G") return "DeviceGray";
  if (name === "DeviceRGB" || name === "RGB") return "DeviceRGB";
  if (name === "DeviceCMYK" || name === "CMYK") return "DeviceCMYK";
  throw new DensePdfUnsupportedError(
    `Color space /${name} is not a built-in device color space.`,
    operator
  );
}

function fallbackDeviceColorSpace(
  name: string,
  operator: string
): Readonly<DensePdfColorSpaceDefinition> {
  const colorSpace = parseDeviceColorSpace(name, operator);
  const componentCount = colorSpace === "DeviceGray" ? 1 : colorSpace === "DeviceRGB" ? 3 : 4;
  const initialComponents = colorSpace === "DeviceCMYK"
    ? [0, 0, 0, 1]
    : new Array<number>(componentCount).fill(0);
  return Object.freeze({
    resourceName: colorSpace,
    colorSpaceIndex: -1,
    componentCount,
    initialComponents: Object.freeze(initialComponents),
    convertToSrgb(components: readonly number[]): readonly [number, number, number] {
      if (components.length !== componentCount) {
        throw new DensePdfSyntaxError(
          `${operator} expected ${componentCount} components for ${colorSpace}.`
        );
      }
      if (colorSpace === "DeviceGray") return normalizeGray(components[0]);
      if (colorSpace === "DeviceRGB") {
        return normalizeRgb(components[0], components[1], components[2]);
      }
      return normalizeCmyk(components[0], components[1], components[2], components[3]);
    }
  });
}

function encodeStrokeStyleMeta(alpha: number, styleFlags: number): number {
  return clamp01(alpha) + Math.max(0, Math.trunc(styleFlags + 1e-6)) * STROKE_STYLE_FLAG_OFFSET;
}

function emptyBounds(): DensePdfBounds {
  return {
    minX: Number.POSITIVE_INFINITY,
    minY: Number.POSITIVE_INFINITY,
    maxX: Number.NEGATIVE_INFINITY,
    maxY: Number.NEGATIVE_INFINITY
  };
}

function includePoint(bounds: DensePdfBounds, x: number, y: number): void {
  bounds.minX = Math.min(bounds.minX, x);
  bounds.minY = Math.min(bounds.minY, y);
  bounds.maxX = Math.max(bounds.maxX, x);
  bounds.maxY = Math.max(bounds.maxY, y);
}

function isNonEmptyBounds(bounds: DensePdfBounds | null): bounds is DensePdfBounds {
  return Boolean(bounds && bounds.minX <= bounds.maxX && bounds.minY <= bounds.maxY);
}

function combineBounds(
  primary: DensePdfBounds | null,
  secondary: DensePdfBounds | null
): DensePdfBounds | null {
  if (!primary) return secondary ? { ...secondary } : null;
  if (!secondary) return { ...primary };
  return {
    minX: Math.min(primary.minX, secondary.minX),
    minY: Math.min(primary.minY, secondary.minY),
    maxX: Math.max(primary.maxX, secondary.maxX),
    maxY: Math.max(primary.maxY, secondary.maxY)
  };
}

function expandBounds(bounds: DensePdfBounds, amount: number): DensePdfBounds {
  if (!Number.isFinite(amount) || amount < 0) {
    throw new DensePdfSyntaxError("A PDF stroke produced an invalid conservative bound.");
  }
  return {
    minX: bounds.minX - amount,
    minY: bounds.minY - amount,
    maxX: bounds.maxX + amount,
    maxY: bounds.maxY + amount
  };
}

function intersectBounds(
  primary: DensePdfBounds | null,
  secondary: DensePdfBounds | null
): DensePdfBounds | null {
  if (!primary) return secondary ? { ...secondary } : null;
  if (!secondary) return { ...primary };
  const result = {
    minX: Math.max(primary.minX, secondary.minX),
    minY: Math.max(primary.minY, secondary.minY),
    maxX: Math.min(primary.maxX, secondary.maxX),
    maxY: Math.min(primary.maxY, secondary.maxY)
  };
  return result.minX <= result.maxX && result.minY <= result.maxY
    ? result
    : { minX: 1, minY: 1, maxX: 0, maxY: 0 };
}

function boundsIntersectNullable(
  primary: DensePdfBounds | null,
  secondary: DensePdfBounds | null
): boolean {
  if (!primary || !secondary) return false;
  if (!isNonEmptyBounds(primary) || !isNonEmptyBounds(secondary)) return false;
  return !(
    primary.maxX < secondary.minX || primary.minX > secondary.maxX ||
    primary.maxY < secondary.minY || primary.minY > secondary.maxY
  );
}

function computeTransformedPathBounds(
  pathData: Float32Array,
  matrix: DensePdfMatrix
): DensePdfBounds | null {
  const bounds = emptyBounds();
  let cursorX = 0;
  let cursorY = 0;
  let startX = 0;
  let startY = 0;
  let hasStart = false;
  const includeTransformed = (x: number, y: number): void => {
    includePoint(
      bounds,
      matrix[0] * x + matrix[2] * y + matrix[4],
      matrix[1] * x + matrix[3] * y + matrix[5]
    );
  };
  for (let offset = 0; offset < pathData.length;) {
    const operator = pathData[offset++];
    if (operator === DRAW_MOVE_TO) {
      cursorX = pathData[offset++];
      cursorY = pathData[offset++];
      startX = cursorX;
      startY = cursorY;
      hasStart = true;
      includeTransformed(cursorX, cursorY);
    } else if (operator === DRAW_LINE_TO) {
      includeTransformed(cursorX, cursorY);
      cursorX = pathData[offset++];
      cursorY = pathData[offset++];
      includeTransformed(cursorX, cursorY);
    } else if (operator === DRAW_CURVE_TO) {
      includeTransformed(cursorX, cursorY);
      includeTransformed(pathData[offset++], pathData[offset++]);
      includeTransformed(pathData[offset++], pathData[offset++]);
      cursorX = pathData[offset++];
      cursorY = pathData[offset++];
      includeTransformed(cursorX, cursorY);
    } else if (operator === DRAW_QUAD_TO) {
      includeTransformed(cursorX, cursorY);
      includeTransformed(pathData[offset++], pathData[offset++]);
      cursorX = pathData[offset++];
      cursorY = pathData[offset++];
      includeTransformed(cursorX, cursorY);
    } else if (operator === DRAW_CLOSE) {
      if (hasStart) {
        includeTransformed(cursorX, cursorY);
        includeTransformed(startX, startY);
        cursorX = startX;
        cursorY = startY;
      }
    } else {
      throw new DensePdfSyntaxError(`Invalid path opcode ${operator}.`);
    }
  }
  return isNonEmptyBounds(bounds) ? bounds : null;
}

function applyClipToState(
  state: GraphicsState,
  pathBounds: DensePdfBounds | null,
  pathMask: DensePdfClipMask | null,
  clipRule: number,
  pathIsExactRectangle: boolean
): void {
  state.clipIsDefault = false;
  state.clipIsExactRectangle = state.clipIsExactRectangle && pathIsExactRectangle;
  const nextClipBounds = intersectBounds(state.clipBounds, pathBounds);
  state.clipBounds = nextClipBounds;
  state.clipMask = combineClipMasks(
    state.clipMask,
    clipRule === FILL_RULE_EVEN_ODD ? pathMask : null,
    nextClipBounds
  );
}

function isSingleAxisAlignedRectangle(
  pathData: Float32Array,
  pathBounds: DensePdfBounds | null,
  matrix: DensePdfMatrix
): boolean {
  return pathBounds !== null && isAxisAlignedRectangleSubpath(
    pathData,
    { start: 0, end: pathData.length, bounds: pathBounds },
    matrix
  );
}

function combineClipMasks(
  currentMask: DensePdfClipMask | null,
  nextMask: DensePdfClipMask | null,
  clipBounds: DensePdfBounds | null
): DensePdfClipMask | null {
  if (!isNonEmptyBounds(clipBounds)) return null;

  const exclusionBounds: DensePdfBounds[] = [];
  const addExclusion = (bounds: DensePdfBounds): void => {
    const clipped = intersectBounds(clipBounds, bounds);
    if (
      !isNonEmptyBounds(clipped) ||
      denseBoundsArea(clipped) <= 1e-6 ||
      denseBoundsNearlyEqual(clipped, clipBounds)
    ) return;
    exclusionBounds.push(clipped);
  };

  for (const bounds of currentMask?.exclusionBounds ?? []) addExclusion(bounds);
  for (const bounds of nextMask?.exclusionBounds ?? []) addExclusion(bounds);
  if (exclusionBounds.length === 0) return null;
  return { bounds: { ...clipBounds }, exclusionBounds };
}

function createClipConstrainedFillPath(
  pathData: Float32Array,
  matrix: DensePdfMatrix,
  localBounds: DensePdfBounds,
  visibleBounds: DensePdfBounds,
  clipMask: DensePdfClipMask | null
): Float32Array | null {
  if (!clipMask || clipMask.exclusionBounds.length === 0) return null;
  if (!denseBoundsNearlyEqual(visibleBounds, clipMask.bounds)) return null;
  if (!denseBoundsContainBoundsWithTolerance(localBounds, clipMask.bounds)) return null;
  if (!isAxisAlignedRectangleSubpath(
    pathData,
    { start: 0, end: pathData.length, bounds: localBounds },
    matrix
  )) return null;

  const exclusionBounds = clipMask.exclusionBounds.filter((bounds) => (
    denseBoundsContainBoundsWithTolerance(visibleBounds, bounds) &&
    denseBoundsArea(bounds) > 1e-6
  ));
  if (exclusionBounds.length === 0) return null;
  return createEvenOddRectanglePath(visibleBounds, exclusionBounds);
}

function createEvenOddRectanglePath(
  outerBounds: DensePdfBounds,
  exclusionBounds: DensePdfBounds[]
): Float32Array {
  const commands: number[] = [];
  appendRectanglePath(commands, outerBounds);
  for (const bounds of exclusionBounds) appendRectanglePath(commands, bounds);
  return new Float32Array(commands);
}

function appendRectanglePath(commands: number[], bounds: DensePdfBounds): void {
  commands.push(
    DRAW_MOVE_TO,
    bounds.minX,
    bounds.minY,
    DRAW_LINE_TO,
    bounds.maxX,
    bounds.minY,
    DRAW_LINE_TO,
    bounds.maxX,
    bounds.maxY,
    DRAW_LINE_TO,
    bounds.minX,
    bounds.maxY,
    DRAW_CLOSE
  );
}

interface RectangleClipSubpath {
  start: number;
  end: number;
  bounds: DensePdfBounds | null;
}

/**
 * Preserve rectangular exclusions for the compact unordered clip path. Other
 * even-odd paths use their transformed bounds in that representation.
 */
function extractSimpleEvenOddRectangleClipMask(
  pathData: Float32Array,
  matrix: DensePdfMatrix
): DensePdfClipMask | null {
  const subpaths: RectangleClipSubpath[] = [];
  let subpathStart = -1;

  const pushSubpath = (end: number): void => {
    if (subpathStart < 0 || end <= subpathStart) return;
    const data = pathData.subarray(subpathStart, end);
    const bounds = computeTransformedPathBounds(data, matrix);
    subpaths.push({ start: subpathStart, end, bounds });
  };

  for (let offset = 0; offset < pathData.length;) {
    const operatorOffset = offset;
    const operator = pathData[offset++];
    if (operator === DRAW_MOVE_TO) {
      pushSubpath(operatorOffset);
      subpathStart = operatorOffset;
      offset += 2;
    } else if (operator === DRAW_LINE_TO) offset += 2;
    else if (operator === DRAW_CURVE_TO) offset += 6;
    else if (operator === DRAW_QUAD_TO) offset += 4;
    else if (operator !== DRAW_CLOSE) return null;
  }
  pushSubpath(pathData.length);

  if (subpaths.length < 2) return null;
  const rectangleSubpaths: Array<RectangleClipSubpath & { bounds: DensePdfBounds }> = [];
  for (const subpath of subpaths) {
    const bounds = subpath.bounds;
    if (!isNonEmptyBounds(bounds)) return null;
    const rectangleSubpath = { ...subpath, bounds };
    if (!isAxisAlignedRectangleSubpath(pathData, rectangleSubpath, matrix)) return null;
    rectangleSubpaths.push(rectangleSubpath);
  }

  rectangleSubpaths.sort((a, b) => denseBoundsArea(b.bounds) - denseBoundsArea(a.bounds));
  const outerBounds = rectangleSubpaths[0].bounds;
  const exclusionBounds: DensePdfBounds[] = [];
  for (let index = 1; index < rectangleSubpaths.length; index += 1) {
    const bounds = rectangleSubpaths[index].bounds;
    if (
      denseBoundsArea(bounds) > 1e-6 &&
      denseBoundsContainBoundsWithTolerance(outerBounds, bounds)
    ) {
      exclusionBounds.push({ ...bounds });
    }
  }
  if (exclusionBounds.length === 0) return null;
  return { bounds: { ...outerBounds }, exclusionBounds };
}

function isAxisAlignedRectangleSubpath(
  pathData: Float32Array,
  subpath: RectangleClipSubpath & { bounds: DensePdfBounds },
  matrix: DensePdfMatrix
): boolean {
  const { bounds } = subpath;
  const width = Math.max(0, bounds.maxX - bounds.minX);
  const height = Math.max(0, bounds.maxY - bounds.minY);
  if (width <= 1e-6 || height <= 1e-6) return false;

  const epsilon = Math.max(1e-3, Math.max(width, height) * 1e-4);
  let cornerMask = 0;
  let moveCount = 0;
  let lineCount = 0;

  const recordPoint = (x: number, y: number): boolean => {
    const transformedX = matrix[0] * x + matrix[2] * y + matrix[4];
    const transformedY = matrix[1] * x + matrix[3] * y + matrix[5];
    const nearMinX = Math.abs(transformedX - bounds.minX) <= epsilon;
    const nearMaxX = Math.abs(transformedX - bounds.maxX) <= epsilon;
    const nearMinY = Math.abs(transformedY - bounds.minY) <= epsilon;
    const nearMaxY = Math.abs(transformedY - bounds.maxY) <= epsilon;
    if (nearMinX && nearMinY) cornerMask |= 1;
    else if (nearMaxX && nearMinY) cornerMask |= 2;
    else if (nearMaxX && nearMaxY) cornerMask |= 4;
    else if (nearMinX && nearMaxY) cornerMask |= 8;
    else return false;
    return true;
  };

  for (let offset = subpath.start; offset < subpath.end;) {
    const operator = pathData[offset++];
    if (operator === DRAW_MOVE_TO) {
      moveCount += 1;
      if (!recordPoint(pathData[offset++], pathData[offset++])) return false;
    } else if (operator === DRAW_LINE_TO) {
      lineCount += 1;
      if (!recordPoint(pathData[offset++], pathData[offset++])) return false;
    } else if (operator === DRAW_CLOSE) {
      continue;
    } else {
      return false;
    }
  }
  return moveCount === 1 && lineCount >= 3 && lineCount <= 4 && cornerMask === 15;
}

function denseBoundsContainBoundsWithTolerance(
  outer: DensePdfBounds,
  inner: DensePdfBounds
): boolean {
  const epsilon = denseBoundsComparisonTolerance(outer, inner);
  return (
    inner.minX >= outer.minX - epsilon &&
    inner.minY >= outer.minY - epsilon &&
    inner.maxX <= outer.maxX + epsilon &&
    inner.maxY <= outer.maxY + epsilon
  );
}

function denseBoundsNearlyEqual(a: DensePdfBounds, b: DensePdfBounds): boolean {
  const epsilon = denseBoundsComparisonTolerance(a, b);
  return (
    Math.abs(a.minX - b.minX) <= epsilon &&
    Math.abs(a.minY - b.minY) <= epsilon &&
    Math.abs(a.maxX - b.maxX) <= epsilon &&
    Math.abs(a.maxY - b.maxY) <= epsilon
  );
}

function denseBoundsComparisonTolerance(a: DensePdfBounds, b: DensePdfBounds): number {
  const width = Math.max(Math.abs(a.maxX - a.minX), Math.abs(b.maxX - b.minX));
  const height = Math.max(Math.abs(a.maxY - a.minY), Math.abs(b.maxY - b.minY));
  return Math.max(1e-3, Math.max(width, height) * 1e-5);
}

function denseBoundsAreProvablyDisjoint(a: DensePdfBounds, b: DensePdfBounds): boolean {
  const margin = denseBoundsComparisonTolerance(a, b);
  return a.maxX + margin < b.minX - margin || b.maxX + margin < a.minX - margin ||
    a.maxY + margin < b.minY - margin || b.maxY + margin < a.minY - margin;
}

function denseBoundsArea(bounds: DensePdfBounds): number {
  return Math.max(0, bounds.maxX - bounds.minX) * Math.max(0, bounds.maxY - bounds.minY);
}

function quantize(value: number, scale: number): number {
  const result = Math.round(value * scale);
  // String-based keys in the established culler canonicalize -0 to "0".
  // Normalize it before hashing the IEEE representation so equal keys always
  // have equal hashes as well.
  return result === 0 ? 0 : result;
}

function fillDuplicateTuple(
  tuple: Float64Array,
  x0: number,
  y0: number,
  cx: number,
  cy: number,
  x1: number,
  y1: number,
  primitiveType: number,
  halfWidth: number,
  colorR: number,
  colorG: number,
  colorB: number,
  alpha: number,
  styleFlags: number,
  clipMinX: number,
  clipMinY: number,
  clipMaxX: number,
  clipMaxY: number
): void {
  const isQuadratic = primitiveType >= STROKE_PRIMITIVE_QUADRATIC - 0.5;
  let ax = x0;
  let ay = y0;
  let bx = x1;
  let by = y1;
  let qcx = cx;
  let qcy = cy;
  if (!isQuadratic && (ax > bx || (ax === bx && ay > by))) {
    ax = x1;
    ay = y1;
    bx = x0;
    by = y0;
  }
  if (!isQuadratic) {
    qcx = bx;
    qcy = by;
  }
  tuple[0] = quantize(primitiveType, 10);
  tuple[1] = quantize(halfWidth, DUPLICATE_STYLE_SCALE);
  tuple[2] = quantize(colorR, DUPLICATE_STYLE_SCALE);
  tuple[3] = quantize(colorG, DUPLICATE_STYLE_SCALE);
  tuple[4] = quantize(colorB, DUPLICATE_STYLE_SCALE);
  tuple[5] = quantize(alpha, DUPLICATE_STYLE_SCALE);
  tuple[6] = quantize(styleFlags, 1);
  tuple[7] = quantize(ax, DUPLICATE_POSITION_SCALE);
  tuple[8] = quantize(ay, DUPLICATE_POSITION_SCALE);
  tuple[9] = quantize(qcx, DUPLICATE_POSITION_SCALE);
  tuple[10] = quantize(qcy, DUPLICATE_POSITION_SCALE);
  tuple[11] = quantize(bx, DUPLICATE_POSITION_SCALE);
  tuple[12] = quantize(by, DUPLICATE_POSITION_SCALE);
  const clipped = (styleFlags & DENSE_PDF_STROKE_STYLE_FLAG_CLIPPED) !== 0;
  tuple[13] = clipped ? Math.fround(clipMinX) : 0;
  tuple[14] = clipped ? Math.fround(clipMinY) : 0;
  tuple[15] = clipped ? Math.fround(clipMaxX) : 0;
  tuple[16] = clipped ? Math.fround(clipMaxY) : 0;
}

/**
 * Hash quantized key components as 32-bit integers. Equal keys hash equally,
 * which is all the indexes need; their equality callbacks decide matches.
 */
function hashQuantizedTuple(tuple: Float64Array, length: number): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < length; index += 1) {
    hash = Math.imul(hash ^ (tuple[index] | 0), 0x01000193);
  }
  hash ^= hash >>> 16;
  hash = Math.imul(hash, 0x85ebca6b);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 0xc2b2ae35);
  hash ^= hash >>> 16;
  hash >>>= 0;
  return hash === 0 ? 1 : hash;
}

function crossDistanceSq(px: number, py: number, ux: number, uy: number, lenSq: number): number {
  const cross = px * uy - py * ux;
  return (cross * cross) / lenSq;
}

function flattenCubic(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number,
  emitLine: (ax: number, ay: number, bx: number, by: number) => void,
  flatness: number,
  maxDepth: number
): void {
  const stack: number[] = [x0, y0, x1, y1, x2, y2, x3, y3, 0];
  const flatnessSq = flatness * flatness;
  while (stack.length > 0) {
    const depth = stack.pop() as number;
    const q3y = stack.pop() as number;
    const q3x = stack.pop() as number;
    const q2y = stack.pop() as number;
    const q2x = stack.pop() as number;
    const q1y = stack.pop() as number;
    const q1x = stack.pop() as number;
    const q0y = stack.pop() as number;
    const q0x = stack.pop() as number;
    if (depth >= maxDepth || cubicFlatnessSq(
      q0x, q0y, q1x, q1y, q2x, q2y, q3x, q3y
    ) <= flatnessSq) {
      emitLine(q0x, q0y, q3x, q3y);
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
    const x0123 = (x012 + x123) * 0.5;
    const y0123 = (y012 + y123) * 0.5;
    const nextDepth = depth + 1;
    stack.push(x0123, y0123, x123, y123, x23, y23, q3x, q3y, nextDepth);
    stack.push(q0x, q0y, x01, y01, x012, y012, x0123, y0123, nextDepth);
  }
}

function cubicFlatnessSq(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number
): number {
  const ux = x3 - x0;
  const uy = y3 - y0;
  const lengthSq = ux * ux + uy * uy;
  if (lengthSq < 1e-12) return 0;
  return Math.max(
    crossDistanceSq(x1 - x0, y1 - y0, ux, uy, lengthSq),
    crossDistanceSq(x2 - x0, y2 - y0, ux, uy, lengthSq)
  );
}

function emitCubicAsQuadratics(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number,
  emitQuadratic: (sx: number, sy: number, cx: number, cy: number, ex: number, ey: number) => void,
  maxError: number,
  maxDepth: number
): void {
  const stack: number[] = [x0, y0, x1, y1, x2, y2, x3, y3, 0];
  const maxErrorSq = maxError * maxError;
  while (stack.length > 0) {
    const depth = stack.pop() as number;
    const q3y = stack.pop() as number;
    const q3x = stack.pop() as number;
    const q2y = stack.pop() as number;
    const q2x = stack.pop() as number;
    const q1y = stack.pop() as number;
    const q1x = stack.pop() as number;
    const q0y = stack.pop() as number;
    const q0x = stack.pop() as number;
    const controlX = (3 * (q1x + q2x) - q0x - q3x) * 0.25;
    const controlY = (3 * (q1y + q2y) - q0y - q3y) * 0.25;
    if (depth >= maxDepth || cubicQuadraticApproxErrorSq(
      q0x, q0y, q1x, q1y, q2x, q2y, q3x, q3y, controlX, controlY
    ) <= maxErrorSq) {
      emitQuadratic(q0x, q0y, controlX, controlY, q3x, q3y);
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
    const x0123 = (x012 + x123) * 0.5;
    const y0123 = (y012 + y123) * 0.5;
    const nextDepth = depth + 1;
    stack.push(x0123, y0123, x123, y123, x23, y23, q3x, q3y, nextDepth);
    stack.push(q0x, q0y, x01, y01, x012, y012, x0123, y0123, nextDepth);
  }
}

function cubicQuadraticApproxErrorSq(
  x0: number, y0: number, x1: number, y1: number,
  x2: number, y2: number, x3: number, y3: number,
  cx: number, cy: number
): number {
  let maxSq = 0;
  for (const t of [0.25, 0.5, 0.75]) {
    const oneMinus = 1 - t;
    const oneMinusSq = oneMinus * oneMinus;
    const tSq = t * t;
    const cubicX = oneMinusSq * oneMinus * x0 + 3 * oneMinusSq * t * x1 +
      3 * oneMinus * tSq * x2 + tSq * t * x3;
    const cubicY = oneMinusSq * oneMinus * y0 + 3 * oneMinusSq * t * y1 +
      3 * oneMinus * tSq * y2 + tSq * t * y3;
    const quadX = oneMinusSq * x0 + 2 * oneMinus * t * cx + tSq * x3;
    const quadY = oneMinusSq * y0 + 2 * oneMinus * t * cy + tSq * y3;
    const dx = cubicX - quadX;
    const dy = cubicY - quadY;
    maxSq = Math.max(maxSq, dx * dx + dy * dy);
  }
  return maxSq;
}
