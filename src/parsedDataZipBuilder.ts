import {
  loadPdfSceneFromSource,
  readPdfObjectSourceBytes,
  type PdfObjectSource
} from "./pdfObjectGenerator";
import {
  buildParsedDataZipBlobForLayout,
  listSceneRasterLayers,
  type SceneTextureStats
} from "./parsedDataZip";
import type { VectorScene } from "./pdfVectorExtractor";
import {
  createLoadProgressReporter,
  type LoadProgressCallback,
  type PDFLoadProgress
} from "./loadProgress";
import { hasPdfHeader } from "./pdfSignature";

/** Compression algorithm used inside a generated HEP file. */
export type ParsedDataZipCompression = "deflate" | "store";

/** Options shared by PDF-source and already-parsed scene HEP builds. */
export interface ParsedDataZipEncodingOptions {
  /** Override the source name written to the HEP manifest. */
  sourceLabel?: string;

  /** Encode raster layers as WebP/PNG when supported; otherwise store raw RGBA. @default true */
  encodeRasterImages?: boolean;

  /** ZIP compression algorithm. @default "deflate" */
  compression?: ParsedDataZipCompression;

  /** DEFLATE compression level from 1 (fastest) to 9 (smallest). @default 9 */
  compressionLevel?: number;

  /** Receives normalized progress for the complete parse-and-build operation. */
  onProgress?: LoadProgressCallback;

  /** Cancels raster compression and HEP generation when aborted. */
  signal?: AbortSignal;
}

/** Options when building parsed data directly from an accepted PDF source. */
export interface BuildParsedDataZipFromPdfOptions extends ParsedDataZipEncodingOptions {
  /** Merge compatible adjacent vector stroke segments during parsing. @default true */
  segmentMerge?: boolean;

  /** Drop vector content known to be invisible during parsing. @default true */
  invisibleCull?: boolean;

  /** One-based PDF page selection such as `"1-5, 8, 11-13"`. */
  pages?: string;

  /** Maximum pages per row in the composed scene. */
  maxPagesPerRow?: number;
}

/** Options when building parsed data from an existing HEPR scene. */
export interface BuildParsedDataZipFromSceneOptions extends ParsedDataZipEncodingOptions {
  /**
   * Original PDF source used only when the scene reports images but contains no
   * extracted raster layers. It accepts the same source forms as `pdfObjectGenerator`.
   */
  sourcePdf?: PdfObjectSource;

  /**
   * Original PDF pages represented by the scene, used when restoring raster
   * layers from `sourcePdf` after loading the generated HEP file. Supply this when
   * the scene was parsed from a non-prefix selection such as `"3-5"`.
   */
  sourcePdfPages?: string;
}

/**
 * Build a HEP parsed-data file from a PDF source.
 *
 * Accepted inputs are URLs/paths, raw base64 or data URLs, `File`, `Blob`,
 * `Uint8Array`, and `ArrayBuffer` values.
 */
export function buildParsedDataZip(
  source: PdfObjectSource,
  options?: BuildParsedDataZipFromPdfOptions
): Promise<Blob>;

/** Build a HEP parsed-data file from an already-parsed scene without parsing again. */
export function buildParsedDataZip(
  scene: VectorScene,
  options?: BuildParsedDataZipFromSceneOptions
): Promise<Blob>;

export async function buildParsedDataZip(
  input: PdfObjectSource | VectorScene,
  options: BuildParsedDataZipFromPdfOptions | BuildParsedDataZipFromSceneOptions = {}
): Promise<Blob> {
  validateEncodingOptions(options);
  options.signal?.throwIfAborted();
  if (isVectorScene(input)) {
    return buildParsedDataZipFromScene(input, options as BuildParsedDataZipFromSceneOptions);
  }
  return buildParsedDataZipFromPdf(input, options as BuildParsedDataZipFromPdfOptions);
}

async function buildParsedDataZipFromPdf(
  source: PdfObjectSource,
  options: BuildParsedDataZipFromPdfOptions
): Promise<Blob> {
  const progress = createLoadProgressReporter(options.onProgress);
  const parseProgress = progress.child(0, 0.82, { sourceType: "pdf" });
  const loaded = await loadPdfSceneFromSource(source, {
    segmentMerge: options.segmentMerge,
    invisibleCull: options.invisibleCull,
    pages: options.pages,
    maxPagesPerRow: options.maxPagesPerRow,
    sourceKind: "pdf",
    onProgress: (payload) => forwardParseProgress(parseProgress, payload)
  }, options.signal);
  options.signal?.throwIfAborted();
  const rasterLayers = listSceneRasterLayers(loaded.scene);
  const sourcePdfBytes = needsSourcePdfFallback(loaded.scene, rasterLayers.length)
    ? loaded.sourceBytes
    : null;
  const result = await buildSceneZip(
    loaded.scene,
    normalizeSourceLabel(options.sourceLabel, loaded.sourceLabel),
    sourcePdfBytes,
    rasterLayers,
    options.pages,
    options,
    progress.child(0.82, 1, { sourceType: "pdf" })
  );
  progress.complete({ sourceType: "pdf" });
  return result;
}

