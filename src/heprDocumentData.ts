/**
 * Page-native, dependency-free HEPR display data.
 *
 * The format deliberately keeps commands as small structured-cloneable records
 * while all potentially large payloads live in typed-array stores. Numeric
 * resource references are page-local, zero-based indexes. `-1` is the only
 * sentinel value and always means "none".
 *
 * HEP archives persist this exact v7 model. A page is self-contained: rendering
 * it never requires the source PDF or another page.
 */

import type {
  PdfDiagnostic,
  PdfDiagnosticSeverity,
  PdfResourceLimits
} from "./pdf/nativeTypes";

export type {
  PdfDiagnostic,
  PdfDiagnosticSeverity,
  PdfResourceLimits
} from "./pdf/nativeTypes";

export const HEPR_DOCUMENT_DATA_VERSION = 7 as const;

export type HeprDocumentDataVersion = typeof HEPR_DOCUMENT_DATA_VERSION;

/** PDF user-space rectangle normalized so min <= max on both axes. */
export type PdfBox = readonly [minX: number, minY: number, maxX: number, maxY: number];

/** Affine matrix `[a, b, c, d, e, f]` using PDF's column-vector convention. */
export type PdfMatrix = readonly [
  a: number,
  b: number,
  c: number,
  d: number,
  e: number,
  f: number
];

export type PdfPageRotation = 0 | 90 | 180 | 270;

export interface PdfPageInfo {
  /** Stable zero-based index in the source PDF. This is never a layout slot. */
  sourcePageIndex: number;
  mediaBox: PdfBox;
  cropBox: PdfBox;
  bleedBox: PdfBox | null;
  trimBox: PdfBox | null;
  artBox: PdfBox | null;
  rotation: PdfPageRotation;
  userUnit: number;
  /** Page-native extent after crop, rotation, and `UserUnit` are applied. */
  width: number;
  height: number;
}

export interface PdfDocumentMetadata {
  title?: string;
  author?: string;
  subject?: string;
  keywords?: string;
  creator?: string;
  producer?: string;
  creationDate?: string;
  modificationDate?: string;
}

/** Metadata available as soon as `openPdf()` resolves. */
export interface PdfDocumentInfo {
  pdfVersion: string | null;
  byteLength: number;
  pageCount: number;
  pages: readonly PdfPageInfo[];
  label: string | null;
  fingerprint: string | null;
  linearized: boolean;
  repaired: boolean;
  tagged: boolean;
  language: string | null;
  metadata: Readonly<PdfDocumentMetadata>;
}

export const PDF_PROGRESS_STAGES = [
  "source-read",
  "xref",
  "catalog",
  "page",
  "content",
  "font",
  "image",
  "color",
  "optimize",
  "hep",
  "lod",
  "upload"
] as const;

export type PdfProgressStage = (typeof PDF_PROGRESS_STAGES)[number];

export interface PdfProgress {
  stage: PdfProgressStage;
  /** Stage-local completed units. */
  completed: number;
  /** Stage-local total when knowable without speculative reads. */
  total: number | null;
  sourcePageIndex: number | null;
  bytesRead: number;
  byteLength: number | null;
}

export type PdfProgressCallback = (progress: Readonly<PdfProgress>) => void;

export const PDF_DIAGNOSTIC_SEVERITIES: readonly PdfDiagnosticSeverity[] = [
  "info",
  "warning",
  "error"
];

/**
 * Stable diagnostic codes emitted by the v1 engine. New codes may be added in
 * minor releases, so consumers should always tolerate unknown strings.
 */
