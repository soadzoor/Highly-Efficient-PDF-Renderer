import type { HepLodOptions } from "./hepLod";
import type { LoadProgressCallback } from "./loadProgress";

export interface ExportTextureEntry {
  name: string;
  filePath: string;
  width: number;
  height: number;
  logicalItemCount: number;
  logicalFloatCount: number;
  data: Uint8Array;
  componentType: TextureComponentType;
  layout: TextureLayout;
  quantizationMin?: number[];
  quantizationMax?: number[];
  byteShuffle?: boolean;
  predictor?: "none" | "xor-delta-u32";
  columnByteLengths?: number[];
}

export interface SceneTextureStats {
  fillPathTextureWidth: number;
  fillPathTextureHeight: number;
  fillSegmentTextureWidth: number;
  fillSegmentTextureHeight: number;
  textureWidth: number;
  textureHeight: number;
  textInstanceTextureWidth: number;
  textInstanceTextureHeight: number;
  textGlyphTextureWidth: number;
  textGlyphTextureHeight: number;
  textSegmentTextureWidth: number;
  textSegmentTextureHeight: number;
  gradientTextureWidth: number;
  gradientTextureHeight: number;
  gradientFillPathTextureWidth: number;
  gradientFillPathTextureHeight: number;
  gradientFillSegmentTextureWidth: number;
  gradientFillSegmentTextureHeight: number;
  gradientStrokeRunTextureWidth: number;
  gradientStrokeRunTextureHeight: number;
  gradientStrokeSegmentTextureWidth: number;
  gradientStrokeSegmentTextureHeight: number;
}

export type TextureLayout = "interleaved" | "channel-major";

export type TextureComponentType =
  | "float32"
  | "uint8-normalized"
  | "uint16-range-delta-columns";

export interface BuildHepBlobOptions extends HepLodOptions {
  encodeRasterImages?: boolean;
  compression?: "STORE" | "DEFLATE";
  signal?: AbortSignal;
  onBuildProgress?: (value: number, progress: HepBuildProgress) => void;
}

export interface HepBuildProgress {
  stage: "raster-encode" | "hep-build" | "vector-lod" | "text-lod";
  unit?: "texels";
  processed?: number;
  total?: number;
}

export interface LoadHepOptions {
  /** Stop loading between archive entries, image decodes, and retained resource reads. */
  signal?: AbortSignal;
  onProgress?: LoadProgressCallback;
}

export interface ParsedDataTextureEntry {
  name?: unknown;
  file?: unknown;
  componentType?: unknown;
  layout?: unknown;
  quantizationMin?: unknown;
  quantizationMax?: unknown;
  byteShuffle?: unknown;
  predictor?: unknown;
  logicalItemCount?: unknown;
  logicalFloatCount?: unknown;
  columnByteLengths?: unknown;
}

export interface ParsedDataSceneEntry {
  annotations?: unknown;
  structure?: unknown;
  retainedPages?: unknown;
  paintGraph?: unknown;
  optionalContent?: unknown;
  drawRuns?: unknown;
  clipPaths?: unknown;
  bounds?: unknown;
  pageBounds?: unknown;
  pageRects?: unknown;
  pageTextRanges?: unknown;
  pagePrimitiveRanges?: unknown;
  pageCount?: unknown;
  pagesPerRow?: unknown;
  maxHalfWidth?: unknown;
  imageLayerSegmentCount?: unknown;
  imagePaintOpCount?: unknown;
  pathCount?: unknown;
  sourceSegmentCount?: unknown;
  mergedSegmentCount?: unknown;
  segmentCount?: unknown;
  fillPathCount?: unknown;
  fillSegmentCount?: unknown;
  gradientCount?: unknown;
  gradientFillPathCount?: unknown;
  gradientFillSegmentCount?: unknown;
  gradientStrokeRunCount?: unknown;
  gradientStrokeSegmentCount?: unknown;
  sourceTextCount?: unknown;
  textInstanceCount?: unknown;
  textGlyphCount?: unknown;
  textGlyphPrimitiveCount?: unknown;
  textGlyphSegmentCount?: unknown;
  textInPageCount?: unknown;
  textOutOfPageCount?: unknown;
  discardedTransparentCount?: unknown;
  discardedDegenerateCount?: unknown;
  discardedDuplicateCount?: unknown;
  discardedContainedCount?: unknown;
  rasterLayers?: unknown;
}

