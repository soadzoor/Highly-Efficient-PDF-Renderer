import { normalizePrimitiveColor } from "./colorInput";
import type { PdfThumbnailOptions } from "./pdfThumbnail";
import type { ThumbnailRenderOptions } from "./thumbnailTypes";

/** @internal Validate before allocating a parser, renderer, or encoding worker.
 * Keep this leaf separate from public factories: runtime implementations must
 * not import their facades and create a cycle across dynamic import boundaries. */
export function normalizeThumbnailOptions(options: PdfThumbnailOptions): ThumbnailRenderOptions {
  options.signal?.throwIfAborted();
  if (!Number.isSafeInteger(options.page ?? 1) || (options.page ?? 1) < 1) throw new RangeError("page must be a positive one-based integer.");
  const maxDimension = options.maxDimension ?? 400;
  if (!Number.isSafeInteger(maxDimension) || maxDimension < 1) throw new RangeError("maxDimension must be a positive safe integer.");
  if (options.format !== undefined && options.format !== "webp" && options.format !== "png") throw new RangeError("format must be webp or png.");
  const backend = options.backend ?? "auto";
  if (!["auto", "webgl", "canvas2d"].includes(backend)) throw new RangeError("backend must be auto, webgl, or canvas2d.");
  const background: [number, number, number, number] = typeof options.background === "string" && options.background.trim().toLowerCase() === "transparent"
    ? [0, 0, 0, 0] : [...normalizePrimitiveColor(options.background ?? "#ffffff"), 1];
  return { maxDimension, background, backend };
}