export const PDF_DIAGNOSTIC_CODES = {
  CatalogRepaired: "catalog.repaired",
  XrefRepaired: "xref.repaired",
  XrefRepairComplete: "xref.repair-complete",
  XrefTrailingData: "xref.trailing-data",
  PageBoxClamped: "page.box-clamped",
  PageCountMismatch: "page.count-mismatch",
  MetadataInvalidInfo: "metadata.invalid-info",
  MetadataInvalidField: "metadata.invalid-field",
  MetadataInvalidId: "metadata.invalid-id",
  MissingFontSubstituted: "font.missing-substituted",
  InvalidToUnicode: "font.invalid-to-unicode",
  MissingUnicodeMapping: "font.missing-unicode-mapping",
  AppearanceSynthesized: "annotation.appearance-synthesized",
  AppearanceStateInferred: "annotation.appearance-state-inferred",
  OptionalContentHidden: "optional-content.hidden",
  ColorProfileFallback: "color.profile-fallback",
  SourceRangeFallback: "source.range-full-download",
  SourceValidatorUnavailable: "source.validator-unavailable",
  OptimizationSkipped: "optimize.skipped"
} as const;

export type KnownPdfDiagnosticCode =
  (typeof PDF_DIAGNOSTIC_CODES)[keyof typeof PDF_DIAGNOSTIC_CODES];

export type PdfDiagnosticCode = KnownPdfDiagnosticCode | (string & {});

export interface PdfCompileOptions {
  signal?: AbortSignal;
  limits?: Partial<PdfResourceLimits>;
  optimization?: "none" | "safe";
  onProgress?: PdfProgressCallback;
}

export interface PdfCompilePagesOptions extends PdfCompileOptions {
  /** Caller order is preserved. Duplicate indexes are rejected. */
  sourcePageIndexes?: readonly number[];
}

/** Numeric encodings used by the typed stores. */
export const HEPR_PATH_VERB = {
  MoveTo: 0,
  LineTo: 1,
  QuadraticTo: 2,
  CubicTo: 3,
  Close: 4
} as const;

export const HEPR_LINE_CAP = {
  Butt: 0,
  Round: 1,
  Square: 2
} as const;

export const HEPR_LINE_JOIN = {
  Miter: 0,
  Round: 1,
  Bevel: 2
} as const;

export const HEPR_PAINT_KIND = {
  SolidColor: 0,
  Gradient: 1,
  Pattern: 2
} as const;

export const HEPR_IMAGE_FORMAT = {
  Rgba8: 0,
  Gray8: 1,
  GrayAlpha8: 2,
  Rgba16: 3,
  Jpeg: 4,
  Jpeg2000: 5,
  Jbig2: 6,
  Ccitt: 7
} as const;

export const HEPR_MESH_KIND = {
  Triangles: 0,
  TensorPatch: 1,
  CoonsPatch: 2
} as const;

export const HEPR_GRADIENT_KIND = {
  Axial: 0,
  Radial: 1,
  Function: 2,
  FreeFormMesh: 3,
  LatticeMesh: 4,
  CoonsPatchMesh: 5,
  TensorPatchMesh: 6
} as const;

export const HEPR_PATTERN_KIND = {
  ColoredTiling: 0,
  UncoloredTiling: 1,
  Shading: 2
} as const;

/** Viewer-dependent counter-transform semantics on an annotation invocation. */
export const HEPR_VIEW_TRANSFORM_FLAG = {
  NoZoom: 1,
  NoRotate: 2
} as const;

export const HEPR_COLOR_SPACE_KIND = {
  DeviceGray: 0,
  DeviceRgb: 1,
  DeviceCmyk: 2,
  CalGray: 3,
  CalRgb: 4,
  Lab: 5,
  IccBased: 6,
  Indexed: 7,
  Separation: 8,
  DeviceN: 9
} as const;

export const HEPR_FUNCTION_KIND = {
  Sampled: 0,
  Exponential: 2,
  Stitching: 3,
  Calculator: 4
} as const;

export const HEPR_FONT_KIND = {
  TrueType: 0,
  OpenType: 1,
  Cff: 2,
  Cff2: 3,
  Type1: 4,
  Type3: 5
} as const;

export const HEPR_GLYPH_FLAG = {
  Vertical: 1 << 0,
  Invisible: 1 << 1,
  Type3: 1 << 2,
  /** Contributes its outline to the BT/ET clip; modes 4-6 also paint it. */
  ClipOnly: 1 << 3
} as const;

export const HEPR_PATH_FLAG = {
  Closed: 1 << 0,
  Rectangle: 1 << 1
} as const;