async function buildParsedDataZipFromScene(
  scene: VectorScene,
  options: BuildParsedDataZipFromSceneOptions
): Promise<Blob> {
  const progress = createLoadProgressReporter(options.onProgress);
  options.signal?.throwIfAborted();
  const rasterLayers = listSceneRasterLayers(scene);
  const needsFallback = needsSourcePdfFallback(scene, rasterLayers.length);
  let sourcePdfBytes: Uint8Array | null = null;
  let buildStart = 0;

  if (needsFallback) {
    if (options.sourcePdf === undefined) {
      throw new Error(
        "This scene contains PDF image operations but no extracted raster layers. " +
        "Pass options.sourcePdf so the generated HEP file can preserve the missing image content."
      );
    }
    buildStart = 0.16;
    sourcePdfBytes = await readPdfObjectSourceBytes(
      options.sourcePdf,
      progress.child(0, buildStart, { sourceType: "pdf" }),
      options.signal
    );
    options.signal?.throwIfAborted();
    if (!hasPdfHeader(sourcePdfBytes)) {
      throw new Error("options.sourcePdf does not contain PDF data.");
    }
  }

  const result = await buildSceneZip(
    scene,
    normalizeSourceLabel(options.sourceLabel, "document.pdf"),
    sourcePdfBytes,
    rasterLayers,
    options.sourcePdfPages,
    options,
    progress.child(buildStart, 1)
  );
  progress.complete();
  return result;
}

async function buildSceneZip(
  scene: VectorScene,
  sourceLabel: string,
  sourcePdfBytes: Uint8Array | null,
  rasterLayers: ReturnType<typeof listSceneRasterLayers>,
  sourcePdfPages: string | undefined,
  options: ParsedDataZipEncodingOptions,
  progress: ReturnType<typeof createLoadProgressReporter>
): Promise<Blob> {
  assertCurrentVectorScene(scene);
  const compressionLevel =
    options.compression === "store" ? 9 : normalizeCompressionLevel(options.compressionLevel);
  const result = await buildParsedDataZipBlobForLayout(
    scene,
    buildSceneTextureStats(scene),
    sourceLabel,
    sourcePdfBytes,
    "interleaved",
    rasterLayers,
    {
      encodeRasterImages: options.encodeRasterImages ?? true,
      zipCompression: options.compression === "store" ? "STORE" : "DEFLATE",
      zipDeflateLevel: compressionLevel,
      sourcePdfPages,
      signal: options.signal,
      onBuildProgress: (value, buildProgress) => {
        progress.report(value, {
          stage: buildProgress.stage,
          unit: buildProgress.unit,
          processed: buildProgress.processed,
          total: buildProgress.total
        });
      }
    }
  );
  return result.blob;
}

function assertCurrentVectorScene(scene: VectorScene): void {
  const counts = [
    scene.gradientCount,
    scene.gradientFillPathCount,
    scene.gradientFillSegmentCount,
    scene.gradientStrokeRunCount,
    scene.gradientStrokeSegmentCount
  ];
  const floatResources = [
    scene.gradientMetaA,
    scene.gradientMetaB,
    scene.gradientMetaC,
    scene.gradientMetaD,
    scene.gradientMetaE,
    scene.gradientFillPathMetaA,
    scene.gradientFillPathMetaB,
    scene.gradientFillPathMetaC,
    scene.gradientFillPaintMeta,
    scene.gradientFillSegmentsA,
    scene.gradientFillSegmentsB,
    scene.gradientStrokeRunMetaA,
    scene.gradientStrokeRunMetaB,
    scene.gradientStrokeEndpoints,
    scene.gradientStrokePrimitiveMeta,
    scene.gradientStrokePrimitiveBounds,
    scene.gradientStrokeStyles
  ];
  if (
    counts.some((value) => !Number.isInteger(value) || value < 0) ||
    floatResources.some((value) => !(value instanceof Float32Array)) ||
    !(scene.gradientLut instanceof Uint8Array)
  ) {
    throw new Error(
      "VectorScene is missing the native-gradient resources required by HEP format v6."
    );
  }
}

