import type { HeprPageData } from "./heprDocumentData";
import { PdfError, type PdfDiagnostic } from "./pdf/nativeTypes";
import { createNativeCompositeSurfaceFactory, renderNativeCompositePixels } from "./retainedPageCompositor";
import { thumbnailSize, type ThumbnailCanvas2dLimits, type ThumbnailPixels, type ThumbnailRenderOptions } from "./thumbnailTypes";

/** Retained snapshot fallback shared by parser workers and DOM-only browser hosts. */
export async function renderThumbnailPageCanvas2d(page: HeprPageData, options: ThumbnailRenderOptions,
  signal?: AbortSignal, limits?: ThumbnailCanvas2dLimits,
  onDiagnostic?: (diagnostic: PdfDiagnostic) => void, trustedPage = false): Promise<ThumbnailPixels> {
  signal?.throwIfAborted();
  const size = thumbnailSize(page.pageInfo.width, page.pageInfo.height, options.maxDimension);
  const factoryStarted = performance.now();
  const factory = await createNativeCompositeSurfaceFactory({ domFallback: true });
  try {
    signal?.throwIfAborted();
    const { renderHeprPageToCanvas2d } = await import("./heprCanvas2dRenderer");
    signal?.throwIfAborted();
    const factoryMs = performance.now() - factoryStarted;
    let surfaceMs = 0;
    const measuredFactory = Object.assign((width: number, height: number) => {
      const started = performance.now();
      try { return factory(width, height); }
      finally { surfaceMs += performance.now() - started; }
    }, factory);
    const timings = { renderMs: 0, imageSurfaceMs: 0, imageSurfaces: 0, imageSurfacePixels: 0,
      imageSurfaceHits: 0, softMaskMs: 0, softMaskPixels: 0, readbackMs: 0, readbackPixels: 0, renders: 0 };
    const pixels = await renderNativeCompositePixels(page, { scale: size.scale, background: options.background,
      signal, surfaceFactory: measuredFactory, maxCanvasPixels: limits?.maxImagePixels,
      maxWorkingPixels: limits === undefined ? undefined : Math.floor(limits.maxDecodedStreamBytes / 4),
      onDiagnostic }, renderHeprPageToCanvas2d,
    { timings, vectorOverride: options.vectorOverride, outputSize: size, thumbnail: true, thumbnailPixelStrokes: true, trustedPage });
    signal?.throwIfAborted();
    // Native Canvas backends can return external, non-transferable buffers.
    return { width: pixels.width, height: pixels.height, rgba: Uint8Array.from(pixels.rgba),
      timings: [{ stage: "factory", durationMs: factoryMs + surfaceMs }, { stage: "draw", durationMs: Math.max(0, timings.renderMs - surfaceMs) },
        { stage: "readback", durationMs: timings.readbackMs }] };
  } catch (error) {
    signal?.throwIfAborted();
    // Canvas wraps a throwing surface factory; preserve a capability failure
    // so the parser can return its prepared page to a DOM-only owning host.
    const seen = new Set<unknown>();
    for (let cause: unknown = error; cause && typeof cause === "object" && !seen.has(cause);
      cause = (cause as { cause?: unknown }).cause) {
      if (cause instanceof PdfError && cause.details?.reason === "selective-composite-surface") throw cause;
      seen.add(cause);
    }
    throw error;
  } finally { factory.releaseAll(); }
}