export const HEPR_STROKE_FLAG = {
  Hairline: 1 << 0,
  StrokeAdjust: 1 << 1
} as const;

export interface HeprTransformStore {
  /** Six floats per affine matrix. Matrix zero should normally be identity. */
  values: Float32Array;
}

export interface HeprPathStore {
  /** `pathCount + 1`; spans into `verbs`. */
  pathVerbOffsets: Uint32Array;
  verbs: Uint8Array;
  /** `verbs.length + 1`; spans into `coordinates`. */
  verbCoordinateOffsets: Uint32Array;
  coordinates: Float32Array;
  /** Four conservative culling floats per path in its owning program's coordinates. */
  bounds: Float32Array;
  /** One bit field per path. */
  flags: Uint8Array;
  /**
   * GPU-ready fill representation retained by the dense compiler. These five
   * fields intentionally match `DensePdfCompiledPage`, allowing ownership to
   * move into a page without decoding and rebuilding its hot-path buffers.
   */
  fillPathMetaA: Float32Array;
  fillPathMetaB: Float32Array;
  fillPathMetaC: Float32Array;
  fillSegmentsA: Float32Array;
  fillSegmentsB: Float32Array;
}

export interface HeprStrokeStore {
  /**
   * GPU-ready stroke representation retained by the dense compiler. Each
   * array contains four floats per stroke segment.
   */
  endpoints: Float32Array;
  primitiveMeta: Float32Array;
  primitiveBounds: Float32Array;
  styles: Float32Array;
  lineWidths: Float32Array;
  miterLimits: Float32Array;
  lineCaps: Uint8Array;
  lineJoins: Uint8Array;
  flags: Uint8Array;
  /** `strokeStyleCount + 1`; spans into `dashValues`. */
  dashOffsets: Uint32Array;
  dashValues: Float32Array;
  dashPhases: Float32Array;
}

/**
 * Glyph instances and their final positioning. The PDF character code and
 * outline glyph ID stay separate from Unicode in `HeprTextIndex`.
 */
export interface HeprGlyphStore {
  fontIndices: Uint32Array;
  characterCodes: Uint32Array;
  glyphIds: Uint32Array;
  transformIndices: Uint32Array;
  /** Two floats per glyph in text-space units. */
  advances: Float32Array;
  flags: Uint8Array;
}

export interface HeprFontStore {
  names: readonly string[];
  kinds: Uint8Array;
  unitsPerEm: Uint32Array;
  ascents: Float32Array;
  descents: Float32Array;
  /** `fontCount + 1`; spans `glyphIds` and the outline arrays. */
  glyphOffsets: Uint32Array;
  glyphIds: Uint32Array;
  /** Path span for each derived outline glyph. */
  outlinePathStarts: Uint32Array;
  outlinePathCounts: Uint32Array;
  /** Canonical Type3 glyph paint program, or -1 for ordinary outline glyphs. */
  type3ProgramIndices: Int32Array;
}

export interface HeprImageStore {
  widths: Uint32Array;
  heights: Uint32Array;
  bitsPerComponent: Uint8Array;
  formats: Uint8Array;
  colorSpaceIndices: Int32Array;
  interpolate: Uint8Array;
  imageMask: Uint8Array;
  softMaskImageIndices: Int32Array;
  colorKeyMaskOffsets: Uint32Array;
  colorKeyMaskValues: Int32Array;
  decodeOffsets: Uint32Array;
  decodeValues: Float32Array;
  matteOffsets: Uint32Array;
  matteValues: Float32Array;
  /** `imageCount + 1`; spans into self-contained encoded or raw bytes. */
  dataOffsets: Uint32Array;
  data: Uint8Array;
}

