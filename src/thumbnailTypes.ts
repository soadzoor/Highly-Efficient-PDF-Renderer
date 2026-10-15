import type { OptionalContentSnapshot } from "./optionalContent";
import type { VectorScene } from "./pdfVectorExtractor";
import type { HeprPageData } from "./heprDocumentData";
import type { PdfResourceLimits } from "./pdf/nativeTypes";

/** Shared endpoint quantization for smooth one-pixel thumbnail strokes. */
export const THUMBNAIL_STROKE_SUBPIXELS = 4;

/** Internal output-space grid used only by disposable Canvas thumbnail preparation. */
export interface ThumbnailStrokePixelSize {
  readonly width: number;
  readonly height: number;
  readonly subpixels: number;
}

/** Internal, clone-safe options shared by preparation and snapshot rendering. */
export interface ThumbnailRenderOptions {
  readonly maxDimension: number;
  readonly background: readonly [number, number, number, number];
  readonly backend: "auto" | "webgl" | "canvas2d";
  readonly optionalContent?: OptionalContentSnapshot;
  readonly vectorOverride?: readonly [number, number, number, number];
  /** Reader-only viewing policy; public thumbnails retain scan appearance. */
  readonly ocrTextOnly?: boolean;
}

/** Newly owned, straight-alpha sRGB pixels in top-to-bottom row order. */
export interface ThumbnailPixels {
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array<ArrayBuffer>;
  /** Clone-safe CPU durations; draw measures submission, readback includes its wait. */
  readonly timings?: readonly ThumbnailStageTiming[];
}

export interface ThumbnailStageTiming {
  readonly stage: "prepare" | "factory" | "upload" | "draw" | "readback";
  readonly durationMs: number;
}

/** Worker WebGL can be unavailable while the owning browser can render the prepared scene. */
export type ThumbnailCanvas2dLimits = Pick<PdfResourceLimits, "maxImagePixels" | "maxDecodedStreamBytes">;
export type ThumbnailPageResult = ThumbnailPixels
  | { readonly scene: VectorScene; readonly page?: HeprPageData; readonly limits?: ThumbnailCanvas2dLimits;
      readonly timings?: readonly ThumbnailStageTiming[] }
  | { readonly page: HeprPageData; readonly limits?: ThumbnailCanvas2dLimits; readonly timings?: readonly ThumbnailStageTiming[] };

export function thumbnailSize(width: number, height: number, maxDimension: number): { width: number; height: number; scale: number } {
  if (!Number.isSafeInteger(maxDimension) || maxDimension < 1) throw new RangeError("maxDimension must be a positive safe integer.");
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new RangeError("A thumbnail requires positive finite page dimensions.");
  }
  const scale = maxDimension / Math.max(width, height);
  return { width: Math.max(1, Math.min(maxDimension, Math.round(width * scale))),
    height: Math.max(1, Math.min(maxDimension, Math.round(height * scale))), scale };
}