function buildSceneTextureStats(scene: VectorScene): SceneTextureStats {
  const fillPath = chooseTextureDimensions(scene.fillPathCount);
  const fillSegment = chooseTextureDimensions(scene.fillSegmentCount);
  const stroke = chooseTextureDimensions(scene.segmentCount);
  const textInstance = chooseTextureDimensions(scene.textInstanceCount);
  const textGlyph = chooseTextureDimensions(scene.textGlyphCount);
  const textSegment = chooseTextureDimensions(scene.textGlyphSegmentCount);
  const gradient = chooseTextureDimensions(scene.gradientCount);
  const gradientFillPath = chooseTextureDimensions(scene.gradientFillPathCount);
  const gradientFillSegment = chooseTextureDimensions(scene.gradientFillSegmentCount);
  const gradientStrokeRun = chooseTextureDimensions(scene.gradientStrokeRunCount);
  const gradientStrokeSegment = chooseTextureDimensions(scene.gradientStrokeSegmentCount);
  return {
    fillPathTextureWidth: fillPath.width,
    fillPathTextureHeight: fillPath.height,
    fillSegmentTextureWidth: fillSegment.width,
    fillSegmentTextureHeight: fillSegment.height,
    textureWidth: stroke.width,
    textureHeight: stroke.height,
    textInstanceTextureWidth: textInstance.width,
    textInstanceTextureHeight: textInstance.height,
    textGlyphTextureWidth: textGlyph.width,
    textGlyphTextureHeight: textGlyph.height,
    textSegmentTextureWidth: textSegment.width,
    textSegmentTextureHeight: textSegment.height,
    gradientTextureWidth: gradient.width,
    gradientTextureHeight: gradient.height,
    gradientFillPathTextureWidth: gradientFillPath.width,
    gradientFillPathTextureHeight: gradientFillPath.height,
    gradientFillSegmentTextureWidth: gradientFillSegment.width,
    gradientFillSegmentTextureHeight: gradientFillSegment.height,
    gradientStrokeRunTextureWidth: gradientStrokeRun.width,
    gradientStrokeRunTextureHeight: gradientStrokeRun.height,
    gradientStrokeSegmentTextureWidth: gradientStrokeSegment.width,
    gradientStrokeSegmentTextureHeight: gradientStrokeSegment.height
  };
}

function chooseTextureDimensions(itemCount: number): { width: number; height: number } {
  const normalizedCount = Number.isFinite(itemCount) ? Math.max(0, Math.trunc(itemCount)) : 0;
  const safeCount = Math.max(1, normalizedCount);
  const width = Math.ceil(Math.sqrt(safeCount));
  return {
    width,
    height: Math.max(1, Math.ceil(safeCount / width))
  };
}

function forwardParseProgress(
  target: ReturnType<typeof createLoadProgressReporter>,
  payload: PDFLoadProgress
): void {
  const { value, ...metadata } = payload;
  target.report(value, {
    ...metadata,
    stage: payload.stage === "complete" ? "compile" : payload.stage
  });
}

function normalizeSourceLabel(value: string | undefined, fallback: string): string {
  const trimmed = value?.trim();
  return trimmed ? trimmed : fallback;
}

function normalizeCompressionLevel(value: number | undefined): number {
  if (value === undefined) {
    return 9;
  }
  if (!Number.isInteger(value) || value < 1 || value > 9) {
    throw new RangeError("compressionLevel must be an integer from 1 to 9.");
  }
  return value;
}

function validateEncodingOptions(options: ParsedDataZipEncodingOptions): void {
  if (
    options.compression !== undefined &&
    options.compression !== "deflate" &&
    options.compression !== "store"
  ) {
    throw new RangeError('compression must be either "deflate" or "store".');
  }
  if (options.compression !== "store") {
    normalizeCompressionLevel(options.compressionLevel);
  }
}

function needsSourcePdfFallback(scene: VectorScene, rasterLayerCount: number): boolean {
  return scene.imagePaintOpCount > 0 && rasterLayerCount === 0;
}

function isVectorScene(value: PdfObjectSource | VectorScene): value is VectorScene {
  if (!value || typeof value !== "object") {
    return false;
  }
  const candidate = value as Partial<VectorScene>;
  return (
    typeof candidate.segmentCount === "number" &&
    candidate.endpoints instanceof Float32Array &&
    candidate.styles instanceof Float32Array
  );
}