export interface HeprMeshStore {
  /**
   * Kind-specific, self-contained mesh encoding:
   *
   * - `Triangles`: `indices` are mesh-local triangle triplets into arbitrary
   *   vertices.
   * - `CoonsPatch`: each source-ordered record is an expanded 12-control-point
   *   ISO 32000 Coons net.
   * - `TensorPatch`: each source-ordered record is an expanded
   *   16-control-point ISO 32000 tensor-product net.
   *
   * Patch continuation edges are already expanded. Patch indices are exact
   * sequential groups of 12/16 global control-point indexes. The four corner
   * color (or function-input) tuples occupy control slots 0, 3, 6, and 9;
   * non-corner color slots are zero. This keeps patch geometry tessellatable
   * without retaining or reparsing the source PDF.
   */
  kinds: Uint8Array;
  vertexOffsets: Uint32Array;
  indexOffsets: Uint32Array;
  /** Two floats per vertex. */
  positions: Float32Array;
  /** Four canonical components per vertex; interpretation uses colorSpaceIndices. */
  colors: Float32Array;
  indices: Uint32Array;
  colorSpaceIndices: Int32Array;
}

export interface HeprFunctionStore {
  kinds: Uint8Array;
  domainOffsets: Uint32Array;
  domains: Float32Array;
  rangeOffsets: Uint32Array;
  ranges: Float32Array;
  parameterOffsets: Uint32Array;
  parameters: Float32Array;
  sampleOffsets: Uint32Array;
  samples: Float32Array;
  /** Validated bytecode for type 4 calculator functions. */
  calculatorOffsets: Uint32Array;
  calculatorBytecode: Uint8Array;
}

export interface HeprGradientStore {
  kinds: Uint8Array;
  colorSpaceIndices: Int32Array;
  functionIndices: Int32Array;
  coordinateOffsets: Uint32Array;
  coordinates: Float32Array;
  stopOffsets: Uint32Array;
  stopPositions: Float32Array;
  stopPaintIndices: Uint32Array;
  meshIndices: Int32Array;
  extendFlags: Uint8Array;
}

export interface HeprPatternStore {
  kinds: Uint8Array;
  paintTypes: Uint8Array;
  tilingTypes: Uint8Array;
  /** Four floats per pattern. */
  bounds: Float32Array;
  xSteps: Float32Array;
  ySteps: Float32Array;
  matrixIndices: Uint32Array;
  programIndices: Int32Array;
  gradientIndices: Int32Array;
  underlyingColorSpaceIndices: Int32Array;
}

export interface HeprClipStore {
  /** Parent intersection, or -1. Parents precede children, making chains acyclic. */
  parentIndices: Int32Array;
  firstPaths: Uint32Array;
  /** Generic path-union count; zero for glyph-backed or exact-empty clips. */
  pathCounts: Uint32Array;
  /** First glyph instance in a text-object clipping union; ignored when glyphCounts is zero. */
  firstGlyphs: Uint32Array;
  /** Contiguous glyph union. Backends apply each glyph transform before one intersection. */
  glyphCounts: Uint32Array;
  /** 0 = nonzero, 1 = even-odd. */
  fillRules: Uint8Array;
  /** Path CTM, or common glyph-union CTM, relative to the owning program. */
  transformIndices: Uint32Array;
}

export interface HeprColorStore {
  spaceKinds: Uint8Array;
  componentCounts: Uint8Array;
  alternateSpaceIndices: Int32Array;
  functionIndices: Int32Array;
  parameterOffsets: Uint32Array;
  parameters: Float32Array;
  nameOffsets: Uint32Array;
  names: readonly string[];
  profileOffsets: Uint32Array;
  profiles: Uint8Array;
  lookupOffsets: Uint32Array;
  lookupBytes: Uint8Array;
}

export interface HeprPaintStore {
  kinds: Uint8Array;
  resourceIndices: Uint32Array;
  alphas: Float32Array;
  overprint: Uint8Array;
  overprintModes: Uint8Array;
  /** Pattern-space CTM captured at color use; -1 for non-pattern paints. */
  patternTransformIndices: Int32Array;
  /** Solid base-color paint for an uncolored tiling pattern; otherwise -1. */
  patternBasePaintIndices: Int32Array;
}

export interface HeprOptionalContentStore {
  names: readonly string[];
  /** Default-view visibility. Hidden content has no draw commands. */
  defaultVisible: Uint8Array;
}

