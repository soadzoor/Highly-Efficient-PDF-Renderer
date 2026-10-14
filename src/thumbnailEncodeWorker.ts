import { encodeThumbnailPixelsDirect, type ThumbnailEncodingFormat } from "./thumbnailEncodingCore";
import type { ThumbnailEncodeResponse } from "./thumbnailEncoder";
import type { PdfDiagnostic } from "./pdf/nativeTypes";
import type { ThumbnailPixels } from "./thumbnailTypes";

const host = globalThis as unknown as {
  onmessage: ((event: MessageEvent<{ id: number; pixels: ThumbnailPixels; format: ThumbnailEncodingFormat }>) => void) | null;
  postMessage(response: ThumbnailEncodeResponse): void;
};
host.onmessage = event => {
  const { id, pixels, format } = event.data;
  const diagnostics: PdfDiagnostic[] = [];
  void encodeThumbnailPixelsDirect(pixels, format, undefined, diagnostic => diagnostics.push(diagnostic)).then(
    blob => host.postMessage({ id, blob, diagnostics }),
    error => host.postMessage({ id, error: error instanceof Error ? error.message : String(error), diagnostics })
  );
};
