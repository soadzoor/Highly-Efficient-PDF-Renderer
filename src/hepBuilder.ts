import type { HepLodOptions } from "./hepLod";
import type { PdfObjectSource } from "./pdfObjectGenerator";
import type { VectorScene } from "./pdfVectorExtractor";
import type { LoadProgressCallback } from "./loadProgress";
import type { PdfIccOptions } from "./pdf/nativeIcc";
import type { PdfDiagnostic } from "./pdf/nativeTypes";
import type { NativeImageCodecResolver } from "./pdf/nativeImage";
import type { AnnotationAppearanceMode } from "./annotationData";
import { waitForLoad } from "./loadCancellation";
import { validateSourcePdfByteLength } from "./hepSizePolicy";

/** Compression algorithm used inside a generated HEP file. */
export type HepCompression = "deflate" | "store";

/** Options shared by PDF-source and already-parsed scene HEP builds. */
export interface HepEncodingOptions extends HepLodOptions {
  /** Override the source name written to the HEP manifest. */
  sourceLabel?: string;

  /** Original PDF byte length; warn when the generated HEP is at least as large. */
  sourcePdfByteLength?: number;

  /** Receives export warnings, including a HEP larger than the original PDF. */
  onWarning?: (message: string) => void;

  /** Encode color rasters as WebP/PNG when supported. Monochrome layers always retain packed bits. @default true */
  encodeRasterImages?: boolean;

  /** HEP compression algorithm. @default "deflate" */
  compression?: HepCompression;

  /** Receives normalized progress for the complete parse-and-build operation. */
  onProgress?: LoadProgressCallback;

  /** Cancels raster compression and HEP generation when aborted. */
  signal?: AbortSignal;
}

/**
 * Options when building complete parsed data directly from a PDF source.
 * Viewing options (compressScans, ocrTextOnly, pageLoading) do not apply here.
 * HEP stores canonical image pixels; GPU display preparations are not serialized.
 */
export interface BuildHepFromPdfOptions extends HepEncodingOptions, PdfIccOptions {
  /** Optional raw-sample image decoder; omitted uses the bundled codecs. */
  imageCodecResolver?: NativeImageCodecResolver;
  /** Receives PDF diagnostics, including warnings when ICC fallback is used. */
  onDiagnostic?: (diagnostic: PdfDiagnostic) => void;

  /**
   * User or owner password for a PDF that requires one to open. The HEP file
   * stores the decrypted content and is not password protected.
   */
  password?: string;

  /** Merge compatible adjacent vector stroke segments during parsing. @default true */
  segmentMerge?: boolean;

  /** Drop vector content known to be invisible during parsing. @default true */
  invisibleCull?: boolean;

  /** One-based PDF page selection such as `"1-5, 8, 11-13"`. */
  pages?: string;

  /** Maximum pages per row in the composed scene. */
  maxPagesPerRow?: number;

  /**
   * Which annotation appearances are compiled into page content. The HEP
   * records the mode; annotation metadata is kept in every mode.
   * @default "render"
   */
  annotationAppearances?: AnnotationAppearanceMode;
}

/** Options when building parsed data from an existing HEPR scene. */
export type BuildHepFromSceneOptions = HepEncodingOptions;

/**
 * Build a HEP parsed-data file from a PDF source.
 *
 * Accepted inputs are URLs/paths, raw base64 or data URLs, `File`, `Blob`,
 * `Uint8Array`, and `ArrayBuffer` values.
 */
export function buildHep(
  source: PdfObjectSource,
  options?: BuildHepFromPdfOptions
): Promise<Blob>;

/** Build a HEP parsed-data file from an already-parsed scene without parsing again. */
export function buildHep(
  scene: VectorScene,
  options?: BuildHepFromSceneOptions
): Promise<Blob>;

export async function buildHep(
  input: PdfObjectSource | VectorScene,
  options: BuildHepFromPdfOptions | BuildHepFromSceneOptions = {}
): Promise<Blob> {
  validateEncodingOptions(options);
  options.signal?.throwIfAborted();
  const { buildHepRuntime } = await waitForLoad(import("./hepBuilderRuntime"), options.signal);
  options.signal?.throwIfAborted();
  return buildHepRuntime(input, options);
}

function validateEncodingOptions(options: HepEncodingOptions): void {
  validateSourcePdfByteLength(options.sourcePdfByteLength);
  if (options.vectorLodPrecision !== undefined && !["lossless", "compact"].includes(options.vectorLodPrecision)) {
    throw new RangeError("vectorLodPrecision must be lossless or compact.");
  }
  for (const key of ["withVectorLod", "withTextLod"] as const) {
    if (options[key] !== undefined && typeof options[key] !== "boolean") throw new RangeError(`${key} must be a boolean.`);
  }
  if ("sourcePdf" in options || "sourcePdfPages" in options) {
    throw new RangeError("sourcePdf and sourcePdfPages are no longer supported; HEP v7 requires a complete scene. Reparse the original PDF before export.");
  }
  if ("compressionLevel" in options) {
    throw new RangeError("compressionLevel is no longer supported; native HEP compression uses the platform default.");
  }
  if (
    options.compression !== undefined &&
    options.compression !== "deflate" &&
    options.compression !== "store"
  ) {
    throw new RangeError('compression must be either "deflate" or "store".');
  }
}