export interface HeprMarkedContentStore {
  tags: readonly string[];
  propertyNames: readonly (string | null)[];
  mcids: Int32Array;
  parentIndices: Int32Array;
}

export interface HeprPageStores {
  transforms: HeprTransformStore;
  paths: HeprPathStore;
  strokes: HeprStrokeStore;
  glyphs: HeprGlyphStore;
  fonts: HeprFontStore;
  images: HeprImageStore;
  meshes: HeprMeshStore;
  functions: HeprFunctionStore;
  gradients: HeprGradientStore;
  patterns: HeprPatternStore;
  clips: HeprClipStore;
  colors: HeprColorStore;
  paints: HeprPaintStore;
  optionalContent: HeprOptionalContentStore;
  markedContent: HeprMarkedContentStore;
}

export type PdfBlendMode =
  | "Normal"
  | "Multiply"
  | "Screen"
  | "Overlay"
  | "Darken"
  | "Lighten"
  | "ColorDodge"
  | "ColorBurn"
  | "HardLight"
  | "SoftLight"
  | "Difference"
  | "Exclusion"
  | "Hue"
  | "Saturation"
  | "Color"
  | "Luminosity";

interface HeprCommandBase {
  /** Transform composed outside resource-local transforms. */
  transformIndex: number;
  /** Active clip chain, or -1. */
  clipIndex: number;
  /** Static default-view optional-content membership, or -1. */
  optionalContentIndex: number;
  /** Innermost marked-content node, or -1. */
  markedContentIndex: number;
  /** Byte position in the decoded content stream, or -1 if unavailable. */
  sourceOffset: number;
  /** Number of source bytes represented by the command, or -1 if unavailable. */
  sourceLength: number;
}

export interface HeprPathDrawRun extends HeprCommandBase {
  kind: "draw";
  source: "paths";
  first: number;
  count: number;
  /** When both paints are present, backends must fill first and stroke second. */
  fillPaintIndex: number;
  strokePaintIndex: number;
  /** Resolve the fill from an enclosing uncolored Type3/pattern invocation. */
  fillPaintInherited?: boolean;
  /** Resolve the stroke from an enclosing uncolored Type3/pattern invocation. */
  strokePaintInherited?: boolean;
  strokeStyleIndex: number;
  /** 0 = nonzero, 1 = even-odd. */
  fillRule: number;
}

/** Zero-copy run over `stores.paths.fillPathMeta*` from the dense compiler. */
export interface HeprFillPathDrawRun extends HeprCommandBase {
  kind: "draw";
  source: "fill-paths";
  first: number;
  count: number;
  /** Canonical paint, or -1 inside an uncolored Type3/pattern program to inherit it. */
  paintIndex: number;
}

/** Zero-copy run over `stores.strokes.*` from the dense compiler. */
export interface HeprStrokeSegmentDrawRun extends HeprCommandBase {
  kind: "draw";
  source: "stroke-segments";
  first: number;
  count: number;
  /** Canonical paint, or -1 inside an uncolored Type3/pattern program to inherit it. */
  paintIndex: number;
}

export interface HeprGlyphDrawRun extends HeprCommandBase {
  kind: "draw";
  source: "glyphs";
  first: number;
  count: number;
  fillPaintIndex: number;
  strokePaintIndex: number;
  strokeStyleIndex: number;
  /** PDF text rendering mode 0..7. */
  renderingMode: number;
}

export interface HeprImageDrawRun extends HeprCommandBase {
  kind: "draw";
  source: "images";
  first: number;
  count: number;
  /**
   * Current nonstroking paint for stencil image masks; -1 for ordinary images
   * or for a stencil inside an uncolored Type3/pattern program that inherits paint.
   */
  paintIndex: number;
}

export interface HeprMeshDrawRun extends HeprCommandBase {
  kind: "draw";
  source: "meshes";
  first: number;
  count: number;
}

export interface HeprGradientDrawRun extends HeprCommandBase {
  kind: "draw";
  source: "gradients";
  first: number;
  count: number;
}

