import type { PdfObjectSource } from "./pdfObjectGenerator";
import type { PdfDiagnostic } from "./pdf/nativeTypes";
import type { PrimitiveColorInput } from "./colorInput";
import type { DocumentSessionOpenOptions } from "./documentSession";
import { waitForLoad } from "./loadCancellation";
import type { ThumbnailStageTiming } from "./thumbnailTypes";
import { normalizeThumbnailOptions } from "./thumbnailOptions";

export { normalizeThumbnailOptions } from "./thumbnailOptions";

export interface PdfThumbnailOptions {
  /** One-based source page number. @default 1 */
  page?: number;
  /** Longest output side in pixels; independent of devicePixelRatio. @default 400 */
  maxDimension?: number;
  /** Existing HEPR colors or "transparent". @default "#ffffff" */
  background?: PrimitiveColorInput;
  /** WebP is encoded losslessly. @default "webp" */
  format?: "webp" | "png";
  /** Auto prefers lightweight WebGL. Canvas2D is available for PDF inputs. */
  backend?: "auto" | "webgl" | "canvas2d";
  signal?: AbortSignal;
  onDiagnostic?: (diagnostic: PdfDiagnostic) => void;
  /** Optional measurements for browser comparisons; durations are milliseconds. */
  onTiming?: (timing: PdfThumbnailTiming) => void;
}

export interface PdfThumbnailTiming {
  readonly stage: ThumbnailStageTiming["stage"] | "source-open" | "prepare-render" | "encode" | "total";
  readonly durationMs: number;
}

export interface PdfThumbnailResult {
  readonly blob: Blob;
  readonly width: number;
  readonly height: number;
}

/** Render a fast overview of one PDF/HEP page without constructing a viewer. */
export async function renderPdfThumbnail(
  source: PdfObjectSource,
  options: PdfThumbnailOptions & DocumentSessionOpenOptions = {}
): Promise<PdfThumbnailResult> {
  normalizeThumbnailOptions(options);
  const started = performance.now();
  const { openDocumentSession } = await waitForLoad(import("./documentSession"), options.signal);
  const session = await openDocumentSession(source, options);
  let failed = true;
  let result: PdfThumbnailResult;
  try {
    options.signal?.throwIfAborted();
    options.onTiming?.({ stage: "source-open", durationMs: performance.now() - started });
    result = await session.renderThumbnail({ ...options,
      onTiming: options.onTiming ? timing => { if (timing.stage !== "total") options.onTiming!(timing); } : undefined });
    options.signal?.throwIfAborted();
    failed = false;
  } finally {
    // Preserve the operation's own error/abort reason if cleanup also fails.
    if (failed) await session.close().catch(() => undefined);
    else await session.close();
  }
  options.signal?.throwIfAborted();
  options.onTiming?.({ stage: "total", durationMs: performance.now() - started });
  options.signal?.throwIfAborted();
  return result;
}