export interface ParsedDataManifest {
  lod?: unknown;
  formatVersion?: unknown;
  sourceFile?: unknown;
  scene?: ParsedDataSceneEntry;
  textures?: ParsedDataTextureEntry[];
  textIndex?: unknown;
  strokeGeometry?: unknown;
  textInstances?: unknown;
  textGlyphSegments?: unknown;
  gradientLut?: unknown;
  gradientMesh?: unknown;
}

export interface ParsedDataGradientLutEntry {
  file?: unknown;
  width?: unknown;
  height?: unknown;
  byteLength?: unknown;
}

export interface HepBlobResult {
  blob: Blob;
  byteLength: number;
  textureCount: number;
  rasterLayerCount: number;
  layout: TextureLayout;
}

export interface TextIndexExportResult {
  json: string;
  charMapBytes: Uint8Array;
  optionalContentBytes: Uint8Array | null;
  fallbackBytes: Uint8Array | null;
  fallbackColumnByteLengths: number[];
  pageCount: number;
  totalCharCount: number;
  totalFallbackCount: number;
}

export interface TextIndexManifestMeta {
  version?: unknown;
  file?: unknown;
  charMapFile?: unknown;
  optionalContentFile?: unknown;
  fallbackFile?: unknown;
  fallbackColumnByteLengths?: unknown;
}

export interface TextIndexPageEntry {
  text?: unknown;
  fallbackCount?: unknown;
}

export interface StrokeGeometrySectionMeta {
  endpointsFile: string;
  metaFile: string;
  clipBoundsFile?: string;
  clippedSegmentCount?: number;
  segmentCount: number;
  curveCount: number;
  quantizationMin: number[];
  quantizationMax: number[];
  ctrlQuantizationMin: number[];
  ctrlQuantizationMax: number[];
  endpointColumnByteLengths: number[];
}

export interface TextInstancesSectionMeta {
  positionsFile: string;
  glyphIndexFile: string;
  glyphIndexFormat: "u16" | "u32";
  count: number;
  positionColumnByteLengths: number[];
  clipRectsFile?: string;
  clipReferencesFile?: string;
  clipRectCount?: number;
}

export interface StrokeGeometryExport {
  endpointsBytes: Uint8Array;
  metaBytes: Uint8Array;
  clipBoundsBytes?: Uint8Array;
  manifest: StrokeGeometrySectionMeta;
}

export interface TextInstancesExport {
  positionsBytes: Uint8Array;
  glyphIndexBytes: Uint8Array;
  clipReferenceBytes?: Uint8Array;
  clipRectBytes?: Uint8Array;
  manifest: TextInstancesSectionMeta;
}

export interface NativeGradientResources {
  gradientCount: number;
  gradientMetaA: Float32Array;
  gradientMetaB: Float32Array;
  gradientMetaC: Float32Array;
  gradientMetaD: Float32Array;
  gradientMetaE: Float32Array;
  gradientLut: Uint8Array;
  gradientFillPathCount: number;
  gradientFillSegmentCount: number;
  gradientFillPathMetaA: Float32Array;
  gradientFillPathMetaB: Float32Array;
  gradientFillPathMetaC: Float32Array;
  gradientFillPaintMeta: Float32Array;
  gradientFillSegmentsA: Float32Array;
  gradientFillSegmentsB: Float32Array;
  gradientStrokeRunCount: number;
  gradientStrokeSegmentCount: number;
  gradientStrokeRunMetaA: Float32Array;
  gradientStrokeRunMetaB: Float32Array;
  gradientStrokeEndpoints: Float32Array;
  gradientStrokePrimitiveMeta: Float32Array;
  gradientStrokePrimitiveBounds: Float32Array;
  gradientStrokeStyles: Float32Array;
}