export interface HeprPatternDrawRun extends HeprCommandBase {
  kind: "draw";
  source: "patterns";
  first: number;
  count: number;
}

export type DrawRun =
  | HeprPathDrawRun
  | HeprFillPathDrawRun
  | HeprStrokeSegmentDrawRun
  | HeprGlyphDrawRun
  | HeprImageDrawRun
  | HeprMeshDrawRun
  | HeprGradientDrawRun
  | HeprPatternDrawRun;

/** Invoke a reusable Form XObject or Type3 CharProc program. */
export interface InvokeProgram extends HeprCommandBase {
  kind: "invoke-program";
  programIndex: number;
  /** Paint inherited by a Type3 program, or -1 when no source paint is required. */
  type3PaintIndex: number;
  /** `HEPR_VIEW_TRANSFORM_FLAG` bits; zero for ordinary resource invocations. */
  viewTransformFlags: number;
}

/** Invoke a transparency/compositing group at this exact paint position. */
export interface InvokeGroup extends HeprCommandBase {
  kind: "invoke-group";
  groupIndex: number;
}

export type HeprDisplayCommand = DrawRun | InvokeProgram | InvokeGroup;

export interface HeprCompositeGroup {
  /** Commands execute strictly in array order. */
  commands: readonly HeprDisplayCommand[];
  isolated: boolean;
  knockout: boolean;
  blendMode: PdfBlendMode;
  alpha: number;
  /** PDF alpha-source flag: true applies alpha/mask to shape, false to opacity. */
  alphaIsShape: boolean;
  softMaskGroupIndex: number;
  /** PDF soft-mask subtype applied to this group's result, or null. */
  softMaskSubtype: "Alpha" | "Luminosity" | null;
  /** Page function index for the mask transfer function, or -1 for identity. */
  softMaskTransferFunctionIndex: number;
  backdropPaintIndex: number;
  blendingColorSpaceIndex: number;
  clipIndex: number;
}

export interface HeprReusableProgram {
  kind: "form" | "type3" | "pattern";
  commands: readonly HeprDisplayCommand[];
  matrixIndex: number;
  bounds: PdfBox | null;
  clipToBounds: boolean;
  /** Stable within this page and useful in diagnostics only. */
  resourceName: string | null;
}

export interface HeprPageDisplayProgram {
  rootGroupIndex: number;
  groups: readonly HeprCompositeGroup[];
  programs: readonly HeprReusableProgram[];
}

/** Mandatory searchable text and geometry mapping for one page. */
export interface HeprTextIndex {
  version: 1;
  text: string;
  /**
   * One entry per UTF-16 code unit. A nonnegative value references a glyph
   * instance. `-1` is a separator. Values <= -2 reference fallback quad
   * `(-value - 2)`.
   */
  charGlyphIndices: Int32Array;
  /** Four floats per fallback quad in page-native coordinates. */
  fallbackQuads: Float32Array;
}

export interface HeprPageData {
  kind: "hepr-page";
  version: HeprDocumentDataVersion;
  pageInfo: Readonly<PdfPageInfo>;
  displayProgram: HeprPageDisplayProgram;
  stores: HeprPageStores;
  textIndex: HeprTextIndex;
  diagnostics: readonly PdfDiagnostic[];
}

export interface HeprDocumentData {
  kind: "hepr-document";
  version: HeprDocumentDataVersion;
  info: Readonly<PdfDocumentInfo>;
  pages: readonly HeprPageData[];
  diagnostics: readonly PdfDiagnostic[];
}

