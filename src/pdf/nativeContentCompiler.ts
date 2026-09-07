/**
 * Allocation-conscious native compiler for PDF page content streams.
 *
 * The caller is responsible for resolving and decoding page content streams.
 * The compiler grows by resource-aware handlers while retaining this streaming,
 * allocation-conscious core. Unsupported visible content throws a typed error;
 * callers must not omit it or replace the page with a parser-generated raster.
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

/** Rendering behavior for one native-registry `/ExtGState` resource. */
export interface DensePdfExtGStateDefinition {
  resourceName: string;
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
  applyOperator(
    operator: string,
    operands: readonly unknown[],
    context: Readonly<DensePdfTextOperatorContext>
  ): void | readonly DensePdfTextPaintRun[];
}

/** Static marked/optional-content state at one source operator. */
export interface DensePdfTextOperatorContext {
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
  /** PatternType 2 `/ExtGState`; merged at the exact source paint position. */
  readonly hasExtGState: boolean;
  readonly extGState?: Readonly<DensePdfExtGStateDefinition>;
}

export type DensePdfColorSpaceResolver = (
  resourceName: string
) => Readonly<DensePdfColorSpaceDefinition> | undefined;

/** Supported graphics state inherited by a specialized Form invocation. */
export interface DensePdfInitialGraphicsState {
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
export interface DensePdfMarkedContentPropertyDefinition {
  readonly resourceName: string;
  readonly optionalContentIndex: number;
  readonly defaultVisible: boolean;
  readonly mcid: number;
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
  /** Pre-resolved `/Pattern` and `[/Pattern base]` color spaces. */
  patternColorSpaces?: ReadonlyMap<string, Readonly<DensePdfPatternColorSpaceDefinition>>;
  /** Page-local HEPR pattern indexes keyed by `/Pattern` resource name. */
  patterns?: ReadonlyMap<string, Readonly<DensePdfPatternDefinition>>;
  /** Pre-resolved page `/ColorSpace` resources plus DefaultGray/RGB/CMYK handling. */
  colorSpaceResolver?: DensePdfColorSpaceResolver;
  enableSegmentMerge?: boolean;
  enableInvisibleCull?: boolean;
  /**
   * Retain source paint ordering as compact `[kind, start, count]` runs.
   *
   * When enabled, the final containment compaction pass is skipped because it
   * changes primitive indexes after commands have been recorded. Streaming
   * transparent/degenerate/duplicate rejection remains available and is
   * reflected in each recorded range.
   */
  preservePaintOrder?: boolean;
  /**
   * Retain only the text/image side data needed to adapt the optimized,
   * unordered packed stores to the legacy grouped VectorScene ABI.
   *
   * This is an internal migration bridge. It is mutually exclusive with
   * `preservePaintOrder`; unsupported source-order or compositing semantics
   * fail instead of being omitted from the bridge output.
   * @internal
   */
  legacyVectorOutput?: boolean;
  /** Retain composite root Form events for the selective-raster migration bridge. @internal */
  legacyAllowCompositeForms?: boolean;
  /** Retain aggregate checkpoints for path-only spans overlapped by a late image. @internal */
  legacySelectiveImageSpans?: boolean;
  /** Capture non-axis-aligned clipped root images in the ordered raster bridge. @internal */
  legacySelectiveClippedImages?: boolean;
  /** Capture root shadings through the ordered raster migration bridge. @internal */
  legacySelectiveShadings?: boolean;
  /** Capture root path paints that the packed legacy ABI cannot represent exactly. @internal */
  legacySelectivePaths?: boolean;
  /** Capture visible text under an arbitrary clip while retaining its text index. @internal */
  legacySelectiveTextClips?: boolean;
  /** Match the PDF.js oracle, which ignores OP/op/OPM in static rendering. @internal */
  legacyIgnoreOverprint?: boolean;
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
  /** Compact side data for the internal grouped-VectorScene bridge. @internal */
  legacyVector?: DensePdfLegacyVectorOutput;
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

/** A legacy-vector image invocation used a non-default PDF clip. @internal */
export const DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_CLIPPED = 1 << 0;

/**
 * An image followed visible text in source order, but no visible path paint.
 * The legacy adapter must prove that every preceding glyph is spatially
 * disjoint before it may move this image into the raster-underlay pass.
 * @internal
 */
export const DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_LATE_AFTER_TEXT = 1 << 1;

/** Preceding visible paths were conservatively proven disjoint at compile time. @internal */
export const DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_LATE_AFTER_PATH = 1 << 2;
/** A preceding contiguous path-only span must be captured with this image. @internal */
export const DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_SELECTIVE_PATH_SPAN = 1 << 3;

/** A glyph run was emitted under a non-default clip. @internal */
export const DENSE_PDF_LEGACY_VECTOR_GLYPH_FLAG_CLIPPED = 1 << 0;
/** Painted text routed to an image layer, not invisible/OCR text. @internal */
export const DENSE_PDF_LEGACY_VECTOR_GLYPH_FLAG_COMPOSITED = 1 << 1;

/** Source-event kind used by `DensePdfLegacyVectorOutput.sourceEvents`. @internal */
export const DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH = 0;

/** Source-event kind used by `DensePdfLegacyVectorOutput.sourceEvents`. @internal */
export const DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE = 1;

/** Source-event kind used by `DensePdfLegacyVectorOutput.sourceEvents`. @internal */
export const DENSE_PDF_LEGACY_VECTOR_EVENT_FORM = 2;

/** Source-event kind used by `DensePdfLegacyVectorOutput.sourceEvents`. @internal */
export const DENSE_PDF_LEGACY_VECTOR_EVENT_ORDINARY_PAINT = 3;

/**
 * Compact text/image sidecar for the internal grouped-VectorScene bridge.
 * Packed fill and stroke geometry remains in `DensePdfCompiledPage` itself.
 * @internal
 */
export interface DensePdfLegacyVectorOutput {
  /**
   * Source-ordered kind/index pairs for glyph runs, image invocations, Form
   * invocations, and the first ordinary-paint barrier. Kind-local indexes
   * address the corresponding sidecar array (or `formPaints`); the barrier's
   * index is always zero.
   */
  readonly sourceEvents: Uint32Array;
  /** Glyph triples: page glyph start, glyph count, and PDF rendering mode. */
  readonly glyphRunMeta: Uint32Array;
  /** One sRGB nonstroking RGBA tuple per glyph triple. */
  readonly glyphFillColors: Float32Array;
  /** Four exact page-space clip bounds per glyph run. */
  readonly glyphClipBounds?: Float32Array;
  /** Per-run DENSE_PDF_LEGACY_VECTOR_GLYPH_FLAG_* bits. */
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
  /** Bit field per image invocation; see DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_*. */
  readonly imageFlags: Uint8Array;
  /** Six values per image: fill start/end, stroke start/end, span/image paint ordinals. */
  readonly imagePathSpanCheckpoints?: Uint32Array;
  /** Four values per image: first-path offset/length and image offset/length. */
  readonly imagePathSourceSpans?: Float64Array;
  /** Start/end paint ordinals for non-packed selective commands such as root shadings. */
  readonly selectivePaintOrdinalSpans?: Uint32Array;
  /** Source offset/length pairs for individually captured root paint operators. */
  readonly selectivePaintSourceSpans?: Float64Array;
}

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
  readonly renderingMode: number;
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
  return TEXT_SINK_OPERATORS.has(operator);
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

/** Compile already-decoded page content into native HEPR stores and source-ordered commands. */
export async function compileDensePdfContent(
  source: DensePdfContentSource | DensePdfPreparedContentSource,
  options: DensePdfContentCompileOptions
): Promise<DensePdfCompiledPage> {
  assertFiniteMatrix(options.pageMatrix);
  assertValidBounds(options.pageBounds, "pageBounds");
  options.signal?.throwIfAborted();

  const compiler = new DenseContentCompiler(options);
  const lexer = new IncrementalPdfLexer((token) => compiler.consumeToken(token));
  const yieldIntervalMs = Math.max(4, options.yieldIntervalMs ?? DEFAULT_YIELD_INTERVAL_MS);
  let processedBytes = 0;
  let lastYieldAt = nowMs();

  for await (const segment of normalizeContentSegments(source)) {
    if (segment.kind === "image") {
      // BI…EI is structurally prepared before resource resolution. Flush the
      // lexical boundary without finalizing the long-lived graphics parser,
      // then interleave one paint event at the exact source position.
      lexer.finish();
      compiler.consumeInlineImage(segment);
      processedBytes += segment.sourceLength;
      continue;
    }
    const inputChunk = segment.bytes;
    for (let offset = 0; offset < inputChunk.length; offset += MAX_INPUT_SLICE_BYTES) {
      options.signal?.throwIfAborted();
      const slice = inputChunk.subarray(
        offset,
        Math.min(inputChunk.length, offset + MAX_INPUT_SLICE_BYTES)
      );
      lexer.feed(slice, false, segment.sourceOffset + offset);
      processedBytes += slice.length;

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
  }

  lexer.finish();
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
  const scanner = new DensePdfResourceReferenceScanner();
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
  options: DensePdfContentCompileOptions
): ReadonlyMap<string, DensePdfExtGStateDefinition> {
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
    if (
      !definition ||
      typeof definition.resourceName !== "string" ||
      definition.resourceName.length === 0 ||
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
    definitions.set(definition.resourceName, { ...definition });
  }
  return definitions;
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
      !Number.isSafeInteger(definition.mcid) || definition.mcid < -1
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

function isDensePdfBlendMode(value: string): value is DensePdfBlendMode {
  return value === "Normal" || value === "Multiply" || value === "Screen" ||
    value === "Overlay" || value === "Darken" || value === "Lighten" ||
    value === "ColorDodge" || value === "ColorBurn" || value === "HardLight" ||
    value === "SoftLight" || value === "Difference" || value === "Exclusion" ||
    value === "Hue" || value === "Saturation" || value === "Color" ||
    value === "Luminosity";
}

class DenseContentCompiler {
  readonly options: DensePdfContentCompileOptions;

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

  readonly operands: PdfValue[] = [];

  readonly containers: ParserContainer[] = [];

  readonly stateStack: GraphicsState[] = [];

  readonly extGStates: ReadonlyMap<string, DensePdfExtGStateDefinition>;

  readonly alwaysVisibleOptionalContentProperties: ReadonlySet<string>;

  readonly markedContentProperties: ReadonlyMap<string, Readonly<DensePdfMarkedContentPropertyDefinition>> | undefined;

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

  readonly legacyGlyphRunMeta: number[] = [];

  readonly legacyGlyphFillColors: number[] = [];

  readonly legacyGlyphClipBounds: number[] = [];

  readonly legacyGlyphRunFlags: number[] = [];
  readonly legacyGlyphClipIndices: number[] = [];

  readonly legacyImageIndices: number[] = [];

  readonly legacyImageTransforms: number[] = [];

  readonly legacyImageClipBounds: number[] = [];

  readonly legacyImagePaintOrders: number[] = [];

  readonly legacyFormPaintOrders: number[] = [];

  readonly legacyImageFlags: number[] = [];

  readonly legacyImagePathSpanCheckpoints: number[] = [];

  readonly legacyImagePathSourceSpans: number[] = [];

  readonly legacySelectivePaintOrdinalSpans: number[] = [];

  readonly legacySelectivePaintSourceSpans: number[] = [];

  readonly legacySourceEvents: number[] = [];

  private legacyPathSpanStartFillCount = 0;

  private legacyPathSpanStartStrokeCount = 0;

  private legacyPathSpanStartOrdinal = 0;

  private legacyPathSpanEligible = true;

  private legacyPathSpanHasPaint = false;

  private legacyPathSpanSourceOffset = -1;

  private legacyPathSpanSourceLength = -1;

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

  private legacyPaintOrdinal = 0;

  private legacySawOrdinaryPaint = false;

  private legacySawVisibleText = false;

  /** Visible path paint cannot be reordered behind a later image by the grouped ABI. */
  private legacySawPathPaint = false;

  private legacyRecordedOrdinaryPaintBarrier = false;

  private finished = false;

  pathCount = 0;

  fillPathCount = 0;

  textShowOpCount = 0;

  operatorCount = 0;

  constructor(options: DensePdfContentCompileOptions) {
    this.options = options;
    if (options.legacyVectorOutput === true && options.preservePaintOrder === true) {
      throw new TypeError(
        "legacyVectorOutput and preservePaintOrder are mutually exclusive compiler modes."
      );
    }
    this.extGStates = normalizeExtGStateDefinitions(options);
    this.alwaysVisibleOptionalContentProperties = new Set(
      options.alwaysVisibleOptionalContentProperties ?? []
    );
    this.markedContentProperties = options.markedContentProperties;
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
      options.preservePaintOrder === true
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

  consumeToken(token: LexerToken): void {
    if (this.finished) {
      throw new DensePdfSyntaxError("Content appeared after the compiler was finalized.");
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

    this.operatorSourceOffset = token.sourceOffset;
    this.operatorSourceLength = token.sourceLength;
    try {
      this.executeOperator(token.value, this.operands);
      this.operatorCount += 1;
      this.operands.length = 0;
    } finally {
      this.operatorSourceOffset = -1;
      this.operatorSourceLength = -1;
    }
  }

  consumeInlineImage(segment: Readonly<DensePdfInlineImageSegment>): void {
    if (this.finished) {
      throw new DensePdfSyntaxError("Inline image appeared after the compiler was finalized.");
    }
    validateContentSegment(segment);
    if (this.containers.length > 0 || this.operands.length > 0) {
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
    if (this.operands.length > 0) {
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

    const strokeResult = await this.strokes.finalize(checkpoint);
    const fillPathMetaA = this.fillPathMetaA.toTypedArray();
    const fillPathMetaB = this.fillPathMetaB.toTypedArray();
    const fillPathMetaC = this.fillPathMetaC.toTypedArray();
    const fillSegmentsA = this.fillSegmentsA.toTypedArray();
    const fillSegmentsB = this.fillSegmentsB.toTypedArray();
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
    if (this.options.legacyVectorOutput && this.options.legacySelectiveTextClips) {
      for (const clip of this.clipPaths) {
        textClips.push(Object.freeze({
          parent: textClips[clip.parentIndex] ?? null,
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
      ...(this.options.legacyVectorOutput === true ? {
        legacyVector: {
          sourceEvents: Uint32Array.from(this.legacySourceEvents),
          glyphRunMeta: Uint32Array.from(this.legacyGlyphRunMeta),
          glyphFillColors: Float32Array.from(this.legacyGlyphFillColors),
          glyphClipBounds: Float32Array.from(this.legacyGlyphClipBounds),
          glyphRunFlags: Uint8Array.from(this.legacyGlyphRunFlags),
          ...(textClips.length === 0 ? {} : {
            glyphRunClips: Object.freeze(this.legacyGlyphClipIndices.map(index => textClips[index] ?? null))
          }),
          imageIndices: Uint32Array.from(this.legacyImageIndices),
          imageTransforms: Float32Array.from(this.legacyImageTransforms),
          imageClipBounds: Float32Array.from(this.legacyImageClipBounds),
          imagePaintOrders: Uint32Array.from(this.legacyImagePaintOrders),
          formPaintOrders: Uint32Array.from(this.legacyFormPaintOrders),
          imageFlags: Uint8Array.from(this.legacyImageFlags),
          imagePathSpanCheckpoints: Uint32Array.from(this.legacyImagePathSpanCheckpoints),
          imagePathSourceSpans: Float64Array.from(this.legacyImagePathSourceSpans),
          selectivePaintOrdinalSpans: Uint32Array.from(this.legacySelectivePaintOrdinalSpans),
          selectivePaintSourceSpans: Float64Array.from(this.legacySelectivePaintSourceSpans)
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
          renderingMode: paint.renderingMode,
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
        this.formPaints.map((paint) => Object.freeze({
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
    if (
      (this.options.type3PaintMode === "uncolored" ||
        this.options.uncoloredPatternPaint === true) &&
      TYPE3_UNCOLORED_FORBIDDEN_OPERATORS.has(operator)
    ) {
      throw new DensePdfUnsupportedError(
        `Uncolored ${this.options.uncoloredPatternPaint === true
          ? "tiling-pattern cell"
          : "Type3 CharProc"} content cannot use color operator ${operator}.`,
        operator
      );
    }
    if (this.options.type3PaintMode !== undefined) {
      if (TYPE3_STROKE_COLOR_OPERATORS.has(operator)) this.state.strokePaintInherited = false;
      if (TYPE3_FILL_COLOR_OPERATORS.has(operator)) this.state.fillPaintInherited = false;
    }
    if (this.options.textOperatorSink && isTextSinkOperator(operator)) {
      const glyphRuns = this.options.textOperatorSink.applyOperator(
        operator,
        args.map(toTextSinkOperand),
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
        this.path.closePath(this.options.preservePaintOrder === true);
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
          if (this.options.preservePaintOrder && lineWidth < 0) {
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
          this.options.preservePaintOrder && dash.length > 0 &&
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
            `Graphics state /${resourceName} was not validated for the dense-vector path.`,
            operator
          );
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
          if (stroke) this.state.strokePattern = definition;
          else this.state.fillPattern = definition;
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
          if (association?.defaultVisible === false) {
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
              association?.optionalContentIndex ?? this.activeOptionalContentIndex,
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
          if (this.contentVisible && association?.defaultVisible !== false) {
            this.recordFormPaint(
              formDefinitionIndex,
              association?.optionalContentIndex ?? this.activeOptionalContentIndex
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
        if (this.options.preservePaintOrder !== true &&
            !(this.options.legacyVectorOutput === true &&
              this.options.legacySelectiveShadings === true)) {
          throw new DensePdfUnsupportedError(
            "The sh operator requires source-ordered display-program compilation.",
            operator
          );
        }
        this.referencedShadings.add(resourceName);
        if (this.contentVisible && this.state.clipBounds) {
          if (this.options.legacyVectorOutput === true) {
            this.assertLegacyVectorComposite("nonstroke", operator);
            const ordinal = this.nextLegacyPaintOrdinal(operator);
            this.legacySelectivePaintSourceSpans.push(
              this.operatorSourceOffset,
              this.operatorSourceLength
            );
            this.legacySelectivePaintOrdinalSpans.push(ordinal, ordinal);
            this.legacyPathSpanStartFillCount = this.fillPathCount;
            this.legacyPathSpanStartStrokeCount = this.strokes.primitiveCount;
            this.legacyPathSpanStartOrdinal = ordinal + 1;
            this.legacyPathSpanEligible = true;
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
            }
            mcid = definition.mcid;
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
        }
        if (
          tag === "OC" && optionalContentIndex < 0 &&
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
        return;
      }
      case "EMC":
        this.requireArgs(operator, args, 0);
        if (!this.markedContentStack.pop()) {
          throw new DensePdfSyntaxError("EMC has no matching BMC or BDC scope.");
        }
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
        if (isPdfName(property)) {
          this.referencedProperties.add(property.value);
          const definition = this.resolveMarkedContentProperty(
            property.value,
            operator
          );
          optionalContentIndex = tag === "OC"
            ? definition?.optionalContentIndex ?? -1
            : -1;
        } else if (!isPdfDictionary(property)) {
          throw new DensePdfSyntaxError("DP property operand must be a name or dictionary.");
        } else if (dictionaryContainsOptionalContent(property)) {
          throw new DensePdfUnsupportedError(
            "Inline optional-content property dictionaries cannot be resolved synchronously.",
            operator
          );
        }
        if (
          tag === "OC" && optionalContentIndex < 0 &&
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
          `PDF content operator ${operator} is not supported by the dense-vector path.`,
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
      this.path.closePath(this.options.preservePaintOrder === true);
      this.assertCurrentPathLimits(operator);
    }

    if (
      this.contentVisible &&
      operator === "S" &&
      this.state.strokePatternColorSpace === null &&
      this.pendingClipRule === null &&
      this.state.clipIndex < 0 &&
      this.state.lineDash.length === 0 &&
      this.state.lineCap !== 2 &&
      this.state.lineJoin === 0 &&
      Math.abs(this.state.miterLimit - 10) <= 1e-6 &&
      !this.state.strokeAdjustment &&
      isPackedStrokeTransformCompatible(
        this.state.matrix,
        this.state.lineWidth,
        this.state.lineDash.length > 0
      ) &&
      this.path.isSingleLine()
    ) {
      this.paintSimpleStrokeLine();
      return;
    }

    const pathData = this.path.view();
    if (!this.options.preservePaintOrder && pathData.length > MAX_PAINT_PATH_FLOATS) {
      throw new DensePdfUnsupportedError(
        "A single PDF path is too large for cooperative dense-vector compilation.",
        operator
      );
    }
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
      !this.options.preservePaintOrder && pathVisible &&
      fillRule === FILL_RULE_NONZERO &&
      countPathMoveOps(pathData) >= 100;
    if (largeDisconnectedFill && !(
      this.options.legacyVectorOutput === true &&
      this.options.legacySelectivePaths === true
    )) {
      throw new DensePdfUnsupportedError(
        "Large disconnected nonzero fills require source-ordered exact path compilation.",
        operator
      );
    }

    let exactPathIndex = -1;
    const finishClip = (): void => {
      if (this.pendingClipRule === null) return;
      if (this.options.preservePaintOrder || this.options.legacySelectiveTextClips) {
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

    const fillUsesPattern = fillPaint && this.state.fillPatternColorSpace !== null;
    const strokeUsesPattern = strokePaint && this.state.strokePatternColorSpace !== null;
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
    const selectivelyCapturedPath = this.options.legacyVectorOutput === true &&
      this.options.legacySelectivePaths === true &&
      (largeDisconnectedFill || visiblePatternFill || visiblePatternStroke ||
        ((!this.state.clipIsDefault && !this.state.clipIsExactRectangle) &&
          (visibleFill || visibleStroke)));
    if (selectivelyCapturedPath) {
      if (visibleFill || visiblePatternFill) this.assertLegacyVectorComposite("nonstroke", operator);
      if (visibleStroke || visiblePatternStroke) this.assertLegacyVectorComposite("stroke", operator);
      const ordinal = this.nextLegacyPaintOrdinal(operator);
      this.legacySelectivePaintSourceSpans.push(
        this.operatorSourceOffset,
        this.operatorSourceLength
      );
      this.legacySelectivePaintOrdinalSpans.push(ordinal, ordinal);
      this.legacyPathSpanEligible = false;
      finishClip();
      this.clearPaintPathState();
      return;
    }
    if (this.options.legacyVectorOutput === true) {
      // Validate before emitting into the optimizing stores: a duplicate or
      // contained primitive may otherwise be removed before its unsupported
      // blend/mask semantics are observed.
      if (visibleFill) this.noteLegacyOrdinaryPaint("nonstroke", operator);
      if (visibleStroke) this.noteLegacyOrdinaryPaint("stroke", operator);
    }
    if (visiblePatternFill || visiblePatternStroke) {
      if (!this.options.preservePaintOrder) {
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
    const genericPaint = this.options.preservePaintOrder === true &&
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
        this.options.preservePaintOrder ? 1 : this.state.strokeAlpha,
        flags,
        this.state.lineDash,
        this.state.dashPhase,
        this.options.enableSegmentMerge !== false,
        strokes,
        this.state.clipBounds
      );
      strokeCount = strokes.primitiveCount - strokeStart;
      if (strokeCount > 0 && (!fillPaint || !visibleFill)) {
        this.recordPaintRun(DENSE_PDF_PAINT_RUN_STROKE, strokeStart, strokeCount);
      }
    }

    if (visibleFill) {
      const fillStart = this.fillPathCount;
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
            this.options.preservePaintOrder ? 1 : this.state.fillAlpha,
            fillPathMetaA,
            fillPathMetaB,
            fillPathMetaC,
            fillSegmentsA,
            fillSegmentsB,
            this.state.clipBounds,
            this.state.clipMask
          );
      if (emittedBounds) {
        this.fillPathCount += 1;
        this.fillBounds = combineBounds(this.fillBounds, emittedBounds);
      }
      const fillCount = this.fillPathCount - fillStart;
      if (fillCount > 0) {
        this.recordPaintRun(DENSE_PDF_PAINT_RUN_FILL, fillStart, fillCount);
      }
      if (strokePaint) {
        if (strokeCount > 0) {
          this.recordPaintRun(
            DENSE_PDF_PAINT_RUN_STROKE,
            strokeStart,
            strokeCount
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
    if (this.state.strokeAlpha > ALPHA_INVISIBLE_EPSILON) {
      if (this.options.legacyVectorOutput === true) {
        this.noteLegacyOrdinaryPaint("stroke", "S");
      }
      this.assertSupportedStrokeState("S");
    }
    strokes.sourceSegmentCount += 1;
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
        this.options.preservePaintOrder ? 1 : this.state.strokeAlpha, flags,
        clipped ? clip.minX : geometryMinX,
        clipped ? clip.minY : geometryMinY,
        clipped ? clip.maxX : geometryMaxX,
        clipped ? clip.maxY : geometryMaxY
      );
    }
    const strokeCount = strokes.primitiveCount - strokeStart;
    if (strokeCount > 0) {
      this.recordPaintRun(DENSE_PDF_PAINT_RUN_STROKE, strokeStart, strokeCount);
    }
    this.path.clear();
  }

  private assertSupportedStrokeState(operator: string): void {
    // The compact unordered representation retains its established
    // approximation behavior. Source-ordered compilation must fail instead
    // of discarding visible stroke semantics.
    if (!this.options.preservePaintOrder) return;
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

  private assertLegacyVectorComposite(
    role: "stroke" | "nonstroke",
    operator: string,
    requireOpaque = false,
    requireLocalPaint = true
  ): void {
    const stroke = role === "stroke";
    const alpha = stroke ? this.state.strokeAlpha : this.state.fillAlpha;
    // `/AIS` only changes compositing when an alpha source can reduce the
    // source contribution. With unit constant alpha and no soft mask, shape
    // and opacity are identically 1, so the legacy result is exact. Keep the
    // rejection for every active-alpha case below.
    if (this.state.alphaIsShape && (alpha !== 1 || this.state.softMaskIndex >= 0)) {
      throw new DensePdfUnsupportedError(
        "Legacy vector output cannot represent alpha-as-shape compositing.",
        operator
      );
    }
    if (this.state.blendMode !== "Normal") {
      throw new DensePdfUnsupportedError(
        `Legacy vector output cannot represent /${this.state.blendMode} blending.`,
        operator
      );
    }
    if (this.state.softMaskIndex >= 0) {
      throw new DensePdfUnsupportedError(
        "Legacy vector output cannot represent a soft mask.",
        operator
      );
    }
    if ((stroke ? this.state.strokeOverprint : this.state.fillOverprint) &&
        this.options.legacyIgnoreOverprint !== true) {
      throw new DensePdfUnsupportedError(
        "Legacy vector output cannot represent active overprint.",
        operator
      );
    }
    if (requireOpaque && alpha !== 1) {
      throw new DensePdfUnsupportedError(
        "Legacy vector image output requires opaque constant alpha.",
        operator
      );
    }
    if (
      requireLocalPaint &&
      (stroke ? this.state.strokePaintInherited : this.state.fillPaintInherited)
    ) {
      throw new DensePdfUnsupportedError(
        "Legacy vector output cannot represent inherited caller paint.",
        operator
      );
    }
  }

  private nextLegacyPaintOrdinal(operator: string): number {
    if (this.legacyPaintOrdinal > 0xffff_ffff) {
      throw new DensePdfResourceLimitError(
        "Legacy vector output exceeds the 32-bit source paint-order range.",
        operator
      );
    }
    return this.legacyPaintOrdinal++;
  }

  private recordLegacySourceEvent(kind: number, index: number, operator: string): void {
    if (
      !Number.isSafeInteger(kind) || kind < 0 || kind > 0xffff_ffff ||
      !Number.isSafeInteger(index) || index < 0 || index > 0xffff_ffff ||
      this.legacySourceEvents.length > 0xffff_ffff - 2
    ) {
      throw new DensePdfResourceLimitError(
        "Legacy vector source events exceed the 32-bit event-tape range.",
        operator
      );
    }
    this.legacySourceEvents.push(kind, index);
  }

  private recordLegacyOrdinaryPaintBarrier(operator: string): void {
    if (this.legacyRecordedOrdinaryPaintBarrier) return;
    this.recordLegacySourceEvent(
      DENSE_PDF_LEGACY_VECTOR_EVENT_ORDINARY_PAINT,
      0,
      operator
    );
    this.legacyRecordedOrdinaryPaintBarrier = true;
  }

  private recordLegacyOrdinaryPaint(
    role: "stroke" | "nonstroke",
    operator: string
  ): void {
    this.assertLegacyVectorComposite(role, operator);
    this.nextLegacyPaintOrdinal(operator);
    this.recordLegacyOrdinaryPaintBarrier(operator);
    this.legacySawOrdinaryPaint = true;
  }

  private recordLegacyPathPaint(
    role: "stroke" | "nonstroke",
    operator: string
  ): void {
    if (!this.legacyPathSpanHasPaint) {
      this.legacyPathSpanSourceOffset = this.operatorSourceOffset;
      this.legacyPathSpanSourceLength = this.operatorSourceLength;
      this.legacyPathSpanHasPaint = true;
    }
    this.recordLegacyOrdinaryPaint(role, operator);
    this.legacySawPathPaint = true;
  }

  private noteLegacyOrdinaryPaint(
    role: "stroke" | "nonstroke",
    operator: string
  ): void {
    this.assertLegacyVectorComposite(role, operator);
    this.recordLegacyOrdinaryPaintBarrier(operator);
    this.legacySawOrdinaryPaint = true;
    this.legacySawPathPaint = true;
  }

  private recordPaintRun(kind: number, start: number, count: number): void {
    if (count <= 0) return;
    const role = kind === DENSE_PDF_PAINT_RUN_STROKE
      ? "stroke"
      : kind === DENSE_PDF_PAINT_RUN_FILL
        ? "nonstroke"
        : null;
    if (role === null) {
      throw new DensePdfSyntaxError("A non-path paint run reached the path paint recorder.");
    }
    if (this.options.legacyVectorOutput === true) {
      if (!this.state.clipIsDefault && !this.state.clipIsExactRectangle) {
        throw new DensePdfUnsupportedError(
          "Legacy vector output cannot represent an arbitrary clipped visible path.",
          kind === DENSE_PDF_PAINT_RUN_STROKE ? "S" : "f"
        );
      }
      this.recordLegacyPathPaint(
        role,
        kind === DENSE_PDF_PAINT_RUN_STROKE ? "S" : "f"
      );
    }
    if (!this.options.preservePaintOrder) return;
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
    if (this.options.legacyVectorOutput === true) {
      this.recordLegacyGlyphPaintRun(start, count, renderingMode);
      return;
    }
    if (renderingMode >= 4) {
      if (!this.options.preservePaintOrder) {
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
    if (!this.options.preservePaintOrder) return;
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
    if (
      (fills && this.state.fillPatternColorSpace) ||
      (strokes && this.state.strokePatternColorSpace)
    ) {
      throw new DensePdfUnsupportedError(
        "Pattern-colored text requires the Type3/pattern glyph paint bridge.",
        "Tj"
      );
    }
    const role = renderingMode === 1 || renderingMode === 5 ? "stroke" : "nonstroke";
    this.recordPaintTrace(
      DENSE_PDF_PAINT_RUN_GLYPH,
      start,
      count,
      undefined,
      role
    );
    this.glyphPaints.push({
      renderingMode,
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

  private recordLegacyGlyphPaintRun(
    start: number,
    count: number,
    renderingMode: number
  ): void {
    if (
      start > 0xffff_ffff || count > 0xffff_ffff ||
      start > 0xffff_ffff - count
    ) {
      throw new DensePdfResourceLimitError(
        "A legacy-vector glyph range exceeds the 32-bit glyph-index range.",
        "Tj"
      );
    }
    if (renderingMode !== 0 && renderingMode !== 3) {
      throw new DensePdfUnsupportedError(
        `Legacy vector output supports only fill and invisible text, not rendering mode ${renderingMode}.`,
        "Tr"
      );
    }
    if (renderingMode === 0 && this.state.fillAlpha > ALPHA_INVISIBLE_EPSILON) {
      if (!this.state.textKnockout) {
        throw new DensePdfUnsupportedError(
          "Legacy vector output cannot represent text knockout disabled.",
          "Tj"
        );
      }
      if (this.state.fillPatternColorSpace) {
        throw new DensePdfUnsupportedError(
          "Legacy vector output cannot represent pattern-colored text.",
          "Tj"
        );
      }
      if (!this.state.clipIsDefault && !this.state.clipIsExactRectangle) {
        if (this.options.legacySelectiveTextClips === true) {
          this.assertLegacyVectorComposite("nonstroke", "Tj");
          const ordinal = this.nextLegacyPaintOrdinal("Tj");
          this.legacySelectivePaintSourceSpans.push(
            this.operatorSourceOffset,
            this.operatorSourceLength
          );
          this.legacySelectivePaintOrdinalSpans.push(ordinal, ordinal);
          const glyphRunIndex = this.legacyGlyphRunMeta.length / 3;
          this.legacyGlyphRunMeta.push(start, count, renderingMode);
          this.legacyGlyphFillColors.push(0, 0, 0, 0);
          const clip = this.state.clipBounds ?? this.options.pageBounds;
          this.legacyGlyphClipBounds.push(clip.minX, clip.minY, clip.maxX, clip.maxY);
          this.legacyGlyphRunFlags.push(DENSE_PDF_LEGACY_VECTOR_GLYPH_FLAG_CLIPPED |
            DENSE_PDF_LEGACY_VECTOR_GLYPH_FLAG_COMPOSITED);
          this.legacyGlyphClipIndices.push(this.state.clipIndex);
          this.recordLegacySourceEvent(
            DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH,
            glyphRunIndex,
            "Tj"
          );
          this.legacyPathSpanEligible = false;
          return;
        }
        throw new DensePdfUnsupportedError(
          "Legacy vector output cannot prove an arbitrary clipped visible text run.",
          "Tj"
        );
      }
      this.recordLegacyOrdinaryPaint("nonstroke", "Tj");
    }
    const glyphRunIndex = this.legacyGlyphRunMeta.length / 3;
    this.legacyGlyphRunMeta.push(start, count, renderingMode);
    this.legacyGlyphClipIndices.push(this.state.clipIndex);
    this.legacyGlyphFillColors.push(
      this.state.fillR,
      this.state.fillG,
      this.state.fillB,
      this.state.fillAlpha
    );
    const clip = this.state.clipBounds ?? this.options.pageBounds;
    this.legacyGlyphClipBounds.push(clip.minX, clip.minY, clip.maxX, clip.maxY);
    this.legacyGlyphRunFlags.push(
      this.state.clipIsDefault ? 0 : DENSE_PDF_LEGACY_VECTOR_GLYPH_FLAG_CLIPPED
    );
    if (renderingMode === 0 && this.state.fillAlpha > ALPHA_INVISIBLE_EPSILON) {
      this.legacySawVisibleText = true;
    }
    this.recordLegacySourceEvent(
      DENSE_PDF_LEGACY_VECTOR_EVENT_GLYPH,
      glyphRunIndex,
      "Tj"
    );
    this.legacyPathSpanEligible = false;
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
    if (!this.state.clipBounds) return;
    if (!this.options.preservePaintOrder && this.options.legacyVectorOutput !== true) return;
    if (
      !Number.isSafeInteger(imageIndex) || imageIndex < 0 || imageIndex > 0xffff_ffff ||
      !Number.isSafeInteger(sourceOffset) || sourceOffset < -1 ||
      !Number.isSafeInteger(sourceLength) || sourceLength < -1 ||
      ((sourceOffset < 0) !== (sourceLength < 0))
    ) {
      throw new DensePdfSyntaxError("Image paint source metadata is invalid.");
    }
    if (this.options.legacyVectorOutput === true) {
      if (this.options.legacySelectiveClippedImages === true &&
          !this.state.clipIsDefault && this.state.clipIsExactRectangle &&
          (this.state.matrix[1] !== 0 || this.state.matrix[2] !== 0)) {
        this.assertLegacyVectorComposite("nonstroke", operator, true, false);
        const ordinal = this.nextLegacyPaintOrdinal(operator);
        this.legacySelectivePaintSourceSpans.push(sourceOffset, sourceLength);
        this.legacySelectivePaintOrdinalSpans.push(ordinal, ordinal);
        this.legacyPathSpanEligible = false;
        return;
      }
      let overlappingPathSpan = false;
      if (this.legacySawPathPaint) {
        overlappingPathSpan = this.legacyPrecedingPathsOverlapImage(operator);
        if (overlappingPathSpan && (
          this.options.legacySelectiveImageSpans !== true ||
          this.genericPathPaints.length !== 0
        )) {
          throw new DensePdfUnsupportedError(
            "Legacy vector output cannot move an image behind overlapping preceding visible path paint.",
            operator
          );
        }
      }
      if (this.options.legacySelectiveImageSpans === true &&
          this.legacySawVisibleText && !overlappingPathSpan) {
        this.assertLegacyVectorComposite("nonstroke", operator, true, false);
        const ordinal = this.nextLegacyPaintOrdinal(operator);
        this.legacySelectivePaintSourceSpans.push(sourceOffset, sourceLength);
        this.legacySelectivePaintOrdinalSpans.push(ordinal, ordinal);
        this.legacyPathSpanStartFillCount = this.fillPathCount;
        this.legacyPathSpanStartStrokeCount = this.strokes.primitiveCount;
        this.legacyPathSpanEligible = true;
        return;
      }
      if (!this.state.clipIsDefault && !this.state.clipIsExactRectangle) {
        throw new DensePdfUnsupportedError(
          "Legacy vector output cannot prove an arbitrarily clipped image underlay.",
          operator
        );
      }
      this.assertLegacyVectorComposite("nonstroke", operator, true, false);
      const ordinal = this.nextLegacyPaintOrdinal(operator);
      const imageInvocationIndex = this.legacyImageIndices.length;
      this.legacyImageIndices.push(imageIndex);
      this.legacyImageTransforms.push(...this.state.matrix);
      this.legacyImageClipBounds.push(
        this.state.clipBounds.minX,
        this.state.clipBounds.minY,
        this.state.clipBounds.maxX,
        this.state.clipBounds.maxY
      );
      this.legacyImagePaintOrders.push(ordinal);
      this.legacyImageFlags.push(
        (this.state.clipIsDefault ? 0 : DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_CLIPPED) |
        (this.legacySawVisibleText
          ? DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_LATE_AFTER_TEXT
          : 0) |
        (this.legacySawPathPaint
          ? DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_LATE_AFTER_PATH
          : 0) |
        (overlappingPathSpan
          ? DENSE_PDF_LEGACY_VECTOR_IMAGE_FLAG_SELECTIVE_PATH_SPAN
          : 0)
      );
      this.legacyImagePathSpanCheckpoints.push(
        overlappingPathSpan ? this.legacyPathSpanStartFillCount : this.fillPathCount,
        this.fillPathCount,
        overlappingPathSpan ? this.legacyPathSpanStartStrokeCount : this.strokes.primitiveCount,
        this.strokes.primitiveCount,
        overlappingPathSpan ? this.legacyPathSpanStartOrdinal : ordinal,
        ordinal
      );
      this.legacyImagePathSourceSpans.push(
        overlappingPathSpan ? this.legacyPathSpanSourceOffset : sourceOffset,
        overlappingPathSpan ? this.legacyPathSpanSourceLength : sourceLength,
        sourceOffset,
        sourceLength
      );
      this.recordLegacySourceEvent(
        DENSE_PDF_LEGACY_VECTOR_EVENT_IMAGE,
        imageInvocationIndex,
        operator
      );
      this.legacyPathSpanStartFillCount = this.fillPathCount;
      this.legacyPathSpanStartStrokeCount = this.strokes.primitiveCount;
      this.legacyPathSpanStartOrdinal = ordinal + 1;
      this.legacyPathSpanEligible = true;
      this.legacyPathSpanHasPaint = false;
      this.legacyPathSpanSourceOffset = -1;
      this.legacyPathSpanSourceLength = -1;
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
  private legacyPrecedingPathsOverlapImage(operator: string): boolean {
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
    for (let offset = this.legacyPathSpanStartFillCount * 4; offset < fillA.length; offset += 4) {
      check({ minX: fillA[offset + 2], minY: fillA[offset + 3],
        maxX: fillB[offset], maxY: fillB[offset + 1] });
    }
    const strokeBounds = this.strokes.primitiveBounds.usedView();
    for (let offset = this.legacyPathSpanStartStrokeCount * 4; offset < strokeBounds.length; offset += 4) {
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
    if (this.options.legacyVectorOutput === true) {
      if (this.state.strokePatternColorSpace || this.state.fillPatternColorSpace) {
        throw new DensePdfUnsupportedError(
          "A Form invoked with inherited pattern color state cannot be specialized exactly.",
          "Do"
        );
      }
      // A Form can inherit either paint role. Validate both now so the event
      // tape never advertises an occurrence whose caller state the grouped
      // bridge cannot represent conservatively.
      if (this.options.legacyAllowCompositeForms !== true) {
        this.assertLegacyVectorComposite("nonstroke", "Do");
        this.assertLegacyVectorComposite("stroke", "Do");
      }
      const paintIndex = this.formPaints.length;
      const paintOrder = this.nextLegacyPaintOrdinal("Do");
      this.formPaints.push({
        definitionIndex,
        transform: [...this.state.matrix],
        clipBounds: { ...this.state.clipBounds },
        clipIsDefault: this.state.clipIsDefault,
        clipIsExactRectangle: this.state.clipIsExactRectangle,
        initialGraphicsState: snapshotInitialGraphicsState(this.state)
      });
      this.legacyFormPaintOrders.push(paintOrder);
      this.recordLegacySourceEvent(
        DENSE_PDF_LEGACY_VECTOR_EVENT_FORM,
        paintIndex,
        "Do"
      );
      this.legacyPathSpanEligible = false;
      return;
    }
    if (!this.options.preservePaintOrder) return;
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
      initialGraphicsState: snapshotInitialGraphicsState(this.state)
    });
  }

  private recordShadingPaint(gradientIndex: number): void {
    if (!this.options.preservePaintOrder || !this.state.clipBounds) return;
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
    if (!this.options.preservePaintOrder) {
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
    this.markedContentStack.push({
      nodeIndex,
      optionalContentIndex: optionalContentIndex >= 0
        ? optionalContentIndex
        : parent?.optionalContentIndex ?? -1,
      defaultVisible: (parent?.defaultVisible ?? true) && ownDefaultVisible
    });
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

  private get activeMarkedContentIndex(): number {
    return this.markedContentStack.at(-1)?.nodeIndex ?? -1;
  }

  private get activeOptionalContentIndex(): number {
    return this.markedContentStack.at(-1)?.optionalContentIndex ?? -1;
  }

  private get contentVisible(): boolean {
    return this.markedContentStack.at(-1)?.defaultVisible ?? true;
  }

  private clearPaintPathState(): void {
    this.path.clear();
    this.pendingClipRule = null;
  }

  private requireArgs(operator: string, args: PdfValue[], count: number): void {
    if (args.length !== count) {
      throw new DensePdfSyntaxError(
        `Operator ${operator} expected ${count} operands but received ${args.length}.`
      );
    }
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

class IncrementalPdfLexer {
  private buffer: Uint8Array<ArrayBufferLike> = new Uint8Array(0);

  private readonly onToken: (token: LexerToken) => void;

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

  constructor(onToken: (token: LexerToken) => void) {
    this.onToken = onToken;
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

    let offset = 0;
    while (true) {
      const nextOffset = this.readToken(offset, final);
      if (nextOffset === null) {
        break;
      }
      offset = nextOffset;
      if (offset >= this.buffer.length) {
        break;
      }
    }

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

  private readToken(
    initialOffset: number,
    final: boolean
  ): number | null {
    const bytes = this.buffer;
    let offset = initialOffset;
    while (offset < bytes.length) {
      const byte = bytes[offset];
      if (isPdfWhitespace(byte)) {
        offset += 1;
        continue;
      }
      if (byte === 0x25) {
        const end = findLineEnd(bytes, offset + 1);
        if (end < 0) {
          return final ? bytes.length : null;
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
      return offset;
    }
    if (byte === 0x5d) {
      this.onToken(ARRAY_END_TOKEN);
      return offset;
    }
    if (byte === 0x3c) {
      if (offset >= bytes.length && !final) {
        return null;
      }
      if (bytes[offset] === 0x3c) {
        this.onToken(DICT_START_TOKEN);
        return offset + 1;
      }
      const end = findByte(bytes, 0x3e, offset);
      if (end < 0) {
        if (!final) {
          return null;
        }
        throw new DensePdfSyntaxError("Unterminated hexadecimal string in PDF content.");
      }
      this.onToken({ kind: "string", value: decodeHexString(bytes.subarray(offset, end)) });
      return end + 1;
    }
    if (byte === 0x3e) {
      if (offset >= bytes.length && !final) {
        return null;
      }
      if (bytes[offset] !== 0x3e) {
        throw new DensePdfSyntaxError("Unexpected > delimiter in PDF content.");
      }
      this.onToken(DICT_END_TOKEN);
      return offset + 1;
    }
    if (byte === 0x28) {
      const parsed = parseLiteralString(bytes, offset, final);
      if (!parsed) {
        return null;
      }
      this.onToken({ kind: "string", value: parsed.value });
      return parsed.offset;
    }
    if (byte === 0x2f) {
      const end = findRegularTokenEnd(bytes, offset);
      if (end === bytes.length && !final) {
        return null;
      }
      this.onToken({ kind: "name", value: decodePdfName(bytes.subarray(offset, end)) });
      return end;
    }

    const end = findRegularTokenEnd(bytes, start);
    if (end === bytes.length && !final) {
      return null;
    }
    if (end === start) {
      throw new DensePdfSyntaxError(`Unexpected delimiter byte 0x${byte.toString(16)}.`);
    }
    if (looksLikePdfNumberBytes(bytes, start, end)) {
      const value = parsePdfNumberBytes(bytes, start, end);
      if (!Number.isFinite(value)) {
        throw new DensePdfSyntaxError("Invalid numeric token in PDF content.");
      }
      this.numberToken.value = value;
      this.onToken(this.numberToken);
      return end;
    }
    this.wordToken.value = internPdfWord(bytes, start, end);
    this.wordToken.sourceOffset = this.bufferSourceOffset + start;
    this.wordToken.sourceLength = end - start;
    this.onToken(this.wordToken);
    return end;
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

  push(a: number, b: number, c: number, d: number): void {
    this.ensureCapacity(4);
    this.data[this.length] = a;
    this.data[this.length + 1] = b;
    this.data[this.length + 2] = c;
    this.data[this.length + 3] = d;
    this.length += 4;
  }

  valueAt(index: number): number {
    return this.data[index];
  }

  usedView(): Float32Array {
    return this.data.subarray(0, this.length);
  }

  toTypedArray(): Float32Array {
    return this.data.slice(0, this.length);
  }

  async toTypedArrayCooperative(
    checkpoint: (force?: boolean) => Promise<void>
  ): Promise<Float32Array> {
    const output = new Float32Array(this.length);
    const chunkLength = 256 * 1024;
    for (let offset = 0; offset < this.length; offset += chunkLength) {
      const end = Math.min(this.length, offset + chunkLength);
      output.set(this.data.subarray(offset, end), offset);
      await checkpoint();
    }
    return output;
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

  readonly duplicateTupleWords = new Uint32Array(
    this.duplicateTuple.buffer,
    this.duplicateTuple.byteOffset,
    this.duplicateTuple.length * 2
  );

  readonly ordinaryDuplicateTupleWords = new Uint32Array(
    this.duplicateTuple.buffer,
    this.duplicateTuple.byteOffset,
    13 * 2
  );

  readonly existingDuplicateTuple = new Float64Array(17);

  private readonly duplicateEquals = (index: number, tuple: Float64Array): boolean =>
    this.matchesDuplicateTuple(index, tuple);

  readonly enableInvisibleCull: boolean;

  readonly preservePrimitiveOrder: boolean;

  sourceSegmentCount = 0;

  mergedSegmentCount = 0;

  discardedTransparentCount = 0;

  discardedDegenerateCount = 0;

  discardedDuplicateCount = 0;

  emittedMaxHalfWidth = 0;

  constructor(enableInvisibleCull: boolean, preservePrimitiveOrder: boolean) {
    this.enableInvisibleCull = enableInvisibleCull;
    this.preservePrimitiveOrder = preservePrimitiveOrder;
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
      if (decodedAlpha >= OPAQUE_ALPHA_EPSILON) {
        fillDuplicateTuple(
          this.duplicateTuple,
          x0, y0, cx, cy, x1, y1, type, width, r, g, b, decodedAlpha,
          decodedFlags,
          visibleMinX, visibleMinY, visibleMaxX, visibleMaxY
        );
        if (this.duplicateIndex.hasOrInsert(
          this.duplicateTuple,
          (decodedFlags & DENSE_PDF_STROKE_STYLE_FLAG_CLIPPED) !== 0
            ? this.duplicateTupleWords
            : this.ordinaryDuplicateTupleWords,
          this.endpoints.quadCount,
          this.duplicateEquals
        )) {
          this.discardedDuplicateCount += 1;
          return;
        }
      }
    }

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

  async finalize(
    checkpoint: (force?: boolean) => Promise<void>
  ): Promise<StrokeFinalizeResult> {
    // No further primitives can be emitted once finalization starts. Release
    // the duplicate hash table before allocating the containment-cull working
    // sets so both indexes do not contribute to the finalization peak.
    this.duplicateIndex.release();
    if (
      !this.enableInvisibleCull ||
      this.preservePrimitiveOrder ||
      this.endpoints.quadCount === 0
    ) {
      const endpoints = await this.endpoints.toTypedArrayCooperative(checkpoint);
      const primitiveMeta = await this.primitiveMeta.toTypedArrayCooperative(checkpoint);
      const primitiveBounds = await this.primitiveBounds.toTypedArrayCooperative(checkpoint);
      const styles = await this.styles.toTypedArrayCooperative(checkpoint);
      return buildUncompactedStrokeResult(
        endpoints,
        primitiveMeta,
        primitiveBounds,
        styles,
        checkpoint,
        this.enableInvisibleCull ? null : this.emittedMaxHalfWidth
      );
    }
    return cullContainedSegments(
      this.endpoints.usedView(),
      this.primitiveMeta.usedView(),
      this.primitiveBounds.usedView(),
      this.styles.usedView(),
      checkpoint
    );
  }

  private matchesDuplicateTuple(index: number, tuple: Float64Array): boolean {
    const offset = index * 4;
    const encoded = this.primitiveMeta.valueAt(offset + 3);
    const decodedFlags = Math.max(0, Math.trunc(encoded / STROKE_STYLE_FLAG_OFFSET + 1e-6));
    const decodedAlpha = clamp01(encoded - decodedFlags * STROKE_STYLE_FLAG_OFFSET);
    fillDuplicateTuple(
      this.existingDuplicateTuple,
      this.endpoints.valueAt(offset),
      this.endpoints.valueAt(offset + 1),
      this.endpoints.valueAt(offset + 2),
      this.endpoints.valueAt(offset + 3),
      this.primitiveMeta.valueAt(offset),
      this.primitiveMeta.valueAt(offset + 1),
      this.primitiveMeta.valueAt(offset + 2),
      this.styles.valueAt(offset),
      this.styles.valueAt(offset + 1),
      this.styles.valueAt(offset + 2),
      this.styles.valueAt(offset + 3),
      decodedAlpha,
      decodedFlags,
      this.primitiveBounds.valueAt(offset),
      this.primitiveBounds.valueAt(offset + 1),
      this.primitiveBounds.valueAt(offset + 2),
      this.primitiveBounds.valueAt(offset + 3)
    );
    for (let i = 0; i < tuple.length; i += 1) {
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

  hasOrInsert(
    tuple: Float64Array,
    tupleWords: Uint32Array,
    newIndex: number,
    equals: (index: number, tuple: Float64Array) => boolean
  ): boolean {
    if ((this.size + 1) * 10 >= this.hashes.length * 7) {
      this.grow();
    }
    const hash = hashFloatTuple(tuple, tupleWords);
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

  release(): void {
    this.hashes = new Uint32Array(0);
    this.indices = new Uint32Array(0);
    this.size = 0;
  }

  private grow(): void {
    const oldHashes = this.hashes;
    const oldIndices = this.indices;
    this.hashes = new Uint32Array(oldHashes.length === 0 ? 1 << 20 : oldHashes.length * 2);
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

  const dashScale = matrixScale(matrix);
  const dashPattern = lineDash.map((entry) => entry * dashScale);
  const dashPatternLength = dashPattern.reduce((sum, entry) => sum + entry, 0);
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
    const paintBounds = {
      minX: minX - halfWidth,
      minY: minY - halfWidth,
      maxX: maxX + halfWidth,
      maxY: maxY + halfWidth
    };
    const visiblePaintBounds = clipBounds ? intersectBounds(clipBounds, paintBounds) : paintBounds;
    if (!isNonEmptyBounds(visiblePaintBounds)) {
      return;
    }
    const clipped = Boolean(clipBounds) && (
      visiblePaintBounds.minX > paintBounds.minX + 1e-6 ||
      visiblePaintBounds.minY > paintBounds.minY + 1e-6 ||
      visiblePaintBounds.maxX < paintBounds.maxX - 1e-6 ||
      visiblePaintBounds.maxY < paintBounds.maxY - 1e-6
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
  checkpoint: (force?: boolean) => Promise<void>
): Promise<StrokeFinalizeResult> {
  const count = endpoints.length >> 2;
  const keep = new Uint8Array(count);
  keep.fill(1);
  let starts = new Float64Array(count);
  let ends = new Float64Array(count);
  const groups: number[][] = [];
  const tuple = new Float64Array(11);
  const tupleWords = new Uint32Array(
    tuple.buffer,
    tuple.byteOffset,
    tuple.length * 2
  );
  const representativeTuple = new Float64Array(11);
  const groupIndex = new DenseCoverageGroupIndex();
  const matchesRepresentative = (representativeIndex: number, candidate: Float64Array): boolean => {
    if (!fillCoverageGroupTuple(
      representativeTuple,
      representativeIndex,
      endpoints,
      primitiveMeta,
      styles,
      primitiveBounds
    )) {
      return false;
    }
    for (let component = 0; component < representativeTuple.length; component += 1) {
      if (representativeTuple[component] !== candidate[component]) {
        return false;
      }
    }
    return true;
  };

  for (let index = 0; index < count; index += 1) {
    if ((index & 0x1fff) === 0) await checkpoint();
    if (!fillCoverageGroupTuple(
      tuple,
      index,
      endpoints,
      primitiveMeta,
      styles,
      primitiveBounds,
      starts,
      ends
    )) {
      continue;
    }
    const groupId = groupIndex.getOrInsert(
      tuple,
      tupleWords,
      index,
      groups.length,
      matchesRepresentative
    );
    if (groupId === groups.length) {
      groups.push([]);
    }
    groups[groupId].push(index);
  }
  groupIndex.release();

  let discardedContainedCount = 0;
  const coverageSorter = new CoverageObjectSorter();
  for (let groupNumber = 0; groupNumber < groups.length; groupNumber += 1) {
    const candidates = groups[groupNumber];
    if (candidates.length > MAX_COVERAGE_GROUP_SIZE) {
      throw new DensePdfUnsupportedError(
        "A collinear stroke group is too large for cooperative dense-vector culling."
      );
    }
    // A singleton has no other segment that can contain it (or be contained by
    // it), so sorting and building an opaque-cover list cannot change output.
    if (candidates.length === 1) {
      if ((groupNumber & 0xff) === 0) await checkpoint();
      continue;
    }
    await coverageSorter.sort(
      candidates,
      starts,
      ends,
      styles,
      primitiveMeta,
      checkpoint
    );
    const opaqueCovers: number[] = [];
    for (let candidateNumber = 0; candidateNumber < candidates.length; candidateNumber += 1) {
      if ((candidateNumber & 0x1fff) === 0) await checkpoint();
      const candidate = candidates[candidateNumber];
      const candidateOffset = candidate * 4;
      const candidateWidth = styles[candidateOffset];
      let covered = false;
      for (let coverNumber = 0; coverNumber < opaqueCovers.length; coverNumber += 1) {
        if (coverNumber > 0 && (coverNumber & 0x1fff) === 0) await checkpoint();
        const cover = opaqueCovers[coverNumber];
        if (styles[cover * 4] + COVER_HALF_WIDTH_EPSILON < candidateWidth) {
          continue;
        }
        if (
          starts[cover] - COVER_INTERVAL_EPSILON <= starts[candidate] &&
          ends[cover] + COVER_INTERVAL_EPSILON >= ends[candidate]
        ) {
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
          opaqueCovers.push(candidate);
        }
      }
    }
    opaqueCovers.length = 0;
    if ((groupNumber & 0xff) === 0) await checkpoint();
  }

  groups.length = 0;
  coverageSorter.release();
  starts = new Float64Array(0);
  ends = new Float64Array(0);
  await checkpoint(true);

  return compactStrokeBuffers(
    endpoints,
    primitiveMeta,
    primitiveBounds,
    styles,
    keep,
    count - discardedContainedCount,
    discardedContainedCount,
    checkpoint
  );
}

function fillCoverageGroupTuple(
  tuple: Float64Array,
  index: number,
  endpoints: Float32Array,
  primitiveMeta: Float32Array,
  styles: Float32Array,
  primitiveBounds: Float32Array,
  starts?: Float64Array,
  ends?: Float64Array
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
  if (starts && ends) {
    starts[index] = Math.min(ux * ax + uy * ay, ux * bx + uy * by);
    ends[index] = Math.max(ux * ax + uy * ay, ux * bx + uy * by);
  }
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
  const clipped = (decodedFlags & DENSE_PDF_STROKE_STYLE_FLAG_CLIPPED) !== 0;
  tuple[7] = clipped ? primitiveBounds[offset] : 0;
  tuple[8] = clipped ? primitiveBounds[offset + 1] : 0;
  tuple[9] = clipped ? primitiveBounds[offset + 2] : 0;
  tuple[10] = clipped ? primitiveBounds[offset + 3] : 0;
  return true;
}

class CoverageObjectSorter {
  private readonly pool: CoverageCandidate[] = [];

  private readonly work: CoverageCandidate[] = [];

  async sort(
    values: number[],
    starts: Float64Array,
    ends: Float64Array,
    styles: Float32Array,
    primitiveMeta: Float32Array,
    checkpoint: (force?: boolean) => Promise<void>
  ): Promise<void> {
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
      candidate.start = starts[index];
      candidate.end = ends[index];
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
    }
    await checkpoint();
  }

  release(): void {
    this.pool.length = 0;
    this.work.length = 0;
  }
}

class DenseCoverageGroupIndex {
  private hashes = new Uint32Array(1 << 16);

  private groupIds = new Uint32Array(1 << 16);

  private representativeIndices = new Uint32Array(1 << 16);

  private size = 0;

  getOrInsert(
    tuple: Float64Array,
    tupleWords: Uint32Array,
    representativeIndex: number,
    newGroupId: number,
    equals: (representativeIndex: number, tuple: Float64Array) => boolean
  ): number {
    if ((this.size + 1) * 10 >= this.hashes.length * 7) {
      this.grow();
    }
    const hash = hashFloatTuple(tuple, tupleWords);
    let slot = hash & (this.hashes.length - 1);
    while (this.hashes[slot] !== 0) {
      if (
        this.hashes[slot] === hash &&
        equals(this.representativeIndices[slot] - 1, tuple)
      ) {
        return this.groupIds[slot] - 1;
      }
      slot = (slot + 1) & (this.hashes.length - 1);
    }
    this.hashes[slot] = hash;
    this.groupIds[slot] = newGroupId + 1;
    this.representativeIndices[slot] = representativeIndex + 1;
    this.size += 1;
    return newGroupId;
  }

  release(): void {
    this.hashes = new Uint32Array(0);
    this.groupIds = new Uint32Array(0);
    this.representativeIndices = new Uint32Array(0);
    this.size = 0;
  }

  private grow(): void {
    const oldHashes = this.hashes;
    const oldIds = this.groupIds;
    const oldRepresentativeIndices = this.representativeIndices;
    this.hashes = new Uint32Array(oldHashes.length * 2);
    this.groupIds = new Uint32Array(oldIds.length * 2);
    this.representativeIndices = new Uint32Array(oldRepresentativeIndices.length * 2);
    const mask = this.hashes.length - 1;
    for (let oldSlot = 0; oldSlot < oldHashes.length; oldSlot += 1) {
      const hash = oldHashes[oldSlot];
      if (hash === 0) {
        continue;
      }
      let slot = hash & mask;
      while (this.hashes[slot] !== 0) {
        slot = (slot + 1) & mask;
      }
      this.hashes[slot] = hash;
      this.groupIds[slot] = oldIds[oldSlot];
      this.representativeIndices[slot] = oldRepresentativeIndices[oldSlot];
    }
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
  checkpoint: (force?: boolean) => Promise<void>
): Promise<StrokeFinalizeResult> {
  const outEndpoints = new Float32Array(visibleCount * 4);
  const outMeta = new Float32Array(visibleCount * 4);
  const outBoundsArray = new Float32Array(visibleCount * 4);
  const outStyles = new Float32Array(visibleCount * 4);
  const bounds = emptyBounds();
  let maxHalfWidth = 0;
  let out = 0;
  for (let index = 0; index < keep.length; index += 1) {
    if ((index & 0x1fff) === 0) await checkpoint();
    if (keep[index] === 0) {
      continue;
    }
    const inputOffset = index * 4;
    const outputOffset = out * 4;
    for (let component = 0; component < 4; component += 1) {
      outEndpoints[outputOffset + component] = endpoints[inputOffset + component];
      outMeta[outputOffset + component] = primitiveMeta[inputOffset + component];
      outBoundsArray[outputOffset + component] = primitiveBounds[inputOffset + component];
      outStyles[outputOffset + component] = styles[inputOffset + component];
    }
    includePoint(bounds, primitiveBounds[inputOffset], primitiveBounds[inputOffset + 1]);
    includePoint(bounds, primitiveBounds[inputOffset + 2], primitiveBounds[inputOffset + 3]);
    maxHalfWidth = Math.max(maxHalfWidth, styles[inputOffset]);
    out += 1;
  }
  return {
    endpoints: outEndpoints,
    primitiveMeta: outMeta,
    primitiveBounds: outBoundsArray,
    styles: outStyles,
    bounds: visibleCount > 0 ? bounds : null,
    maxHalfWidth,
    discardedContainedCount
  };
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

function isPdfWhitespace(byte: number): boolean {
  return byte === 0 || byte === 9 || byte === 10 || byte === 12 || byte === 13 || byte === 32;
}

function isPdfDelimiter(byte: number): boolean {
  return byte === 0x28 || byte === 0x29 || byte === 0x3c || byte === 0x3e ||
    byte === 0x5b || byte === 0x5d || byte === 0x7b || byte === 0x7d ||
    byte === 0x2f || byte === 0x25;
}

function findRegularTokenEnd(bytes: Uint8Array, offset: number): number {
  while (
    offset < bytes.length &&
    !isPdfWhitespace(bytes[offset]) &&
    !isPdfDelimiter(bytes[offset])
  ) {
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

function looksLikePdfNumberBytes(bytes: Uint8Array, start: number, end: number): boolean {
  if (start >= end) return false;
  const first = bytes[start];
  return (first >= 0x30 && first <= 0x39) || first === 0x2b || first === 0x2d || first === 0x2e;
}

function parsePdfNumberBytes(bytes: Uint8Array, start: number, end: number): number {
  let offset = start;
  let sign = 1;
  if (bytes[offset] === 0x2b || bytes[offset] === 0x2d) {
    if (bytes[offset] === 0x2d) sign = -1;
    offset += 1;
  }
  let divideBy = 0;
  if (offset < end && bytes[offset] === 0x2e) {
    divideBy = 10;
    offset += 1;
  }
  if (offset >= end || bytes[offset] < 0x30 || bytes[offset] > 0x39) {
    throw new DensePdfSyntaxError("Malformed numeric token in PDF content.");
  }
  let value = bytes[offset++] - 0x30;
  while (offset < end) {
    const byte = bytes[offset++];
    if (byte >= 0x30 && byte <= 0x39) {
      if (divideBy !== 0) divideBy *= 10;
      value = value * 10 + byte - 0x30;
    } else if (byte === 0x2e && divideBy === 0) {
      divideBy = 1;
    } else {
      throw new DensePdfSyntaxError("Malformed numeric token in PDF content.");
    }
  }
  return sign * (divideBy === 0 ? value : value / divideBy);
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

function snapshotInitialGraphicsState(state: GraphicsState): DensePdfInitialGraphicsState {
  return {
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
    lineDash: Object.freeze([...state.lineDash]),
    strokeColor: Object.freeze([...state.strokeColor]) as DensePdfInitialGraphicsState["strokeColor"],
    fillColor: Object.freeze([...state.fillColor]) as DensePdfInitialGraphicsState["fillColor"]
  });
}

function validateInitialGraphicsState(state: DensePdfInitialGraphicsState): void {
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

function normalizeDeviceColor(
  colorSpace: DeviceColorSpace,
  args: PdfValue[],
  operator: string
): [number, number, number] {
  const componentCount = colorSpace === "DeviceGray" ? 1 : colorSpace === "DeviceRGB" ? 3 : 4;
  if (args.length !== componentCount) {
    throw new DensePdfSyntaxError(
      `${operator} expected ${componentCount} components for ${colorSpace}.`
    );
  }
  if (colorSpace === "DeviceGray") return normalizeGray(numberArg(args, 0));
  if (colorSpace === "DeviceRGB") {
    return normalizeRgb(numberArg(args, 0), numberArg(args, 1), numberArg(args, 2));
  }
  return normalizeCmyk(
    numberArg(args, 0), numberArg(args, 1), numberArg(args, 2), numberArg(args, 3)
  );
}

function encodeStrokeStyleMeta(alpha: number, styleFlags: number): number {
  return clamp01(alpha) + Math.max(0, Math.trunc(styleFlags + 1e-6)) * STROKE_STYLE_FLAG_OFFSET;
}

function decodeStrokeStyleMeta(encoded: number): { alpha: number; styleFlags: number } {
  const styleFlags = Math.max(0, Math.trunc(encoded / STROKE_STYLE_FLAG_OFFSET + 1e-6));
  return { alpha: clamp01(encoded - styleFlags * STROKE_STYLE_FLAG_OFFSET), styleFlags };
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

function hashFloatTuple(tuple: Float64Array, words: Uint32Array): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < words.length; index += 1) {
    let value = words[index];
    hash = Math.imul(hash ^ value, 0x01000193);
    value >>>= 16;
    hash = Math.imul(hash ^ value, 0x01000193);
  }
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