/** Create canonical empty stores for a page compiler or fixture. */
export function createEmptyHeprPageStores(): HeprPageStores {
  return {
    transforms: { values: new Float32Array([1, 0, 0, 1, 0, 0]) },
    paths: {
      pathVerbOffsets: new Uint32Array([0]),
      verbs: new Uint8Array(0),
      verbCoordinateOffsets: new Uint32Array([0]),
      coordinates: new Float32Array(0),
      bounds: new Float32Array(0),
      flags: new Uint8Array(0),
      fillPathMetaA: new Float32Array(0),
      fillPathMetaB: new Float32Array(0),
      fillPathMetaC: new Float32Array(0),
      fillSegmentsA: new Float32Array(0),
      fillSegmentsB: new Float32Array(0)
    },
    strokes: {
      endpoints: new Float32Array(0),
      primitiveMeta: new Float32Array(0),
      primitiveBounds: new Float32Array(0),
      styles: new Float32Array(0),
      lineWidths: new Float32Array(0),
      miterLimits: new Float32Array(0),
      lineCaps: new Uint8Array(0),
      lineJoins: new Uint8Array(0),
      flags: new Uint8Array(0),
      dashOffsets: new Uint32Array([0]),
      dashValues: new Float32Array(0),
      dashPhases: new Float32Array(0)
    },
    glyphs: {
      fontIndices: new Uint32Array(0),
      characterCodes: new Uint32Array(0),
      glyphIds: new Uint32Array(0),
      transformIndices: new Uint32Array(0),
      advances: new Float32Array(0),
      flags: new Uint8Array(0)
    },
    fonts: {
      names: [],
      kinds: new Uint8Array(0),
      unitsPerEm: new Uint32Array(0),
      ascents: new Float32Array(0),
      descents: new Float32Array(0),
      glyphOffsets: new Uint32Array([0]),
      glyphIds: new Uint32Array(0),
      outlinePathStarts: new Uint32Array(0),
      outlinePathCounts: new Uint32Array(0),
      type3ProgramIndices: new Int32Array(0)
    },
    images: {
      widths: new Uint32Array(0),
      heights: new Uint32Array(0),
      bitsPerComponent: new Uint8Array(0),
      formats: new Uint8Array(0),
      colorSpaceIndices: new Int32Array(0),
      interpolate: new Uint8Array(0),
      imageMask: new Uint8Array(0),
      softMaskImageIndices: new Int32Array(0),
      colorKeyMaskOffsets: new Uint32Array([0]),
      colorKeyMaskValues: new Int32Array(0),
      decodeOffsets: new Uint32Array([0]),
      decodeValues: new Float32Array(0),
      matteOffsets: new Uint32Array([0]),
      matteValues: new Float32Array(0),
      dataOffsets: new Uint32Array([0]),
      data: new Uint8Array(0)
    },
    meshes: {
      kinds: new Uint8Array(0),
      vertexOffsets: new Uint32Array([0]),
      indexOffsets: new Uint32Array([0]),
      positions: new Float32Array(0),
      colors: new Float32Array(0),
      indices: new Uint32Array(0),
      colorSpaceIndices: new Int32Array(0)
    },
    functions: {
      kinds: new Uint8Array(0),
      domainOffsets: new Uint32Array([0]),
      domains: new Float32Array(0),
      rangeOffsets: new Uint32Array([0]),
      ranges: new Float32Array(0),
      parameterOffsets: new Uint32Array([0]),
      parameters: new Float32Array(0),
      sampleOffsets: new Uint32Array([0]),
      samples: new Float32Array(0),
      calculatorOffsets: new Uint32Array([0]),
      calculatorBytecode: new Uint8Array(0)
    },
    gradients: {
      kinds: new Uint8Array(0),
      colorSpaceIndices: new Int32Array(0),
      functionIndices: new Int32Array(0),
      coordinateOffsets: new Uint32Array([0]),
      coordinates: new Float32Array(0),
      stopOffsets: new Uint32Array([0]),
      stopPositions: new Float32Array(0),
      stopPaintIndices: new Uint32Array(0),
      meshIndices: new Int32Array(0),
      extendFlags: new Uint8Array(0)
    },
    patterns: {
      kinds: new Uint8Array(0),
      paintTypes: new Uint8Array(0),
      tilingTypes: new Uint8Array(0),
      bounds: new Float32Array(0),
      xSteps: new Float32Array(0),
      ySteps: new Float32Array(0),
      matrixIndices: new Uint32Array(0),
      programIndices: new Int32Array(0),
      gradientIndices: new Int32Array(0),
      underlyingColorSpaceIndices: new Int32Array(0)
    },
    clips: {
      parentIndices: new Int32Array(0),
      firstPaths: new Uint32Array(0),
      pathCounts: new Uint32Array(0),
      firstGlyphs: new Uint32Array(0),
      glyphCounts: new Uint32Array(0),
      fillRules: new Uint8Array(0),
      transformIndices: new Uint32Array(0)
    },
    colors: {
      spaceKinds: new Uint8Array(0),
      componentCounts: new Uint8Array(0),
      alternateSpaceIndices: new Int32Array(0),
      functionIndices: new Int32Array(0),
      parameterOffsets: new Uint32Array([0]),
      parameters: new Float32Array(0),
      nameOffsets: new Uint32Array([0]),
      names: [],
      profileOffsets: new Uint32Array([0]),
      profiles: new Uint8Array(0),
      lookupOffsets: new Uint32Array([0]),
      lookupBytes: new Uint8Array(0)
    },
    paints: {
      kinds: new Uint8Array(0),
      resourceIndices: new Uint32Array(0),
      alphas: new Float32Array(0),
      overprint: new Uint8Array(0),
      overprintModes: new Uint8Array(0),
      patternTransformIndices: new Int32Array(0),
      patternBasePaintIndices: new Int32Array(0)
    },
    optionalContent: {
      names: [],
      defaultVisible: new Uint8Array(0)
    },
    markedContent: {
      tags: [],
      propertyNames: [],
      mcids: new Int32Array(0),
      parentIndices: new Int32Array(0)
    }
  };
}

/** Create a valid empty root display program. */
export function createEmptyHeprDisplayProgram(): HeprPageDisplayProgram {
  return {
    rootGroupIndex: 0,
    groups: [
      {
        commands: [],
        isolated: true,
        knockout: false,
        blendMode: "Normal",
        alpha: 1,
        alphaIsShape: false,
        softMaskGroupIndex: -1,
        softMaskSubtype: null,
        softMaskTransferFunctionIndex: -1,
        backdropPaintIndex: -1,
        blendingColorSpaceIndex: -1,
        clipIndex: -1
      }
    ],
    programs: []
  };
}

export function createEmptyHeprTextIndex(): HeprTextIndex {
  return {
    version: 1,
    text: "",
    charGlyphIndices: new Int32Array(0),
    fallbackQuads: new Float32Array(0)
  };
}

/** Create a valid resource-owning page shell for incremental compilation. */
export function createEmptyHeprPageData(
  pageInfo: Readonly<PdfPageInfo>,
  diagnostics: readonly PdfDiagnostic[] = []
): HeprPageData {
  return {
    kind: "hepr-page",
    version: HEPR_DOCUMENT_DATA_VERSION,
    pageInfo,
    displayProgram: createEmptyHeprDisplayProgram(),
    stores: createEmptyHeprPageStores(),
    textIndex: createEmptyHeprTextIndex(),
    diagnostics
  };
}

/**
 * Return each unique transferable `ArrayBuffer` owned by the supplied HEPR
 * value. SharedArrayBuffer-backed views remain shared and are omitted.
 */
export function collectHeprTransferables(
  value: HeprPageData | HeprDocumentData
): ArrayBuffer[] {
  const buffers = new Set<ArrayBuffer>();
  const visited = new Set<object>();

  const visit = (entry: unknown): void => {
    if (typeof entry !== "object" || entry === null) {
      return;
    }
    if (visited.has(entry)) {
      return;
    }
    visited.add(entry);

    if (ArrayBuffer.isView(entry)) {
      if (entry.buffer instanceof ArrayBuffer) {
        buffers.add(entry.buffer);
      }
      return;
    }
    if (entry instanceof ArrayBuffer) {
      buffers.add(entry);
      return;
    }
    if (Array.isArray(entry)) {
      for (const item of entry) {
        visit(item);
      }
      return;
    }
    for (const item of Object.values(entry)) {
      visit(item);
    }
  };

  visit(value);
  return [...buffers];
}
